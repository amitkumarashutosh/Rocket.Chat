import { Lexer } from 'chevrotain';
import { allTokens } from './tokens';

export const MessageLexer = new Lexer(allTokens);
