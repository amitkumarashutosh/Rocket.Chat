import { createToken, Lexer } from 'chevrotain';

// ─── Email Token ───────────────────────────────────────────────────────────
// Matches email addresses including unicode, dots, underscores, apostrophes.
// Stops before trailing punctuation like . , ) that are not part of the email.
// The mailto: prefix is also matched so it can be stripped from the label.
// Must be validated further (tldts) in the parser — lexer only does shape matching.
const EMAIL_PATTERN =
	/(?:mailto:)?[a-zA-Z0-9À-ÖØ-öø-ÿЀ-ӿ'_.+-]+@[a-zA-Z0-9À-ÖØ-öø-ÿЀ-ӿ-]+\.[a-zA-Z0-9À-ÖØ-öø-ÿЀ-ӿ.-]+[a-zA-Z0-9À-ÖØ-öø-ÿЀ-ӿ]/;

// ─── Phone Token ──────────────────────────────────────────────────────────
// Matches phone numbers starting with + at word boundary (not after digit/letter).
// Formats: +digits, +(digits)digits, +digits-digits
// Must NOT be preceded by a word character (handles 5+51231 → plain).
// Further validation (min 5 digits, no dots/commas) done in parser.
const PHONE_PATTERN = /(?<![\w])\+(\(\d+\)[\d-]*|\d[\d-]*)(?![.,\d])/;

// ─── Email ────────────────────────────────────────────────────────────────
// Lexer-level shape match only. Parser validates TLD via tldts.
export const Email = createToken({
	name: 'Email',
	pattern: EMAIL_PATTERN,
});

// ─── Phone ────────────────────────────────────────────────────────────────
// Lexer-level shape match only. Parser validates digit count via phoneChecker.
export const Phone = createToken({
	name: 'Phone',
	pattern: PHONE_PATTERN,
});

// ─── Escape ────────────────────────────────────────────────────────────────
// Matches backslash followed by ONLY these escapable characters: * _ ~ ` # .
// \[ is intentionally excluded — it must remain as literal \[
export const Escape = createToken({
	name: 'Escape',
	pattern: /\\[*_~`#.]/,
});

// ─── Literal Backslash ─────────────────────────────────────────────────────
// Matches a backslash NOT followed by an escapable character.
// e.g. \[ \& \< all pass through as plain text INCLUDING the backslash.
// Must come AFTER Escape so Escape gets priority for \\* \\_ etc.
export const LiteralBackslash = createToken({
	name: 'LiteralBackslash',
	pattern: /\\(?![*_~`#.])/,
});

// ─── Double New Line ───────────────────────────────────────────────────────
// Matches exactly two consecutive newlines = a LINE_BREAK block node.
// MUST come before NewLine so it gets priority over single \n.
export const DoubleNewLine = createToken({
	name: 'DoubleNewLine',
	pattern: /\n\n/,
});

// ─── New Line ──────────────────────────────────────────────────────────────
// Single \n — used as paragraph terminator, consumed but not emitted as a node.
// Must come AFTER DoubleNewLine.
export const NewLine = createToken({
	name: 'NewLine',
	pattern: /\n/,
});

// ─── Plain Text ────────────────────────────────────────────────────────────
// Matches any run of characters that are NOT special formatting characters.
// Allows letters, digits, spaces, punctuation like , / ( ) etc.
// Must come BEFORE SpecialChar so it grabs as much plain text as possible.
export const Plain = createToken({
	name: 'Plain',
	pattern: /[^*_~`#+\\\[\]\n]+/,
});

// ─── Special Char ──────────────────────────────────────────────────────────
// Single character fallback for * _ ~ ~ ` # [ ]
// Catches any special character not consumed by a higher-priority token.
// These become PLAIN_TEXT when no formatting rule claims them (e.g. *bold_).
export const SpecialChar = createToken({
	name: 'SpecialChar',
	pattern: /[*_~`#+\[\]]/,
});

// ─── Token Order Matters! ──────────────────────────────────────────────────
// Chevrotain tries tokens TOP to BOTTOM.
// More specific / longer patterns MUST come before shorter / catch-all ones.
export const allTokens = [
	Email, // email@domain.com       — MUST be before Plain
	Phone, // +1234567890            — MUST be before Plain
	Escape, // \\*  \\_  etc         — MUST be before LiteralBackslash
	LiteralBackslash, // \\[ \\& \\< etc        — MUST be before SpecialChar
	DoubleNewLine, // \n\n                   — MUST be before NewLine
	NewLine, // \n                     — single newline
	Plain, // normal text runs       — MUST be before SpecialChar
	SpecialChar, // leftover single chars  — always last
];

export const MessageLexer = new Lexer(allTokens, {
	positionTracking: 'onlyStart',
});
