import { createToken } from 'chevrotain';

export const WhiteSpace = createToken({
	name: 'WhiteSpace',
	pattern: /\s+/,
	group: 'SKIPPED',
});

export const Star = createToken({
	name: 'Star',
	pattern: /\*/,
});

export const Backtick = createToken({
	name: 'Backtick',
	pattern: /`/,
});

export const GreaterThan = createToken({
	name: 'GreaterThan',
	pattern: />/,
});

export const Text = createToken({
	name: 'Text',
	pattern: /[^*`>\s]+/,
});

export const Newline = createToken({
	name: 'Newline',
	pattern: /\n/,
});

export const allTokens = [WhiteSpace, Newline, Star, Backtick, GreaterThan, Text];
