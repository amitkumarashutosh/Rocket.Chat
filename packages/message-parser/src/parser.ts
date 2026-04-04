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
	timestamp,
	timestampFromHours,
} from './utils';

import type {
	Root,
	Inlines,
	Markup,
	Paragraph,
	Bold,
	Italic,
	Strike,
	Plain,
	Code,
	CodeLine,
	Heading,
	Quote,
	Spoiler,
	SpoilerBlock,
	Link,
	ChannelMention,
	Emoji,
	Color,
	Image,
	OrderedList,
	UnorderedList,
	ListItem,
	InlineCode,
	KaTeX,
	InlineKaTeX,
	Timestamp,
	BigEmoji,
	Blocks,
} from './definitions';

import type { Options } from './index';

import {
	EMOTICONS,
	EMOTICON_LIST,
	URL_TRAILING_CHARS,
	encodeTimestamps,
	decodeSentinels,
	parseTimestampTagParts,
	isEpochString,
	parseRelativeTimestamp,
	matchAtDomain,
	stripTrailingUnderscores,
	isPhoneUrl,
	isOrderedListStart,
	matchOrderedListItem,
	isValidHexString,
	isWordChar,
	isWordCharWithDot,
	isNonSpaceStart,
	isGenericWordChar,
	stripNonDigits,
	findEmailInText,
	scanPlainText,
	type ScanHit,
} from './patterns';

import { TokenStream } from './token-stream';

// =============================================================================
// CONSTANTS
// =============================================================================

const VALID_TIMESTAMP_FORMATS = new Set<Timestamp['value']['format']>(['t', 'T', 'd', 'D', 'f', 'F', 'R']);

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

function prevTokenLastChar(stream: TokenStream, pos: number): string | undefined {
	if (pos === 0) return undefined;
	return stream.tokenAt(pos - 1)?.image?.slice(-1);
}

// =============================================================================
// BIG EMOJI POST-PROCESSOR
// =============================================================================

function tryMakeBigEmoji(blocks: Array<Paragraph | Blocks>): Root {
	const emojis: Emoji[] = [];
	for (const block of blocks) {
		if (block.type === 'LINE_BREAK') continue;
		if (block.type !== 'PARAGRAPH') return blocks;
		for (const node of block.value) {
			if (node.type === 'PLAIN_TEXT') {
				if (node.value.trim() !== '') return blocks;
			} else if (node.type === 'EMOJI') {
				if (emojis.length === 3) return blocks;
				emojis.push(node);
			} else {
				return blocks;
			}
		}
	}
	if (emojis.length === 0) return blocks;
	return [bigEmoji(emojis as BigEmoji['value'])];
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
		const blocks: Array<Paragraph | Blocks> = [];

		while (!this.stream.isAtEnd()) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
				let count = 0;
				while (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
					count += this.stream.consume().image.length;
				}
				if (blocks.length > 0) {
					const lastType = blocks[blocks.length - 1]?.type;
					const trailingIsBreak = lastType === 'HEADING' || lastType === 'SPOILER_BLOCK';
					const breaksToAdd = trailingIsBreak ? (this.stream.isAtEnd() ? count : count) : this.stream.isAtEnd() ? 0 : count - 1;
					for (let i = 0; i < breaksToAdd; i++) blocks.push(lineBreak());
				}
				continue;
			}

			if ((this.options as any).katex?.parenthesisSyntax && this.stream.check(LiteralBackslash)) {
				const block = this.tryParseBlockKatex();
				if (block) {
					blocks.push(block);
					continue;
				}
			}

			if (this.stream.check(CodeFence)) {
				const pos = this.stream.getPos();
				const prev = this.stream.tokenAt(pos - 1);
				const prevNL = prev?.tokenType.name === NewLine.name || prev?.tokenType.name === DoubleNewLine.name;
				if (pos === 0 || prevNL) {
					const block = this.tryParseCodeBlock();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			if (this.stream.check(PlainToken)) {
				const img = this.stream.peek()!.image;
				const pos = this.stream.getPos();
				const prev = this.stream.tokenAt(pos - 1);
				const prevNL = pos === 0 || prev?.tokenType.name === NewLine.name || prev?.tokenType.name === DoubleNewLine.name;

				if (img.startsWith('>') && prevNL) {
					const block = this.tryParseQuote();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
				if (img === '||' && prevNL) {
					const block = this.tryParseSpoilerBlock();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
				if (img.startsWith('- ') && prevNL) {
					const block = this.tryParseUnorderedList('-');
					if (block) {
						blocks.push(block);
						continue;
					}
				}
				if (isOrderedListStart(img) && prevNL) {
					const block = this.tryParseOrderedList();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			if (this.stream.checkImage(SpecialChar, '*')) {
				const pos = this.stream.getPos();
				const prev = this.stream.tokenAt(pos - 1);
				const prevNL = pos === 0 || prev?.tokenType.name === NewLine.name || prev?.tokenType.name === DoubleNewLine.name;
				const next = this.stream.peekAt(1);
				const nextIsSpace = next?.tokenType.name === PlainToken.name && next.image.startsWith(' ');
				if (prevNL && nextIsSpace) {
					const block = this.tryParseUnorderedList('*');
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			if (this.stream.checkImage(SpecialChar, '#')) {
				const pos = this.stream.getPos();
				const prev = this.stream.tokenAt(pos - 1);
				const prevNL = pos === 0 || prev?.tokenType.name === NewLine.name || prev?.tokenType.name === DoubleNewLine.name;
				if (prevNL) {
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

	private tryParseCodeBlock(): Code | null {
		const savedPos = this.stream.getPos();
		const openTok = this.stream.consume();
		const rawLang = openTok.image.slice(3).trim();
		const lang = rawLang.length > 0 ? rawLang : undefined;

		if (!this.stream.match(NewLine)) {
			this.stream.setPos(savedPos);
			return null;
		}

		const lines: CodeLine[] = [];

		while (!this.stream.isAtEnd()) {
			if (this.stream.check(CodeFence)) {
				this.stream.consume();
				return code(lines, lang);
			}
			const lineParts: string[] = [];
			let alreadyPushed = false;

			while (!this.stream.isAtEnd()) {
				if (this.stream.check(CodeFence)) break;
				if (this.stream.check(NewLine)) {
					this.stream.consume();
					break;
				}
				if (this.stream.check(DoubleNewLine)) {
					this.stream.consume();
					lines.push(codeLine(plain(lineParts.join(''))));
					lines.push(codeLine(plain('')));
					lineParts.length = 0;
					alreadyPushed = true;
					break;
				}
				lineParts.push(this.stream.consume().image);
			}
			if (!alreadyPushed) lines.push(codeLine(plain(lineParts.join(''))));
		}

		this.stream.setPos(savedPos);
		return null;
	}

	// ===========================================================================
	// HEADING
	// ===========================================================================

	private tryParseHeading(): Heading | null {
		const savedPos = this.stream.getPos();
		let level = 0;
		while (this.stream.checkImage(SpecialChar, '#') && level < 4) {
			this.stream.consume();
			level++;
		}
		const next = this.stream.peek();
		if (!next || next.tokenType.name !== PlainToken.name || !next.image.startsWith(' ')) {
			this.stream.setPos(savedPos);
			return null;
		}
		const tok = this.stream.consume();
		const parts = [tok.image.slice(1)];
		while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
			parts.push(this.stream.consume().image);
		}
		return heading([plain(parts.join(''))], level as Heading['level']);
	}

	// ===========================================================================
	// BLOCK KATEX
	// ===========================================================================

	private tryParseBlockKatex(): KaTeX | null {
		const savedPos = this.stream.getPos();
		if (!this.stream.check(LiteralBackslash)) return null;
		this.stream.consume();
		if (!this.stream.checkImage(SpecialChar, '[')) {
			this.stream.setPos(savedPos);
			return null;
		}
		this.stream.consume();
		const parts: string[] = [];
		while (!this.stream.isAtEnd()) {
			if (this.stream.check(LiteralBackslash)) {
				this.stream.consume();
				if (this.stream.checkImage(SpecialChar, ']')) {
					this.stream.consume();
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
	// INLINE KATEX
	// ===========================================================================

	private tryParseInlineKatex(): InlineKaTeX | null {
		const savedPos = this.stream.getPos();
		this.stream.consume();
		const next = this.stream.peek();
		if (!next || next.tokenType.name !== PlainToken.name || !next.image.startsWith('(')) {
			this.stream.setPos(savedPos);
			return null;
		}
		this.stream.consume();
		const parts = [next.image.slice(1)];
		while (!this.stream.isAtEnd()) {
			if (this.stream.check(NewLine) || this.stream.check(DoubleNewLine)) break;
			if (this.stream.check(LiteralBackslash)) {
				this.stream.consume();
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
	// BLOCKQUOTE
	// ===========================================================================

	private tryParseQuote(): Quote | null {
		const savedPos = this.stream.getPos();
		const paragraphs: Paragraph[] = [];

		while (!this.stream.isAtEnd()) {
			if (!this.stream.check(PlainToken) || !this.stream.peek()!.image.startsWith('>')) break;
			const tok = this.stream.consume();
			let line = tok.image.slice(1);
			if (line.startsWith(' ')) line = line.slice(1);

			const lineParts = [line];
			while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
				lineParts.push(this.stream.consume().image);
			}
			paragraphs.push(paragraph(reducePlainTexts(this.parseQuoteLine(lineParts.join('')))));
			if (this.stream.check(NewLine)) this.stream.consume();
			else break;
		}

		if (paragraphs.length === 0) {
			this.stream.setPos(savedPos);
			return null;
		}
		return quote(paragraphs);
	}

	private parseQuoteLine(text: string): Inlines[] {
		const { tokens, errors } = MessageLexer.tokenize(text);
		if (errors.length > 0) return [plain(text)];
		if (tokens.length === 0) return [plain('')];
		const sub = new Parser(new TokenStream(tokens), this.options);
		return reducePlainTexts(sub.parseParagraphInlines()) as Inlines[];
	}

	parseParagraphInlines(): Inlines[] {
		const inlines: Inlines[] = [];
		while (!this.stream.isAtEnd() || this.pending.length > 0) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;
			const node = this.nextInline({});
			if (node) inlines.push(node);
		}
		return inlines;
	}

	// ===========================================================================
	// SPOILER BLOCK
	// ===========================================================================

	private tryParseSpoilerBlock(): SpoilerBlock | null {
		const savedPos = this.stream.getPos();
		if (!this.stream.check(PlainToken) || this.stream.peek()!.image !== '||') return null;
		this.stream.consume();
		if (!this.stream.check(NewLine)) {
			this.stream.setPos(savedPos);
			return null;
		}
		this.stream.consume();

		const paragraphs: Paragraph[] = [];
		while (!this.stream.isAtEnd()) {
			if (this.stream.check(PlainToken) && this.stream.peek()!.image === '||') {
				this.stream.consume();
				return spoilerBlock(paragraphs);
			}
			const lineParts: string[] = [];
			while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
				lineParts.push(this.stream.consume().image);
			}
			paragraphs.push(paragraph(reducePlainTexts(this.parseQuoteLine(lineParts.join('')))));
			if (this.stream.check(NewLine)) this.stream.consume();
			else if (this.stream.check(DoubleNewLine)) break;
		}
		this.stream.setPos(savedPos);
		return null;
	}

	// ===========================================================================
	// UNORDERED LIST
	// ===========================================================================

	private tryParseUnorderedList(marker: '-' | '*'): UnorderedList | null {
		const savedPos = this.stream.getPos();
		const items: ListItem[] = [];

		while (!this.stream.isAtEnd()) {
			let lineText: string;
			if (marker === '-') {
				if (!this.stream.check(PlainToken) || !this.stream.peek()!.image.startsWith('- ')) break;
				lineText = this.stream.consume().image.slice(2);
			} else {
				if (!this.stream.checkImage(SpecialChar, '*')) break;
				const next = this.stream.peekAt(1);
				if (!next || next.tokenType.name !== PlainToken.name || !next.image.startsWith(' ')) break;
				this.stream.consume();
				lineText = this.stream.consume().image.slice(1);
			}
			const lineParts = [lineText];
			while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
				lineParts.push(this.stream.consume().image);
			}
			items.push(listItem(this.parseQuoteLine(lineParts.join(''))));
			if (this.stream.check(NewLine)) this.stream.consume();
			else break;
		}

		if (items.length === 0) {
			this.stream.setPos(savedPos);
			return null;
		}
		return unorderedList(items);
	}

	// ===========================================================================
	// ORDERED LIST
	// ===========================================================================

	private tryParseOrderedList(): OrderedList | null {
		const savedPos = this.stream.getPos();
		const items: ListItem[] = [];

		while (!this.stream.isAtEnd()) {
			if (!this.stream.check(PlainToken)) break;
			const tok = this.stream.peek()!;
			const m = matchOrderedListItem(tok.image);
			if (!m) break;
			this.stream.consume();
			const [num, firstLine] = m;
			const lineParts = [firstLine];
			while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
				lineParts.push(this.stream.consume().image);
			}
			items.push(listItem(this.parseQuoteLine(lineParts.join('')), num));
			if (this.stream.check(NewLine)) this.stream.consume();
			else break;
		}

		if (items.length === 0) {
			this.stream.setPos(savedPos);
			return null;
		}
		return orderedList(items);
	}

	private parseParagraph(): Paragraph {
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

		if (this.stream.check(LiteralBackslash)) {
			if ((this.options as any).katex?.parenthesisSyntax) {
				const node = this.tryParseInlineKatex();
				if (node) return node;
			}
			const bsImage = this.stream.consume().image;
			const next = this.stream.peek();
			if (next && next.tokenType.name === SpecialChar.name) {
				return plain(bsImage + this.stream.consume().image);
			}
			return plain(bsImage);
		}

		if (this.stream.checkImage(SpecialChar, '*') && !ctx.inBold) {
			const node = this.tryParseFormatting('*', ctx);
			if (node) return node;
		}
		if (this.stream.checkImage(SpecialChar, '_') && !ctx.inItalic) {
			const node = this.tryParseItalic(ctx);
			if (node) return node;
		}
		if (this.stream.checkImage(SpecialChar, '~') && !ctx.inStrike) {
			const node = this.tryParseFormatting('~', ctx);
			if (node) return node;
		}
		if (this.stream.checkImage(SpecialChar, '`')) {
			const node = this.tryParseInlineCode();
			if (node) return node;
		}

		if (
			this.stream.check(PlainToken) &&
			this.stream.peek()!.image.endsWith('!') &&
			this.stream.peekAt(1)?.tokenType.name === SpecialChar.name &&
			this.stream.peekAt(1)?.image === '['
		) {
			const node = this.tryParseImage(ctx);
			if (node) return node;
		}

		if (this.stream.checkImage(SpecialChar, '[')) {
			const node = this.tryParseLink(ctx);
			if (node) return node;
		}
		if (this.stream.checkImage(SpecialChar, '#')) {
			const node = this.tryParseChannelMention();
			if (node) return node;
		}

		if (this.stream.check(EmailToken)) return this.parseEmailToken();
		if (this.stream.check(UrlToken)) return this.parseUrlToken();
		if (this.stream.check(PhoneToken)) return this.parsePhoneToken();

		if (this.stream.check(PlainToken)) {
			const img = this.stream.peek()!.image;
			if (img.startsWith('||')) {
				const node = this.tryParseInlineSpoiler();
				if (node) return node;
			}
			if (img === 'color:') {
				const node = this.tryParseColor();
				if (node) return node;
			}
			return this.parsePlainToken(ctx);
		}

		if (this.stream.check(CodeFence)) return plain(this.stream.consume().image);
		return this.parseFallback();
	}

	// ===========================================================================
	// TOKEN PARSERS
	// ===========================================================================

	private parseEmailToken(): Link | Plain {
		const tok = this.stream.consume();
		const address = tok.image.startsWith('mailto:') ? tok.image.slice(7) : tok.image;
		return autoEmail(address);
	}

	private parseUrlToken(): Link | Plain {
		const tok = this.stream.consume();
		const prevChar = prevTokenLastChar(this.stream, this.stream.getPos() - 1);
		if (isWordCharWithDot(prevChar)) return plain(tok.image);
		const [stripped, leftover] = stripUrlTrailing(tok.image);
		if (leftover) this.pending.push(plain(leftover));
		return autoLink(stripped, this.options.customDomains);
	}

	private parsePhoneToken(): Link | Plain {
		const tok = this.stream.consume();
		const prevChar = prevTokenLastChar(this.stream, this.stream.getPos() - 1);
		if (isGenericWordChar(prevChar)) return plain(tok.image);
		return phoneChecker(tok.image, stripNonDigits(tok.image));
	}

	// ===========================================================================
	// CHANNEL MENTION
	// ===========================================================================

	private tryParseChannelMention(): ChannelMention | null {
		const savedPos = this.stream.getPos();
		const prevChar = prevTokenLastChar(this.stream, savedPos);
		if (isWordChar(prevChar) || prevChar === '#' || prevChar === ':' || prevChar === '@') return null;
		const prevImg = savedPos > 0 ? this.stream.tokenAt(savedPos - 1)?.image : undefined;
		if (prevImg === 'color:') return null;

		this.stream.consume();
		if (this.stream.checkImage(SpecialChar, '#')) {
			this.stream.setPos(savedPos);
			return null;
		}

		const tok = this.stream.peek();
		if (tok?.tokenType.name === PlainToken.name && isNonSpaceStart(tok.image)) {
			this.stream.consume();
			const spaceIdx = tok.image.indexOf(' ');
			const name = spaceIdx === -1 ? tok.image : tok.image.slice(0, spaceIdx);
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

	private tryParseFormatting(delim: '*', ctx: FormattingContext): Bold | null;
	private tryParseFormatting(delim: '~', ctx: FormattingContext): Strike | null;
	private tryParseFormatting(delim: '*' | '~', ctx: FormattingContext): Bold | Strike | null {
		const savedPos = this.stream.getPos();
		this.stream.consume();
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
				this.stream.consume();
				const closingDouble = this.stream.checkImage(SpecialChar, delim);

				if (isDouble && closingDouble) {
					this.stream.consume();
					closed = true;
					break;
				} else if (isDouble && !closingDouble) {
					this.stream.setPos(savedPos + 1);
					const single = this.tryParseFormatting(delim as any, ctx);
					if (single) {
						this.pending.unshift(single);
						return plain(delim) as any;
					}
					this.stream.setPos(savedPos);
					return null;
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
		const allWS = inner.every((n) => n.type === 'PLAIN_TEXT' && (n as Plain).value.trim() === '');
		if (allWS) {
			this.stream.setPos(savedPos);
			return null;
		}

		const reduced = reducePlainTexts(inner) as Bold['value'];
		return delim === '*' ? bold(reduced) : strike(reduced as Strike['value']);
	}

	// ===========================================================================
	// ITALIC (_)
	// ===========================================================================

	private tryParseItalic(ctx: FormattingContext): Italic | null {
		const savedPos = this.stream.getPos();
		const prevChar = prevTokenLastChar(this.stream, savedPos);
		if (isWordChar(prevChar)) return null;

		this.stream.consume();
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
					this.stream.setPos(savedPos + 1);
					const single = this.tryParseItalic(ctx);
					if (single) {
						this.pending.unshift(single);
						return plain('_') as any;
					}
					this.stream.setPos(savedPos);
					return null;
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
		const allWS = inner.every((n) => n.type === 'PLAIN_TEXT' && (n as Plain).value.trim() === '');
		if (allWS) {
			this.stream.setPos(savedPos);
			return null;
		}
		return italic(reducePlainTexts(inner) as Italic['value']);
	}

	// ===========================================================================
	// IMAGE & LINK
	// ===========================================================================

	private tryParseImage(ctx: FormattingContext): Image | Plain | null {
		const savedPos = this.stream.getPos();
		const plainTok = this.stream.consume();
		const prefix = plainTok.image.slice(0, -1);
		this.stream.consume();

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

		const label = labelNodes.length > 0 ? (reducePlainTexts(labelNodes)[0] as Markup) : undefined;
		const imgNode = image(urlRaw, label);
		if (prefix.length > 0) {
			this.pending.push(imgNode);
			return plain(prefix);
		}
		return imgNode;
	}

	private tryParseLink(ctx: FormattingContext): Link | null {
		const savedPos = this.stream.getPos();
		this.stream.consume();
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

	private resolveLinkUrl(urlRaw: string, labelNodes: Inlines[]): Link {
		const label = labelNodes.length > 0 ? (reducePlainTexts(labelNodes) as Markup[]) : undefined;
		if (isPhoneUrl(urlRaw)) {
			const digits = stripNonDigits(urlRaw);
			if (digits.length >= 5) return link(`tel:${digits}`, label ?? [plain(urlRaw)]);
		}
		return link(urlRaw, label);
	}

	// ===========================================================================
	// INLINE SPOILER
	// ===========================================================================

	private tryParseInlineSpoiler(): Spoiler | null {
		const savedPos = this.stream.getPos();
		const tok = this.stream.peek()!;
		const afterOpen = tok.image.slice(2);
		if (tok.image === '||||') return null;
		this.stream.consume();

		const closeIdx = afterOpen.indexOf('||');
		if (closeIdx !== -1) {
			const innerText = afterOpen.slice(0, closeIdx);
			const rest = afterOpen.slice(closeIdx + 2);
			if (innerText.length === 0) {
				this.stream.setPos(savedPos);
				return null;
			}
			const inner = this.parseQuoteLine(innerText);
			if (rest.length > 0) this.pendingFromText(rest);
			return spoiler(inner as Spoiler['value']);
		}

		const parts = [afterOpen];
		while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
			if (this.stream.check(PlainToken)) {
				const t = this.stream.peek()!;
				const ci = t.image.indexOf('||');
				if (ci !== -1) {
					parts.push(t.image.slice(0, ci));
					const rest = t.image.slice(ci + 2);
					const innerText = parts.join('');
					this.stream.consume();
					if (innerText.length === 0) {
						this.stream.setPos(savedPos);
						return null;
					}
					const inner = this.parseQuoteLine(innerText);
					if (rest.length > 0) this.pendingFromText(rest);
					return spoiler(inner as Spoiler['value']);
				}
			}
			parts.push(this.stream.consume().image);
		}
		this.stream.setPos(savedPos);
		return null;
	}

	private pendingFromText(text: string): void {
		if (!text) return;
		const { tokens, errors } = MessageLexer.tokenize(text);
		if (errors.length > 0 || tokens.length === 0) {
			this.pending.push(plain(text));
			return;
		}
		this.stream.inject(tokens);
	}

	// ===========================================================================
	// COLOR
	// ===========================================================================

	private tryParseColor(): Color | Plain | null {
		const savedPos = this.stream.getPos();
		this.stream.consume();
		if (!this.stream.checkImage(SpecialChar, '#')) {
			this.stream.setPos(savedPos);
			return null;
		}
		this.stream.consume();

		const hexTok = this.stream.peek();
		if (!hexTok || hexTok.tokenType.name !== PlainToken.name) {
			this.stream.setPos(savedPos);
			return null;
		}

		const hex = hexTok.image;
		const validLen = hex.length === 3 || hex.length === 4 || hex.length === 6 || hex.length === 8;
		if (!validLen || !isValidHexString(hex)) {
			this.stream.consume();
			this.pending.push(plain('#' + hex));
			return plain('color:');
		}
		this.stream.consume();

		function hb(s: string, start: number, expand: boolean): number {
			const n = s.slice(start, start + (expand ? 1 : 2));
			return expand ? parseInt(n + n, 16) : parseInt(n, 16);
		}

		let r = 0,
			g = 0,
			b = 0,
			a = 255;
		if (hex.length === 3) {
			r = hb(hex, 0, true);
			g = hb(hex, 1, true);
			b = hb(hex, 2, true);
		} else if (hex.length === 4) {
			r = hb(hex, 0, true);
			g = hb(hex, 1, true);
			b = hb(hex, 2, true);
			a = hb(hex, 3, true);
		} else if (hex.length === 6) {
			r = hb(hex, 0, false);
			g = hb(hex, 2, false);
			b = hb(hex, 4, false);
		} else {
			r = hb(hex, 0, false);
			g = hb(hex, 2, false);
			b = hb(hex, 4, false);
			a = hb(hex, 6, false);
		}

		if (!(this.options as any).colors) return plain('color:#' + hex);
		return color(r, g, b, a);
	}

	// ===========================================================================
	// TIMESTAMP TAG
	// ===========================================================================

	private parseTimestampTag(raw: string): Timestamp | null {
		const parts = parseTimestampTagParts(raw);
		if (!parts) return null;
		const { value, format } = parts;
		if (!VALID_TIMESTAMP_FORMATS.has(format as Timestamp['value']['format'])) return null;

		let unixSeconds: number;
		if (isEpochString(value)) {
			if (value.length < 5) return null;
			unixSeconds = parseInt(value, 10);
		} else if (value.includes('T')) {
			const ms = Date.parse(value);
			if (isNaN(ms)) return null;
			unixSeconds = Math.floor(ms / 1000);
		} else {
			const m = parseRelativeTimestamp(value);
			if (!m) return null;
			const tsStr = timestampFromHours(m[0], m[1], m[2], m[3]);
			unixSeconds = parseInt(tsStr, 10);
			if (isNaN(unixSeconds)) return null;
		}
		return timestamp(String(unixSeconds), format as Timestamp['value']['format']);
	}

	// ===========================================================================
	// PLAIN TOKEN
	// ===========================================================================

	private parsePlainToken(_ctx: FormattingContext = {}): Inlines {
		let text = this.stream.consume().image;

		// Absorb underscore-joined word segments (snake_case protection)
		while (
			this.stream.checkImage(SpecialChar, '_') &&
			((this.stream.peekAt(1)?.tokenType.name === PlainToken.name &&
				isNonSpaceStart(this.stream.peekAt(1)!.image) &&
				!this.stream.peekAt(1)!.image.startsWith('_')) ||
				this.stream.peekAt(1)?.tokenType.name === EmailToken.name) &&
			isWordChar(text.slice(-1))
		) {
			text += this.stream.consume().image;
			text += this.stream.consume().image;
		}
		while (this.stream.check(EmailToken) && this.stream.peek()!.image.startsWith('_') && isWordChar(text.slice(-1))) {
			text += this.stream.consume().image;
		}
		while (text.endsWith('@') && this.stream.check(EmailToken)) {
			text += this.stream.consume().image;
		}

		// Fast email detection with '@' pre-check
		if (!text.startsWith('@') && text.includes('@')) {
			const emailResult = findEmailInText(text, 0);
			if (emailResult) {
				const [emailIdx, matchedEmail] = emailResult;
				const before = text.slice(0, emailIdx);
				const after = text.slice(emailIdx + matchedEmail.length);
				const address = matchedEmail.startsWith('mailto:') ? matchedEmail.slice(7) : matchedEmail;
				const emailNode = autoEmail(address);
				if (emailNode.type !== 'PLAIN_TEXT') {
					if (after.length > 0) {
						const afterNodes = this.splitPlainText(after, _ctx.inBold);
						this.pending.unshift(emailNode, ...afterNodes);
					} else {
						this.pending.unshift(emailNode);
					}
					if (before.length > 0) return plain(before);
					return this.pending.shift()!;
				}
			}
		}

		const nodes = this.splitPlainText(text, _ctx.inBold);
		if (nodes.length > 1) this.pending.push(...nodes.slice(1));
		return nodes[0];
	}

	// ===========================================================================
	// SPLIT PLAIN TEXT  — single-pass via scanPlainText()
	// ===========================================================================

	private splitPlainText(text: string, noTimestamp: boolean = false): Inlines[] {
		const results: Inlines[] = [];
		let remaining = text;
		let prevChar = '';

		while (remaining.length > 0) {
			const spoilerIdx = remaining.indexOf('||');
			const hit: ScanHit | null = scanPlainText(remaining, prevChar, noTimestamp, !!this.options.emoticons, EMOTICON_LIST);

			// if || comes before any other hit, handle it first
			if (spoilerIdx !== -1 && (hit === null || spoilerIdx < hit.idx)) {
				if (spoilerIdx > 0) results.push(plain(remaining.slice(0, spoilerIdx)));
				// find closing ||
				const closeIdx = remaining.indexOf('||', spoilerIdx + 2);
				if (closeIdx !== -1) {
					const innerText = remaining.slice(spoilerIdx + 2, closeIdx);
					if (innerText.length > 0) {
						const inner = this.parseQuoteLine(innerText);
						results.push(spoiler(inner as Spoiler['value']));
						prevChar = '|';
						remaining = remaining.slice(closeIdx + 2);
						continue;
					}
				}
				// no valid closing || found, treat as plain
				results.push(plain('||'));
				prevChar = '|';
				remaining = remaining.slice(spoilerIdx + 2);
				continue;
			}

			if (!hit) {
				results.push(plain(remaining));
				break;
			}

			if (hit.idx > 0) results.push(plain(remaining.slice(0, hit.idx)));

			switch (hit.type) {
				case 'timestamp': {
					const tsNode = this.parseTimestampTag(hit.text);
					results.push(tsNode ?? plain(hit.text));
					prevChar = '>';
					remaining = remaining.slice(hit.idx + hit.text.length);
					break;
				}
				case 'mention': {
					let mentionText = hit.text;
					let afterMention = remaining.slice(hit.idx + mentionText.length);
					const domainMatch = matchAtDomain(afterMention);
					if (domainMatch) {
						mentionText += domainMatch;
						afterMention = afterMention.slice(domainMatch.length);
					}
					const [stripped, leftover] = stripTrailingUnderscores(mentionText);
					results.push(mentionUser(stripped.slice(1)));
					prevChar = stripped.slice(-1);
					remaining = leftover + afterMention;
					break;
				}
				case 'emoji': {
					results.push(emoji(hit.text.slice(1, -1)));
					prevChar = ':';
					remaining = remaining.slice(hit.idx + hit.text.length);
					break;
				}
				case 'unicode': {
					results.push(emojiUnicode(hit.text));
					prevChar = hit.text.slice(-1);
					remaining = remaining.slice(hit.idx + hit.text.length);
					break;
				}
				case 'emoticon': {
					results.push(emoticonNode(hit.key, EMOTICONS[hit.key]));
					prevChar = hit.key.slice(-1);
					remaining = remaining.slice(hit.idx + hit.key.length);
					break;
				}
			}
		}

		return results;
	}

	// ===========================================================================
	// ESCAPE & FALLBACK
	// ===========================================================================

	private parseEscape(): Plain {
		return plain(this.stream.consume().image[1]);
	}
	private parseFallback(): Plain {
		return plain(this.stream.consume().image);
	}

	// ===========================================================================
	// INLINE CODE
	// ===========================================================================

	private tryParseInlineCode(): InlineCode | null {
		const savedPos = this.stream.getPos();
		this.stream.consume();
		const parts: string[] = [];

		while (!this.stream.isAtEnd()) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;
			if (this.stream.checkImage(SpecialChar, '`')) {
				this.stream.consume();
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
	const { encoded, map } = encodeTimestamps(input);

	if (map.length === 0) {
		const { tokens, errors } = MessageLexer.tokenize(input);
		if (errors.length > 0) throw new Error(`Lexer error: ${errors[0].message}`);
		return new Parser(new TokenStream(tokens), options).parseMessage();
	}

	const { tokens, errors } = MessageLexer.tokenize(encoded);
	if (errors.length > 0) throw new Error(`Lexer error: ${errors[0].message}`);

	for (const tok of tokens) {
		if (tok.tokenType.name === 'Plain') {
			tok.image = decodeSentinels(tok.image, map);
		}
	}

	return new Parser(new TokenStream(tokens), options).parseMessage();
};
