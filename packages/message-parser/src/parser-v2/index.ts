import { MessageLexer } from './lexer';
import { MessageParser } from './parser';
import { buildAst } from './astBuilder';

export function parseV2(input: string) {
	const lexResult = MessageLexer.tokenize(input);

	const parser = new MessageParser();
	parser.input = lexResult.tokens;

	const cst = parser.document?.();

	return buildAst(cst);
}
