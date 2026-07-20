import {
	EMOTICON_KEYS,
	EMOTICONS,
	isAlpha,
	isAlphaNum,
	isDigit,
	isEmojiStart,
	isHexDigit,
	isNewline,
	isPlainChar,
	isSpace,
	isUrlStart,
} from './chars';
import {
	BigEmoji,
	Bold,
	Code,
	CodeLine,
	Heading,
	HorizontalRule,
	Inlines,
	Italic,
	KaTeX,
	LineBreak,
	ListItem,
	Options,
	OrderedList,
	Paragraph,
	Quote,
	Root,
	Spoiler,
	SpoilerBlock,
	Strike,
	Timestamp,
	UnorderedList,
} from './index';
import { Scanner } from './scanner';
import {
	autoEmail,
	autoLink,
	bigEmoji,
	bold,
	code,
	codeLine,
	color,
	emoji,
	emojiUnicode,
	emoticon,
	heading,
	horizontalRule,
	image,
	inlineCode,
	inlineKatex,
	italic,
	katex,
	lineBreak,
	link,
	listItem,
	mentionChannel,
	mentionUser,
	orderedList,
	paragraph,
	phoneChecker,
	plain,
	quote,
	reducePlainTexts,
	spoiler,
	spoilerBlock,
	strike,
	timestamp,
	timestampFromHours,
	timestampFromIsoTime,
	unorderedList,
} from './utils';

// ----- Constants ------------------------------------------------------------
const ESCAPABLE = new Set(['*', '_', '~', '#', '.', '`']);
const UNICODE_EMOJI = new RegExp('^\\p{RGI_Emoji}\\uFE0F?', 'v');

const TS_TZ = '([+-]\\d{2}:\\d{2})?'; // optional "+00:00" style offset
const TS_UNIX = /^\d{10}$/; // exactly 10 digits
const TS_ISO_MS = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})\\.(\\d{3})${TS_TZ}$`);
const TS_ISO = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})${TS_TZ}$`);
const TS_HMS = new RegExp(`^(\\d{2}):(\\d{2}):(\\d{2})${TS_TZ}$`);
const TS_HM = new RegExp(`^(\\d{2}):(\\d{2})${TS_TZ}$`);

// ----- Re-entrancy guards  --------------------------------------------------
let skipBold = false;
let skipItalic = false;
let skipStrike = false;

// ----- Helpers --------------------------------------------------------------
function consumeEndOfLine(s: Scanner): void {
	if (s.isEnd()) return;
	if (s.char() === '\r' && s.charAt(1) === '\n') s.consume(2);
	else s.consume(1);
}

function isShortCodeChar(ch: string): boolean {
	return isAlphaNum(ch) || ch === '-' || ch === '_' || ch === '+' || ch === '.';
}

export function matchEmoticon(scanner: Scanner): Inlines | null {
	for (const key of EMOTICON_KEYS) {
		if (scanner.matches(key)) {
			scanner.consume(key.length);
			return emoticon(key, EMOTICONS[key]);
		}
	}
	return null;
}

function isEmailLocalChar(ch: string): boolean {
	return isAlphaNum(ch) || ch.charCodeAt(0) > 127 || ch === '.' || ch === '_' || ch === '+' || ch === '-' || ch === "'";
}

function isEmailDomainChar(ch: string): boolean {
	return isAlphaNum(ch) || ch.charCodeAt(0) > 127 || ch === '.' || ch === '-';
}

function isAnyText(ch: string): boolean {
	if (ch === '') return false;
	return (
		(ch >= ' ' && ch <= "'") || // space ! " # $ % & '
		(ch >= '+' && ch <= '@') || // + , - . / 0-9 : ; < = > ? @
		(ch >= 'A' && ch <= 'Z') || // A-Z
		(ch >= 'a' && ch <= 'z') || // a-z
		ch.charCodeAt(0) > 127 // any non-ASCII character
	);
}

function isPhoneChar(ch: string): boolean {
	return isDigit(ch) || ch === '(' || ch === ')' || ch === '-';
}

// ------ Entry Point ---------------------------------------------------------
export function parse(input: string, options: Options = {}) {
	const bigEmojiRoot = tryBigEmoji(input, options);
	if (bigEmojiRoot !== null) {
		return bigEmojiRoot;
	}

	const root: Root = [];
	const scanner = new Scanner(input);

	while (!scanner.isEnd()) {
		const lineBreakNode: LineBreak | null = tryLineBreak(scanner);
		if (lineBreakNode !== null) {
			root.push(lineBreakNode);
			continue;
		}

		const katexBlockNode: KaTeX | null = tryKatexBlock(scanner, options);
		if (katexBlockNode !== null) {
			root.push(katexBlockNode);
			continue;
		}

		const codeFenceNode: Code | null = tryCodeFence(scanner);
		if (codeFenceNode !== null) {
			root.push(codeFenceNode);
			continue;
		}

		const blockSpoilerNode: SpoilerBlock | null = tryBlockSpoiler(scanner, options);
		if (blockSpoilerNode !== null) {
			root.push(blockSpoilerNode);
			continue;
		}

		const blockquoteNode: Quote | null = tryBlockquote(scanner, options);
		if (blockquoteNode !== null) {
			root.push(blockquoteNode);
			continue;
		}

		const unorderedListNode: UnorderedList | null = tryUnorderedList(scanner, options);
		if (unorderedListNode !== null) {
			root.push(unorderedListNode);
			continue;
		}

		const orderedListNode: OrderedList | null = tryOrderedList(scanner, options);
		if (orderedListNode !== null) {
			root.push(orderedListNode);
			continue;
		}

		const headingNode: Heading | null = tryHeading(scanner, options);
		if (headingNode !== null) {
			root.push(headingNode);
			continue;
		}

		const inlines = parseInline(scanner, options);
		if (inlines.length > 0) {
			root.push(paragraph(inlines));
		}

		consumeEndOfLine(scanner); // Skip newline characters
	}

	return root;
}

function parseInline(scanner: Scanner, options: Options) {
	const nodes: Inlines[] = [];
	let prev = '';

	while (!scanner.isEnd() && !isNewline(scanner.char())) {
		const ch = scanner.char();

		// Emoticons
		if (options.emoticons) {
			const result = tryEmoticon(scanner, prev);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// KaTeX inline
		if (ch === '$' || (ch === '\\' && scanner.charAt(1) === '(')) {
			const result = tryKatexInline(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Escape sequences
		if (ch === '\\') {
			const next = scanner.charAt(1);
			if (next !== '' && ESCAPABLE.has(next)) {
				nodes.push(plain(next));
				scanner.consume(2);
				prev = next;
				continue;
			}

			nodes.push(plain(ch));
			scanner.consume();
			prev = ch;
			continue;
		}

		// Inline code
		if (ch === '`') {
			const result = tryInlineCode(scanner);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Bold
		if (ch === '*') {
			const result = tryBold(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Strike
		if (ch === '~') {
			const result = tryStrike(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Italic
		if (ch === '_') {
			const result = tryItalic(scanner, options, prev);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Emoji shortcode (:smile:)
		if (ch === ':') {
			const result = tryEmojiShortCode(scanner);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Unicode raw emoji
		if (isEmojiStart(ch)) {
			const result = tryUnicodeEmoji(scanner);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// Color (color:#rgb / rgba / rrggbb / rrggbbaa)
		if (scanner.matches('color:#')) {
			const result = tryColor(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// Phone (+number)
		if (ch === '+') {
			const result = tryPhone(scanner, prev);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// User mention
		if (ch === '@') {
			const mention = tryUserMention(scanner, prev);
			if (mention !== null) {
				nodes.push(mention);
				prev = ch;
				continue;
			}
		}

		// Email (local@domain)
		if (isUrlStart(ch) || ch.charCodeAt(0) > 127) {
			const email = tryEmail(scanner);
			if (email !== null) {
				nodes.push(email);
				prev = '';
				continue;
			}
		}

		// Mention channel
		if (ch === '#') {
			const result = tryChannelMention(scanner, prev);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Image
		if (ch === '!') {
			const result = tryImage(scanner);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// Markdown link
		if (ch === '[') {
			const result = tryMarkdownLink(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = ']';
				continue;
			}
		}

		// Angle bracket link or Timestamp
		if (ch === '<') {
			const ts = tryTimestamp(scanner);
			if (ts !== null) {
				nodes.push(ts);
				prev = '';
				continue;
			}

			const link = tryAngleBracketLink(scanner);
			if (link !== null) {
				nodes.push(link);
				prev = '>';
				continue;
			}
		}

		// Inline spoiler
		if (ch === '|') {
			const result = trySpoiler(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Auto link
		if (isUrlStart(ch)) {
			const result = tryAutoLinkUrl(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// Plain run
		if (isPlainChar(ch)) {
			const start = scanner.position();
			while (!scanner.isEnd() && isPlainChar(scanner.char())) {
				scanner.consume();
			}

			const text = scanner.sliceFrom(start);
			nodes.push(plain(text));
			prev = text[text.length - 1] ?? '';
			continue;
		}

		// Fallback to plain text
		nodes.push(plain(ch));
		prev = ch;
		scanner.consume();
	}

	return reducePlainTexts(nodes);
}

function parseInlineContent(scanner: Scanner, options: Options, stopChar: string) {
	const nodes: Inlines[] = [];
	let prev = '';

	while (!scanner.isEnd() && !isNewline(scanner.char())) {
		if (stopChar && scanner.matches(stopChar)) break;
		const ch = scanner.char();

		// Emoticons
		if (options.emoticons) {
			const result = tryEmoticon(scanner, prev);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// KaTeX inline
		if (ch === '$' || (ch === '\\' && scanner.charAt(1) === '(')) {
			const result = tryKatexInline(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Escape sequences
		if (ch === '\\') {
			const next = scanner.charAt(1);
			if (next !== '' && ESCAPABLE.has(next)) {
				nodes.push(plain(next));
				scanner.consume(2);
				prev = next;
				continue;
			}

			nodes.push(plain(ch));
			scanner.consume();
			prev = ch;
			continue;
		}

		// Inline code
		if (ch === '`') {
			const result = tryInlineCode(scanner);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Bold
		if (ch === '*') {
			const result = tryBold(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Strike
		if (ch === '~') {
			const result = tryStrike(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Italic
		if (ch === '_') {
			const result = tryItalic(scanner, options, prev);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Emoji shortcode (:smile:)
		if (ch === ':') {
			const result = tryEmojiShortCode(scanner);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		//  Unicode raw emoji
		if (isEmojiStart(ch)) {
			const result = tryUnicodeEmoji(scanner);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// Color (color:#rgb / rgba / rrggbb / rrggbbaa)
		if (scanner.matches('color:#')) {
			const result = tryColor(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// Phone (+number)
		if (ch === '+') {
			const result = tryPhone(scanner, prev);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// User mention
		if (ch === '@') {
			const mention = tryUserMention(scanner, prev);
			if (mention !== null) {
				nodes.push(mention);
				prev = ch;
				continue;
			}
		}

		// Email (local@domain)
		if (isUrlStart(ch) || ch.charCodeAt(0) > 127) {
			const email = tryEmail(scanner);
			if (email !== null) {
				nodes.push(email);
				prev = '';
				continue;
			}
		}

		// Mention channel
		if (ch === '#') {
			const result = tryChannelMention(scanner, prev);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Image
		if (ch === '!') {
			const result = tryImage(scanner);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// Markdown link
		if (ch === '[') {
			const result = tryMarkdownLink(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = ']';
				continue;
			}
		}

		// Angle bracket link or Timestamp
		if (ch === '<') {
			const ts = tryTimestamp(scanner);
			if (ts !== null) {
				nodes.push(ts);
				prev = '';
				continue;
			}

			const link = tryAngleBracketLink(scanner);
			if (link !== null) {
				nodes.push(link);
				prev = '>';
				continue;
			}
		}

		// Inline spoiler
		if (ch === '|') {
			const result = trySpoiler(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
				continue;
			}
		}

		// Auto link
		if (isUrlStart(ch)) {
			const result = tryAutoLinkUrl(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = '';
				continue;
			}
		}

		// Plain run
		if (isPlainChar(ch)) {
			const start = scanner.position();
			while (!scanner.isEnd() && isPlainChar(scanner.char())) {
				if (stopChar && scanner.matches(stopChar)) break;
				scanner.consume();
			}

			const text = scanner.sliceFrom(start);
			nodes.push(plain(text));
			prev = text[text.length - 1] ?? '';
			continue;
		}

		// Fallback to plain text
		nodes.push(plain(ch));
		prev = ch;
		scanner.consume();
	}

	return nodes;
}

// ------ Inline methods ----------------------------------------------------
function tryLineBreak(scanner: Scanner): LineBreak | null {
	if (!isNewline(scanner.char())) return null;
	consumeEndOfLine(scanner);
	return lineBreak();
}

function tryInlineCode(scanner: Scanner): Inlines | null {
	const start = scanner.position();
	scanner.consume(); // consume opening backtrack(`)

	const contentStart = scanner.position();

	while (!scanner.isEnd() && !isNewline(scanner.char()) && scanner.char() !== '`') {
		scanner.consume();
	}

	if (scanner.isEnd() || isNewline(scanner.char()) || scanner.char() !== '`') {
		scanner.backtrack(start);
		return null;
	}

	const content = scanner.sliceFrom(contentStart);
	if (content.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	scanner.consume();
	return inlineCode(plain(content));
}

function tryBold(scanner: Scanner, options: Options): Inlines | null {
	if (skipBold) return null;
	const start = scanner.position();

	if (scanner.matches('***')) {
		scanner.consume(1);
		return plain('*');
	}

	const isDouble = scanner.matches('**');
	const delimiter = isDouble ? '**' : '*';

	scanner.consume(delimiter.length);
	if (scanner.isEnd() || isNewline(scanner.char())) {
		scanner.backtrack(start);
		return null;
	}

	skipBold = true;
	const content = parseInlineContent(scanner, options, delimiter);
	skipBold = false;

	if (!scanner.matches(delimiter)) {
		scanner.backtrack(start);
		return null;
	}

	if (content.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	const isWhiteSpace = content.every((n) => n.type === 'PLAIN_TEXT' && n.value.trim() === '');
	if (isWhiteSpace) {
		scanner.backtrack(start);
		return null;
	}

	scanner.consume(delimiter.length);
	return bold(reducePlainTexts(content) as Bold['value']);
}

function tryStrike(scanner: Scanner, options: Options): Inlines | null {
	if (skipStrike) return null;
	const start = scanner.position();

	if (scanner.matches('~~~')) {
		scanner.consume(1);
		return plain('~');
	}

	const isDouble = scanner.matches('~~');
	const delimiter = isDouble ? '~~' : '~';

	scanner.consume(delimiter.length);
	if (scanner.isEnd() || isNewline(scanner.char())) {
		scanner.backtrack(start);
		return null;
	}

	skipStrike = true;
	const content = parseInlineContent(scanner, options, delimiter);
	skipStrike = false;

	if (!scanner.matches(delimiter)) {
		scanner.backtrack(start);
		return null;
	}

	if (content.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	const isWhiteSpace = content.every((n) => n.type === 'PLAIN_TEXT' && n.value.trim() === '');
	if (isWhiteSpace) {
		scanner.backtrack(start);
		return null;
	}

	scanner.consume(delimiter.length);
	return strike(reducePlainTexts(content) as Strike['value']);
}

function tryItalic(scanner: Scanner, options: Options, prev: string): Inlines | null {
	if (isAlphaNum(prev)) return null; // Hello_World (prev char is alphaNum(o))

	if (skipItalic) return null;
	const start = scanner.position();

	if (scanner.matches('___')) {
		scanner.consume(1);
		return plain('_');
	}

	const isDouble = scanner.matches('__');
	const delimiter = isDouble ? '__' : '_';

	scanner.consume(delimiter.length);
	if (scanner.isEnd() || isNewline(scanner.char())) {
		scanner.backtrack(start);
		return null;
	}

	skipItalic = true;
	const content = parseInlineContent(scanner, options, delimiter);
	skipItalic = false;

	if (!scanner.matches(delimiter)) {
		scanner.backtrack(start);
		return null;
	}

	if (content.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	const isWhiteSpace = content.every((n) => n.type === 'PLAIN_TEXT' && n.value.trim() === '');
	if (isWhiteSpace) {
		scanner.backtrack(start);
		return null;
	}

	if (isDouble && isAlphaNum(scanner.charAt(delimiter.length))) {
		scanner.backtrack(start);
		return null;
	}

	// "_hello_text" → plain text
	if (!isDouble && isAlpha(scanner.charAt(delimiter.length))) {
		scanner.backtrack(start);
		return null;
	}

	scanner.consume(delimiter.length);
	return italic(reducePlainTexts(content) as Italic['value']);
}

function tryChannelMention(scanner: Scanner, prev: string): Inlines | null {
	if (prev !== '' && !isSpace(prev)) return null;

	const start = scanner.position();
	scanner.consume();

	const nameStart = scanner.position();

	while (!scanner.isEnd() && !isNewline(scanner.char()) && !isSpace(scanner.char())) {
		const c = scanner.char();
		if (!isAlphaNum(c) && !'_-.'.includes(c)) break;
		scanner.consume();
	}

	const name = scanner.sliceFrom(nameStart);
	if (name.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	return mentionChannel(name);
}

function tryUserMention(scanner: Scanner, prev: string): Inlines | null {
	if (isAlphaNum(prev)) return null;

	const start = scanner.position();

	scanner.consume(); // consume '@'
	const nameStart = scanner.position();

	while (!scanner.isEnd() && !isNewline(scanner.char()) && !isSpace(scanner.char())) {
		const ch = scanner.char();
		const code = ch.charCodeAt(0);

		if (isAlphaNum(ch) || '._-:@'.includes(ch) || code > 127) {
			scanner.consume();
		} else {
			break;
		}
	}

	const name = scanner.sliceFrom(nameStart);

	if (name.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	return mentionUser(name);
}

function trySpoiler(scanner: Scanner, options: Options): Inlines | null {
	const start = scanner.position();
	const delimiter = '||';

	// Must start with "||"
	if (!scanner.matches(delimiter)) {
		return null;
	}
	scanner.consume(delimiter.length); // consume opening "||"

	const content = parseInlineContent(scanner, options, delimiter);

	if (!scanner.matches(delimiter)) {
		scanner.backtrack(start);
		return null;
	}
	scanner.consume(delimiter.length); // consume closing "||"

	if (content.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	return spoiler(reducePlainTexts(content) as Spoiler['value']);
}

function tryMarkdownLink(scanner: Scanner, options: Options): Inlines | null {
	const start = scanner.position();

	// Must start with '['
	if (scanner.char() !== '[') {
		return null;
	}
	scanner.consume(); // consume '['

	// Parse title content — stops at ']'
	const titleNodes = parseInlineContent(scanner, options, ']');

	// Must find ']('
	if (!scanner.matches('](')) {
		scanner.backtrack(start);
		return null;
	}
	scanner.consume(2); // consume ']('

	// Parse URL — stops at ')'
	const urlStart = scanner.position();
	let depth = 1;
	while (!scanner.isEnd() && !isNewline(scanner.char())) {
		if (scanner.char() === '(') depth++;
		if (scanner.char() === ')') {
			depth--;
			if (depth === 0) break;
		}
		scanner.consume();
	}

	if (!scanner.matches(')')) {
		scanner.backtrack(start);
		return null;
	}

	let url = scanner.sliceFrom(urlStart);
	scanner.consume(); // consume ')'

	if (url.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	// A phone number in the URL position becomes a tel: link.
	if (url[0] === '+') {
		let digits = '';
		for (const ch of url) {
			if (isDigit(ch)) digits += ch;
		}
		if (digits.length >= 5) {
			url = 'tel:' + digits;
		}
	}

	const title = reducePlainTexts(titleNodes);

	// Empty title → link with no label (defaults to src)
	if (title.length === 0) {
		return link(url);
	}

	return link(url, title as any);
}

function tryAngleBracketLink(scanner: Scanner): Inlines | null {
	const start = scanner.position();

	// Must start with '<'
	if (scanner.char() !== '<') {
		return null;
	}
	scanner.consume(); // consume '<'

	// Parse URL — stops at '|' or '>'
	const urlStart = scanner.position();
	while (!scanner.isEnd() && !isNewline(scanner.char())) {
		if (scanner.char() === '|' || scanner.char() === '>') break;
		scanner.consume();
	}

	const url = scanner.sliceFrom(urlStart);

	if (url.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	// Must have '|' separator for angle bracket link
	if (scanner.char() !== '|') {
		scanner.backtrack(start);
		return null;
	}
	scanner.consume(); // consume '|'

	// Parse title — stops at '>'
	const titleStart = scanner.position();
	while (!scanner.isEnd() && !isNewline(scanner.char()) && scanner.char() !== '>') {
		scanner.consume();
	}

	if (scanner.char() !== '>') {
		scanner.backtrack(start);
		return null;
	}

	const title = scanner.sliceFrom(titleStart);
	scanner.consume(); // consume '>'

	return link(url, [plain(title)]);
}

function tryUnorderedList(scanner: Scanner, options: Options): UnorderedList | null {
	const start = scanner.position();

	const marker = scanner.char();
	if (marker !== '-' && marker !== '*') {
		return null;
	}

	if (!isSpace(scanner.charAt(1))) {
		return null;
	}

	const items: ListItem[] = [];

	while (!scanner.isEnd()) {
		const ch = scanner.char();
		const itemStart = scanner.position();

		// Stop if marker changes or line is no longer a list item
		if (ch !== marker) break;
		if (!isSpace(scanner.charAt(1))) break;

		scanner.consume(); // consume marker

		while (isSpace(scanner.char())) {
			scanner.consume();
		}

		const inlines = parseInline(scanner, options);

		// '*' is also the bold marker, so "* " or text ending in '*' is bold, not a list
		if (marker === '*') {
			const last = inlines[inlines.length - 1];
			const isEmpty = inlines.length === 0;
			const endsWithStar = last?.type === 'PLAIN_TEXT' && last.value.endsWith('*');

			if (isEmpty || endsWithStar) {
				scanner.backtrack(itemStart);
				break;
			}
		}

		items.push(listItem(inlines));

		consumeEndOfLine(scanner);
	}

	if (items.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	return unorderedList(items);
}

function tryOrderedList(scanner: Scanner, options: Options): OrderedList | null {
	const start = scanner.position();

	if (!isDigit(scanner.char())) {
		return null;
	}

	const items: ListItem[] = [];

	while (!scanner.isEnd()) {
		if (!isDigit(scanner.char())) break;

		// Collect leading digits
		const numStart = scanner.position();
		while (!scanner.isEnd() && isDigit(scanner.char())) {
			scanner.consume();
		}
		const numStr = scanner.sliceFrom(numStart);

		// Must be followed by '.' then a space
		if (scanner.char() !== '.') {
			scanner.backtrack(start);
			return null;
		}
		scanner.consume(); // consume '.'

		if (!isSpace(scanner.char())) {
			scanner.backtrack(start);
			return null;
		}

		while (isSpace(scanner.char())) {
			scanner.consume();
		}

		const inlines = parseInline(scanner, options);
		items.push(listItem(inlines, parseInt(numStr)));

		consumeEndOfLine(scanner);
	}

	if (items.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	return orderedList(items);
}

function tryKatexInline(scanner: Scanner, options: Options): Inlines | null {
	const start = scanner.position();

	let openDelim: string;
	let closeDelim: string;

	if (options.katex?.dollarSyntax && scanner.matches('$') && !scanner.matches('$$')) {
		openDelim = '$';
		closeDelim = '$';
	} else if (options.katex?.parenthesisSyntax && scanner.matches('\\(')) {
		openDelim = '\\(';
		closeDelim = '\\)';
	} else {
		return null;
	}

	scanner.consume(openDelim.length);

	const contentStart = scanner.position();

	// Inline katex: no newlines allowed inside
	while (!scanner.isEnd() && !isNewline(scanner.char())) {
		if (scanner.matches(closeDelim)) break;
		scanner.consume();
	}

	if (!scanner.matches(closeDelim)) {
		scanner.backtrack(start);
		return null;
	}

	const content = scanner.sliceFrom(contentStart);
	scanner.consume(closeDelim.length);

	return inlineKatex(content);
}

function tryEmojiShortCode(scanner: Scanner): Inlines | null {
	const start = scanner.position();
	scanner.consume(); // consume opening ':'

	const nameStart = scanner.position();
	while (!scanner.isEnd() && isShortCodeChar(scanner.char())) {
		scanner.consume();
	}

	const name = scanner.sliceFrom(nameStart);
	if (name.length === 0 || scanner.char() !== ':') {
		scanner.backtrack(start);
		return null;
	}

	scanner.consume(); // consume closing ':'
	return emoji(name);
}

export function tryEmoticon(scanner: Scanner, prev: string): Inlines | null {
	if (prev !== '' && !isSpace(prev)) return null;

	const start = scanner.position();

	const node = matchEmoticon(scanner);
	if (node === null) return null;

	const after = scanner.char();
	if (after === '' || isSpace(after) || isNewline(after) || after === '*') {
		return node;
	}

	scanner.backtrack(start);
	return null;
}

function tryUnicodeEmoji(scanner: Scanner): Inlines | null {
	const ch = scanner.char();
	if (ch === '' || ch.charCodeAt(0) <= 127) return null; // fast-reject ASCII

	let window = '';
	for (let i = 0; i < 32; i++) {
		const c = scanner.charAt(i);
		if (c === '') break;
		window += c;
	}

	const m = UNICODE_EMOJI.exec(window);
	if (m === null) return null;

	scanner.consume(m[0].length);
	return emojiUnicode(m[0]);
}

function tryAutoLinkUrl(scanner: Scanner, options: Options): Inlines | null {
	// A bare URL or domain always begins with a letter or digit.
	const ch = scanner.char();
	if (!isAlpha(ch) && !isDigit(ch)) return null;

	const start = scanner.position();

	// Collect the full URL token — everything until whitespace or end
	const tokenStart = scanner.position();
	while (!scanner.isEnd() && !isNewline(scanner.char()) && !isSpace(scanner.char())) {
		scanner.consume();
	}

	const token = scanner.sliceFrom(tokenStart);
	if (token.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	// Must contain '://' or '.' to be worth trying
	if (!token.includes('://') && !token.includes('.')) {
		scanner.backtrack(start);
		return null;
	}

	// Strip trailing punctuation that shouldn't be part of URL
	// e.g. "rocket.chat." → "rocket.chat"
	let url = token;
	while (url.length > 0 && '.,!?;:)'.includes(url[url.length - 1])) {
		url = url.slice(0, -1);
	}

	if (url.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	// Restore scanner to end of actual url (not trailing punct)
	scanner.backtrack(tokenStart);
	scanner.consume(url.length);

	// Use autoLink from utils which validates via tldts
	const result = autoLink(url, options.customDomains);

	// autoLink returns plain() if domain is invalid
	if (result.type === 'PLAIN_TEXT') {
		scanner.backtrack(start);
		return null;
	}

	return result;
}

function tryEmail(scanner: Scanner): Inlines | null {
	const start = scanner.position();
	const delimiter = 'mailto:';

	// Optional "mailto:" prefix — consumed, but NOT part of the captured address
	if (scanner.matches(delimiter)) {
		scanner.consume(delimiter.length);
	}

	// Local part: alphanumeric / unicode, plus  . _ + - '
	const localStart = scanner.position();
	while (!scanner.isEnd() && isEmailLocalChar(scanner.char())) {
		scanner.consume();
	}
	const local = scanner.sliceFrom(localStart);

	// Must have a non-empty local part immediately followed by '@'
	if (local.length === 0 || scanner.char() !== '@') {
		scanner.backtrack(start);
		return null;
	}
	scanner.consume(); // consume '@'

	// Domain: alphanumeric / unicode, plus  . -
	const domainStart = scanner.position();
	while (!scanner.isEnd() && isEmailDomainChar(scanner.char())) {
		scanner.consume();
	}

	// Trim trailing '.' / '-' back out of the domain ("joe.com." → "joe.com")
	while (scanner.position() > domainStart && (scanner.charAt(-1) === '.' || scanner.charAt(-1) === '-')) {
		scanner.consume(-1);
	}

	const domain = scanner.sliceFrom(domainStart);

	// Domain must contain a dot that is not at the very start or end
	const dotIdx = domain.indexOf('.');
	if (dotIdx <= 0 || dotIdx === domain.length - 1) {
		scanner.backtrack(start);
		return null;
	}

	// autoEmail validates the TLD via tldts (same logic the grammar uses):
	return autoEmail(local + '@' + domain);
}

function tryColor(scanner: Scanner, options: Options): Inlines | null {
	if (!options.colors) return null;
	const delimiter = 'color:#';

	if (!scanner.matches(delimiter)) return null;

	const startPos = scanner.position();
	scanner.consume(delimiter.length); // consume "color:#"

	const hexStart = scanner.position();
	while (!scanner.isEnd() && isHexDigit(scanner.char())) {
		scanner.consume();
	}
	const hex = scanner.sliceFrom(hexStart);

	let rgba: [number, number, number, number] | null = null;

	if (hex.length === 6 || hex.length === 8) {
		// byte pairs: c7 -> 0xc7
		const b: number[] = [];
		for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));
		rgba = [b[0], b[1], b[2], b[3] ?? 255];
	} else if (hex.length === 3 || hex.length === 4) {
		// single nibbles doubled: c -> cc -> 0xcc
		const n: number[] = [];
		for (let i = 0; i < hex.length; i++) n.push(parseInt(hex[i] + hex[i], 16));
		rgba = [n[0], n[1], n[2], n[3] ?? 255];
	}

	// Invalid digit count, or color is immediately followed by text -> not a color.
	if (rgba === null || isAnyText(scanner.char())) {
		scanner.backtrack(startPos);
		return null;
	}

	return color(rgba[0], rgba[1], rgba[2], rgba[3]);
}

function tryPhone(scanner: Scanner, prev: string): Inlines | null {
	// A phone number starts with '+' at the start of text or right after a space.
	if (prev !== '' && !isSpace(prev)) return null;

	const start = scanner.position();
	scanner.consume(); // consume '+'

	while (!scanner.isEnd() && isPhoneChar(scanner.char())) {
		scanner.consume();
	}

	const raw = scanner.sliceFrom(start); // includes the leading '+'

	// The tel: target keeps only the digits.
	let digits = '';
	for (const ch of raw) {
		if (isDigit(ch)) digits += ch;
	}

	// Needs at least 5 digits to count as a real phone number.
	if (digits.length < 5) {
		scanner.backtrack(start);
		return null;
	}

	// return link('tel:' + digits, [plain(raw)]);
	return phoneChecker(raw, digits);
}

function tryTimestamp(scanner: Scanner): Inlines | null {
	const start = scanner.position();
	if (!scanner.matches('<t:')) return null;
	scanner.consume(3); // consume '<t:'

	// Grab everything up to the closing '>'
	const contentStart = scanner.position();
	while (!scanner.isEnd() && !isNewline(scanner.char()) && scanner.char() !== '>') {
		scanner.consume();
	}
	if (scanner.char() !== '>') {
		scanner.backtrack(start);
		return null;
	}
	const content = scanner.sliceFrom(contentStart);

	// Optional ":format" — a single valid format letter right before '>'
	let format: Timestamp['value']['format'] | undefined;
	let payload = content;
	if (content.length >= 2 && content[content.length - 2] === ':' && 'tTdDfFR'.includes(content[content.length - 1])) {
		format = content[content.length - 1] as Timestamp['value']['format'];
		payload = content.slice(0, content.length - 2);
	}

	// Convert the payload to a unix-seconds string (same order as the grammar).
	let date: string | null = null;
	let m: RegExpExecArray | null;
	if (TS_UNIX.test(payload)) {
		date = payload;
	} else if ((m = TS_ISO_MS.exec(payload))) {
		date = timestampFromIsoTime({
			year: m[1],
			month: m[2],
			day: m[3],
			hours: m[4],
			minutes: m[5],
			seconds: m[6],
			milliseconds: m[7],
			timezone: m[8],
		});
	} else if ((m = TS_ISO.exec(payload))) {
		date = timestampFromIsoTime({ year: m[1], month: m[2], day: m[3], hours: m[4], minutes: m[5], seconds: m[6], timezone: m[7] });
	} else if ((m = TS_HMS.exec(payload))) {
		date = timestampFromHours(m[1], m[2], m[3], m[4]);
	} else if ((m = TS_HM.exec(payload))) {
		date = timestampFromHours(m[1], m[2], undefined, m[3]);
	}

	if (date === null) {
		scanner.backtrack(start);
		return null;
	}

	scanner.consume(); // consume '>'
	return timestamp(date, format, [start, scanner.position()]);
}

function tryImage(scanner: Scanner): Inlines | null {
	const start = scanner.position();

	if (!scanner.matches('![')) return null;
	scanner.consume(2); // consume '!['

	// Alt text — literal, up to ']'
	const titleStart = scanner.position();
	while (!scanner.isEnd() && !isNewline(scanner.char()) && scanner.char() !== ']') {
		scanner.consume();
	}
	const title = scanner.sliceFrom(titleStart);

	if (!scanner.matches('](')) {
		scanner.backtrack(start);
		return null;
	}
	scanner.consume(2); // consume ']('

	// URL — up to the matching ')'
	const urlStart = scanner.position();
	let depth = 1;
	while (!scanner.isEnd() && !isNewline(scanner.char())) {
		if (scanner.char() === '(') depth++;
		if (scanner.char() === ')') {
			depth--;
			if (depth === 0) break;
		}
		scanner.consume();
	}

	if (scanner.char() !== ')') {
		scanner.backtrack(start);
		return null;
	}
	const href = scanner.sliceFrom(urlStart);
	scanner.consume(); // consume ')'

	if (href.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	return title.length > 0 ? image(href, plain(title)) : image(href);
}

// ------ Block methods ----------------------------------------------------

function tryHeading(scanner: Scanner, options: Options): Heading | null {
	const start = scanner.position();

	let level = 0; // Count # characters (max 4)

	while (level < 4 && scanner.char() === '#') {
		scanner.consume();
		level++;
	}

	if (level === 0) {
		scanner.backtrack(start);
		return null;
	}

	// Must be followed by at least one space or tab
	if (!isSpace(scanner.char())) {
		scanner.backtrack(start);
		return null;
	}

	// Skip all leading spaces/tabs
	while (isSpace(scanner.char())) {
		scanner.consume();
	}

	if (scanner.isEnd() || isNewline(scanner.char())) {
		scanner.backtrack(start);
		return null;
	}

	const inlines = parseInline(scanner, options);
	consumeEndOfLine(scanner);
	return heading(inlines, level as 1 | 2 | 3 | 4);
}

function tryCodeFence(scanner: Scanner): Code | null {
	const start = scanner.position();
	const fence = '```';

	if (!scanner.matches(fence)) {
		return null;
	}
	scanner.consume(fence.length);

	// Optional language tag
	const langStart = scanner.position();
	while (!scanner.isEnd() && !isNewline(scanner.char())) {
		scanner.consume();
	}
	const language = scanner.sliceFrom(langStart).trim();

	// Must be followed by newline
	if (scanner.isEnd()) {
		scanner.backtrack(start);
		return null;
	}

	consumeEndOfLine(scanner); // Consume newline after opening ```

	const lines: CodeLine[] = [];
	let closed = false;

	while (!scanner.isEnd()) {
		if (scanner.matches(fence)) {
			scanner.consume(fence.length);
			while (!scanner.isEnd() && !isNewline(scanner.char())) scanner.consume();
			closed = true;
			break;
		}

		const lineStart = scanner.position();
		while (!scanner.isEnd() && !isNewline(scanner.char())) {
			scanner.consume();
		}

		const text = scanner.sliceFrom(lineStart);
		lines.push(codeLine(plain(text)));

		consumeEndOfLine(scanner);
	}

	if (!closed) {
		scanner.backtrack(start);
		return null;
	}

	return code(lines, language || undefined);
}

function tryBlockquote(scanner: Scanner, options: Options): Quote | null {
	const start = scanner.position();

	if (scanner.char() !== '>') {
		return null;
	}

	const paragraphs: Paragraph[] = [];
	let hasContent = false;

	while (!scanner.isEnd() && scanner.char() === '>') {
		scanner.consume(); // consume '>'

		// Optional space/tab after '>'
		if (isSpace(scanner.char())) {
			scanner.consume();
		}

		if (scanner.isEnd() || isNewline(scanner.char())) {
			paragraphs.push(paragraph([plain('')])); // empty quoted line
		} else {
			const inlines = parseInline(scanner, options);
			paragraphs.push(paragraph(inlines));
			hasContent = true;
		}

		consumeEndOfLine(scanner); // Consume newline
	}

	// A bare '>' with no content isn't a quote — fall back to plain text.
	if (paragraphs.length === 0 || !hasContent) {
		scanner.backtrack(start);
		return null;
	}

	return quote(paragraphs);
}

function tryBlockSpoiler(scanner: Scanner, options: Options): SpoilerBlock | null {
	const start = scanner.position();
	const spoiler = '||';

	// Opening line must be exactly "||"
	if (!scanner.matches(spoiler)) {
		return null;
	}
	scanner.consume(spoiler.length);

	if (scanner.isEnd() || !isNewline(scanner.char())) {
		scanner.backtrack(start); // "||" not alone on its line, or at EOF
		return null;
	}
	consumeEndOfLine(scanner);

	const paragraphs: Paragraph[] = [];
	let closed = false;

	while (!scanner.isEnd()) {
		if (scanner.matches(spoiler)) {
			const closingPos = scanner.position();
			scanner.consume(spoiler.length);

			if (scanner.isEnd() || isNewline(scanner.char())) {
				closed = true;
				break;
			}
			scanner.backtrack(closingPos); // not a closing line → treat as content
		}

		const inlines = parseInline(scanner, options);
		paragraphs.push(paragraph(inlines));
		consumeEndOfLine(scanner);
	}

	if (!closed || paragraphs.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	return spoilerBlock(paragraphs);
}

function tryKatexBlock(scanner: Scanner, options: Options): KaTeX | null {
	const start = scanner.position();

	let openDelim: string;
	let closeDelim: string;

	if (options.katex?.dollarSyntax && scanner.matches('$$')) {
		openDelim = '$$';
		closeDelim = '$$';
	} else if (options.katex?.parenthesisSyntax && scanner.matches('\\[')) {
		openDelim = '\\[';
		closeDelim = '\\]';
	} else {
		return null;
	}

	scanner.consume(openDelim.length);

	// Collect content until closing delimiter
	const contentStart = scanner.position();
	while (!scanner.isEnd()) {
		if (scanner.matches(closeDelim)) break;
		scanner.consume();
	}

	if (!scanner.matches(closeDelim)) {
		scanner.backtrack(start);
		return null;
	}

	const content = scanner.sliceFrom(contentStart);
	scanner.consume(closeDelim.length);

	return katex(content);
}

function tryBigEmoji(input: string, options: Options): [BigEmoji] | null {
	const scanner = new Scanner(input);

	const skipWhitespace = (): void => {
		while (!scanner.isEnd() && (isSpace(scanner.char()) || isNewline(scanner.char()))) {
			scanner.consume();
		}
	};

	skipWhitespace();

	const emojis: Inlines[] = [];
	while (emojis.length < 3 && !scanner.isEnd()) {
		let node: Inlines | null = null;

		if (scanner.char() === ':') {
			node = tryEmojiShortCode(scanner);
		}
		if (node === null) {
			node = tryUnicodeEmoji(scanner);
		}
		if (node === null && options.emoticons) {
			node = matchEmoticon(scanner);
		}
		if (node === null) return null;

		emojis.push(node);
		skipWhitespace();
	}

	// Whole input must be nothing but 1-3 emojis + whitespace
	if (emojis.length === 0 || !scanner.isEnd()) return null;
	return [bigEmoji(emojis as BigEmoji['value'])];
}
