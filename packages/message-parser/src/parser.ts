import type { IToken } from 'chevrotain';

import { MessageLexer, Escape, LiteralBackslash, DoubleNewLine, NewLine, Plain as PlainToken, SpecialChar } from './lexer';

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
} from './utils';

import type { Root, Inlines, Markup } from './definitions';
import type { Options } from './index';
import { EMOTICONS, EMOTICON_LIST } from './emoticons';

// =============================================================================
// INLINE PATTERNS — all detected inside Plain tokens via splitPlainText()
// The lexer does NOT have special tokens for these; they live in Plain text.
// =============================================================================

// @mention — unicode-aware, includes . @ : - in name
const MENTION_USER_RE =
	/@[\w\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0400-\u04FF\u0E00-\u0E7F\u0900-\u097F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF][\w\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0400-\u04FF\u0E00-\u0E7F\u0900-\u097F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF.@:-]*/;

// Email
const EMAIL_RE =
	/(?:mailto:)?[a-zA-Z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0400-\u04FF'_.+-]+@[a-zA-Z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0400-\u04FF-]+\.[a-zA-Z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0400-\u04FF.-]+[a-zA-Z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0400-\u04FF]/;

// URL
const URL_RE = /(?:(?:[a-zA-Z][a-zA-Z0-9+\-]*):\/\/|(?:www\.))[\S]+/;

// Phone
const PHONE_RE = /\+(\(\d+\)[\d-]*|\d[\d-]*)(?![.,\d])/;

// Emoji shortcode: must be preceded by space/start/colon, followed by space/end/colon
const EMOJI_CODE_RE = /:[a-zA-Z0-9_+\-]+:/g;

// Unicode emoji sequences
const UNICODE_EMOJI_RE =
	/(?:\p{Emoji}\uFE0F|\p{Emoji_Presentation})\p{Emoji_Modifier}?(?:\u200D(?:\p{Emoji}\uFE0F|\p{Emoji_Presentation})\p{Emoji_Modifier}?)*/u;

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
		if ('.!,'.includes(last)) result = result.slice(0, -1);
		else if (last === ')' && !result.includes('(')) result = result.slice(0, -1);
		else break;
	}
	return [result, url.slice(result.length)];
}

function isWordChar(ch: string | undefined): boolean {
	return ch !== undefined && /\w/.test(ch);
}

// =============================================================================
// BIG EMOJI POST-PROCESSOR
// Check if the entire parsed result is 1-3 emoji/emoticon nodes (+ whitespace only)
// =============================================================================

function tryMakeBigEmoji(blocks: any[]): Root {
	const emojis: any[] = [];

	for (const block of blocks) {
		if (block.type === 'LINE_BREAK') continue;
		if (block.type !== 'PARAGRAPH') return blocks;

		for (const node of block.value) {
			if (node.type === 'PLAIN_TEXT') {
				if (node.value.trim() !== '') return blocks; // non-whitespace text = not bigEmoji
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
				if (blocks.length > 0 && !this.stream.isAtEnd()) {
					for (let i = 0; i < count - 1; i++) blocks.push(lineBreak());
				}
				continue;
			}

			const para = this.parseParagraph();
			if (para.value.length > 0) blocks.push(para);
		}

		return tryMakeBigEmoji(blocks);
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

		// Plain token — may contain @mentions, emails, URLs, phones, emoji
		if (this.stream.check(PlainToken)) return this.parsePlainToken();

		return this.parseFallback();
	}

	// ===========================================================================
	// #CHANNEL MENTION — # is SpecialChar, rest is in Plain token
	// ===========================================================================

	private tryParseChannelMention(): Inlines | null {
		const savedPos = this.stream.getPos();
		this.stream.consume(); // #

		const tok = this.stream.peek();
		if (tok?.tokenType.name === PlainToken.name && !/^\s/.test(tok.image)) {
			this.stream.consume();
			// Extract just the channel name (stop at first space)
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
					break; // leave extra * in stream
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
		const prevChar = savedPos > 0 ? this.stream.tokenAt(savedPos - 1)?.image?.slice(-1) : undefined;
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
						this.stream.setPos(p);
						this.stream.setPos(savedPos);
						return null;
					}
					closed = true;
					break;
				} else {
					if (isWordChar(nextChar)) {
						this.stream.setPos(p);
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
		return italic(reducePlainTexts(inner) as any);
	}

	// ===========================================================================
	// LINK [label](url)
	// ===========================================================================

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

		if (/^\+(\(\d+\)[\d-]*|\d[\d-]*)$/.test(urlRaw)) {
			const digits = urlRaw.replace(/\D/g, '');
			if (digits.length >= 5) return link(`tel:${digits}`, label ?? [plain(urlRaw)]);
		}
		return link(urlRaw, label);
	}

	// ===========================================================================
	// PLAIN TOKEN — merge underscores, then split at all pattern boundaries
	// ===========================================================================

	private parsePlainToken(): Inlines {
		let text = this.stream.consume().image;

		// Merge _ + Plain tokens for emails like joe_roe@joe.com
		while (this.stream.checkImage(SpecialChar, '_') && this.stream.peekAt(1)?.tokenType.name === PlainToken.name) {
			text += this.stream.consume().image;
			text += this.stream.consume().image;
		}

		const nodes = this.splitPlainText(text);
		if (nodes.length > 1) this.pending.push(...nodes.slice(1));
		return nodes[0];
	}

	// Split plain text at all inline pattern boundaries
	private splitPlainText(text: string): Inlines[] {
		const results: Inlines[] = [];
		let remaining = text;
		let prevChar = '';

		while (remaining.length > 0) {
			// Find all candidates
			const urlMatch = remaining.match(URL_RE);
			const emailMatch = remaining.match(EMAIL_RE);
			const phoneMatch = remaining.match(PHONE_RE);
			const mentionMatch = remaining.match(MENTION_USER_RE);

			let urlIdx = urlMatch?.index ?? Infinity;
			let emailIdx = emailMatch?.index ?? Infinity;
			let phoneIdx = phoneMatch?.index ?? Infinity;
			let mentionIdx = mentionMatch?.index ?? Infinity;

			// URL: reject if preceded by alphanumeric or dot
			if (urlMatch && urlIdx !== Infinity) {
				const cb = urlIdx > 0 ? remaining[urlIdx - 1] : prevChar;
				if (/[a-zA-Z0-9.]/.test(cb)) urlIdx = Infinity;
			}

			// Phone: reject if preceded by word char
			if (phoneMatch && phoneIdx !== Infinity) {
				const cb = phoneIdx > 0 ? remaining[phoneIdx - 1] : prevChar;
				if (/\w/.test(cb)) phoneIdx = Infinity;
			}

			// Emoji shortcode
			let emojiIdx = Infinity;
			let emojiMatch: RegExpMatchArray | null = null;
			const emojiRe = /:[a-zA-Z0-9_+\-]+:/g;
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
					// Must be space/start before AND (space/end OR another emoticon start) after
					const validBefore = idx === 0 ? prevChar === '' || /\s/.test(prevChar) : /\s/.test(before);
					const validAfter = after === undefined || /\s/.test(after) || this.startsEmoticon(after + remaining.slice(idx + key.length + 1));
					if (validBefore && validAfter) {
						if (idx < emoticonIdx) {
							emoticonIdx = idx;
							emoticonKey = key;
						}
					}
				}
			}

			// No matches
			if ([urlIdx, emailIdx, phoneIdx, mentionIdx, emojiIdx, unicodeIdx, emoticonIdx].every((i) => i === Infinity)) {
				results.push(plain(remaining));
				break;
			}

			// Pick earliest
			const minIdx = Math.min(urlIdx, emailIdx, phoneIdx, mentionIdx, emojiIdx, unicodeIdx, emoticonIdx);

			if (minIdx > 0) results.push(plain(remaining.slice(0, minIdx)));

			if (minIdx === urlIdx) {
				const [stripped, leftover] = stripUrlTrailing(urlMatch![0]);
				results.push(autoLink(stripped, this.options.customDomains));
				remaining = leftover + remaining.slice(urlIdx + urlMatch![0].length);
				prevChar = stripped.slice(-1);
			} else if (minIdx === emailIdx) {
				const address = emailMatch![0].startsWith('mailto:') ? emailMatch![0].slice(7) : emailMatch![0];
				results.push(autoEmail(address));
				prevChar = emailMatch![0].slice(-1);
				remaining = remaining.slice(emailIdx + emailMatch![0].length);
			} else if (minIdx === phoneIdx) {
				results.push(phoneChecker(phoneMatch![0], phoneMatch![0].replace(/\D/g, '')));
				prevChar = phoneMatch![0].slice(-1);
				remaining = remaining.slice(phoneIdx + phoneMatch![0].length);
			} else if (minIdx === mentionIdx) {
				results.push(mentionUser(mentionMatch![0].slice(1))); // strip @
				prevChar = mentionMatch![0].slice(-1);
				remaining = remaining.slice(mentionIdx + mentionMatch![0].length);
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
