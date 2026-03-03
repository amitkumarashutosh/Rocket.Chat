// =============================================================================
// PATTERNS
// Single source of truth for all regex patterns used by the lexer and parser.
//
// Lexer patterns (stateless, no context required):
//   EMAIL_PATTERN, URL_PATTERN, PHONE_PATTERN
//
// Parser patterns (context-sensitive, used inside splitPlainText):
//   MENTION_USER_RE, UNICODE_EMOJI_RE
//
// Inline patterns (used inside splitPlainText only):
//   EMOJI_CODE_RE
// =============================================================================

// Shared unicode letter+digit block used in email and mention patterns.
// Covers: ASCII, Latin Extended (\u00C0-\u00FF), Cyrillic (\u0400-\u04FF).
// \u00C0-\u00FF intentionally includes × (\u00D7) and ÷ (\u00F7) — harmless
// in email/mention context and simplifies the range.
const UW = 'a-zA-Z0-9\\u00C0-\\u00FF\\u0400-\\u04FF';

// Extended unicode block used in mention names only (adds Thai, Devanagari,
// Hiragana, Katakana, CJK on top of UW).
const UW_MENTION = `${UW}\\u0E00-\\u0E7F\\u0900-\\u097F\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF`;

// =============================================================================
// LEXER PATTERNS
// Used as `pattern:` values in createToken(). Must be stateless RegExp.
// =============================================================================

// Email — optional mailto: prefix, unicode local part, domain, TLD.
// MUST be tried before URL (mailto:foo@bar.com also matches URL_PATTERN).
export const EMAIL_PATTERN = new RegExp(`(?:mailto:)?[${UW}'_.+-]+@[${UW}-]+\\.[${UW}.-]+[${UW}]`);

// URL — any scheme://, or www. prefix.
export const URL_PATTERN = /(?:(?:[a-zA-Z][a-zA-Z0-9+\-]*):\/\/|(?:www\.))[\S]+/;

// Phone — international format: +44... or +(44)...
// Negative lookahead prevents matching mid-number.
export const PHONE_PATTERN = /\+(\(\d+\)[\d-]*|\d[\d-]*)(?![.,\d])/;

// =============================================================================
// PARSER PATTERNS
// Used inside splitPlainText(). May rely on surrounding context (prevChar etc).
// =============================================================================

// @mention — unicode-aware, allows . @ : - after the first char.
// Context rule: rejected when preceded by a word char (enforced in splitPlainText).
export const MENTION_USER_RE = new RegExp(`@[\\w${UW_MENTION}][\\w${UW_MENTION}.@:-]*`);

// Emoji shortcode — :smile: style. Context rule: must be surrounded by
// whitespace/start/end/colon (enforced in splitPlainText).
export const EMOJI_CODE_RE = /:[a-zA-Z0-9_+\-]+:/g;

// Unicode emoji sequences including ZWJ sequences and variation selectors.
export const UNICODE_EMOJI_RE =
	/(?:\p{Emoji}\uFE0F|\p{Emoji_Presentation})\p{Emoji_Modifier}?(?:\u200D(?:\p{Emoji}\uFE0F|\p{Emoji_Presentation})\p{Emoji_Modifier}?)*/u;

// =============================================================================
// PARSER INLINE HELPERS
// Small patterns used directly in parser logic (not in splitPlainText).
// =============================================================================

// URL trailing punctuation chars to strip (used in stripUrlTrailing).
export const URL_TRAILING_CHARS = '.!,';

// Phone number in a link URL — used in resolveLinkUrl.
export const PHONE_URL_RE = /^\+(\(\d+\)[\d-]*|\d[\d-]*)$/;

// =============================================================================
// CHARACTER CLASS HELPERS
// Named predicates used in isWordChar, boundary guards, etc.
// =============================================================================

// Alphanumeric character — used for word-boundary checks around bold/italic/mentions.
export const WORD_CHAR_RE = /^[a-zA-Z0-9]$/;

// Alphanumeric + dot — used to reject URL tokens preceded by e.g. "foo.http://..."
export const WORD_CHAR_WITH_DOT_RE = /^[a-zA-Z0-9.]$/;

// Any whitespace character — used in emoticon boundary checks.
export const WHITESPACE_RE = /^\s$/;

// Whitespace or colon — used in emoji shortcode boundary checks.
export const WHITESPACE_OR_COLON_RE = /^[\s:]$/;

// Non-space start — used to check a token does NOT begin with whitespace.
// Usage: NON_SPACE_START_RE.test(tok.image) → token starts with non-space.
export const NON_SPACE_START_RE = /^\S/;

// Alphabetic — used to validate the format character in timestamp tags.
export const ALPHA_RE = /^[a-zA-Z]$/;

// Non-digit — used to strip all non-numeric chars from phone strings.
export const NON_DIGIT_RE = /\D/g;

// Generic \w (word char) — used for phone token boundary check.
export const GENERIC_WORD_CHAR_RE = /^\w$/;

// =============================================================================
// BLOCK-LEVEL PATTERNS
// Used in parseMessage / tryParse* to identify block constructs.
// =============================================================================

// Ordered list item — "1. text" at the start of a Plain token.
export const ORDERED_LIST_RE = /^\d+\.\s/;

// Ordered list item with capture groups — extracts number and content.
export const ORDERED_LIST_ITEM_RE = /^(\d+)\.\s(.*)/s;

// =============================================================================
// COLOR PATTERNS
// =============================================================================

// Hex color value — validates the hex portion after "color:#".
export const HEX_COLOR_RE = /^[0-9a-fA-F]+$/;

// =============================================================================
// TIMESTAMP PATTERNS
// =============================================================================

// Matches any <t:...> tag in raw input (used in the sentinel pre-lexer pass).
export const TIMESTAMP_TAG_RE = /<t:[^>]+>/g;

// Sentinel prefix injected around timestamp tag indices during pre-lexing.
// Must not contain any lexer-special chars (* _ ~ ` # \ [ ] \n +).
export const TIMESTAMP_SENTINEL_PREFIX = '\x00TS\x00';

// Matches sentinel placeholders after lexing, to restore original tag text.
// Call buildSentinelRe(TIMESTAMP_SENTINEL_PREFIX) to get the RegExp.
export function buildSentinelRe(prefix: string): RegExp {
	// Escape the prefix for use in a RegExp (the NUL chars are safe but be explicit).
	const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`${escaped}(\\d+)${escaped}`, 'g');
}

// Relative time format — HH:MM[:SS]+TZ  e.g. "10:00:00+00:00" or "10:00+00:00"
export const TIMESTAMP_RELATIVE_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?([+-]\d{2}:\d{2}|Z)$/;

// Pure unix epoch — all digits, minimum 5 chars.
export const TIMESTAMP_EPOCH_RE = /^\d+$/;

// Inline timestamp tag scan — used in splitPlainText.
export const TIMESTAMP_INLINE_RE = /<t:[^>]+>/;

// =============================================================================
// INLINE PATTERNS
// =============================================================================

// @domain suffix immediately following a mention — absorbs federated-style addresses.
export const AT_DOMAIN_RE = /^@[^\s]+/;

// Trailing underscores at the end of a mention — may be italic delimiters.
export const MENTION_TRAILING_UNDERSCORE_RE = /_+$/;
