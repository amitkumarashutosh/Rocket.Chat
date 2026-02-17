import { createToken, Lexer, CustomPatternMatcherFunc } from 'chevrotain';

// ============================================================================
// CUSTOM PATTERN HELPERS
// ============================================================================

/**
 * Pre-compiled char-code based lookup for invalid mention preceding chars.
 * Avoids regex allocation and .test() call overhead on every token attempt.
 * Invalid chars: a-z, A-Z, 0-9, _, #, @  (i.e. \w plus # and @)
 */
function isInvalidMentionPrev(ch: string): boolean {
	const c = ch.charCodeAt(0);
	return (
		(c >= 97 && c <= 122) || // a-z
		(c >= 65 && c <= 90) || // A-Z
		(c >= 48 && c <= 57) || // 0-9
		c === 95 || // _
		c === 35 || // #
		c === 64 // @
	);
}

/**
 * Creates a word-boundary-aware custom pattern for mention tokens (@user, #channel).
 *
 * Optimizations vs original:
 * 1. char-code check instead of regex.test() for the prev-char guard
 * 2. Uses lastIndex trick on a sticky regex instead of text.slice(offset)
 *    — avoids allocating a new string on every attempt
 */
function makeMentionPattern(marker: '@' | '#', bodyPattern: RegExp): CustomPatternMatcherFunc {
	// Sticky flag (/y) matches at exactly the given lastIndex without slicing
	const sticky = new RegExp(`${marker === '@' ? '@' : '#'}${bodyPattern.source}`, 'y');

	return (text, offset, _tokens, _groups) => {
		if (offset > 0 && isInvalidMentionPrev(text[offset - 1])) {
			return null;
		}

		sticky.lastIndex = offset;
		const match = sticky.exec(text);
		return match;
	};
}

// ============================================================================
// TOKEN DEFINITIONS
// ============================================================================

export const Escape = createToken({
	name: 'Escape',
	pattern: /\\[*_~`#.\[\]()]/,
});

export const TripleBacktick = createToken({
	name: 'TripleBacktick',
	pattern: /```/,
});

export const CodeLanguage = createToken({
	name: 'CodeLanguage',
	pattern: /[a-zA-Z0-9 _\-.]+/,
	longer_alt: TripleBacktick,
});

export const Hash = createToken({
	name: 'Hash',
	pattern: /#/,
});

export const UnorderedListMarker = createToken({
	name: 'UnorderedListMarker',
	pattern: /\* /,
});

export const OrderedListMarker = createToken({
	name: 'OrderedListMarker',
	pattern: /\d+\. /,
});

export const TaskStart = createToken({
	name: 'TaskStart',
	pattern: /- \[/,
});

export const TaskChecked = createToken({
	name: 'TaskChecked',
	pattern: /x\]/,
});

export const TaskUnchecked = createToken({
	name: 'TaskUnchecked',
	pattern: / \]/,
});

export const QuoteMarker = createToken({
	name: 'QuoteMarker',
	pattern: /> /,
	line_breaks: false,
});

export const KaTeXBlockStart = createToken({
	name: 'KaTeXBlockStart',
	pattern: /\$\$/,
});

export const KaTeXInlineStart = createToken({
	name: 'KaTeXInlineStart',
	pattern: /\$/,
});

export const TimestampStart = createToken({
	name: 'TimestampStart',
	pattern: /<t:/,
});

export const TimestampFormat = createToken({
	name: 'TimestampFormat',
	pattern: /[DFRTdft]/,
});

export const ImageStart = createToken({
	name: 'ImageStart',
	pattern: /!\[/,
});

export const LinkStart = createToken({
	name: 'LinkStart',
	pattern: /\[/,
});

export const LinkMiddle = createToken({
	name: 'LinkMiddle',
	pattern: /\]\(/,
});

export const RightBracket = createToken({
	name: 'RightBracket',
	pattern: /\]/,
});

export const LeftParen = createToken({
	name: 'LeftParen',
	pattern: /\(/,
});

export const RightParen = createToken({
	name: 'RightParen',
	pattern: /\)/,
});

// ============================================================================
// MENTION TOKENS
// ============================================================================

export const UserMention = createToken({
	name: 'UserMention',
	pattern: makeMentionPattern('@', /[a-zA-Z0-9_\-.]+/),
	line_breaks: false,
});

export const ChannelMention = createToken({
	name: 'ChannelMention',
	pattern: makeMentionPattern('#', /[a-zA-Z0-9_\-.]+/),
	line_breaks: false,
});

// ============================================================================
// EMOTICON TOKEN
// ============================================================================

export const Emoticon = createToken({
	name: 'Emoticon',
	pattern:
		/<3|<\/3|:D|:-D|=D|>:\)|>;\)|>:-\)|>=\)|':\)|':-\)|'=\)|':D|':-D|'=D|:'\)|:':-\)|O:-\)|0:-3|0:3|0:-\)|0:\)|0;\^\)|O:\)|O;-\)|O=\)|0;-\)|O:-3|O:3|:\)|:-\)|=\]|=\)|:\]|;\)|;-\)|\*-\)|\*\)|;-\]|;\]|;D|;\^\)|:\*|:-\*|=\*|:\^\*|:P|:-P|=P|:-þ|:þ|:-b|:b|>:P|X-P|B-\)|B\)|8\)|8-\)|B-D|8-D|>:\[|:-\(|:\(|:-\[|:\[|=\(|>:\\|>:\/|:-\/|:-\.|:\/|:\\|=\/|=\\|:L|=L|>\.<|:'\(|:':-\(|;\(|;-\(|>:\(|>:-\(|:@|:\$|=\$|D:|':\(|':-\(|'=\(|:-X|:X|:-#|:#|=X|=#|-_-|-__-|-___-|:-O|:O|O_O|>:O|#-\)|#\)|%-\)|%\)|X\)|X-\)|\(y\)|\*\\0\/\*|\\0\/|\*\\O\/\*|\\O\//,
});

// ============================================================================
// EMOJI TOKENS
// ============================================================================

export const EmojiShortcode = createToken({
	name: 'EmojiShortcode',
	pattern: /:[a-zA-Z0-9_+-]+:/,
});

export const EmojiUnicode = createToken({
	name: 'EmojiUnicode',
	pattern: /(?:\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F]|\uD83D[\uDE80-\uDEFF]|\uD83E[\uDD00-\uDDFF]|[\u2600-\u26FF]|[\u2700-\u27BF])+/,
});

// ============================================================================
// URL, EMAIL, PHONE TOKENS
// ============================================================================

export const URL = createToken({
	name: 'URL',
	pattern: /(https?:\/\/|\/\/)[^\s<>()]+/,
});

export const Email = createToken({
	name: 'Email',
	pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
});

export const Phone = createToken({
	name: 'Phone',
	pattern: /\+?[0-9]{1,3}?[-.\s]?\(?[0-9]{1,4}?\)?[-.\s]?[0-9]{1,4}[-.\s]?[0-9]{1,9}/,
});

export const Color = createToken({
	name: 'Color',
	pattern: /color:#[0-9A-Fa-f]{3,8}/,
});

// ============================================================================
// INLINE FORMATTING TOKENS
// ============================================================================

export const InlineCodeMarker = createToken({
	name: 'InlineCodeMarker',
	pattern: /`/,
});

export const BoldMarker = createToken({
	name: 'BoldMarker',
	pattern: /\*\*/,
});

export const ItalicMarker = createToken({
	name: 'ItalicMarker',
	pattern: /\*/,
});

export const StrikeMarker = createToken({
	name: 'StrikeMarker',
	pattern: /~~/,
});

export const UnderscoreItalicMarker = createToken({
	name: 'UnderscoreItalicMarker',
	pattern: /_/,
});

// ============================================================================
// WHITESPACE AND NEWLINE TOKENS
// ============================================================================

export const Newline = createToken({
	name: 'Newline',
	pattern: /\r?\n/,
	line_breaks: true,
});

export const DoubleNewline = createToken({
	name: 'DoubleNewline',
	pattern: /\r?\n\r?\n/,
	line_breaks: true,
	longer_alt: Newline,
});

export const WhiteSpace = createToken({
	name: 'WhiteSpace',
	pattern: /[ \t]+/,
});

// ============================================================================
// SPECIAL CHARACTER TOKENS
// ============================================================================

export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Pipe = createToken({ name: 'Pipe', pattern: /\|/ });
export const LessThan = createToken({ name: 'LessThan', pattern: /</ });
export const GreaterThan = createToken({ name: 'GreaterThan', pattern: />/ });
export const Dash = createToken({ name: 'Dash', pattern: /-/ });
export const Plus = createToken({ name: 'Plus', pattern: /\+/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });
export const At = createToken({ name: 'At', pattern: /@/ });
export const Slash = createToken({ name: 'Slash', pattern: /\// });
export const Backslash = createToken({ name: 'Backslash', pattern: /\\/ });

// ============================================================================
// TEXT CONTENT (lowest priority)
// ============================================================================

export const TextContent = createToken({
	name: 'TextContent',
	pattern: /[^\s*_~`\[\]()<>:|\\\/\n\r$!.+\-@#]+/,
});

// ============================================================================
// TOKEN ARRAY (ORDER MATTERS!)
// ============================================================================

export const allTokens = [
	DoubleNewline,
	Newline,
	WhiteSpace,

	Escape,

	TripleBacktick,
	KaTeXBlockStart,
	KaTeXInlineStart,
	QuoteMarker,
	TaskStart,
	TaskChecked,
	TaskUnchecked,

	UserMention,
	ChannelMention,

	Hash,

	UnorderedListMarker,
	OrderedListMarker,

	ImageStart,
	LinkMiddle,
	LinkStart,
	RightBracket,
	LeftParen,
	RightParen,

	TimestampStart,

	URL,
	Email,
	Phone,
	Color,

	Emoticon,

	EmojiShortcode,
	EmojiUnicode,

	BoldMarker,
	StrikeMarker,
	ItalicMarker,
	UnderscoreItalicMarker,
	InlineCodeMarker,

	Colon,
	Pipe,
	LessThan,
	GreaterThan,
	Dash,
	Plus,
	Dot,
	At,
	Slash,
	Backslash,

	TextContent,

	TimestampFormat,
];
