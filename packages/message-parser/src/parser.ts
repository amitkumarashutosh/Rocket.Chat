import type { IToken } from 'chevrotain';

import {
	MessageLexer,
	Escape,
	LiteralBackslash,
	DoubleNewLine,
	NewLine,
	CodeFence,
	Plain as PlainToken,
	SpecialChar,
	Email as EmailToken,
	Url as UrlToken,
	Phone as PhoneToken,
} from './lexer';

import {
	paragraph,
	plain,
	bold,
	italic,
	strike,
	lineBreak,
	reducePlainTexts,
	autoEmail,
	autoLink,
	phoneChecker,
	link,
	emoji,
	emojiUnicode,
	emoticon as emoticonNode,
	mentionUser,
	mentionChannel,
	bigEmoji,
	inlineCode,
	code,
	codeLine,
	heading,
	katex,
	inlineKatex,
	quote,
	color,
	image,
	orderedList,
	listItem,
	unorderedList,
	spoilerBlock,
	spoiler,
} from './utils';

import type { Root, Inlines, Markup } from './definitions';
import type { Options } from './index';
import { EMOTICONS, EMOTICON_LIST } from './emoticons';
import { MENTION_USER_RE, EMOJI_CODE_RE, UNICODE_EMOJI_RE, URL_TRAILING_CHARS, PHONE_URL_RE, EMAIL_PATTERN } from './patterns';

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
	tokenAt(i: number): IToken | undefined {
		return this.tokens[i];
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
// HELPERS
// =============================================================================

function stripUrlTrailing(url: string): [string, string] {
	let result = url;
	while (result.length > 0) {
		const last = result[result.length - 1];
		if (URL_TRAILING_CHARS.includes(last)) result = result.slice(0, -1);
		else if (last === ')' && !result.includes('(')) result = result.slice(0, -1);
		else break;
	}
	return [result, url.slice(result.length)];
}

function isWordChar(ch: string | undefined): boolean {
	return ch !== undefined && /[a-zA-Z0-9]/.test(ch);
}

// Returns the last character of the token immediately before position pos,
// looking across all token types (Plain, Email, Url, Phone, SpecialChar…).
function prevTokenLastChar(stream: TokenStream, pos: number): string | undefined {
	if (pos === 0) return undefined;
	return stream.tokenAt(pos - 1)?.image?.slice(-1);
}

// =============================================================================
// BIG EMOJI POST-PROCESSOR
// =============================================================================

function tryMakeBigEmoji(blocks: any[]): Root {
	const emojis: any[] = [];

	for (const block of blocks) {
		if (block.type === 'LINE_BREAK') continue;
		if (block.type !== 'PARAGRAPH') return blocks;

		for (const node of block.value) {
			if (node.type === 'PLAIN_TEXT') {
				if (node.value.trim() !== '') return blocks;
			} else if (node.type === 'EMOJI') {
				emojis.push(node);
			} else {
				return blocks;
			}
		}
	}

	if (emojis.length === 0 || emojis.length > 3) return blocks;
	return [bigEmoji(emojis as any)];
}

// =============================================================================
// PARSER
// =============================================================================

type FormattingContext = {
	inBold?: boolean;
	inItalic?: boolean;
	inStrike?: boolean;
};

class Parser {
	private stream: TokenStream;
	private options: Options;
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
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
				let count = 0;
				while (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
					count += this.stream.consume().image.length;
				}
				if (blocks.length > 0) {
					// A trailing \n after a heading counts as one lineBreak;
					// between paragraphs each extra \n beyond the first is a lineBreak.
					const lastType = blocks[blocks.length - 1]?.type;
					// After headings and spoiler blocks, every \n (including single) counts as a lineBreak.
					// After paragraphs, only extra \n beyond the first separator count.
					const trailingNewlineIsBreak = lastType === 'HEADING' || lastType === 'SPOILER_BLOCK';
					let breaksToAdd: number;
					if (trailingNewlineIsBreak) {
						breaksToAdd = this.stream.isAtEnd() ? count : count - 1 + 1; // every \n is a break
					} else {
						breaksToAdd = this.stream.isAtEnd() ? 0 : count - 1;
					}
					for (let i = 0; i < breaksToAdd; i++) blocks.push(lineBreak());
				}
				continue;
			}

			// Block KaTeX — \[ ... \] (only when katex.parenthesisSyntax is enabled)
			if ((this.options as any).katex?.parenthesisSyntax && this.stream.check(LiteralBackslash)) {
				const block = this.tryParseBlockKatex();
				if (block) {
					blocks.push(block);
					continue;
				}
			}

			// Code block — ``` must be at the very start of a line.
			// Guard: only attempt if we're at position 0 or the previous token was a newline.
			if (this.stream.check(CodeFence)) {
				const pos = this.stream.getPos();
				const prevTok = this.stream.tokenAt(pos - 1);
				const prevIsNewline = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;

				if (pos === 0 || prevIsNewline) {
					const block = this.tryParseCodeBlock();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			// Blockquote — > or >text lines, only at line start.
			if (this.stream.check(PlainToken) && this.stream.peek()!.image.startsWith('>')) {
				const pos = this.stream.getPos();
				const prevTok = this.stream.tokenAt(pos - 1);
				const prevIsNewline = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				if (pos === 0 || prevIsNewline) {
					const block = this.tryParseQuote();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			// Spoiler block — || on its own line opens/closes the block.
			if (this.stream.check(PlainToken) && this.stream.peek()!.image === '||') {
				const pos = this.stream.getPos();
				const prevTok = this.stream.tokenAt(pos - 1);
				const prevIsNewline = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				if (pos === 0 || prevIsNewline) {
					const block = this.tryParseSpoilerBlock();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			// Unordered list — "- item" (Plain starting with "- "), only at line start.
			if (this.stream.check(PlainToken) && this.stream.peek()!.image.startsWith('- ')) {
				const pos = this.stream.getPos();
				const prevTok = this.stream.tokenAt(pos - 1);
				const prevIsNewline = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				if (pos === 0 || prevIsNewline) {
					const block = this.tryParseUnorderedList('-');
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			// Unordered list — "* item" (SpecialChar("*") + Plain(" item")), only at line start.
			if (this.stream.checkImage(SpecialChar, '*')) {
				const pos = this.stream.getPos();
				const prevTok = this.stream.tokenAt(pos - 1);
				const prevIsNewline = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				const nextTok = this.stream.peekAt(1);
				const nextIsSpace = nextTok?.tokenType.name === PlainToken.name && nextTok.image.startsWith(' ');
				if ((pos === 0 || prevIsNewline) && nextIsSpace) {
					const block = this.tryParseUnorderedList('*');
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			// Ordered list — <number>. <content> lines, only at line start.
			if (this.stream.check(PlainToken) && /^\d+\.\s/.test(this.stream.peek()!.image)) {
				const pos = this.stream.getPos();
				const prevTok = this.stream.tokenAt(pos - 1);
				const prevIsNewline = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				if (pos === 0 || prevIsNewline) {
					const block = this.tryParseOrderedList();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			// Heading — # / ## / ### / #### followed by a space, only at line start.
			if (this.stream.checkImage(SpecialChar, '#')) {
				const pos = this.stream.getPos();
				const prevTok = this.stream.tokenAt(pos - 1);
				const prevIsNewline = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;

				if (pos === 0 || prevIsNewline) {
					const block = this.tryParseHeading();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			const para = this.parseParagraph();
			if (para.value.length > 0) blocks.push(para);
		}

		return tryMakeBigEmoji(blocks);
	}

	// ===========================================================================
	// CODE BLOCK
	// ===========================================================================

	private tryParseCodeBlock(): any | null {
		const savedPos = this.stream.getPos();
		const openTok = this.stream.consume(); // consume the ``` token

		// Extract optional language label from the opening fence token image
		// e.g. "```javascript" → "javascript", "```" → undefined
		const rawLang = openTok.image.slice(3).trim();
		const lang = rawLang.length > 0 ? rawLang : undefined;

		// Opening fence must be followed by a newline
		if (!this.stream.match(NewLine)) {
			this.stream.setPos(savedPos);
			return null;
		}

		const lines: any[] = [];

		while (!this.stream.isAtEnd()) {
			// Closing fence
			if (this.stream.check(CodeFence)) {
				this.stream.consume();
				return code(lines, lang);
			}

			// Collect raw text for one line until we hit a newline token
			const lineParts: string[] = [];

			while (!this.stream.isAtEnd()) {
				if (this.stream.check(CodeFence)) break; // will be caught by outer loop

				if (this.stream.check(NewLine)) {
					this.stream.consume();
					break;
				}

				if (this.stream.check(DoubleNewLine)) {
					// DoubleNewLine = "\n\n" — push the current line, then a blank line,
					// then stop collecting (the second \n is already consumed).
					this.stream.consume();
					lines.push(codeLine(plain(lineParts.join(''))));
					lines.push(codeLine(plain('')));
					lineParts.length = 0;
					// Signal that we already pushed, skip the push below
					// by setting a flag via a sentinel
					(lineParts as any).__alreadyPushed = true;
					break;
				}

				lineParts.push(this.stream.consume().image);
			}

			if (!(lineParts as any).__alreadyPushed) {
				lines.push(codeLine(plain(lineParts.join(''))));
			}
		}

		// No closing fence found — not a valid code block
		this.stream.setPos(savedPos);
		return null;
	}

	// ===========================================================================
	// HEADING
	// ===========================================================================

	private tryParseHeading(): any | null {
		const savedPos = this.stream.getPos();

		// Count consecutive # SpecialChars (max 4)
		let level = 0;
		while (this.stream.checkImage(SpecialChar, '#') && level < 4) {
			this.stream.consume();
			level++;
		}

		// Must be followed by a Plain token starting with a space
		const next = this.stream.peek();
		if (!next || next.tokenType.name !== PlainToken.name || !next.image.startsWith(' ')) {
			this.stream.setPos(savedPos);
			return null;
		}

		const tok = this.stream.consume();
		const text = tok.image.slice(1); // strip leading space

		// Collect any remaining tokens on this line (do NOT consume the newline)
		const parts: string[] = [text];
		while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
			parts.push(this.stream.consume().image);
		}

		// Emit the trailing newline back so parseMessage can count it for lineBreak
		// We intentionally leave it in the stream — parseMessage's newline loop handles it.

		return heading([plain(parts.join(''))], level as 1 | 2 | 3 | 4);
	}

	// ===========================================================================
	// BLOCK KATEX — \[ ... \]
	// ===========================================================================

	private tryParseBlockKatex(): any | null {
		const savedPos = this.stream.getPos();

		if (!this.stream.check(LiteralBackslash)) return null;
		this.stream.consume(); // \

		if (!this.stream.checkImage(SpecialChar, '[')) {
			this.stream.setPos(savedPos);
			return null;
		}
		this.stream.consume(); // [

		const parts: string[] = [];
		while (!this.stream.isAtEnd()) {
			if (this.stream.check(LiteralBackslash)) {
				this.stream.consume(); // \
				if (this.stream.checkImage(SpecialChar, ']')) {
					this.stream.consume(); // ]
					return katex(parts.join(''));
				}
				parts.push('\\');
				continue;
			}
			parts.push(this.stream.consume().image);
		}

		this.stream.setPos(savedPos);
		return null;
	}

	// ===========================================================================
	// INLINE KATEX — \(content\)
	// ===========================================================================

	private tryParseInlineKatex(): Inlines | null {
		const savedPos = this.stream.getPos();

		this.stream.consume(); // \

		// Next token must be a Plain token starting with (
		const next = this.stream.peek();
		if (!next || next.tokenType.name !== PlainToken.name || !next.image.startsWith('(')) {
			this.stream.setPos(savedPos);
			return null;
		}
		this.stream.consume();
		const afterParen = next.image.slice(1); // strip leading (

		// Collect until \)
		const parts: string[] = [afterParen];
		while (!this.stream.isAtEnd()) {
			if (this.stream.check(NewLine) || this.stream.check(DoubleNewLine)) break;
			if (this.stream.check(LiteralBackslash)) {
				this.stream.consume(); // \
				const t = this.stream.peek();
				if (t && t.tokenType.name === PlainToken.name && t.image.startsWith(')')) {
					this.stream.consume();
					const leftover = t.image.slice(1);
					if (leftover) this.pending.push(plain(leftover));
					return inlineKatex(parts.join(''));
				}
				parts.push('\\\\');
				continue;
			}
			parts.push(this.stream.consume().image);
		}

		this.stream.setPos(savedPos);
		return null;
	}

	// ===========================================================================
	// BLOCKQUOTE — consecutive > lines
	// ===========================================================================

	private tryParseQuote(): any | null {
		const savedPos = this.stream.getPos();
		const paragraphs: any[] = [];

		while (!this.stream.isAtEnd()) {
			// Check we have a Plain token starting with >
			if (!this.stream.check(PlainToken) || !this.stream.peek()!.image.startsWith('>')) break;

			const tok = this.stream.consume();
			// Strip the leading > and optional single space
			let line = tok.image.slice(1);
			if (line.startsWith(' ')) line = line.slice(1);

			// Collect any remaining tokens on this line (e.g. Email, Url, SpecialChar tokens)
			const lineParts: string[] = [line];
			while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
				lineParts.push(this.stream.consume().image);
			}
			const lineText = lineParts.join('');

			// Re-parse the line content using a sub-parser
			const lineInlines = this.parseQuoteLine(lineText);
			paragraphs.push(paragraph(reducePlainTexts(lineInlines)));

			// Consume the newline separator between quote lines
			if (this.stream.check(NewLine)) {
				this.stream.consume();
			} else if (this.stream.check(DoubleNewLine)) {
				break;
			} else {
				break;
			}
		}

		if (paragraphs.length === 0) {
			this.stream.setPos(savedPos);
			return null;
		}

		return quote(paragraphs);
	}

	// Parse a single quote line's text as inlines by re-lexing and re-parsing it.
	private parseQuoteLine(text: string): Inlines[] {
		const { tokens, errors } = MessageLexer.tokenize(text);
		if (errors.length > 0) return [plain(text)];
		if (tokens.length === 0) return [plain('')];
		const subStream = new TokenStream(tokens);
		const subParser = new Parser(subStream, this.options);
		// Use parseParagraph directly to avoid block-level checks interfering
		const inlines = (subParser as any).parseParagraphInlines();
		return reducePlainTexts(inlines) as Inlines[];
	}

	// Parse all inlines until end of stream (used by parseQuoteLine)
	parseParagraphInlines(): Inlines[] {
		const inlines: Inlines[] = [];
		while (!this.stream.isAtEnd()) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;
			const node = this.nextInline({});
			if (node) inlines.push(node);
		}
		return inlines;
	}

	// ===========================================================================
	// SPOILER BLOCK — || ... ||
	// ===========================================================================

	private tryParseSpoilerBlock(): any | null {
		const savedPos = this.stream.getPos();

		// Opening ||
		if (!this.stream.check(PlainToken) || this.stream.peek()!.image !== '||') return null;
		this.stream.consume(); // ||

		// Must be followed immediately by a newline
		if (!this.stream.check(NewLine)) {
			this.stream.setPos(savedPos);
			return null;
		}
		this.stream.consume(); // newline after opening ||

		const paragraphs: any[] = [];

		while (!this.stream.isAtEnd()) {
			// Closing || on its own line
			if (this.stream.check(PlainToken) && this.stream.peek()!.image === '||') {
				this.stream.consume(); // closing ||
				return spoilerBlock(paragraphs);
			}

			// Collect one line of tokens
			const lineParts: string[] = [];
			while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
				lineParts.push(this.stream.consume().image);
			}
			const lineText = lineParts.join('');
			const inlines = this.parseQuoteLine(lineText);
			paragraphs.push(paragraph(reducePlainTexts(inlines)));

			if (this.stream.check(NewLine)) {
				this.stream.consume();
			} else if (this.stream.check(DoubleNewLine)) {
				break;
			}
		}

		// No closing || found
		this.stream.setPos(savedPos);
		return null;
	}

	// ===========================================================================
	// UNORDERED LIST — consecutive "- item" or "* item" lines
	// ===========================================================================

	private tryParseUnorderedList(marker: '-' | '*'): any | null {
		const savedPos = this.stream.getPos();
		const items: any[] = [];

		while (!this.stream.isAtEnd()) {
			let lineText: string;

			if (marker === '-') {
				// Plain token starting with "- "
				if (!this.stream.check(PlainToken) || !this.stream.peek()!.image.startsWith('- ')) break;
				const tok = this.stream.consume();
				lineText = tok.image.slice(2); // strip "- "
			} else {
				// SpecialChar("*") + Plain(" item...")
				if (!this.stream.checkImage(SpecialChar, '*')) break;
				const nextTok = this.stream.peekAt(1);
				if (!nextTok || nextTok.tokenType.name !== PlainToken.name || !nextTok.image.startsWith(' ')) break;
				this.stream.consume(); // *
				const tok = this.stream.consume(); // " item..."
				lineText = tok.image.slice(1); // strip leading space
			}

			// Collect remaining tokens on this line (e.g. SpecialChar for bold/italic)
			const lineParts: string[] = [lineText];
			while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
				lineParts.push(this.stream.consume().image);
			}

			const inlines = this.parseQuoteLine(lineParts.join(''));
			items.push(listItem(inlines));

			if (this.stream.check(NewLine)) {
				this.stream.consume();
			} else {
				break;
			}
		}

		if (items.length === 0) {
			this.stream.setPos(savedPos);
			return null;
		}

		return unorderedList(items);
	}

	// ===========================================================================
	// ORDERED LIST — consecutive <number>. <content> lines
	// ===========================================================================

	private tryParseOrderedList(): any | null {
		const savedPos = this.stream.getPos();
		const items: any[] = [];

		while (!this.stream.isAtEnd()) {
			// Check for <number>. <content> pattern in Plain token
			if (!this.stream.check(PlainToken)) break;
			const tok = this.stream.peek()!;
			const m = tok.image.match(/^(\d+)\.\s(.*)/s);
			if (!m) break;

			this.stream.consume();
			const num = parseInt(m[1], 10);
			let lineText = m[2];

			// Collect remaining tokens on this line
			const lineParts: string[] = [lineText];
			while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
				lineParts.push(this.stream.consume().image);
			}
			lineText = lineParts.join('');

			// Parse line content as inlines via sub-parser
			const inlines = this.parseQuoteLine(lineText);
			items.push(listItem(inlines, num));

			// Consume newline between items
			if (this.stream.check(NewLine)) {
				this.stream.consume();
			} else {
				break;
			}
		}

		if (items.length === 0) {
			this.stream.setPos(savedPos);
			return null;
		}

		return orderedList(items);
	}

	private parseParagraph() {
		const inlines: Inlines[] = [];

		while (!this.stream.isAtEnd() || this.pending.length > 0) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;
			const node = this.nextInline({});
			if (node) inlines.push(node);
		}

		return paragraph(reducePlainTexts(inlines));
	}

	// ===========================================================================
	// INLINE DISPATCHER
	// ===========================================================================

	private nextInline(ctx: FormattingContext): Inlines | null {
		if (this.pending.length > 0) return this.pending.shift()!;
		return this.parseInline(ctx);
	}

	private parseInline(ctx: FormattingContext): Inlines | null {
		if (this.stream.check(Escape)) return this.parseEscape();

		// Inline KaTeX — \(content\)
		if ((this.options as any).katex?.parenthesisSyntax && this.stream.check(LiteralBackslash)) {
			const node = this.tryParseInlineKatex();
			if (node) return node;
		}

		// Bold *
		if (this.stream.checkImage(SpecialChar, '*') && !ctx.inBold) {
			const node = this.tryParseFormatting('*', ctx);
			if (node) return node;
		}

		// Italic _
		if (this.stream.checkImage(SpecialChar, '_') && !ctx.inItalic) {
			const node = this.tryParseItalic(ctx);
			if (node) return node;
		}

		// Strike ~
		if (this.stream.checkImage(SpecialChar, '~') && !ctx.inStrike) {
			const node = this.tryParseFormatting('~', ctx);
			if (node) return node;
		}

		// Inline Code
		if (this.stream.checkImage(SpecialChar, '`')) {
			const node = this.tryParseInlineCode();
			if (node) return node;
		}

		// Image ![label](url) — Plain ending with ! followed by [
		if (
			this.stream.check(PlainToken) &&
			this.stream.peek()!.image.endsWith('!') &&
			this.stream.peekAt(1)?.tokenType.name === SpecialChar.name &&
			this.stream.peekAt(1)?.image === '['
		) {
			const node = this.tryParseImage(ctx);
			if (node) return node;
		}

		// Link [label](url)
		if (this.stream.checkImage(SpecialChar, '[')) {
			const node = this.tryParseLink(ctx);
			if (node) return node;
		}

		// #channel — # is SpecialChar, followed by Plain
		if (this.stream.checkImage(SpecialChar, '#')) {
			const node = this.tryParseChannelMention();
			if (node) return node;
		}

		// ── Tokens moved from splitPlainText ──────────────────────────────────

		// Email token — foo@bar.com or mailto:foo@bar.com
		if (this.stream.check(EmailToken)) return this.parseEmailToken();

		// URL token — http://... or www....
		if (this.stream.check(UrlToken)) return this.parseUrlToken();

		// Phone token — +44...
		if (this.stream.check(PhoneToken)) return this.parsePhoneToken();

		// Inline spoiler — ||content||
		if (this.stream.check(PlainToken) && this.stream.peek()!.image.startsWith('||')) {
			const node = this.tryParseInlineSpoiler(ctx);
			if (node) return node;
		}

		// Color token — color:#rrggbb etc. spans Plain("color:") + SpecialChar("#") + Plain(<hex>)
		// Always intercept this pattern (even when colors disabled) to prevent # becoming a channel mention.
		if (this.stream.check(PlainToken) && this.stream.peek()!.image === 'color:') {
			const node = this.tryParseColor();
			if (node) return node;
		}

		// Plain token — may still contain @mentions, emoji shortcodes and emoticons
		if (this.stream.check(PlainToken)) return this.parsePlainToken();

		// CodeFence inside a paragraph — treat as plain text (e.g. "  ```")
		if (this.stream.check(CodeFence)) return plain(this.stream.consume().image);

		return this.parseFallback();
	}

	// ===========================================================================
	// EMAIL TOKEN
	// ===========================================================================

	private parseEmailToken(): Inlines {
		const tok = this.stream.consume();
		const address = tok.image.startsWith('mailto:') ? tok.image.slice(7) : tok.image;
		return autoEmail(address);
	}

	// ===========================================================================
	// URL TOKEN
	// ===========================================================================

	private parseUrlToken(): Inlines {
		const tok = this.stream.consume();

		// Check if preceded by alphanumeric/dot — same guard as old splitPlainText
		const prevChar = prevTokenLastChar(this.stream, this.stream.getPos() - 1);
		if (/[a-zA-Z0-9.]/.test(prevChar ?? '')) {
			return plain(tok.image);
		}

		const [stripped, leftover] = stripUrlTrailing(tok.image);
		if (leftover) this.pending.push(plain(leftover));
		return autoLink(stripped, this.options.customDomains);
	}

	// ===========================================================================
	// PHONE TOKEN
	// ===========================================================================

	private parsePhoneToken(): Inlines {
		const tok = this.stream.consume();

		// Reject if preceded by a word char
		const prevChar = prevTokenLastChar(this.stream, this.stream.getPos() - 1);
		if (/\w/.test(prevChar ?? '')) return plain(tok.image);

		return phoneChecker(tok.image, tok.image.replace(/\D/g, ''));
	}

	// ===========================================================================
	// #CHANNEL MENTION — # is SpecialChar, rest is in Plain token
	// ===========================================================================

	private tryParseChannelMention(): Inlines | null {
		const savedPos = this.stream.getPos();

		// Reject if preceded by a word char, another #, or : (e.g. color:#ccc)
		const prevChar = prevTokenLastChar(this.stream, savedPos);
		if (isWordChar(prevChar)) return null;
		if (prevChar === '#') return null;
		if (prevChar === ':') return null;

		// Reject if preceded by "color:" — this is part of a color token like color:#ccc
		// that should stay as plain text when colors option is disabled
		const prevTokImage = this.stream.getPos() > 0 ? this.stream.tokenAt(this.stream.getPos() - 1)?.image : undefined;
		if (prevTokImage === 'color:') return null;

		this.stream.consume(); // #

		// Reject if the next token is also # (e.g. still inside ##Hello at pos 0)
		if (this.stream.checkImage(SpecialChar, '#')) {
			this.stream.setPos(savedPos);
			return null;
		}

		const tok = this.stream.peek();
		if (tok?.tokenType.name === PlainToken.name && !/^\s/.test(tok.image)) {
			this.stream.consume();
			const name = tok.image.split(' ')[0];
			const rest = tok.image.slice(name.length);
			if (rest) this.pending.push(plain(rest));
			return mentionChannel(name);
		}

		this.stream.setPos(savedPos);
		return null;
	}

	// ===========================================================================
	// FORMATTING: Bold (*) and Strike (~)
	// ===========================================================================

	private tryParseFormatting(delim: '*' | '~', ctx: FormattingContext): Inlines | null {
		const savedPos = this.stream.getPos();

		this.stream.consume(); // first delim
		const isDouble = this.stream.checkImage(SpecialChar, delim);
		if (isDouble) this.stream.consume();

		const innerCtx: FormattingContext = {
			...ctx,
			inBold: delim === '*' ? true : ctx.inBold,
			inStrike: delim === '~' ? true : ctx.inStrike,
		};

		const inner: Inlines[] = [];
		let closed = false;

		while (!this.stream.isAtEnd()) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;

			if (this.stream.checkImage(SpecialChar, delim)) {
				const p = this.stream.getPos();
				this.stream.consume();
				const closingDouble = this.stream.checkImage(SpecialChar, delim);

				if (isDouble && closingDouble) {
					this.stream.consume();
					closed = true;
					break;
				} else if (isDouble && !closingDouble) {
					// Opened ** but only one closing → emit plain opener, reparse as single
					this.stream.setPos(savedPos + 1);
					const single = this.tryParseFormatting(delim, ctx);
					if (single) {
						this.pending.unshift(single);
						return plain(delim);
					}
					this.stream.setPos(savedPos);
					return null;
				} else if (!isDouble && closingDouble) {
					closed = true;
					break; // leave extra delim in stream
				} else {
					closed = true;
					break;
				}
			}

			const node = this.nextInline(innerCtx);
			if (node) inner.push(node);
		}

		if (!closed || inner.length === 0) {
			this.stream.setPos(savedPos);
			return null;
		}

		const allWS = inner.every((n) => n.type === 'PLAIN_TEXT' && (n as any).value.trim() === '');
		if (allWS) {
			this.stream.setPos(savedPos);
			return null;
		}

		const reduced = reducePlainTexts(inner) as any;
		return delim === '*' ? bold(reduced) : strike(reduced);
	}

	// ===========================================================================
	// ITALIC (_) — word boundary rules
	// ===========================================================================

	private tryParseItalic(ctx: FormattingContext): Inlines | null {
		const savedPos = this.stream.getPos();

		// Reject if preceded by word char (mid-word _ not italic)
		const prevChar = prevTokenLastChar(this.stream, savedPos);
		if (isWordChar(prevChar)) return null;

		this.stream.consume(); // first _
		const isDouble = this.stream.checkImage(SpecialChar, '_');
		if (isDouble) this.stream.consume();

		const innerCtx: FormattingContext = { ...ctx, inItalic: true };
		const inner: Inlines[] = [];
		let closed = false;

		while (!this.stream.isAtEnd()) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;

			if (this.stream.checkImage(SpecialChar, '_')) {
				const p = this.stream.getPos();
				this.stream.consume();
				const closingDouble = this.stream.checkImage(SpecialChar, '_');
				const nextChar = this.stream.peek()?.image?.[0];

				if (isDouble && closingDouble) {
					if (isWordChar(nextChar)) {
						this.stream.setPos(p);
						const node = this.nextInline(innerCtx);
						if (node) inner.push(node);
						continue;
					}
					this.stream.consume();
					closed = true;
					break;
				} else if (isDouble && !closingDouble) {
					if (isWordChar(nextChar)) {
						this.stream.setPos(p);
						const node = this.nextInline(innerCtx);
						if (node) inner.push(node);
						continue;
					}
					// Emit plain opener, reparse as single
					this.stream.setPos(savedPos + 1);
					const single = this.tryParseItalic(ctx);
					if (single) {
						this.pending.unshift(single);
						return plain('_');
					}
					this.stream.setPos(savedPos);
					return null;
				} else if (!isDouble && closingDouble) {
					if (isWordChar(nextChar)) {
						this.stream.setPos(savedPos);
						return null;
					}
					closed = true;
					break;
				} else {
					if (isWordChar(nextChar)) {
						this.stream.setPos(savedPos);
						return null;
					}
					closed = true;
					break;
				}
			}

			const node = this.nextInline(innerCtx);
			if (node) inner.push(node);
		}

		if (!closed || inner.length === 0) {
			this.stream.setPos(savedPos);
			return null;
		}

		const allWS = inner.every((n) => n.type === 'PLAIN_TEXT' && (n as any).value.trim() === '');
		if (allWS) {
			this.stream.setPos(savedPos);
			return null;
		}

		return italic(reducePlainTexts(inner) as any);
	}

	// ===========================================================================
	// LINK [label](url)
	// ===========================================================================

	// ===========================================================================
	// IMAGE — ![label](url)
	// ===========================================================================

	private tryParseImage(ctx: FormattingContext): Inlines | null {
		const savedPos = this.stream.getPos();

		// Consume the Plain token ending with !
		const plainTok = this.stream.consume();
		const prefix = plainTok.image.slice(0, -1); // everything before the !

		// Consume [
		this.stream.consume();

		// Parse label (may be empty)
		const labelNodes = this.parseLinkLabel(ctx);

		if (!this.stream.matchImage(SpecialChar, ']')) {
			this.stream.setPos(savedPos);
			return null;
		}

		const urlRaw = this.parseLinkUrl();
		if (urlRaw === null) {
			this.stream.setPos(savedPos);
			return null;
		}

		// If there was text before the !, push image to pending and return the prefix
		const label = labelNodes.length > 0 ? (reducePlainTexts(labelNodes)[0] as any) : undefined;
		const imgNode = image(urlRaw, label);

		if (prefix.length > 0) {
			this.pending.push(imgNode);
			return plain(prefix);
		}

		return imgNode;
	}

	private tryParseLink(ctx: FormattingContext): Inlines | null {
		const savedPos = this.stream.getPos();
		this.stream.consume(); // [

		const labelNodes = this.parseLinkLabel(ctx);

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

	private parseLinkLabel(ctx: FormattingContext): Inlines[] {
		const nodes: Inlines[] = [];
		while (!this.stream.isAtEnd()) {
			if (this.stream.checkImage(SpecialChar, ']')) break;
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;
			const node = this.parseInline(ctx);
			if (node) nodes.push(node);
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
		const label = labelNodes.length > 0 ? (reducePlainTexts(labelNodes) as Markup[]) : undefined;

		if (PHONE_URL_RE.test(urlRaw)) {
			const digits = urlRaw.replace(/\D/g, '');
			if (digits.length >= 5) return link(`tel:${digits}`, label ?? [plain(urlRaw)]);
		}
		return link(urlRaw, label);
	}

	// ===========================================================================
	// PLAIN TOKEN — now only handles emoji shortcodes and emoticons.
	// Email, URL, Phone are handled as dedicated lexer tokens above.
	//
	// Underscore merging: still needed for word-internal cases like joe_roe@joe.com.
	// Now also merges when _ is followed by Email (e.g. local_part@domain.com).
	// ===========================================================================

	// ===========================================================================
	// INLINE SPOILER — ||content||
	// ===========================================================================

	private tryParseInlineSpoiler(ctx: FormattingContext): Inlines | null {
		const savedPos = this.stream.getPos();
		const tok = this.stream.peek()!;
		const afterOpen = tok.image.slice(2); // strip leading ||

		// |||| (empty) — not a valid spoiler
		if (tok.image === '||||') return null;

		this.stream.consume(); // consume the Plain token starting with ||

		// Check if closing || is in the same token (e.g. "||spoiler||" is one Plain token)
		const closeIdx = afterOpen.indexOf('||');
		if (closeIdx !== -1) {
			const innerText = afterOpen.slice(0, closeIdx);
			const rest = afterOpen.slice(closeIdx + 2);
			if (innerText.length === 0) {
				this.stream.setPos(savedPos);
				return null;
			}
			const inner = this.parseQuoteLine(innerText);
			// Re-lex the rest so it can be parsed (e.g. " and ||second||")
			if (rest.length > 0) {
				const restNodes = this.parseQuoteLine(rest);
				this.pending.push(...restNodes);
			}
			return spoiler(inner as any);
		}

		// Closing || is in a later token — collect raw text + tokens until found
		const parts: string[] = [afterOpen];

		while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
			if (this.stream.check(PlainToken)) {
				const t = this.stream.peek()!;
				const ci = t.image.indexOf('||');
				if (ci !== -1) {
					parts.push(t.image.slice(0, ci));
					const rest = t.image.slice(ci + 2);
					this.stream.consume();
					const innerText = parts.join('');
					if (innerText.length === 0) {
						this.stream.setPos(savedPos);
						return null;
					}
					const inner = this.parseQuoteLine(innerText);
					if (rest.length > 0) {
						const restNodes = this.parseQuoteLine(rest);
						this.pending.push(...restNodes);
					}
					return spoiler(inner as any);
				}
			}
			parts.push(this.stream.consume().image);
		}

		// No closing || found — restore and return null (treated as plain text by parsePlainToken)
		this.stream.setPos(savedPos);
		return null;
	}

	// ===========================================================================
	// COLOR — color:#rgb / #rgba / #rrggbb / #rrggbbaa
	// Tokens: Plain("color:") + SpecialChar("#") + Plain("<hex>")
	// ===========================================================================

	private tryParseColor(): Inlines | null {
		const savedPos = this.stream.getPos();

		// Consume Plain("color:")
		this.stream.consume();

		// Must be followed by SpecialChar("#")
		if (!this.stream.checkImage(SpecialChar, '#')) {
			this.stream.setPos(savedPos);
			return null;
		}
		this.stream.consume(); // #

		// Must be followed by a Plain token containing only hex chars of valid length
		const hexTok = this.stream.peek();
		if (!hexTok || hexTok.tokenType.name !== PlainToken.name) {
			this.stream.setPos(savedPos);
			return null;
		}

		const hex = hexTok.image;
		const validLen = hex.length === 3 || hex.length === 4 || hex.length === 6 || hex.length === 8;
		const validChars = /^[0-9a-fA-F]+$/.test(hex);

		if (!validLen || !validChars) {
			// Invalid hex — emit color: + # + hexTok all as plain text to prevent
			// the # being parsed as a channel mention
			this.stream.consume(); // # already consumed above, consume hex too
			this.pending.push(plain('#' + hex));
			return plain('color:');
		}
		this.stream.consume(); // hex token

		let r = 0,
			g = 0,
			b = 0,
			a = 255;
		if (hex.length === 3) {
			r = parseInt(hex[0] + hex[0], 16);
			g = parseInt(hex[1] + hex[1], 16);
			b = parseInt(hex[2] + hex[2], 16);
		} else if (hex.length === 4) {
			r = parseInt(hex[0] + hex[0], 16);
			g = parseInt(hex[1] + hex[1], 16);
			b = parseInt(hex[2] + hex[2], 16);
			a = parseInt(hex[3] + hex[3], 16);
		} else if (hex.length === 6) {
			r = parseInt(hex.slice(0, 2), 16);
			g = parseInt(hex.slice(2, 4), 16);
			b = parseInt(hex.slice(4, 6), 16);
		} else {
			r = parseInt(hex.slice(0, 2), 16);
			g = parseInt(hex.slice(2, 4), 16);
			b = parseInt(hex.slice(4, 6), 16);
			a = parseInt(hex.slice(6, 8), 16);
		}

		// colors option disabled — emit as plain text
		if (!(this.options as any).colors) {
			return plain('color:#' + hex);
		}

		return color(r, g, b, a);
	}

	private parsePlainToken(): Inlines {
		let text = this.stream.consume().image;

		// Merge _ + Plain/Email tokens for word-internal cases like joe_roe@joe.com
		while (
			this.stream.checkImage(SpecialChar, '_') &&
			// _ followed by Plain that doesn't start with space or _
			((this.stream.peekAt(1)?.tokenType.name === PlainToken.name &&
				!/^\s/.test(this.stream.peekAt(1)!.image) &&
				!/^_/.test(this.stream.peekAt(1)!.image)) ||
				// _ followed by Email (e.g. local_part@domain.com)
				this.stream.peekAt(1)?.tokenType.name === EmailToken.name) &&
			/[a-zA-Z0-9]/.test(text.slice(-1))
		) {
			text += this.stream.consume().image; // _
			text += this.stream.consume().image; // Plain or Email
		}

		// Merge Plain + Email when Email starts with _ and plain ends with a word char.
		// e.g. Plain("(joe") + Email("_roe@joe.com") → text = "(joe_roe@joe.com)"
		// This happens because _ is in EMAIL_PATTERN's local-part charset, so Chevrotain
		// tokenizes "_roe@joe.com" as one Email token instead of SC("_") + Email("roe@...").
		while (this.stream.check(EmailToken) && this.stream.peek()!.image.startsWith('_') && /[a-zA-Z0-9]/.test(text.slice(-1))) {
			text += this.stream.consume().image;
		}

		// Scan for an email address embedded in the plain text.
		// Needed because the Plain token greedily consumes @ when it appears mid-sentence
		// (e.g. "Joe's email is joe@joe.com" is one Plain token since Plain is tried after
		// Email at each position, but only wins when the text doesn't start with a valid
		// email local-part).
		const emailRe = new RegExp(EMAIL_PATTERN.source, 'g');
		const emailMatch = emailRe.exec(text);
		if (emailMatch) {
			const before = text.slice(0, emailMatch.index);
			const matchedEmail = emailMatch[0];
			const after = text.slice(emailMatch.index + matchedEmail.length);
			const address = matchedEmail.startsWith('mailto:') ? matchedEmail.slice(7) : matchedEmail;
			const emailNode = autoEmail(address);
			// If autoEmail returned plain (invalid TLD etc.), fall through to splitPlainText
			if (emailNode.type !== 'PLAIN_TEXT') {
				if (after.length > 0) {
					const afterNodes = this.splitPlainText(after);
					this.pending.unshift(emailNode, ...afterNodes);
				} else {
					this.pending.unshift(emailNode);
				}
				if (before.length > 0) return plain(before);
				return this.pending.shift()!;
			}
		}

		const nodes = this.splitPlainText(text);
		if (nodes.length > 1) this.pending.push(...nodes.slice(1));
		return nodes[0];
	}

	// Split plain text at @mention, emoji shortcode, and emoticon boundaries.
	// URL/email/phone are now handled as dedicated lexer tokens.
	// @mention stays here due to word-boundary context requirement.
	private splitPlainText(text: string): Inlines[] {
		const results: Inlines[] = [];
		let remaining = text;
		let prevChar = '';

		while (remaining.length > 0) {
			// @mention
			const mentionMatch = remaining.match(MENTION_USER_RE);
			let mentionIdx = mentionMatch?.index ?? Infinity;

			// Reject if preceded by word char
			if (mentionMatch && mentionIdx !== Infinity) {
				const cb = mentionIdx > 0 ? remaining[mentionIdx - 1] : prevChar;
				if (/[a-zA-Z0-9]/.test(cb)) mentionIdx = Infinity;
			}

			// Emoji shortcode
			let emojiIdx = Infinity;
			let emojiMatch: RegExpMatchArray | null = null;
			const emojiRe = new RegExp(EMOJI_CODE_RE.source, 'g');
			let em: RegExpMatchArray | null;
			while ((em = emojiRe.exec(remaining)) !== null) {
				const before = em.index! > 0 ? remaining[em.index! - 1] : prevChar;
				const after = remaining[em.index! + em[0].length];
				if ((em.index === 0 || /[\s:]/.test(before)) && (after === undefined || /[\s:]/.test(after))) {
					emojiIdx = em.index!;
					emojiMatch = em;
					break;
				}
			}

			// Unicode emoji
			let unicodeIdx = Infinity;
			let unicodeMatch: RegExpMatchArray | null = null;
			const um = remaining.match(UNICODE_EMOJI_RE);
			if (um?.index !== undefined) {
				unicodeIdx = um.index;
				unicodeMatch = um;
			}

			// Emoticons (only when enabled)
			let emoticonIdx = Infinity;
			let emoticonKey = '';
			if (this.options.emoticons) {
				for (const key of EMOTICON_LIST) {
					const idx = remaining.indexOf(key);
					if (idx === -1) continue;
					const before = idx > 0 ? remaining[idx - 1] : prevChar;
					const after = remaining[idx + key.length];
					const validBefore = idx === 0 ? prevChar === '' || /\s/.test(prevChar) : /\s/.test(before);
					const validAfter = after === undefined || /\s/.test(after) || this.startsEmoticon(after + remaining.slice(idx + key.length + 1));
					if (validBefore && validAfter && idx < emoticonIdx) {
						emoticonIdx = idx;
						emoticonKey = key;
					}
				}
			}

			// No matches — entire remaining string is plain text
			if ([mentionIdx, emojiIdx, unicodeIdx, emoticonIdx].every((i) => i === Infinity)) {
				results.push(plain(remaining));
				break;
			}

			const minIdx = Math.min(mentionIdx, emojiIdx, unicodeIdx, emoticonIdx);
			if (minIdx > 0) results.push(plain(remaining.slice(0, minIdx)));

			if (minIdx === mentionIdx) {
				let mentionText = mentionMatch![0];
				// Strip trailing underscores — they may be italic delimiters
				const stripped = mentionText.replace(/_+$/, '');
				const leftover = mentionText.slice(stripped.length);
				results.push(mentionUser(stripped.slice(1))); // strip @
				prevChar = stripped.slice(-1);
				remaining = leftover + remaining.slice(mentionIdx + mentionText.length);
			} else if (minIdx === emojiIdx) {
				results.push(emoji(emojiMatch![0].slice(1, -1)));
				prevChar = ':';
				remaining = remaining.slice(emojiIdx + emojiMatch![0].length);
			} else if (minIdx === unicodeIdx) {
				results.push(emojiUnicode(unicodeMatch![0]));
				prevChar = unicodeMatch![0].slice(-1);
				remaining = remaining.slice(unicodeIdx + unicodeMatch![0].length);
			} else {
				// Emoticon
				results.push(emoticonNode(emoticonKey, EMOTICONS[emoticonKey]));
				prevChar = emoticonKey.slice(-1);
				remaining = remaining.slice(emoticonIdx + emoticonKey.length);
			}
		}

		return results;
	}

	// Check if a string starts with a known emoticon
	private startsEmoticon(s: string): boolean {
		return EMOTICON_LIST.some((k: any) => s.startsWith(k));
	}

	// ===========================================================================
	// ESCAPE & FALLBACK
	// ===========================================================================

	private parseEscape(): Inlines {
		return plain(this.stream.consume().image[1]);
	}

	private parseFallback(): Inlines {
		return plain(this.stream.consume().image);
	}

	// ===========================================================================
	// INLINE CODE
	// ===========================================================================

	private tryParseInlineCode(): Inlines | null {
		const savedPos = this.stream.getPos();
		this.stream.consume(); // opening `

		const parts: string[] = [];

		while (!this.stream.isAtEnd()) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;

			if (this.stream.checkImage(SpecialChar, '`')) {
				this.stream.consume(); // closing `

				if (parts.length === 0) {
					this.stream.setPos(savedPos);
					return null;
				}

				return inlineCode(plain(parts.join('')));
			}

			parts.push(this.stream.consume().image);
		}

		this.stream.setPos(savedPos);
		return null;
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
