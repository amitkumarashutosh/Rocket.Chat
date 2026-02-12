import { Lexer } from 'chevrotain';
import { allTokens } from './tokens';

export const MarkdownLexer = new Lexer(allTokens);
