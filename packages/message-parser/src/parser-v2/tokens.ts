import { createToken } from 'chevrotain';

export const NewLine = createToken({
	name: 'NewLine',
	pattern: /\r\n|\n|\r/,
});

export const HeadingHash = createToken({
	name: 'HeadingHash',
	pattern: /#{1,4}(?=\s)/,
	line_breaks: false,
	start_chars_hint: ['#'],
});

// export const MentionChannel = createToken({
// 	name: 'MentionChannel',
// 	pattern: /(?<=^|\s)#[a-zA-Z0-9_]+/,
// });

export const Space = createToken({
	name: 'Space',
	pattern: /[ \t]+/,
});

export const Text = createToken({
	name: 'Text',
	pattern: /[^#\n]+/,
});

export const Hash = createToken({
	name: 'Hash',
	pattern: /#/,
	longer_alt: HeadingHash,
});

// NOTE: Order matters
export const allTokens = [NewLine, HeadingHash, Hash, Space, Text];
