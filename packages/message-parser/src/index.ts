import type { Root } from './definitions';
//@ts-ignore
import grammar from './grammar.js';
import { parse as parser } from './parser-v2/index';

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

// chevrotain.js
export const parse = (input: string, _options?: Options): Root => parser(input) as Root;

// peggy.js
// export const parse = (input: string, options?: Options): Root => grammar.parse(input, options);

export {
	/** @deprecated */
	parse as parser,
	/** @deprecated */
	Root as MarkdownAST,
};
