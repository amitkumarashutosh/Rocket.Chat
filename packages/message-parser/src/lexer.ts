import { createToken, Lexer } from 'chevrotain';
import { EMAIL_PATTERN, URL_PATTERN, PHONE_PATTERN } from './patterns';

// =============================================================================
// TOKEN TYPES
// Order matters — Chevrotain tries patterns TOP to BOTTOM at each position.
// More specific / longer patterns MUST come before catch-alls.
// =============================================================================

// ─── Escape ───────────────────────────────────────────────────────────────────
export const Escape = createToken({
	name: 'Escape',
	pattern: /\\[*_~`#.]/,
});

// ─── Literal Backslash ────────────────────────────────────────────────────────
export const LiteralBackslash = createToken({
	name: 'LiteralBackslash',
	pattern: /\\(?![*_~`#.])/,
});

// ─── Double New Line ──────────────────────────────────────────────────────────
export const DoubleNewLine = createToken({
	name: 'DoubleNewLine',
	pattern: /\n\n/,
});

// ─── New Line ─────────────────────────────────────────────────────────────────
export const NewLine = createToken({
	name: 'NewLine',
	pattern: /\n/,
});

// ─── Email ────────────────────────────────────────────────────────────────────
// MUST come before Url — mailto:foo@bar.com also matches URL_PATTERN.
export const Email = createToken({
	name: 'Email',
	pattern: EMAIL_PATTERN,
});

// ─── URL ──────────────────────────────────────────────────────────────────────
export const Url = createToken({
	name: 'Url',
	pattern: URL_PATTERN,
});

// ─── Phone ────────────────────────────────────────────────────────────────────
export const Phone = createToken({
	name: 'Phone',
	pattern: PHONE_PATTERN,
});

// ─── Plain Text ───────────────────────────────────────────────────────────────
// @mentions, emoji shortcodes, and emoticons are detected inside Plain tokens
// by the parser's splitPlainText() — they require surrounding context that
// stateless Chevrotain tokens cannot express.
export const Plain = createToken({
	name: 'Plain',
	pattern: /[^*_~`#\\\[\]\n+]+/,
});

// ─── Special Char ─────────────────────────────────────────────────────────────
export const SpecialChar = createToken({
	name: 'SpecialChar',
	pattern: /[*_~`#\[\]+]/,
});

// =============================================================================
// TOKEN ORDER
//   Email    before  Url         — mailto:foo@bar also matches Url
//   Email    before  Plain       — foo@bar.com would otherwise be plain text
//   Url      before  Plain       — http://... would otherwise be plain text
//   Phone    before  Plain       — +123... would otherwise be plain text
//   Plain    before  SpecialChar — greedily consume before single-char fallback
// =============================================================================
export const allTokens = [Escape, LiteralBackslash, DoubleNewLine, NewLine, Email, Url, Phone, Plain, SpecialChar];

export const MessageLexer = new Lexer(allTokens, {
	positionTracking: 'onlyStart',
});
