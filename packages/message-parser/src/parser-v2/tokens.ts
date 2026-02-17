import { createToken } from 'chevrotain';

export const NewLine = createToken({
	name: 'NewLine',
	pattern: /\r\n|\n|\r/,
});

export const CodeFence = createToken({
	name: 'CodeFence',
	pattern: /```[^\n\r]*/,
	line_breaks: false,
	start_chars_hint: ['`'],
});

export const Color = createToken({
	name: 'Color',
	pattern: /color:#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})/,
	line_breaks: false,
	start_chars_hint: ['c'],
});

export const HeadingHash = createToken({
	name: 'HeadingHash',
	pattern: /#{1,4} /,
	line_breaks: false,
	start_chars_hint: ['#'],
});

export const GreaterThan = createToken({
	name: 'GreaterThan',
	pattern: />/,
	start_chars_hint: ['>'],
});

export const Asterisk = createToken({
	name: 'Asterisk',
	pattern: /\*/,
	start_chars_hint: ['*'],
});

export const Underscore = createToken({
	name: 'Underscore',
	pattern: /_/,
	start_chars_hint: ['_'],
});

export const Space = createToken({
	name: 'Space',
	pattern: /[ \t]+/,
});

export const Text = createToken({
	name: 'Text',
	pattern: /[^#\n*_>`]+/,
});

export const Hash = createToken({
	name: 'Hash',
	pattern: /#/,
	longer_alt: HeadingHash,
});

export const Backtick = createToken({
	name: 'Backtick',
	pattern: /`/,
});

export const allTokens = [NewLine, CodeFence, Color, HeadingHash, Hash, GreaterThan, Asterisk, Underscore, Space, Backtick, Text];
