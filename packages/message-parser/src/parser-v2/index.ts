/**
 * Rocket.Chat Message Parser - Chevrotain Implementation
 * High-performance parser for Rocket.Chat markdown-like messages
 */

import { messageLexer } from './lexer';
import { messageParser } from './parser';
import { messageVisitor } from './visitor';
import type { Root } from '../definitions';

export interface ParseOptions {
	customDomains?: string[];
	skipBold?: boolean;
	skipItalic?: boolean;
	skipStrikethrough?: boolean;
	skipReferences?: boolean;
	skipBoldEmoji?: boolean;
	skipItalicEmoji?: boolean;
	skipInlineEmoji?: boolean;
	skipColors?: boolean;
	skipEmoticons?: boolean;
	skipKatex?: boolean;
}

export function parse(input: string, options?: ParseOptions): Root {
	// PERF: .length check is a single property read.
	// The original input.trim() === '' allocated a new string on every call.
	if (!input || input.length === 0) {
		return [];
	}

	try {
		const tokens = messageLexer.tokenize(input, options);
		messageParser.input = tokens;
		const cst = messageParser.document();
		// PERF: removed console.warn on parser errors — string formatting
		// inside a hot loop is expensive. Use parseWithErrors() for diagnostics.
		return messageVisitor.visit(cst) as Root;
	} catch {
		return [];
	}
}

export function parseWithErrors(input: string, options?: ParseOptions): { ast: Root | null; errors: string[] } {
	if (!input || input.length === 0) return { ast: [], errors: [] };

	const errors: string[] = [];
	try {
		const tokens = messageLexer.tokenize(input, options);
		messageParser.input = tokens;
		const cst = messageParser.document();
		if (messageParser.errors.length > 0) {
			errors.push(...messageParser.errors.map((e) => e.message));
		}
		return { ast: messageVisitor.visit(cst) as Root, errors };
	} catch (error) {
		if (error instanceof Error) errors.push(error.message);
		return { ast: null, errors };
	}
}

export function validate(input: string, options?: ParseOptions): boolean {
	try {
		parse(input, options);
		return true;
	} catch {
		return false;
	}
}

export function getParseErrors(input: string, options?: ParseOptions): string[] {
	return parseWithErrors(input, options).errors;
}

export * from '../definitions';
export * from './ast';
export { messageLexer, messageParser, messageVisitor };
export type { LexerOptions } from './lexer';

export default { parse, parseWithErrors, validate, getParseErrors };
