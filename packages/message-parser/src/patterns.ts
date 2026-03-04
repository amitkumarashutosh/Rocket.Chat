// =============================================================================
// PATTERNS
// Single source of truth for all regex patterns used by the lexer and parser.
// =============================================================================

const UW = 'a-zA-Z0-9\\u00C0-\\u00FF\\u0400-\\u04FF';
const UW_MENTION = `${UW}\\u0E00-\\u0E7F\\u0900-\\u097F\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF`;

// =============================================================================
// LEXER PATTERNS
// =============================================================================

export const EMAIL_PATTERN: RegExp = new RegExp(`(?:mailto:)?[${UW}'_.+-]+@[${UW}-]+\\.[${UW}.-]+[${UW}]`);
export const URL_PATTERN: RegExp = /(?:(?:[a-zA-Z][a-zA-Z0-9+\-]*):\/\/|(?:www\.))[\S]+/;
export const PHONE_PATTERN: RegExp = /\+(\(\d+\)[\d-]*|\d[\d-]*)(?![.,\d])/;

// =============================================================================
// PARSER PATTERNS
// =============================================================================

export const MENTION_USER_RE: RegExp = new RegExp(`@[\\w${UW_MENTION}][\\w${UW_MENTION}.@:-]*`);
export const EMOJI_CODE_RE: RegExp = /:[a-zA-Z0-9_+\-]+:/g;
export const UNICODE_EMOJI_RE: RegExp =
	/(?:\p{Emoji}\uFE0F|\p{Emoji_Presentation})\p{Emoji_Modifier}?(?:\u200D(?:\p{Emoji}\uFE0F|\p{Emoji_Presentation})\p{Emoji_Modifier}?)*/u;

// =============================================================================
// PARSER INLINE HELPERS
// =============================================================================

export const URL_TRAILING_CHARS: string = '.!,';
export const PHONE_URL_RE: RegExp = /^\+(\(\d+\)[\d-]*|\d[\d-]*)$/;

// =============================================================================
// CHARACTER CLASS HELPERS
// =============================================================================

export const WORD_CHAR_RE: RegExp = /^[a-zA-Z0-9]$/;
export const WORD_CHAR_WITH_DOT_RE: RegExp = /^[a-zA-Z0-9.]$/;
export const WHITESPACE_RE: RegExp = /^\s$/;
export const WHITESPACE_OR_COLON_RE: RegExp = /^[\s:]$/;
export const NON_SPACE_START_RE: RegExp = /^\S/;
export const ALPHA_RE: RegExp = /^[a-zA-Z]$/;
export const NON_DIGIT_RE: RegExp = /\D/g;
export const GENERIC_WORD_CHAR_RE: RegExp = /^\w$/;

// =============================================================================
// BLOCK-LEVEL PATTERNS
// =============================================================================

export const ORDERED_LIST_RE: RegExp = /^\d+\.\s/;
export const ORDERED_LIST_ITEM_RE: RegExp = /^(\d+)\.\s(.*)/s;

// =============================================================================
// COLOR PATTERNS
// =============================================================================

export const HEX_COLOR_RE: RegExp = /^[0-9a-fA-F]+$/;

// =============================================================================
// TIMESTAMP PATTERNS
// =============================================================================

export const TIMESTAMP_TAG_RE: RegExp = /<t:[^>]+>/g;
export const TIMESTAMP_SENTINEL_PREFIX: string = '\x00TS\x00';

export function buildSentinelRe(prefix: string): RegExp {
	const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`${escaped}(\\d+)${escaped}`, 'g');
}

export const TIMESTAMP_RELATIVE_RE: RegExp = /^(\d{1,2}):(\d{2})(?::(\d{2}))?([+-]\d{2}:\d{2}|Z)$/;
export const TIMESTAMP_EPOCH_RE: RegExp = /^\d+$/;
export const TIMESTAMP_INLINE_RE: RegExp = /<t:[^>]+>/;

// =============================================================================
// INLINE PATTERNS
// =============================================================================

export const AT_DOMAIN_RE: RegExp = /^@[^\s]+/;
export const MENTION_TRAILING_UNDERSCORE_RE: RegExp = /_+$/;

// Emoticons map: text pattern → emoji shortCode
// Only used when options.emoticons = true
export const EMOTICONS: Record<string, string> = {
	':)': 'slight_smile',
	':-)': 'slight_smile',
	':]': 'slight_smile',
	'=)': 'slight_smile',
	':((': 'cry',
	':(': 'disappointed',
	':-(': 'disappointed',
	':[': 'disappointed',
	'=(': 'disappointed',
	':D': 'smiley',
	':-D': 'smiley',
	'=D': 'smiley',
	';)': 'wink',
	';-)': 'wink',
	':P': 'stuck_out_tongue',
	':-P': 'stuck_out_tongue',
	'=P': 'stuck_out_tongue',
	':p': 'stuck_out_tongue',
	':-p': 'stuck_out_tongue',
	':O': 'open_mouth',
	':-O': 'open_mouth',
	':o': 'open_mouth',
	':-o': 'open_mouth',
	':|': 'neutral_face',
	':-|': 'neutral_face',
	":'(": 'cry',
	'>:(': 'angry',
	'>:-(': 'angry',
	'B)': 'sunglasses',
	'B-)': 'sunglasses',
	'8)': 'sunglasses',
	'8-)': 'sunglasses',
	':3': 'cat',
	':/': 'confused',
	':-/': 'confused',
	'D:': 'fearful',
	'O:)': 'innocent',
	'O:-)': 'innocent',
	':*': 'kissing_heart',
	':-*': 'kissing_heart',
	':^)': 'slight_smile',
	'¯\\_(ツ)_/¯': 'shrug',
};

// Build sorted list (longest first to avoid partial matches)
export const EMOTICON_LIST = Object.keys(EMOTICONS).sort((a, b) => b.length - a.length);
