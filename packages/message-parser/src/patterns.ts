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
