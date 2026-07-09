import { isAlpha, isAlphaNum, isNewline, isPlainChar, isSpace } from './chars';
import {
	Bold,
	Code,
	CodeLine,
	Heading,
	Inlines,
	Italic,
	LineBreak,
	Options,
	Paragraph,
	Quote,
	Root,
	Spoiler,
	SpoilerBlock,
	Strike,
} from './index';
import { Scanner } from './scanner';
import {
	bold,
	code,
	codeLine,
	heading,
	inlineCode,
	italic,
	lineBreak,
	mentionChannel,
	mentionUser,
	paragraph,
	plain,
	quote,
	reducePlainTexts,
	spoiler,
	spoilerBlock,
	strike,
} from './utils';

// ----- Constants ------------------------------------------------------------
const ESCAPABLE = new Set(['*', '_', '~', '#', '.', '`']);

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

// ------ Entry Point ---------------------------------------------------------
export function parse(input: string, options: Options = {}) {
	const root: Root = [];
	const scanner = new Scanner(input);

	while (!scanner.isEnd()) {
		const lineBreakNode: LineBreak | null = tryLineBreak(scanner);
		if (lineBreakNode !== null) {
			root.push(lineBreakNode);
			continue;
		}

		const codeFenceNode: Code | null = tryCodeFence(scanner);
		if (codeFenceNode !== null) {
			root.push(codeFenceNode);
			continue;
		}

		const blockquoteNode: Quote | null = tryBlockquote(scanner, options);
		if (blockquoteNode !== null) {
			root.push(blockquoteNode);
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
				prev = '_';
				continue;
			}
		}

		// User mention
		if (ch === '@') {
			const result = tryUserMention(scanner, prev);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
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

		// Inline spoiler
		if (ch === '|') {
			const result = trySpoiler(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = '|';
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
				prev = '_';
				continue;
			}
		}

		// User mention
		if (ch === '@') {
			const result = tryUserMention(scanner, prev);
			if (result !== null) {
				nodes.push(result);
				prev = ch;
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

		// Inline spoiler
		if (ch === '|') {
			const result = trySpoiler(scanner, options);
			if (result !== null) {
				nodes.push(result);
				prev = '|';
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
		}

		consumeEndOfLine(scanner); // Consume newline
	}

	if (paragraphs.length === 0) {
		scanner.backtrack(start);
		return null;
	}

	return quote(paragraphs);
}
