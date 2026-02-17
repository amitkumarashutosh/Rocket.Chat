import { CstParser, EOF } from 'chevrotain';
import {
	allTokens,
	HeadingHash,
	NewLine,
	Space,
	Text,
	Hash,
	GreaterThan,
	Asterisk,
	Underscore,
	CodeFence,
	Backtick,
	Color,
} from './tokens';

export class MarkdownParser extends CstParser {
	// Rule declarations
	public document!: any;
	public codeBlock!: any;
	public codeLine!: any;
	public headingLine!: any;
	public blockquote!: any;
	public blockquoteLine!: any;
	public paragraphLine!: any;
	public inline!: any;
	public bold!: any;
	public boldContent!: any;
	public italic!: any;
	public italicContent!: any;
	public color!: any;

	constructor() {
		super(allTokens);

		const $ = this;

		// ========================================
		// DOCUMENT STRUCTURE
		// ========================================

		$.RULE('document', () => {
			$.MANY(() => {
				$.OR([
					{
						GATE: () => $.LA(1).tokenType === CodeFence,
						ALT: () => $.SUBRULE($.codeBlock),
					},
					{
						GATE: () => $.LA(1).tokenType === HeadingHash,
						ALT: () => $.SUBRULE($.headingLine),
					},
					{
						GATE: () => $.LA(1).tokenType === GreaterThan,
						ALT: () => $.SUBRULE($.blockquote),
					},
					{
						ALT: () => $.SUBRULE($.paragraphLine),
					},
				]);
			});

			$.CONSUME(EOF);
		});

		// ========================================
		// CODE BLOCKS
		// ========================================

		$.RULE('codeBlock', () => {
			$.CONSUME(CodeFence); // Opening ```
			$.OPTION(() => $.CONSUME(NewLine));

			// Consume lines until we hit closing fence or EOF
			$.MANY({
				GATE: () => {
					const next = $.LA(1);
					return next.tokenType !== CodeFence && next.tokenType !== EOF;
				},
				DEF: () => {
					$.SUBRULE($.codeLine);
				},
			});

			$.OPTION2(() => $.CONSUME2(CodeFence)); // Closing ```
		});

		$.RULE('codeLine', () => {
			$.OR([
				{
					// Line with content
					ALT: () => {
						$.AT_LEAST_ONE(() => {
							$.OR2([
								{ ALT: () => $.CONSUME(Text) },
								{ ALT: () => $.CONSUME(Space) },
								{ ALT: () => $.CONSUME(Hash) },
								{ ALT: () => $.CONSUME(Asterisk) },
								{ ALT: () => $.CONSUME(Underscore) },
								{ ALT: () => $.CONSUME(GreaterThan) },
								{ ALT: () => $.CONSUME(Backtick) },
							]);
						});
						$.OPTION(() => $.CONSUME(NewLine));
					},
				},
				{
					// Empty line (just newline)
					ALT: () => {
						$.CONSUME2(NewLine);
					},
				},
			]);
		});

		// ========================================
		// HEADINGS
		// ========================================

		$.RULE('headingLine', () => {
			$.CONSUME(HeadingHash); // # or ## or ### or ####
			$.MANY(() => {
				$.SUBRULE($.inline);
			});
			$.OPTION(() => $.CONSUME(NewLine));
		});

		// ========================================
		// BLOCKQUOTES
		// ========================================

		$.RULE('blockquote', () => {
			$.AT_LEAST_ONE(() => {
				$.SUBRULE($.blockquoteLine);
			});
		});

		$.RULE('blockquoteLine', () => {
			$.CONSUME(GreaterThan); // >
			$.OPTION(() => $.CONSUME(Space));
			$.MANY(() => {
				$.SUBRULE($.inline);
			});
			$.OPTION2(() => $.CONSUME(NewLine));
		});

		// ========================================
		// PARAGRAPHS
		// ========================================

		$.RULE('paragraphLine', () => {
			$.AT_LEAST_ONE(() => {
				$.SUBRULE($.inline);
			});
			$.OPTION(() => $.CONSUME(NewLine));
		});

		// ========================================
		// INLINE ELEMENTS
		// ========================================

		$.RULE('inline', () => {
			$.OR([
				{ ALT: () => $.SUBRULE($.color) },
				{ ALT: () => $.SUBRULE($.bold) },
				{ ALT: () => $.SUBRULE($.italic) },
				{ ALT: () => $.CONSUME(Text) },
				{ ALT: () => $.CONSUME(Hash) },
				{ ALT: () => $.CONSUME(GreaterThan) },
				{ ALT: () => $.CONSUME(Space) },
				{ ALT: () => $.CONSUME(Asterisk) },
				{ ALT: () => $.CONSUME(Underscore) },
				{ ALT: () => $.CONSUME(Backtick) },
			]);
		});

		// ========================================
		// BOLD FORMATTING
		// ========================================

		$.RULE('bold', () => {
			$.CONSUME(Asterisk); // Opening *
			$.AT_LEAST_ONE(() => {
				$.SUBRULE($.boldContent);
			});
			$.OPTION(() => $.CONSUME2(Asterisk)); // Closing * (optional for incomplete)
		});

		$.RULE('boldContent', () => {
			$.OR([
				{ ALT: () => $.SUBRULE($.italic) }, // Nested italic
				{ ALT: () => $.CONSUME(Text) },
				{ ALT: () => $.CONSUME(Hash) },
				{ ALT: () => $.CONSUME(GreaterThan) },
				{ ALT: () => $.CONSUME(Space) },
				{ ALT: () => $.CONSUME(Underscore) },
				{ ALT: () => $.CONSUME(Backtick) },
			]);
		});

		// ========================================
		// ITALIC FORMATTING
		// ========================================

		$.RULE('italic', () => {
			$.CONSUME(Underscore); // Opening _
			$.AT_LEAST_ONE(() => {
				$.SUBRULE($.italicContent);
			});
			$.OPTION(() => $.CONSUME2(Underscore)); // Closing _ (optional for incomplete)
		});

		$.RULE('italicContent', () => {
			$.OR([
				{ ALT: () => $.SUBRULE($.bold) }, // Nested bold
				{ ALT: () => $.CONSUME(Text) },
				{ ALT: () => $.CONSUME(Hash) },
				{ ALT: () => $.CONSUME(GreaterThan) },
				{ ALT: () => $.CONSUME(Space) },
				{ ALT: () => $.CONSUME(Asterisk) },
				{ ALT: () => $.CONSUME(Backtick) },
			]);
		});

		// ========================================
		// COLOR
		// ========================================

		$.RULE('color', () => {
			$.CONSUME(Color);
		});

		// Perform grammar analysis
		this.performSelfAnalysis();
	}
}
