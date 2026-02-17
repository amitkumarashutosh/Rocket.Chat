import type { Root } from './definitions';
import { parse as chevrotainParser } from './parser-v2/index';

export * from './definitions';
export { isNodeOfType } from './guards';

export type Options = {
	colors?: boolean;
	emoticons?: boolean;
	katex?: {
		dollarSyntax?: boolean;
		parenthesisSyntax?: boolean;
	};
	customDomains?: string[];
};

/**
 * Parse a message string into an AST
 * Using the new high-performance Chevrotain implementation
 *
 * @param input - The message text to parse
 * @param options - Optional parsing options
 * @returns Root AST node
 */

export const parse = (input: string, options?: Options): Root => {
	return chevrotainParser(input, {
		customDomains: options?.customDomains,
		// Map options to internal format
		skipColors: options?.colors === false,
		skipEmoticons: options?.emoticons === false,
		skipKatex: options?.katex === undefined || (options.katex.dollarSyntax === false && options.katex.parenthesisSyntax === false),
	}) as Root;
};

export {
	/** @deprecated Use parse instead */
	parse as parser,
	/** @deprecated Use Root instead */
	Root as MarkdownAST,
};
