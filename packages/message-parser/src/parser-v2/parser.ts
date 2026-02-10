import { EmbeddedActionsParser } from 'chevrotain';
import { Text, Newline, Star, Backtick, GreaterThan } from './tokens';

export class MessageParser extends EmbeddedActionsParser {
	public document!: () => any[];
	public paragraph!: () => any;
	public inline!: () => any;
	public bold!: () => any;
	public inlineCode!: () => any;
	public quote!: () => any;

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
				recoveryEnabled: false, // 🔥 IMPORTANT
			},
		);

		const $ = this;

		// document := (quote | paragraph)*
		$.RULE('document', () => {
			const blocks: any[] = [];

			$.MANY(() => {
				blocks.push($.OR([{ ALT: () => $.SUBRULE($.quote) }, { ALT: () => $.SUBRULE($.paragraph) }]));
			});

			return blocks;
		});

		// quote := '>' paragraph
		$.RULE('quote', () => {
			$.CONSUME(GreaterThan);
			const paragraph = $.SUBRULE($.paragraph);

			return {
				type: 'QUOTE',
				value: [paragraph],
			};
		});

		// paragraph := inline* Newline?
		$.RULE('paragraph', () => {
			const inlines: any[] = [];

			$.MANY(() => {
				inlines.push($.SUBRULE($.inline));
			});

			$.OPTION(() => {
				$.CONSUME(Newline);
			});

			return {
				type: 'PARAGRAPH',
				value: inlines,
			};
		});

		// inline := inlineCode | bold | Text | Star
		$.RULE('inline', () => {
			return $.OR([
				{ ALT: () => $.SUBRULE($.inlineCode) },
				{ ALT: () => $.SUBRULE($.bold) },
				{
					ALT: () => ({
						type: 'PLAIN_TEXT',
						value: $.CONSUME(Text).image,
					}),
				},
				{
					// fail-soft star
					ALT: () => ({
						type: 'PLAIN_TEXT',
						value: $.CONSUME(Star).image,
					}),
				},
			]);
		});

		// bold := '**' Text* '**' | '*' Text* '*'
		$.RULE('bold', () => {
			return $.OR([
				{
					ALT: () => {
						$.CONSUME1(Star);
						$.CONSUME2(Star);

						const parts: string[] = [];
						$.MANY(() => {
							parts.push($.CONSUME(Text).image);
						});

						$.CONSUME3(Star);
						$.CONSUME4(Star);

						return {
							type: 'BOLD',
							value: [
								{
									type: 'PLAIN_TEXT',
									value: parts.join(''),
								},
							],
						};
					},
				},
				{
					ALT: () => {
						$.CONSUME5(Star);

						const parts: string[] = [];
						$.MANY2(() => {
							parts.push($.CONSUME2(Text).image);
						});

						$.CONSUME6(Star);

						return {
							type: 'BOLD',
							value: [
								{
									type: 'PLAIN_TEXT',
									value: parts.join(''),
								},
							],
						};
					},
				},
			]);
		});

		// inlineCode := '`' Text* '`'
		$.RULE('inlineCode', () => {
			$.CONSUME1(Backtick);

			const parts: string[] = [];
			$.MANY(() => {
				parts.push($.CONSUME(Text).image);
			});

			$.CONSUME2(Backtick);

			return {
				type: 'INLINE_CODE',
				value: {
					type: 'PLAIN_TEXT',
					value: parts.join(''),
				},
			};
		});

		this.performSelfAnalysis();
	}
}
