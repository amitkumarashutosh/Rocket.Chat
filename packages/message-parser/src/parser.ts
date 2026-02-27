import type { IToken } from 'chevrotain';

import { MessageLexer, Escape, LiteralBackslash, DoubleNewLine, NewLine, Plain as PlainToken, SpecialChar } from './lexer';
import { paragraph, plain, lineBreak, reducePlainTexts } from './utils';
import type { Root, Inlines } from './definitions';
import type { Options } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// TokenStream
// ─────────────────────────────────────────────────────────────────────────────
// A simple cursor over the Chevrotain token array.
// This replaces Chevrotain's parser classes entirely.
// All parser logic is hand-written using these primitives.
// ─────────────────────────────────────────────────────────────────────────────

class TokenStream {
	private tokens: IToken[];
	private pos: number = 0;

	constructor(tokens: IToken[]) {
		this.tokens = tokens;
	}

	// Look at current token WITHOUT consuming it
	peek(): IToken | undefined {
		return this.tokens[this.pos];
	}

	// Look ahead by offset WITHOUT consuming
	peekAt(offset: number): IToken | undefined {
		return this.tokens[this.pos + offset];
	}

	// Consume and return current token, advancing cursor
	consume(): IToken {
		return this.tokens[this.pos++];
	}

	// Check if current token matches a given TokenType by name
	check(tokenType: { name: string }): boolean {
		const token = this.peek();
		return token !== undefined && token.tokenType.name === tokenType.name;
	}

	// Check token at specific offset matches a TokenType
	checkAt(offset: number, tokenType: { name: string }): boolean {
		const token = this.peekAt(offset);
		return token !== undefined && token.tokenType.name === tokenType.name;
	}

	// Consume only if matches. Returns token or undefined.
	match(tokenType: { name: string }): IToken | undefined {
		if (this.check(tokenType)) {
			return this.consume();
		}
		return undefined;
	}

	// Returns true when all tokens consumed
	isAtEnd(): boolean {
		return this.pos >= this.tokens.length;
	}

	// Returns current cursor position (for backtracking)
	getPos(): number {
		return this.pos;
	}

	// Restore cursor to previous position (for backtracking)
	setPos(pos: number): void {
		this.pos = pos;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

class Parser {
	private stream: TokenStream;
	private options: Options;

	constructor(stream: TokenStream, options: Options = {}) {
		this.stream = stream;
		this.options = options;
	}

	// ── Entry Point ────────────────────────────────────────────────────────────
	// Parses the entire message into an array of block-level nodes.
	// Blocks are separated by DoubleNewLine tokens which become LINE_BREAK nodes.
	// Trailing newlines are ignored.
	parseMessage(): Root {
		const blocks: any[] = [];

		while (!this.stream.isAtEnd()) {
			// Collect a run of newlines (both DoubleNewLine and NewLine tokens)
			// Rules:
			//   N newlines between content = (N-1) LINE_BREAK nodes
			//   e.g. \n\n = 1 lineBreak, \n\n\n = 2 lineBreaks, \n\n\n\n = 3 lineBreaks
			//   Trailing newlines (nothing after) = ignored
			//   Leading newlines (nothing before) = ignored
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
				// Count total newline characters in this run
				let newlineCount = 0;
				while (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
					const tok = this.stream.consume();
					newlineCount += tok.image.length; // \n\n = 2, \n = 1
				}

				// Only emit lineBreaks if there is content both before AND after
				const hasContentBefore = blocks.length > 0;
				const hasContentAfter = !this.stream.isAtEnd();
				if (hasContentBefore && hasContentAfter) {
					// N newline chars = N-1 LINE_BREAK nodes
					for (let i = 0; i < newlineCount - 1; i++) {
						blocks.push(lineBreak());
					}
				}
				continue;
			}

			// Everything else → paragraph
			const para = this.parseParagraph();
			// Only push non-empty paragraphs
			if (para.value.length > 0) {
				blocks.push(para);
			}
		}

		return blocks;
	}

	// ── Paragraph ──────────────────────────────────────────────────────────────
	// Collects inline nodes until:
	//   - End of input
	//   - A DoubleNewLine (block boundary)
	//   - A single NewLine (paragraph terminator — consumed but not included)
	// reducePlainTexts() merges consecutive PLAIN_TEXT nodes.
	private parseParagraph() {
		const inlines: Inlines[] = [];

		while (!this.stream.isAtEnd()) {
			// Stop at ANY newline — let parseMessage handle newline accounting
			if (this.stream.check(DoubleNewLine) || this.stream.check(NewLine)) {
				break;
			}

			const node = this.parseInline();
			if (node) {
				inlines.push(node);
			}
		}

		return paragraph(reducePlainTexts(inlines));
	}

	// ── Inline Dispatcher ──────────────────────────────────────────────────────
	// Central dispatch for all inline-level rules.
	// Rules checked in priority order — more specific rules first.
	//
	// PHASES WILL ADD TO THIS METHOD:
	// Phase 3 → bold, italic, strike
	// Phase 4 → inlineCode
	// Phase 5 → links, images
	// Phase 6 → mentions, emoji
	private parseInline(): Inlines | null {
		// ── Escape: \\* \\_ etc → plain('*') plain('_') etc
		if (this.stream.check(Escape)) {
			return this.parseEscape();
		}

		// ── Everything else → plain text
		// Includes: Plain, LiteralBackslash, SpecialChar
		// SpecialChar tokens (*_~`#) that aren't claimed by a formatting rule
		// (e.g. unfinished *bold_ ) fall through here and become plain text.
		return this.parsePlain();
	}

	// ── Escape Rule ────────────────────────────────────────────────────────────
	// Token image is e.g. "\\*" — strip backslash, return second char as plain.
	private parseEscape(): Inlines {
		const token = this.stream.consume();
		return plain(token.image[1]); // "\\*"[1] === "*"
	}

	// ── Plain Text Rule ────────────────────────────────────────────────────────
	// Consumes any single token and returns its raw text as PLAIN_TEXT.
	// reducePlainTexts() merges consecutive plain nodes later.
	private parsePlain(): Inlines {
		const token = this.stream.consume();
		return plain(token.image);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export const parse = (input: string, options?: Options): Root => {
	// Step 1: Lex — Chevrotain turns raw string into token array
	const { tokens, errors } = MessageLexer.tokenize(input);

	if (errors.length > 0) {
		throw new Error(`Lexer error: ${errors[0].message}`);
	}

	// Step 2: Parse — hand-written recursive descent builds the AST
	const stream = new TokenStream(tokens);
	const parser = new Parser(stream, options);
	return parser.parseMessage();
};
