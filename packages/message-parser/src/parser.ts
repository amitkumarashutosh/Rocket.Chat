import type { IToken } from 'chevrotain';

import { MessageLexer, Escape, LiteralBackslash, DoubleNewLine, NewLine, Plain as PlainToken, SpecialChar } from './lexer';

import { paragraph, plain, bold, lineBreak, reducePlainTexts, autoEmail, phoneChecker, link } from './utils';

import type { Root, Inlines, Markup } from './definitions';
import type { Options } from './index';

// =============================================================================
// INLINE PATTERNS — detected inside Plain tokens by the parser
// Keeping these out of the lexer avoids Chevrotain lookbehind limitations
// and correctly handles patterns embedded mid-sentence.
// =============================================================================

// Email: user@domain.tld — supports unicode, dots, underscores, apostrophes, +
const EMAIL_RE =
	/(?:mailto:)?[a-zA-Z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0400-\u04FF'_.+-]+@[a-zA-Z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0400-\u04FF-]+\.[a-zA-Z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0400-\u04FF.-]+[a-zA-Z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0400-\u04FF]/;

// Phone: +digits, +(digits)digits, +digits-digits
// Lookbehind replaced with explicit char-before check in splitPlainText()
const PHONE_RE = /\+(\(\d+\)[\d-]*|\d[\d-]*)(?![.,\d])/;

// =============================================================================
// TOKEN STREAM
// =============================================================================

class TokenStream {
	private tokens: IToken[];
	private pos = 0;

	constructor(tokens: IToken[]) {
		this.tokens = tokens;
	}

	peek(): IToken | undefined {
		return this.tokens[this.pos];
	}
	peekAt(n: number): IToken | undefined {
		return this.tokens[this.pos + n];
	}
	consume(): IToken {
		return this.tokens[this.pos++];
	}
	isAtEnd(): boolean {
		return this.pos >= this.tokens.length;
	}
	getPos(): number {
		return this.pos;
	}
	setPos(pos: number): void {
		this.pos = pos;
	}

	check(type: { name: string }): boolean {
		return this.peek()?.tokenType.name === type.name;
	}
	checkImage(type: { name: string }, image: string): boolean {
		const t = this.peek();
		return t?.tokenType.name === type.name && t.image === image;
	}
	match(type: { name: string }): IToken | undefined {
		return this.check(type) ? this.consume() : undefined;
	}
	matchImage(type: { name: string }, image: string): IToken | undefined {
		return this.checkImage(type, image) ? this.consume() : undefined;
	}
}

// =============================================================================
// PARSER
// Hand-written recursive descent. Zero Chevrotain parser classes.
//
// Block level:
//   parseMessage()       → blocks (paragraphs + line breaks)
//   parseParagraph()     → PARAGRAPH containing inlines
//
// Inline level (via pending queue):
//   nextInline()         → drains pending queue, then calls parseInline()
//   parseInline()        → dispatcher
//   parseEscape()        → \\* → plain("*")
//   parsePlainToken()    → splits Plain token into email/phone/text nodes
//   tryParseLink()       → [label](url)
//   tryParseBold()       → **text** (used inside link labels)
//   parseFallback()      → any token → plain text
// =============================================================================

class Parser {
	private stream: TokenStream;
	private options: Options;

	// When a Plain token contains an email or phone mid-text, splitPlainText()
	// produces multiple nodes. Extras are queued here and drained before the
	// next token is consumed.
	private pending: Inlines[] = [];

	constructor(stream: TokenStream, options: Options = {}) {
		this.stream = stream;
		this.options = options;
	}

	// ===========================================================================
	// BLOCK LEVEL
	// ===========================================================================

	parseMessage(): Root {
		const blocks: any[] = [];

		while (!this.stream.isAtEnd()) {
			// Newline run: N chars → (N-1) LINE_BREAK nodes between content
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
				let count = 0;
				while (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
					count += this.stream.consume().image.length;
				}
				if (blocks.length > 0 && !this.stream.isAtEnd()) {
					for (let i = 0; i < count - 1; i++) blocks.push(lineBreak());
				}
				continue;
			}

			const para = this.parseParagraph();
			if (para.value.length > 0) blocks.push(para);
		}

		return blocks;
	}

	private parseParagraph() {
		const inlines: Inlines[] = [];

		while (!this.stream.isAtEnd() || this.pending.length > 0) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;
			const node = this.nextInline();
			if (node) inlines.push(node);
		}

		return paragraph(reducePlainTexts(inlines));
	}

	// ===========================================================================
	// INLINE — pending queue + dispatcher
	// ===========================================================================

	// Always drain the pending queue before consuming a new token
	private nextInline(): Inlines | null {
		if (this.pending.length > 0) return this.pending.shift()!;
		return this.parseInline();
	}

	private parseInline(): Inlines | null {
		// Escape: \\* → plain("*")
		if (this.stream.check(Escape)) return this.parseEscape();

		// Link: [label](url) — backtracking
		if (this.stream.checkImage(SpecialChar, '[')) {
			const node = this.tryParseLink();
			if (node) return node;
		}

		// Plain token — scan for embedded email / phone
		if (this.stream.check(PlainToken)) return this.parsePlainToken();

		// Fallback — SpecialChar, LiteralBackslash, etc → plain text
		return this.parseFallback();
	}

	// ===========================================================================
	// INLINE RULES
	// ===========================================================================

	// ── Escape ──────────────────────────────────────────────────────────────────
	private parseEscape(): Inlines {
		return plain(this.stream.consume().image[1]);
	}

	// ── Plain Token ─────────────────────────────────────────────────────────────
	// Scans the token image for email and phone patterns.
	// Greedily merges consecutive Plain tokens and underscore SpecialChars so
	// that email addresses like joe_roe@joe.com are seen whole by EMAIL_RE.
	private parsePlainToken(): Inlines {
		let text = this.stream.consume().image;

		// Merge trailing _ and the Plain token after it (for joe_roe@joe.com)
		while (this.stream.checkImage(SpecialChar, '_') && this.stream.peekAt(1)?.tokenType.name === PlainToken.name) {
			text += this.stream.consume().image; // underscore
			text += this.stream.consume().image; // following plain
		}

		const nodes = this.splitPlainText(text);
		if (nodes.length > 1) this.pending.push(...nodes.slice(1));
		return nodes[0];
	}

	// Split a plain text string at email and phone boundaries
	private splitPlainText(text: string): Inlines[] {
		const results: Inlines[] = [];
		let remaining = text;
		let prevChar = ''; // track char before current slice for phone validation

		while (remaining.length > 0) {
			const emailMatch = remaining.match(EMAIL_RE);
			const phoneMatch = remaining.match(PHONE_RE);

			let emailIdx = emailMatch?.index ?? Infinity;
			let phoneIdx = phoneMatch?.index ?? Infinity;

			// Phone: reject if the character immediately before + is a word char
			if (phoneMatch && phoneIdx !== Infinity) {
				const charBefore = phoneIdx > 0 ? remaining[phoneIdx - 1] : prevChar;
				if (/\w/.test(charBefore)) phoneIdx = Infinity;
			}

			// No match — rest is plain text
			if (emailIdx === Infinity && phoneIdx === Infinity) {
				results.push(plain(remaining));
				break;
			}

			// Pick earliest match
			const useEmail = emailIdx <= phoneIdx;
			const matchIdx = useEmail ? emailIdx : phoneIdx;
			const matchStr = useEmail ? emailMatch![0] : phoneMatch![0];

			// Text before the match
			if (matchIdx > 0) results.push(plain(remaining.slice(0, matchIdx)));

			// The matched email or phone
			if (useEmail) {
				const address = matchStr.startsWith('mailto:') ? matchStr.slice(7) : matchStr;
				results.push(autoEmail(address));
			} else {
				results.push(phoneChecker(matchStr, matchStr.replace(/\D/g, '')));
			}

			prevChar = matchStr[matchStr.length - 1];
			remaining = remaining.slice(matchIdx + matchStr.length);
		}

		return results;
	}

	// ── Link ────────────────────────────────────────────────────────────────────
	// Parses [label](url) with backtracking.
	private tryParseLink(): Inlines | null {
		const savedPos = this.stream.getPos();

		this.stream.consume(); // opening [

		const labelNodes = this.parseLinkLabel();

		if (!this.stream.matchImage(SpecialChar, ']')) {
			this.stream.setPos(savedPos);
			return null;
		}

		const urlRaw = this.parseLinkUrl();
		if (urlRaw === null) {
			this.stream.setPos(savedPos);
			return null;
		}

		return this.resolveLinkUrl(urlRaw, labelNodes);
	}

	private parseLinkLabel(): Inlines[] {
		const nodes: Inlines[] = [];

		while (!this.stream.isAtEnd()) {
			if (this.stream.checkImage(SpecialChar, ']')) break;
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;

			if (this.stream.checkImage(SpecialChar, '*')) {
				const b = this.tryParseBold();
				if (b) {
					nodes.push(b);
					continue;
				}
			}

			nodes.push(this.parseFallback());
		}

		return nodes;
	}

	private parseLinkUrl(): string | null {
		const tok = this.stream.peek();
		if (!tok?.image.startsWith('(')) return null;

		this.stream.consume();
		let raw = tok.image.slice(1);

		if (raw.endsWith(')')) return raw.slice(0, -1);

		while (!this.stream.isAtEnd()) {
			const t = this.stream.consume();
			if (t.image.endsWith(')')) {
				raw += t.image.slice(0, -1);
				return raw;
			}
			raw += t.image;
		}

		return null;
	}

	private resolveLinkUrl(urlRaw: string, labelNodes: Inlines[]): Inlines {
		const label = labelNodes.length > 0 ? (reducePlainTexts(labelNodes) as Markup[]) : [plain(urlRaw)];

		if (/^\+(\(\d+\)[\d-]*|\d[\d-]*)$/.test(urlRaw)) {
			const digits = urlRaw.replace(/\D/g, '');
			if (digits.length >= 5) return link(`tel:${digits}`, label);
		}

		return link(urlRaw, label);
	}

	// ── Bold (minimal — for inside link labels) ──────────────────────────────────
	private tryParseBold(): Inlines | null {
		const savedPos = this.stream.getPos();

		if (!this.stream.matchImage(SpecialChar, '*')) return null;
		if (!this.stream.matchImage(SpecialChar, '*')) {
			this.stream.setPos(savedPos);
			return null;
		}

		const inner: Inlines[] = [];
		while (!this.stream.isAtEnd()) {
			if (this.stream.checkImage(SpecialChar, '*')) {
				const p = this.stream.getPos();
				this.stream.consume();
				if (this.stream.matchImage(SpecialChar, '*')) {
					return bold(reducePlainTexts(inner) as any);
				}
				this.stream.setPos(p);
				break;
			}
			inner.push(this.parseFallback());
		}

		this.stream.setPos(savedPos);
		return null;
	}

	// ── Fallback ────────────────────────────────────────────────────────────────
	private parseFallback(): Inlines {
		return plain(this.stream.consume().image);
	}
}

// =============================================================================
// PUBLIC API
// =============================================================================

export const parse = (input: string, options?: Options): Root => {
	const { tokens, errors } = MessageLexer.tokenize(input);
	if (errors.length > 0) throw new Error(`Lexer error: ${errors[0].message}`);
	return new Parser(new TokenStream(tokens), options).parseMessage();
};
