import type { Root } from './definitions';
// import * as grammar from './grammar.pegjs';
//@ts-ignore
import * as grammar from './grammar.js';
import { parseV2 } from './parser-v2';

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

// HARD DISABLE parser-v2 in Jest
const isJest = process.env.JEST_WORKER_ID !== undefined;

const useParserV2 = !isJest && process.env.MESSAGE_PARSER_V2 === 'true';

export const parse = (input: string, options?: Options): Root => {
	if (useParserV2) {
		// lazy load — NEVER evaluated in Jest
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { parseV2 } = require('./parser-v2');
		return parseV2(input) as Root;
	}

	return grammar.parse(input, options);
};

// peggy.js
// export const parse = (input: string, options?: Options): Root => grammar.parse(input, options);

export {
	/** @deprecated */
	parse as parser,
	/** @deprecated */
	Root as MarkdownAST,
};
