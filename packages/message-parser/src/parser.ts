import { isNewline, isPlainChar } from './chars';
import { Inlines, LineBreak, Options, Root } from './index';
import { Scanner } from './scanner';
import { inlineCode, lineBreak, paragraph, plain, reducePlainTexts } from './utils';

// ----- Constants ------------------------------------------------------------
const ESCAPABLE = new Set(['*', '_', '~', '#', '.', '`']);

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

	while (!scanner.isEnd() && !isNewline(scanner.char())) {
		const ch = scanner.char();

		// Escape sequences
		if (ch === '\\') {
			const next = scanner.charAt(1);
			if (next !== '' && ESCAPABLE.has(next)) {
				nodes.push(plain(next));
				scanner.consume(2);
				continue;
			}

			nodes.push(plain(ch));
			scanner.consume();
			continue;
		}

		// Inline code
		if (ch === '`') {
			const result = tryInlineCode(scanner);
			if (result !== null) {
				nodes.push(result);
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
			continue;
		}

		// Fallback to plain text
		nodes.push(plain(ch));
		scanner.consume();
	}

	return reducePlainTexts(nodes);
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
