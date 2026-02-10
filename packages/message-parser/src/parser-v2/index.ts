import { MessageLexer } from './lexer';
import { MessageParser } from './parser';

const parser = new MessageParser();

export function parseV2(input: string) {
	const lexResult = MessageLexer.tokenize(input);

	if (lexResult.errors.length > 0) {
		throw new Error('Lexing error');
	}

	parser.reset();
	parser.input = lexResult.tokens;

	return parser.document();
}
