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
	// FIX 1: Removed unused 'UserMention' type import
	ChannelMention,
	Emoji,
	Color,
	Image,
	OrderedList,
	UnorderedList,
	ListItem,
	InlineCode,
	// FIX 2: Removed unused 'LineBreak' type import
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
	MENTION_USER_RE,
	EMOJI_CODE_RE,
	UNICODE_EMOJI_RE,
	URL_TRAILING_CHARS,
	PHONE_URL_RE,
	EMAIL_PATTERN,
	WORD_CHAR_RE,
	WORD_CHAR_WITH_DOT_RE,
	WHITESPACE_RE,
	WHITESPACE_OR_COLON_RE,
	NON_SPACE_START_RE,
	ALPHA_RE,
	NON_DIGIT_RE,
	GENERIC_WORD_CHAR_RE,
	ORDERED_LIST_RE,
	ORDERED_LIST_ITEM_RE,
	HEX_COLOR_RE,
	TIMESTAMP_TAG_RE,
	TIMESTAMP_SENTINEL_PREFIX,
	buildSentinelRe,
	TIMESTAMP_RELATIVE_RE,
	TIMESTAMP_EPOCH_RE,
	TIMESTAMP_INLINE_RE,
	AT_DOMAIN_RE,
	MENTION_TRAILING_UNDERSCORE_RE,
} from './patterns';

// =============================================================================
// MODULE-LEVEL COMPILED REGEX CACHE
// =============================================================================

const _emojiCodeRe: RegExp = new RegExp(EMOJI_CODE_RE.source, 'g');
const _emailRe: RegExp = new RegExp(EMAIL_PATTERN.source, 'g');
const _sentinelRe: RegExp = buildSentinelRe(TIMESTAMP_SENTINEL_PREFIX);
const _emoticonCount: number = EMOTICON_LIST.length;

// =============================================================================
// TIMESTAMP
// =============================================================================

const VALID_TIMESTAMP_FORMATS = new Set<Timestamp['value']['format']>(['t', 'T', 'd', 'D', 'f', 'F', 'R']);

// =============================================================================
// TOKEN STREAM
// =============================================================================

class TokenStream {
	private tokens: IToken[];
	private pos: number = 0;

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

	inject(newTokens: IToken[]): void {
		this.tokens.splice(this.pos, 0, ...newTokens);
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
	return ch !== undefined && WORD_CHAR_RE.test(ch);
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
				let count: number = 0;
				while (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
					count += this.stream.consume().image.length;
				}
				if (blocks.length > 0) {
					const lastType = blocks[blocks.length - 1]?.type;
					const trailingNewlineIsBreak: boolean = lastType === 'HEADING' || lastType === 'SPOILER_BLOCK';
					let breaksToAdd: number;
					if (trailingNewlineIsBreak) {
						breaksToAdd = this.stream.isAtEnd() ? count : count - 1 + 1;
					} else {
						breaksToAdd = this.stream.isAtEnd() ? 0 : count - 1;
					}
					for (let i = 0; i < breaksToAdd; i++) blocks.push(lineBreak());
				}
				continue;
			}

			if ((this.options as any).katex?.parenthesisSyntax && this.stream.check(LiteralBackslash)) {
				const block: KaTeX | null = this.tryParseBlockKatex();
				if (block) {
					blocks.push(block);
					continue;
				}
			}

			if (this.stream.check(CodeFence)) {
				const pos: number = this.stream.getPos();
				const prevTok: IToken | undefined = this.stream.tokenAt(pos - 1);
				const prevIsNewline: boolean = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				if (pos === 0 || prevIsNewline) {
					const block: Code | null = this.tryParseCodeBlock();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			if (this.stream.check(PlainToken) && this.stream.peek()!.image.startsWith('>')) {
				const pos: number = this.stream.getPos();
				const prevTok: IToken | undefined = this.stream.tokenAt(pos - 1);
				const prevIsNewline: boolean = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				if (pos === 0 || prevIsNewline) {
					const block: Quote | null = this.tryParseQuote();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			if (this.stream.check(PlainToken) && this.stream.peek()!.image === '||') {
				const pos: number = this.stream.getPos();
				const prevTok: IToken | undefined = this.stream.tokenAt(pos - 1);
				const prevIsNewline: boolean = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				if (pos === 0 || prevIsNewline) {
					const block: SpoilerBlock | null = this.tryParseSpoilerBlock();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			if (this.stream.check(PlainToken) && this.stream.peek()!.image.startsWith('- ')) {
				const pos: number = this.stream.getPos();
				const prevTok: IToken | undefined = this.stream.tokenAt(pos - 1);
				const prevIsNewline: boolean = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				if (pos === 0 || prevIsNewline) {
					const block: UnorderedList | null = this.tryParseUnorderedList('-');
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			if (this.stream.checkImage(SpecialChar, '*')) {
				const pos: number = this.stream.getPos();
				const prevTok: IToken | undefined = this.stream.tokenAt(pos - 1);
				const prevIsNewline: boolean = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				const nextTok: IToken | undefined = this.stream.peekAt(1);
				const nextIsSpace: boolean = nextTok?.tokenType.name === PlainToken.name && nextTok.image.startsWith(' ');
				if ((pos === 0 || prevIsNewline) && nextIsSpace) {
					const block: UnorderedList | null = this.tryParseUnorderedList('*');
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			if (this.stream.check(PlainToken) && ORDERED_LIST_RE.test(this.stream.peek()!.image)) {
				const pos: number = this.stream.getPos();
				const prevTok: IToken | undefined = this.stream.tokenAt(pos - 1);
				const prevIsNewline: boolean = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				if (pos === 0 || prevIsNewline) {
					const block: OrderedList | null = this.tryParseOrderedList();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			if (this.stream.checkImage(SpecialChar, '#')) {
				const pos: number = this.stream.getPos();
				const prevTok: IToken | undefined = this.stream.tokenAt(pos - 1);
				const prevIsNewline: boolean = prevTok?.tokenType.name === NewLine.name || prevTok?.tokenType.name === DoubleNewLine.name;
				if (pos === 0 || prevIsNewline) {
					const block: Heading | null = this.tryParseHeading();
					if (block) {
						blocks.push(block);
						continue;
					}
				}
			}

			const para: Paragraph = this.parseParagraph();
			if (para.value.length > 0) blocks.push(para);
		}

		return tryMakeBigEmoji(blocks);
	}

	// ===========================================================================
	// CODE BLOCK
	// ===========================================================================

	private tryParseCodeBlock(): Code | null {
		const savedPos: number = this.stream.getPos();
		const openTok: IToken = this.stream.consume();

		const rawLang: string = openTok.image.slice(3).trim();
		const lang: string | undefined = rawLang.length > 0 ? rawLang : undefined;

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
					(lineParts as any).__alreadyPushed = true;
					break;
				}

				lineParts.push(this.stream.consume().image);
			}

			if (!(lineParts as any).__alreadyPushed) {
				lines.push(codeLine(plain(lineParts.join(''))));
			}
		}

		this.stream.setPos(savedPos);
		return null;
	}

	// ===========================================================================
	// HEADING
	// ===========================================================================

	private tryParseHeading(): Heading | null {
		const savedPos: number = this.stream.getPos();

		let level: number = 0;
		while (this.stream.checkImage(SpecialChar, '#') && level < 4) {
			this.stream.consume();
			level++;
		}

		const next: IToken | undefined = this.stream.peek();
		if (!next || next.tokenType.name !== PlainToken.name || !next.image.startsWith(' ')) {
			this.stream.setPos(savedPos);
			return null;
		}

		const tok: IToken = this.stream.consume();
		const text: string = tok.image.slice(1);

		const parts: string[] = [text];
		while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
			parts.push(this.stream.consume().image);
		}

		return heading([plain(parts.join(''))], level as Heading['level']);
	}

	// ===========================================================================
	// BLOCK KATEX — \[ ... \]
	// ===========================================================================

	private tryParseBlockKatex(): KaTeX | null {
		const savedPos: number = this.stream.getPos();

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
	// INLINE KATEX — \(content\)
	// ===========================================================================

	private tryParseInlineKatex(): InlineKaTeX | null {
		const savedPos: number = this.stream.getPos();

		this.stream.consume();

		const next: IToken | undefined = this.stream.peek();
		if (!next || next.tokenType.name !== PlainToken.name || !next.image.startsWith('(')) {
			this.stream.setPos(savedPos);
			return null;
		}
		this.stream.consume();
		const afterParen: string = next.image.slice(1);

		const parts: string[] = [afterParen];
		while (!this.stream.isAtEnd()) {
			if (this.stream.check(NewLine) || this.stream.check(DoubleNewLine)) break;
			if (this.stream.check(LiteralBackslash)) {
				this.stream.consume();
				const t: IToken | undefined = this.stream.peek();
				if (t && t.tokenType.name === PlainToken.name && t.image.startsWith(')')) {
					this.stream.consume();
					const leftover: string = t.image.slice(1);
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
		const savedPos: number = this.stream.getPos();
		const paragraphs: Paragraph[] = [];

		while (!this.stream.isAtEnd()) {
			if (!this.stream.check(PlainToken) || !this.stream.peek()!.image.startsWith('>')) break;

			const tok: IToken = this.stream.consume();
			let line: string = tok.image.slice(1);
			if (line.startsWith(' ')) line = line.slice(1);

			const lineParts: string[] = [line];
			while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
				lineParts.push(this.stream.consume().image);
			}

			const lineInlines: Inlines[] = this.parseQuoteLine(lineParts.join(''));
			paragraphs.push(paragraph(reducePlainTexts(lineInlines)));

			if (this.stream.check(NewLine)) {
				this.stream.consume();
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

	private parseQuoteLine(text: string): Inlines[] {
		const { tokens, errors } = MessageLexer.tokenize(text);
		if (errors.length > 0) return [plain(text)];
		if (tokens.length === 0) return [plain('')];
		const subStream = new TokenStream(tokens);
		const subParser = new Parser(subStream, this.options);
		const inlines: Inlines[] = subParser.parseParagraphInlines();
		return reducePlainTexts(inlines) as Inlines[];
	}

	parseParagraphInlines(): Inlines[] {
		const inlines: Inlines[] = [];
		while (!this.stream.isAtEnd() || this.pending.length > 0) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;
			const node: Inlines | null = this.nextInline({});
			if (node) inlines.push(node);
		}
		return inlines;
	}

	// ===========================================================================
	// SPOILER BLOCK
	// ===========================================================================

	private tryParseSpoilerBlock(): SpoilerBlock | null {
		const savedPos: number = this.stream.getPos();

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
			const inlines: Inlines[] = this.parseQuoteLine(lineParts.join(''));
			paragraphs.push(paragraph(reducePlainTexts(inlines)));

			if (this.stream.check(NewLine)) {
				this.stream.consume();
			} else if (this.stream.check(DoubleNewLine)) {
				break;
			}
		}

		this.stream.setPos(savedPos);
		return null;
	}

	// ===========================================================================
	// UNORDERED LIST
	// ===========================================================================

	private tryParseUnorderedList(marker: '-' | '*'): UnorderedList | null {
		const savedPos: number = this.stream.getPos();
		const items: ListItem[] = [];

		while (!this.stream.isAtEnd()) {
			let lineText: string;

			if (marker === '-') {
				if (!this.stream.check(PlainToken) || !this.stream.peek()!.image.startsWith('- ')) break;
				const tok: IToken = this.stream.consume();
				lineText = tok.image.slice(2);
			} else {
				if (!this.stream.checkImage(SpecialChar, '*')) break;
				const nextTok: IToken | undefined = this.stream.peekAt(1);
				if (!nextTok || nextTok.tokenType.name !== PlainToken.name || !nextTok.image.startsWith(' ')) break;
				this.stream.consume();
				const tok: IToken = this.stream.consume();
				lineText = tok.image.slice(1);
			}

			const lineParts: string[] = [lineText];
			while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
				lineParts.push(this.stream.consume().image);
			}

			const inlines: Inlines[] = this.parseQuoteLine(lineParts.join(''));
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
	// ORDERED LIST
	// ===========================================================================

	private tryParseOrderedList(): OrderedList | null {
		const savedPos: number = this.stream.getPos();
		const items: ListItem[] = [];

		while (!this.stream.isAtEnd()) {
			if (!this.stream.check(PlainToken)) break;
			const tok: IToken = this.stream.peek()!;
			const m: RegExpMatchArray | null = tok.image.match(ORDERED_LIST_ITEM_RE);
			if (!m) break;

			this.stream.consume();
			const num: number = parseInt(m[1], 10);
			let lineText: string = m[2];

			const lineParts: string[] = [lineText];
			while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
				lineParts.push(this.stream.consume().image);
			}
			lineText = lineParts.join('');

			const inlines: Inlines[] = this.parseQuoteLine(lineText);
			items.push(listItem(inlines, num));

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

	private parseParagraph(): Paragraph {
		const inlines: Inlines[] = [];

		while (!this.stream.isAtEnd() || this.pending.length > 0) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;
			const node: Inlines | null = this.nextInline({});
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
				const node: InlineKaTeX | null = this.tryParseInlineKatex();
				if (node) return node;
			}
			const bsImage: string = this.stream.consume().image;
			const next: IToken | undefined = this.stream.peek();
			if (next && next.tokenType.name === SpecialChar.name) {
				return plain(bsImage + this.stream.consume().image);
			}
			return plain(bsImage);
		}

		if (this.stream.checkImage(SpecialChar, '*') && !ctx.inBold) {
			const node: Bold | null = this.tryParseFormatting('*', ctx);
			if (node) return node;
		}

		if (this.stream.checkImage(SpecialChar, '_') && !ctx.inItalic) {
			const node: Italic | null = this.tryParseItalic(ctx);
			if (node) return node;
		}

		if (this.stream.checkImage(SpecialChar, '~') && !ctx.inStrike) {
			const node: Strike | null = this.tryParseFormatting('~', ctx);
			if (node) return node;
		}

		if (this.stream.checkImage(SpecialChar, '`')) {
			const node: InlineCode | null = this.tryParseInlineCode();
			if (node) return node;
		}

		if (
			this.stream.check(PlainToken) &&
			this.stream.peek()!.image.endsWith('!') &&
			this.stream.peekAt(1)?.tokenType.name === SpecialChar.name &&
			this.stream.peekAt(1)?.image === '['
		) {
			const node: Image | Plain | null = this.tryParseImage(ctx);
			if (node) return node;
		}

		if (this.stream.checkImage(SpecialChar, '[')) {
			const node: Link | null = this.tryParseLink(ctx);
			if (node) return node;
		}

		if (this.stream.checkImage(SpecialChar, '#')) {
			const node: ChannelMention | null = this.tryParseChannelMention();
			if (node) return node;
		}

		if (this.stream.check(EmailToken)) return this.parseEmailToken();
		if (this.stream.check(UrlToken)) return this.parseUrlToken();
		if (this.stream.check(PhoneToken)) return this.parsePhoneToken();

		if (this.stream.check(PlainToken) && this.stream.peek()!.image.startsWith('||')) {
			const node: Spoiler | null = this.tryParseInlineSpoiler();
			if (node) return node;
		}

		if (this.stream.check(PlainToken) && this.stream.peek()!.image === 'color:') {
			const node: Color | Plain | null = this.tryParseColor();
			if (node) return node;
		}

		if (this.stream.check(PlainToken)) return this.parsePlainToken(ctx);

		if (this.stream.check(CodeFence)) return plain(this.stream.consume().image);

		return this.parseFallback();
	}

	// ===========================================================================
	// EMAIL TOKEN
	// ===========================================================================

	private parseEmailToken(): Link | Plain {
		const tok: IToken = this.stream.consume();
		const address: string = tok.image.startsWith('mailto:') ? tok.image.slice(7) : tok.image;
		return autoEmail(address);
	}

	// ===========================================================================
	// URL TOKEN
	// ===========================================================================

	private parseUrlToken(): Link | Plain {
		const tok: IToken = this.stream.consume();

		const prevChar: string | undefined = prevTokenLastChar(this.stream, this.stream.getPos() - 1);
		if (WORD_CHAR_WITH_DOT_RE.test(prevChar ?? '')) {
			return plain(tok.image);
		}

		const [stripped, leftover]: [string, string] = stripUrlTrailing(tok.image);
		if (leftover) this.pending.push(plain(leftover));
		return autoLink(stripped, this.options.customDomains);
	}

	// ===========================================================================
	// PHONE TOKEN
	// ===========================================================================

	private parsePhoneToken(): Link | Plain {
		const tok: IToken = this.stream.consume();

		const prevChar: string | undefined = prevTokenLastChar(this.stream, this.stream.getPos() - 1);
		if (GENERIC_WORD_CHAR_RE.test(prevChar ?? '')) return plain(tok.image);

		return phoneChecker(tok.image, tok.image.replace(NON_DIGIT_RE, ''));
	}

	// ===========================================================================
	// #CHANNEL MENTION
	// ===========================================================================

	private tryParseChannelMention(): ChannelMention | null {
		const savedPos: number = this.stream.getPos();

		const prevChar: string | undefined = prevTokenLastChar(this.stream, savedPos);
		if (isWordChar(prevChar)) return null;
		if (prevChar === '#') return null;
		if (prevChar === ':') return null;
		if (prevChar === '@') return null;

		const prevTokImage: string | undefined = this.stream.getPos() > 0 ? this.stream.tokenAt(this.stream.getPos() - 1)?.image : undefined;
		if (prevTokImage === 'color:') return null;

		this.stream.consume();

		if (this.stream.checkImage(SpecialChar, '#')) {
			this.stream.setPos(savedPos);
			return null;
		}

		const tok: IToken | undefined = this.stream.peek();
		if (tok?.tokenType.name === PlainToken.name && NON_SPACE_START_RE.test(tok.image)) {
			this.stream.consume();
			const name: string = tok.image.split(' ')[0];
			const rest: string = tok.image.slice(name.length);
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
		const savedPos: number = this.stream.getPos();

		this.stream.consume();
		const isDouble: boolean = this.stream.checkImage(SpecialChar, delim);
		if (isDouble) this.stream.consume();

		const innerCtx: FormattingContext = {
			...ctx,
			inBold: delim === '*' ? true : ctx.inBold,
			inStrike: delim === '~' ? true : ctx.inStrike,
		};

		const inner: Inlines[] = [];
		let closed: boolean = false;

		while (!this.stream.isAtEnd()) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;

			if (this.stream.checkImage(SpecialChar, delim)) {
				// FIX 3: removed unused `const p` — position is captured in savedPos already
				this.stream.consume();
				const closingDouble: boolean = this.stream.checkImage(SpecialChar, delim);

				if (isDouble && closingDouble) {
					this.stream.consume();
					closed = true;
					break;
				} else if (isDouble && !closingDouble) {
					this.stream.setPos(savedPos + 1);
					const single: Bold | Strike | null = this.tryParseFormatting(delim as any, ctx);
					if (single) {
						this.pending.unshift(single);
						return plain(delim) as any;
					}
					this.stream.setPos(savedPos);
					return null;
				} else if (!isDouble && closingDouble) {
					closed = true;
					break;
				} else {
					closed = true;
					break;
				}
			}

			const node: Inlines | null = this.nextInline(innerCtx);
			if (node) inner.push(node);
		}

		if (!closed || inner.length === 0) {
			this.stream.setPos(savedPos);
			return null;
		}

		const allWS: boolean = inner.every((n) => n.type === 'PLAIN_TEXT' && (n as Plain).value.trim() === '');
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
		const savedPos: number = this.stream.getPos();

		const prevChar: string | undefined = prevTokenLastChar(this.stream, savedPos);
		if (isWordChar(prevChar)) return null;

		this.stream.consume();
		const isDouble: boolean = this.stream.checkImage(SpecialChar, '_');
		if (isDouble) this.stream.consume();

		const innerCtx: FormattingContext = { ...ctx, inItalic: true };
		const inner: Inlines[] = [];
		let closed: boolean = false;

		while (!this.stream.isAtEnd()) {
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) break;

			if (this.stream.checkImage(SpecialChar, '_')) {
				const p: number = this.stream.getPos();
				this.stream.consume();
				const closingDouble: boolean = this.stream.checkImage(SpecialChar, '_');
				const nextChar: string | undefined = this.stream.peek()?.image?.[0];

				if (isDouble && closingDouble) {
					if (isWordChar(nextChar)) {
						this.stream.setPos(p);
						const node: Inlines | null = this.nextInline(innerCtx);
						if (node) inner.push(node);
						continue;
					}
					this.stream.consume();
					closed = true;
					break;
				} else if (isDouble && !closingDouble) {
					if (isWordChar(nextChar)) {
						this.stream.setPos(p);
						const node: Inlines | null = this.nextInline(innerCtx);
						if (node) inner.push(node);
						continue;
					}
					this.stream.setPos(savedPos + 1);
					const single: Italic | null = this.tryParseItalic(ctx);
					if (single) {
						this.pending.unshift(single);
						return plain('_') as any;
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

			const node: Inlines | null = this.nextInline(innerCtx);
			if (node) inner.push(node);
		}

		if (!closed || inner.length === 0) {
			this.stream.setPos(savedPos);
			return null;
		}

		const allWS: boolean = inner.every((n) => n.type === 'PLAIN_TEXT' && (n as Plain).value.trim() === '');
		if (allWS) {
			this.stream.setPos(savedPos);
			return null;
		}

		return italic(reducePlainTexts(inner) as Italic['value']);
	}

	// ===========================================================================
	// IMAGE — ![label](url)
	// ===========================================================================

	private tryParseImage(ctx: FormattingContext): Image | Plain | null {
		const savedPos: number = this.stream.getPos();

		const plainTok: IToken = this.stream.consume();
		const prefix: string = plainTok.image.slice(0, -1);

		this.stream.consume();

		const labelNodes: Inlines[] = this.parseLinkLabel(ctx);

		if (!this.stream.matchImage(SpecialChar, ']')) {
			this.stream.setPos(savedPos);
			return null;
		}

		const urlRaw: string | null = this.parseLinkUrl();
		if (urlRaw === null) {
			this.stream.setPos(savedPos);
			return null;
		}

		const label: Markup | undefined = labelNodes.length > 0 ? (reducePlainTexts(labelNodes)[0] as Markup) : undefined;
		const imgNode: Image = image(urlRaw, label);

		if (prefix.length > 0) {
			this.pending.push(imgNode);
			return plain(prefix);
		}

		return imgNode;
	}

	private tryParseLink(ctx: FormattingContext): Link | null {
		const savedPos: number = this.stream.getPos();
		this.stream.consume();

		const labelNodes: Inlines[] = this.parseLinkLabel(ctx);

		if (!this.stream.matchImage(SpecialChar, ']')) {
			this.stream.setPos(savedPos);
			return null;
		}

		const urlRaw: string | null = this.parseLinkUrl();
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
			const node: Inlines | null = this.parseInline(ctx);
			if (node) nodes.push(node);
		}
		return nodes;
	}

	private parseLinkUrl(): string | null {
		const tok: IToken | undefined = this.stream.peek();
		if (!tok?.image.startsWith('(')) return null;
		this.stream.consume();
		let raw: string = tok.image.slice(1);
		if (raw.endsWith(')')) return raw.slice(0, -1);
		while (!this.stream.isAtEnd()) {
			const t: IToken = this.stream.consume();
			if (t.image.endsWith(')')) {
				raw += t.image.slice(0, -1);
				return raw;
			}
			raw += t.image;
		}
		return null;
	}

	private resolveLinkUrl(urlRaw: string, labelNodes: Inlines[]): Link {
		const label: Markup[] | undefined = labelNodes.length > 0 ? (reducePlainTexts(labelNodes) as Markup[]) : undefined;

		if (PHONE_URL_RE.test(urlRaw)) {
			const digits: string = urlRaw.replace(NON_DIGIT_RE, '');
			if (digits.length >= 5) return link(`tel:${digits}`, label ?? [plain(urlRaw)]);
		}
		return link(urlRaw, label);
	}

	// ===========================================================================
	// INLINE SPOILER
	// ===========================================================================

	private tryParseInlineSpoiler(): Spoiler | null {
		const savedPos: number = this.stream.getPos();
		const tok: IToken = this.stream.peek()!;
		const afterOpen: string = tok.image.slice(2);

		if (tok.image === '||||') return null;

		this.stream.consume();

		const closeIdx: number = afterOpen.indexOf('||');
		if (closeIdx !== -1) {
			const innerText: string = afterOpen.slice(0, closeIdx);
			const rest: string = afterOpen.slice(closeIdx + 2);
			if (innerText.length === 0) {
				this.stream.setPos(savedPos);
				return null;
			}
			const inner: Inlines[] = this.parseQuoteLine(innerText);
			if (rest.length > 0) this.pendingFromText(rest);
			return spoiler(inner as Spoiler['value']);
		}

		const parts: string[] = [afterOpen];

		while (!this.stream.isAtEnd() && !this.stream.check(NewLine) && !this.stream.check(DoubleNewLine)) {
			if (this.stream.check(PlainToken)) {
				const t: IToken = this.stream.peek()!;
				const ci: number = t.image.indexOf('||');
				if (ci !== -1) {
					parts.push(t.image.slice(0, ci));
					const rest: string = t.image.slice(ci + 2);
					this.stream.consume();
					const innerText: string = parts.join('');
					if (innerText.length === 0) {
						this.stream.setPos(savedPos);
						return null;
					}
					const inner: Inlines[] = this.parseQuoteLine(innerText);
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
		if (text.length === 0) return;
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
		const savedPos: number = this.stream.getPos();

		this.stream.consume();

		if (!this.stream.checkImage(SpecialChar, '#')) {
			this.stream.setPos(savedPos);
			return null;
		}
		this.stream.consume();

		const hexTok: IToken | undefined = this.stream.peek();
		if (!hexTok || hexTok.tokenType.name !== PlainToken.name) {
			this.stream.setPos(savedPos);
			return null;
		}

		const hex: string = hexTok.image;
		const validLen: boolean = hex.length === 3 || hex.length === 4 || hex.length === 6 || hex.length === 8;
		const validChars: boolean = HEX_COLOR_RE.test(hex);

		if (!validLen || !validChars) {
			this.stream.consume();
			this.pending.push(plain('#' + hex));
			return plain('color:');
		}
		this.stream.consume();

		let r: number = 0,
			g: number = 0,
			b: number = 0,
			a: number = 255;
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

		if (!(this.options as any).colors) {
			return plain('color:#' + hex);
		}

		return color(r, g, b, a);
	}

	// ===========================================================================
	// TIMESTAMP TAG
	// ===========================================================================

	private parseTimestampTag(raw: string): Timestamp | null {
		const inner: string = raw.slice(3, -1);

		let value: string = inner;
		let format: string = 't';

		const lastColon: number = inner.lastIndexOf(':');
		if (lastColon !== -1) {
			const candidate: string = inner.slice(lastColon + 1);
			if (candidate.length === 1 && ALPHA_RE.test(candidate)) {
				format = candidate;
				value = inner.slice(0, lastColon);
			}
		}

		if (!VALID_TIMESTAMP_FORMATS.has(format as Timestamp['value']['format'])) return null;

		let unixSeconds: number;

		if (TIMESTAMP_EPOCH_RE.test(value)) {
			if (value.length < 5) return null;
			unixSeconds = parseInt(value, 10);
		} else if (value.includes('T')) {
			const ms: number = Date.parse(value);
			if (isNaN(ms)) return null;
			unixSeconds = Math.floor(ms / 1000);
		} else {
			const m: RegExpMatchArray | null = value.match(TIMESTAMP_RELATIVE_RE);
			if (!m) return null;

			const tsStr: string = timestampFromHours(m[1], m[2], m[3] ?? '00', m[4]);
			unixSeconds = parseInt(tsStr, 10);
			if (isNaN(unixSeconds)) return null;
		}

		return timestamp(String(unixSeconds), format as Timestamp['value']['format']);
	}

	// ===========================================================================
	// PLAIN TOKEN
	// ===========================================================================

	private parsePlainToken(_ctx: FormattingContext = {}): Inlines {
		let text: string = this.stream.consume().image;

		while (
			this.stream.checkImage(SpecialChar, '_') &&
			((this.stream.peekAt(1)?.tokenType.name === PlainToken.name &&
				NON_SPACE_START_RE.test(this.stream.peekAt(1)!.image) &&
				!this.stream.peekAt(1)!.image.startsWith('_')) ||
				this.stream.peekAt(1)?.tokenType.name === EmailToken.name) &&
			WORD_CHAR_RE.test(text.slice(-1))
		) {
			text += this.stream.consume().image;
			text += this.stream.consume().image;
		}

		while (this.stream.check(EmailToken) && this.stream.peek()!.image.startsWith('_') && WORD_CHAR_RE.test(text.slice(-1))) {
			text += this.stream.consume().image;
		}

		while (text.endsWith('@') && this.stream.check(EmailToken)) {
			text += this.stream.consume().image;
		}

		_emailRe.lastIndex = 0;
		const emailMatch: RegExpExecArray | null = text.startsWith('@') ? null : _emailRe.exec(text);
		if (emailMatch) {
			const before: string = text.slice(0, emailMatch.index);
			const matchedEmail: string = emailMatch[0];
			const after: string = text.slice(emailMatch.index + matchedEmail.length);
			const address: string = matchedEmail.startsWith('mailto:') ? matchedEmail.slice(7) : matchedEmail;
			const emailNode: Link | Plain = autoEmail(address);
			if (emailNode.type !== 'PLAIN_TEXT') {
				if (after.length > 0) {
					const afterNodes: Inlines[] = this.splitPlainText(after, _ctx.inBold);
					this.pending.unshift(emailNode, ...afterNodes);
				} else {
					this.pending.unshift(emailNode);
				}
				if (before.length > 0) return plain(before);
				return this.pending.shift()!;
			}
		}

		const nodes: Inlines[] = this.splitPlainText(text, _ctx.inBold);
		if (nodes.length > 1) this.pending.push(...nodes.slice(1));
		return nodes[0];
	}

	// ===========================================================================
	// SPLIT PLAIN TEXT
	// ===========================================================================

	private splitPlainText(text: string, noTimestamp: boolean = false): Inlines[] {
		const results: Inlines[] = [];
		let remaining: string = text;
		let prevChar: string = '';

		while (remaining.length > 0) {
			if (!noTimestamp) {
				const tsMatch: RegExpMatchArray | null = remaining.match(TIMESTAMP_INLINE_RE);
				if (tsMatch && tsMatch.index !== undefined) {
					if (tsMatch.index > 0) results.push(plain(remaining.slice(0, tsMatch.index)));
					const tsNode: Timestamp | null = this.parseTimestampTag(tsMatch[0]);
					results.push(tsNode ?? plain(tsMatch[0]));
					prevChar = '>';
					remaining = remaining.slice(tsMatch.index + tsMatch[0].length);
					continue;
				}
			}

			const mentionMatch: RegExpMatchArray | null = remaining.match(MENTION_USER_RE);
			let mentionIdx: number = mentionMatch?.index ?? Infinity;
			if (mentionMatch && mentionIdx !== Infinity) {
				const cb: string = mentionIdx > 0 ? remaining[mentionIdx - 1] : prevChar;
				if (WORD_CHAR_RE.test(cb)) mentionIdx = Infinity;
			}

			let emojiIdx: number = Infinity;
			let emojiMatch: RegExpMatchArray | null = null;
			_emojiCodeRe.lastIndex = 0;
			let em: RegExpMatchArray | null;
			while ((em = _emojiCodeRe.exec(remaining)) !== null) {
				const before: string = em.index! > 0 ? remaining[em.index! - 1] : prevChar;
				const after: string | undefined = remaining[em.index! + em[0].length];
				if ((em.index === 0 || WHITESPACE_OR_COLON_RE.test(before)) && (after === undefined || WHITESPACE_OR_COLON_RE.test(after))) {
					emojiIdx = em.index!;
					emojiMatch = em;
					break;
				}
			}

			let unicodeIdx: number = Infinity;
			let unicodeMatch: RegExpMatchArray | null = null;
			const um: RegExpMatchArray | null = remaining.match(UNICODE_EMOJI_RE);
			if (um?.index !== undefined) {
				unicodeIdx = um.index;
				unicodeMatch = um;
			}

			let emoticonIdx: number = Infinity;
			let emoticonKey: string = '';
			if (this.options.emoticons) {
				for (let i = 0; i < _emoticonCount; i++) {
					const key: string = EMOTICON_LIST[i];
					const idx: number = remaining.indexOf(key);
					if (idx === -1 || idx >= emoticonIdx) continue;
					const before: string = idx > 0 ? remaining[idx - 1] : prevChar;
					const after: string | undefined = remaining[idx + key.length];
					const validBefore: boolean = idx === 0 ? prevChar === '' || WHITESPACE_RE.test(prevChar) : WHITESPACE_RE.test(before);
					const validAfter: boolean =
						after === undefined || WHITESPACE_RE.test(after) || this.startsEmoticon(after + remaining.slice(idx + key.length + 1));
					if (validBefore && validAfter) {
						emoticonIdx = idx;
						emoticonKey = key;
					}
				}
			}

			if (mentionIdx === Infinity && emojiIdx === Infinity && unicodeIdx === Infinity && emoticonIdx === Infinity) {
				results.push(plain(remaining));
				break;
			}

			const minIdx: number = Math.min(mentionIdx, emojiIdx, unicodeIdx, emoticonIdx);
			if (minIdx > 0) results.push(plain(remaining.slice(0, minIdx)));

			if (minIdx === mentionIdx) {
				let mentionText: string = mentionMatch![0];
				let afterMention: string = remaining.slice(mentionIdx + mentionText.length);

				const domainMatch: RegExpMatchArray | null = afterMention.match(AT_DOMAIN_RE);
				if (domainMatch) {
					mentionText += domainMatch[0];
					afterMention = afterMention.slice(domainMatch[0].length);
				}

				const stripped: string = mentionText.replace(MENTION_TRAILING_UNDERSCORE_RE, '');
				const leftover: string = mentionText.slice(stripped.length);
				results.push(mentionUser(stripped.slice(1)));
				prevChar = stripped.slice(-1);
				remaining = leftover + afterMention;
			} else if (minIdx === emojiIdx) {
				results.push(emoji(emojiMatch![0].slice(1, -1)));
				prevChar = ':';
				remaining = remaining.slice(emojiIdx + emojiMatch![0].length);
			} else if (minIdx === unicodeIdx) {
				results.push(emojiUnicode(unicodeMatch![0]));
				prevChar = unicodeMatch![0].slice(-1);
				remaining = remaining.slice(unicodeIdx + unicodeMatch![0].length);
			} else {
				results.push(emoticonNode(emoticonKey, EMOTICONS[emoticonKey]));
				prevChar = emoticonKey.slice(-1);
				remaining = remaining.slice(emoticonIdx + emoticonKey.length);
			}
		}

		return results;
	}

	private startsEmoticon(s: string): boolean {
		return EMOTICON_LIST.some((k: string) => s.startsWith(k));
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
		const savedPos: number = this.stream.getPos();
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
// TIMESTAMP PRE-LEXER
// =============================================================================

function encodeTimestampSentinels(input: string): { encoded: string; map: string[] } {
	const map: string[] = [];
	const encoded: string = input.replace(TIMESTAMP_TAG_RE, (match: string) => {
		const idx: number = map.length;
		map.push(match);
		return `${TIMESTAMP_SENTINEL_PREFIX}${idx}${TIMESTAMP_SENTINEL_PREFIX}`;
	});
	return { encoded, map };
}

// =============================================================================
// PUBLIC API
// =============================================================================

export const parse = (input: string, options?: Options): Root => {
	const { encoded, map }: { encoded: string; map: string[] } = encodeTimestampSentinels(input);

	if (map.length === 0) {
		const { tokens, errors } = MessageLexer.tokenize(input);
		if (errors.length > 0) throw new Error(`Lexer error: ${errors[0].message}`);
		return new Parser(new TokenStream(tokens), options).parseMessage();
	}

	const { tokens, errors } = MessageLexer.tokenize(encoded);
	if (errors.length > 0) throw new Error(`Lexer error: ${errors[0].message}`);

	_sentinelRe.lastIndex = 0;
	for (const tok of tokens) {
		if (tok.tokenType.name === 'Plain') {
			tok.image = tok.image.replace(_sentinelRe, (_: string, idx: string) => map[Number(idx)]);
		}
	}

	return new Parser(new TokenStream(tokens), options).parseMessage();
};
