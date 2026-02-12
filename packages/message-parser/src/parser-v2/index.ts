import { MarkdownLexer } from './lexer';
import { MarkdownParser } from './parser';
import { MarkdownAstVisitor } from './ast';
import { Options } from '../index';

const parser = new MarkdownParser();
const visitor = new MarkdownAstVisitor();

export function parse(input: string, options?: Options) {
	const lexResult = MarkdownLexer.tokenize(input);

	if (lexResult.errors.length > 0) {
		throw new Error('Lexing errors');
	}

	parser.input = lexResult.tokens;
	parser.reset();

	const cst = parser.document();

	if (parser.errors.length > 0) {
		throw new Error('Parsing errors');
	}

	return visitor.visit(cst);
}
