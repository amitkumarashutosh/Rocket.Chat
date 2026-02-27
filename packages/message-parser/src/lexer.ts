import { createToken, Lexer } from 'chevrotain';

// =============================================================================
// TOKEN TYPES
// Order matters — Chevrotain tries patterns TOP to BOTTOM at each position.
// More specific / longer patterns MUST come before catch-alls.
// =============================================================================

// ─── Escape ───────────────────────────────────────────────────────────────────
// Backslash followed by an escapable char: * _ ~ ` # .
// \[ is intentionally excluded — it stays as literal \[
export const Escape = createToken({
	name: 'Escape',
	pattern: /\\[*_~`#.]/,
});

// ─── Literal Backslash ────────────────────────────────────────────────────────
// Backslash NOT followed by an escapable char (e.g. \[ \& \<).
// Kept as-is including the backslash. MUST come after Escape.
export const LiteralBackslash = createToken({
	name: 'LiteralBackslash',
	pattern: /\\(?![*_~`#.])/,
});

// ─── Double New Line ──────────────────────────────────────────────────────────
// Two consecutive newlines — becomes a LINE_BREAK block node.
// MUST come before NewLine.
export const DoubleNewLine = createToken({
	name: 'DoubleNewLine',
	pattern: /\n\n/,
});

// ─── New Line ─────────────────────────────────────────────────────────────────
// Single newline — paragraph terminator.
export const NewLine = createToken({
	name: 'NewLine',
	pattern: /\n/,
});

// ─── Plain Text ───────────────────────────────────────────────────────────────
// Any run of non-special characters.
// NOTE: emails and phone numbers are detected INSIDE Plain tokens by the parser.
// This avoids Chevrotain lookbehind issues and handles mid-sentence emails cleanly.
export const Plain = createToken({
	name: 'Plain',
	pattern: /[^*_~`#\\\[\]\n]+/,
});

// ─── Special Char ─────────────────────────────────────────────────────────────
// Single special character not consumed by any other token.
// These become PLAIN_TEXT if no formatting rule claims them.
export const SpecialChar = createToken({
	name: 'SpecialChar',
	pattern: /[*_~`#\[\]]/,
});

// =============================================================================
// TOKEN ORDER — Chevrotain tries top to bottom at each position
// =============================================================================
export const allTokens = [
	Escape, // \\*  \\_  etc       — before LiteralBackslash
	LiteralBackslash, // \\[  \\&  etc        — before SpecialChar
	DoubleNewLine, // \n\n                 — before NewLine
	NewLine, // \n
	Plain, // normal text runs    — before SpecialChar
	SpecialChar, // * _ ~ ` # [ ]       — catch-all
];

export const MessageLexer = new Lexer(allTokens, {
	positionTracking: 'onlyStart',
});
