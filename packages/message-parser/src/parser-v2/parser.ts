import { CstParser, EOF } from 'chevrotain';
import { allTokens, HeadingHash, NewLine, Space, Text, Hash } from './tokens';

export class MarkdownParser extends CstParser {
	public document!: any;
	public headingLine!: any;
	public paragraphLine!: any;
	public inline!: any;

	constructor() {
		super(allTokens);

		const $ = this;

		$.RULE('document', () => {
			$.MANY(() => {
				$.OR([
					{
						GATE: () => $.LA(1).tokenType === HeadingHash,
						ALT: () => $.SUBRULE($.headingLine),
					},
					{ ALT: () => $.SUBRULE($.paragraphLine) },
				]);
			});

			$.MANY2(() => {
				$.CONSUME(NewLine);
			});

			$.CONSUME(EOF);
		});

		$.RULE('headingLine', () => {
			$.CONSUME(HeadingHash);
			$.CONSUME(Space);
			$.AT_LEAST_ONE(() => {
				$.SUBRULE($.inline);
			});
			$.OPTION(() => $.CONSUME(NewLine));
		});

		$.RULE('paragraphLine', () => {
			$.AT_LEAST_ONE(() => {
				$.SUBRULE($.inline);
			});
			$.OPTION(() => $.CONSUME(NewLine));
		});

		$.RULE('inline', () => {
			$.OR([{ ALT: () => $.CONSUME(Text) }, { ALT: () => $.CONSUME(Hash) }, { ALT: () => $.CONSUME(Space) }]);
		});

		this.performSelfAnalysis();
	}
}
