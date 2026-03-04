import type { Root } from './definitions';
import { parse as parser } from './parser';

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

export const parse = (input: string, options?: Options): Root => parser(input, options);

export {
	/** @deprecated */
	parse as parser,
	/** @deprecated */
	Root as MarkdownAST,
};
