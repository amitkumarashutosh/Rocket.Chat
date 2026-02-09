import { CstParser, CstNode } from 'chevrotain';
import { Text, Newline, Star, Backtick, GreaterThan } from './tokens';

export class MessageParser extends CstParser {
	public document!: () => CstNode;
	public paragraph!: () => CstNode;
	public inline!: () => CstNode;
	public bold!: () => CstNode;
	public inlineCode!: () => CstNode;
	public quote!: () => CstNode;

	constructor() {
		super(
			{
				Text,
				Newline,
				Star,
				Backtick,
				GreaterThan,
			},
			{
				recoveryEnabled: true,
			},
		);

		const $ = this;

		// document := (quote | paragraph)*
		$.RULE('document', () => {
			$.MANY(() => {
				$.OR([{ ALT: () => $.SUBRULE($.quote) }, { ALT: () => $.SUBRULE($.paragraph) }]);
			});
		});

		// quote := '>' paragraph
		$.RULE('quote', () => {
			$.CONSUME(GreaterThan);
			$.SUBRULE($.paragraph);
		});

		// paragraph := inline* Newline?
		$.RULE('paragraph', () => {
			$.MANY1(() => {
				$.SUBRULE($.inline);
			});
			$.OPTION(() => {
				$.CONSUME(Newline);
			});
		});

		// inline := inlineCode | bold | Text | Star
		$.RULE('inline', () => {
			$.OR([
				{ ALT: () => $.SUBRULE($.inlineCode) },
				{ ALT: () => $.SUBRULE($.bold) },
				{ ALT: () => $.CONSUME(Text) },
				{ ALT: () => $.CONSUME(Star) }, // fail-soft
			]);
		});

		// bold := '**' Text* '**' | '*' Text* '*'
		$.RULE('bold', () => {
			$.OR([
				{
					ALT: () => {
						$.CONSUME1(Star);
						$.CONSUME2(Star);
						$.MANY2(() => {
							$.CONSUME1(Text);
						});
						$.CONSUME3(Star);
						$.CONSUME4(Star);
					},
				},
				{
					ALT: () => {
						$.CONSUME5(Star);
						$.MANY3(() => {
							$.CONSUME2(Text);
						});
						$.CONSUME6(Star);
					},
				},
			]);
		});

		// inlineCode := '`' Text* '`'
		$.RULE('inlineCode', () => {
			$.CONSUME1(Backtick);
			$.MANY4(() => {
				$.CONSUME3(Text);
			});
			$.CONSUME2(Backtick);
		});

		this.performSelfAnalysis();
	}
}
