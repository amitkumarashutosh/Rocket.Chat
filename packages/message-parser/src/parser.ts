import type { IToken } from 'chevrotain';

import { MessageLexer, Escape, LiteralBackslash, DoubleNewLine, NewLine, Plain as PlainToken, SpecialChar, Email, Phone } from './lexer';

import { paragraph, plain, bold, lineBreak, reducePlainTexts, autoEmail, phoneChecker, link } from './utils';

import type { Root, Inlines, Markup } from './definitions';
import type { Options } from './index';

// =============================================================================
// TOKEN STREAM
// A simple cursor over the flat Chevrotain token array.
// Chevrotain handles lexing; this class handles navigation for the parser.
// =============================================================================

class TokenStream {
	private tokens: IToken[];
	private pos = 0;

	constructor(tokens: IToken[]) {
		this.tokens = tokens;
	}

	// Look at current token WITHOUT consuming
	peek(): IToken | undefined {
		return this.tokens[this.pos];
	}

	// Look ahead by N positions WITHOUT consuming
	peekAt(offset: number): IToken | undefined {
		return this.tokens[this.pos + offset];
	}

	// Consume and return current token
	consume(): IToken {
		return this.tokens[this.pos++];
	}

	// True if current token matches the given TokenType
	check(tokenType: { name: string }): boolean {
		return this.peek()?.tokenType.name === tokenType.name;
	}

	// True if current token matches AND has the given image text
	checkImage(tokenType: { name: string }, image: string): boolean {
		const tok = this.peek();
		return tok?.tokenType.name === tokenType.name && tok.image === image;
	}

	// Consume if matches, otherwise return undefined
	match(tokenType: { name: string }): IToken | undefined {
		return this.check(tokenType) ? this.consume() : undefined;
	}

	// Consume if matches image, otherwise return undefined
	matchImage(tokenType: { name: string }, image: string): IToken | undefined {
		return this.checkImage(tokenType, image) ? this.consume() : undefined;
	}

	isAtEnd(): boolean {
		return this.pos >= this.tokens.length;
	}

	// Save/restore position for backtracking
	getPos(): number {
		return this.pos;
	}
	setPos(pos: number): void {
		this.pos = pos;
	}
}

// =============================================================================
// PARSER
// Hand-written recursive descent. No Chevrotain parser classes used.
//
// Structure:
//   parseMessage()        — top level, emits blocks
//     parseParagraph()    — collects inlines until newline/end
//       parseInline()     — dispatches to specific inline rules
//         parseEscape()   — \\* \\_ etc
//         tryParseLink()  — [label](url)
//         parseEmail()    — joe@joe.com
//         parsePhone()    — +07563546725
//         tryParseBold()  — **text** (minimal, used inside links)
//         parsePlain()    — fallback for any token
// =============================================================================

class Parser {
	private stream: TokenStream;
	private options: Options;

	constructor(stream: TokenStream, options: Options = {}) {
		this.stream = stream;
		this.options = options;
	}

	// =========================================================================
	// BLOCK LEVEL
	// =========================================================================

	parseMessage(): Root {
		const blocks: any[] = [];

		while (!this.stream.isAtEnd()) {
			// ── Newline handling ──────────────────────────────────────────────
			// Consume an entire run of newlines at once.
			// Rule: N newline characters between content = (N-1) LINE_BREAK nodes
			//   \n\n   → 1 lineBreak  (paragraph separator)
			//   \n\n\n → 2 lineBreaks
			// Leading or trailing newlines (no content on one side) → ignored
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
				let count = 0;
				while (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
					count += this.stream.consume().image.length;
				}
				const hasBefore = blocks.length > 0;
				const hasAfter = !this.stream.isAtEnd();
				if (hasBefore && hasAfter) {
					for (let i = 0; i < count - 1; i++) blocks.push(lineBreak());
				}
				continue;
			}

			// ── Paragraph ─────────────────────────────────────────────────────
			const para = this.parseParagraph();
			if (para.value.length > 0) blocks.push(para);
		}

		return blocks;
	}

	private parseParagraph() {
		const inlines: Inlines[] = [];

		while (!this.stream.isAtEnd()) {
			// Stop at any newline — let parseMessage handle newline accounting
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;

			const node = this.parseInline();
			if (node) inlines.push(node);
		}

		return paragraph(reducePlainTexts(inlines));
	}

	// =========================================================================
	// INLINE LEVEL — dispatch
	// Rules are checked in priority order. More specific rules first.
	// Unrecognised tokens fall through to parsePlain() at the bottom.
	// =========================================================================

	private parseInline(): Inlines | null {
		// Escape: \\* \\_ \\~ etc → strips backslash, emits plain char
		if (this.stream.check(Escape)) {
			return this.parseEscape();
		}

		// Link: [label](url) — backtracking; falls through if malformed
		if (this.stream.checkImage(SpecialChar, '[')) {
			const node = this.tryParseLink();
			if (node) return node;
		}

		// Email: user@domain.tld
		if (this.stream.check(Email)) {
			return this.parseEmail();
		}

		// Phone: +07563546725
		if (this.stream.check(Phone)) {
			return this.parsePhone();
		}

		// Fallback: emit token image as plain text
		// Covers: Plain, LiteralBackslash, SpecialChar (unmatched * _ ~ ` # [ ])
		return this.parsePlain();
	}

	// =========================================================================
	// INLINE RULES
	// =========================================================================

	// ── Escape ────────────────────────────────────────────────────────────────
	// Token image = "\\*" → return plain("*")
	private parseEscape(): Inlines {
		return plain(this.stream.consume().image[1]);
	}

	// ── Email ─────────────────────────────────────────────────────────────────
	// Lexer matched the shape; autoEmail() validates TLD via tldts.
	// Returns link() on valid TLD, plain() otherwise.
	private parseEmail(): Inlines {
		const raw = this.stream.consume().image;
		// Strip mailto: prefix if present — autoEmail re-adds it for the href
		const address = raw.startsWith('mailto:') ? raw.slice(7) : raw;
		return autoEmail(address);
	}

	// ── Phone ─────────────────────────────────────────────────────────────────
	// Lexer matched the shape; phoneChecker() enforces min 5 digits.
	// Returns link("tel:...") or plain() if too short.
	private parsePhone(): Inlines {
		const raw = this.stream.consume().image;
		const digits = raw.replace(/\D/g, '');
		return phoneChecker(raw, digits);
	}

	// ── Link ──────────────────────────────────────────────────────────────────
	// Parses [label](url) syntax.
	// Uses backtracking — returns null and resets position if malformed.
	// Supported URL types:
	//   - Regular URL:     [text](https://example.com)
	//   - Phone number:    [text](+(075)63546725)
	//   - Anything else:   [text](foo) → link with raw href
	private tryParseLink(): Inlines | null {
		const savedPos = this.stream.getPos();

		// Opening [
		this.stream.consume();

		// Label — collect inlines until ] or newline
		const labelNodes = this.parseLinkLabel();

		// Closing ]
		if (!this.stream.matchImage(SpecialChar, ']')) {
			this.stream.setPos(savedPos);
			return null;
		}

		// URL in parens — must be a Plain token starting with (
		const urlRaw = this.parseLinkUrl();
		if (urlRaw === null) {
			this.stream.setPos(savedPos);
			return null;
		}

		// Resolve the URL type
		return this.resolveLinkUrl(urlRaw, labelNodes);
	}

	// Collects label tokens between [ and ]
	// Supports **bold** inside the label
	private parseLinkLabel(): Inlines[] {
		const nodes: Inlines[] = [];

		while (!this.stream.isAtEnd()) {
			if (this.stream.checkImage(SpecialChar, ']')) break;
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;

			// **bold** inside label
			if (this.stream.checkImage(SpecialChar, '*')) {
				const boldNode = this.tryParseBold();
				if (boldNode) {
					nodes.push(boldNode);
					continue;
				}
			}

			nodes.push(this.parsePlain());
		}

		return nodes;
	}

	// Extracts the raw URL string from (url) after the ]
	// Returns null if the next token is not a Plain token starting with (
	private parseLinkUrl(): string | null {
		const tok = this.stream.peek();
		if (!tok?.image.startsWith('(')) return null;

		this.stream.consume();
		let raw = tok.image.slice(1); // strip leading (

		// Single token containing full (url) — most common case
		if (raw.endsWith(')')) return raw.slice(0, -1);

		// Multi-token URL — keep consuming until we find the closing )
		while (!this.stream.isAtEnd()) {
			const t = this.stream.consume();
			if (t.image.endsWith(')')) {
				raw += t.image.slice(0, -1);
				return raw;
			}
			raw += t.image;
		}

		return null; // never found closing )
	}

	// Resolves a raw URL string into the correct link node
	private resolveLinkUrl(urlRaw: string, labelNodes: Inlines[]): Inlines {
		const label = labelNodes.length > 0 ? (reducePlainTexts(labelNodes) as Markup[]) : [plain(urlRaw)];

		// Phone number URL: +(digits) or +digits-digits
		const isPhone = /^\+(\(\d+\)[\d-]*|\d[\d-]*)$/.test(urlRaw);
		if (isPhone) {
			const digits = urlRaw.replace(/\D/g, '');
			if (digits.length >= 5) return link(`tel:${digits}`, label);
		}

		return link(urlRaw, label);
	}

	// ── Bold (minimal — for link labels) ──────────────────────────────────────
	// Full bold parsing (with italic, strike nesting) added in next phase.
	// This handles only **text** inside [label](url).
	private tryParseBold(): Inlines | null {
		const savedPos = this.stream.getPos();

		// Must open with **
		if (!this.stream.matchImage(SpecialChar, '*')) return null;
		if (!this.stream.matchImage(SpecialChar, '*')) {
			this.stream.setPos(savedPos);
			return null;
		}

		// Collect content until closing **
		const inner: Inlines[] = [];
		while (!this.stream.isAtEnd()) {
			if (this.stream.checkImage(SpecialChar, '*')) {
				const p = this.stream.getPos();
				this.stream.consume(); // first *
				if (this.stream.matchImage(SpecialChar, '*')) {
					return bold(reducePlainTexts(inner) as any);
				}
				this.stream.setPos(p); // only one *, not closing **
				break;
			}
			inner.push(this.parsePlain());
		}

		// No closing ** found — backtrack
		this.stream.setPos(savedPos);
		return null;
	}

	// ── Plain (fallback) ──────────────────────────────────────────────────────
	// Emits any token as a PLAIN_TEXT node.
	// reducePlainTexts() in parseParagraph merges consecutive plain nodes.
	private parsePlain(): Inlines {
		return plain(this.stream.consume().image);
	}
}

// =============================================================================
// PUBLIC API
// =============================================================================

export const parse = (input: string, options?: Options): Root => {
	const { tokens, errors } = MessageLexer.tokenize(input);

	if (errors.length > 0) {
		throw new Error(`Lexer error: ${errors[0].message}`);
	}

	return new Parser(new TokenStream(tokens), options).parseMessage();
};
