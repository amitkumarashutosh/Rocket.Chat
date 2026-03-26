// =============================================================================
// TOKEN TYPES
// =============================================================================

export type TokenTypeName =
	| 'Escape'
	| 'LiteralBackslash'
	| 'DoubleNewLine'
	| 'NewLine'
	| 'CodeFence'
	| 'Email'
	| 'Url'
	| 'Phone'
	| 'Plain'
	| 'SpecialChar';

export interface TokenType {
	name: TokenTypeName;
}
export interface IToken {
	image: string;
	tokenType: TokenType;
	startOffset: number;
}
export interface LexerError {
	message: string;
	offset: number;
}
export interface LexerResult {
	tokens: IToken[];
	errors: LexerError[];
}

export const Escape: TokenType = { name: 'Escape' };
export const LiteralBackslash: TokenType = { name: 'LiteralBackslash' };
export const DoubleNewLine: TokenType = { name: 'DoubleNewLine' };
export const NewLine: TokenType = { name: 'NewLine' };
export const CodeFence: TokenType = { name: 'CodeFence' };
export const Email: TokenType = { name: 'Email' };
export const Url: TokenType = { name: 'Url' };
export const Phone: TokenType = { name: 'Phone' };
export const Plain: TokenType = { name: 'Plain' };
export const SpecialChar: TokenType = { name: 'SpecialChar' };

function makeToken(type: TokenType, image: string, startOffset: number): IToken {
	return { image, tokenType: type, startOffset };
}

// =============================================================================
// CHARACTER SETS — Set for O(1) lookup
// =============================================================================

const PLAIN_STOP_SET = new Set(['*', '_', '~', '`', '#', '\\', '[', ']', '\n', '+']);
const SPECIAL_CHAR_SET = new Set(['*', '_', '~', '`', '#', '[', ']', '+']);
// Characters that can follow \ to form an Escape token
const ESCAPE_SET = new Set(['*', '_', '~', '`', '#', '.']);

// =============================================================================
// CHARACTER HELPERS  — charCode only, zero regex
// =============================================================================

// Uint8Array for fast ASCII classification
const _LEX = new Uint8Array(128);
const L_ALPHA = 1;
const L_ALNUM = 2;
const L_UW = 4; // [a-zA-Z0-9] + extended (handled separately for non-ASCII)
const L_EMAIL_LC = 8; // email local-part chars [a-zA-Z0-9'_.+-]
const L_DOMAIN = 16; // domain chars [a-zA-Z0-9-]
const L_DIGIT = 32;

for (let c = 0x30; c <= 0x39; c++) _LEX[c] |= L_ALNUM | L_UW | L_EMAIL_LC | L_DOMAIN | L_DIGIT;
for (let c = 0x41; c <= 0x5a; c++) _LEX[c] |= L_ALPHA | L_ALNUM | L_UW | L_EMAIL_LC | L_DOMAIN;
for (let c = 0x61; c <= 0x7a; c++) _LEX[c] |= L_ALPHA | L_ALNUM | L_UW | L_EMAIL_LC | L_DOMAIN;
_LEX[0x27] |= L_EMAIL_LC; // '
_LEX[0x5f] |= L_EMAIL_LC; // _
_LEX[0x2e] |= L_EMAIL_LC; // .
_LEX[0x2b] |= L_EMAIL_LC; // +
_LEX[0x2d] |= L_EMAIL_LC | L_DOMAIN; // -

// Unicode word char ranges for email/domain (non-ASCII)
const UW_FLAT = new Int32Array([0x0030, 0x0039, 0x0041, 0x005a, 0x0061, 0x007a, 0x00c0, 0x00ff, 0x0400, 0x04ff]);
function inUW(c: number): boolean {
	for (let i = 0; i < UW_FLAT.length; i += 2) {
		if (c < UW_FLAT[i]) return false;
		if (c <= UW_FLAT[i + 1]) return true;
	}
	return false;
}

function isEmailLocalChar(c: number): boolean {
	return c < 128 ? (_LEX[c] & L_EMAIL_LC) !== 0 : inUW(c);
}
function isEmailDomainChar(c: number): boolean {
	return c < 128 ? (_LEX[c] & L_DOMAIN) !== 0 : inUW(c);
}
function isUWChar(c: number): boolean {
	return c < 128 ? (_LEX[c] & L_UW) !== 0 : inUW(c);
}
function isAlpha(c: number): boolean {
	return c < 128 && (_LEX[c] & L_ALPHA) !== 0;
}
function isDigit(c: number): boolean {
	return c >= 0x30 && c <= 0x39;
}
function isNonWS(c: number): boolean {
	return c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c && c !== 0x0b;
}

// =============================================================================
// MATCH HELPERS
// =============================================================================

function tryMatchEmail(input: string, pos: number, len: number): number {
	// Returns end position (exclusive) or -1
	let i = pos;
	if (i + 7 <= len && input.startsWith('mailto:', i)) i += 7;
	const localStart = i;
	while (i < len && isEmailLocalChar(input.charCodeAt(i))) i++;
	if (i === localStart || i >= len || input.charCodeAt(i) !== 0x40) return -1;
	i++; // @
	if (i >= len || !isEmailDomainChar(input.charCodeAt(i))) return -1;
	while (i < len && isEmailDomainChar(input.charCodeAt(i))) i++;
	if (i >= len || input.charCodeAt(i) !== 0x2e) return -1;
	let hadLabel = false;
	while (i < len && input.charCodeAt(i) === 0x2e) {
		i++;
		const ls = i;
		while (i < len && (isEmailDomainChar(input.charCodeAt(i)) || input.charCodeAt(i) === 0x2e)) i++;
		if (i > ls) hadLabel = true;
	}
	if (!hadLabel) return -1;
	if (!isUWChar(input.charCodeAt(i - 1))) return -1;
	// Verify '@' is present in the matched string
	const result = input.slice(pos, i);
	return result.includes('@') ? i : -1;
}

function hasUrlScheme(input: string, pos: number, len: number): boolean {
	// letter (letter|digit|+|-)* ://
	let i = pos;
	if (i >= len || !isAlpha(input.charCodeAt(i))) return false;
	i++;
	while (i < len) {
		const c = input.charCodeAt(i);
		if (isAlpha(c) || isDigit(c) || c === 0x2b || c === 0x2d) {
			i++;
			continue;
		}
		break;
	}
	return i + 2 < len && input.charCodeAt(i) === 0x3a && input.charCodeAt(i + 1) === 0x2f && input.charCodeAt(i + 2) === 0x2f;
}

function tryMatchUrl(input: string, pos: number, len: number): number {
	const hasScheme = hasUrlScheme(input, pos, len);
	const hasWww = !hasScheme && input.startsWith('www.', pos);
	if (!hasScheme && !hasWww) return -1;
	let i = pos;
	while (i < len && isNonWS(input.charCodeAt(i))) i++;
	return i > pos ? i : -1;
}

function tryMatchPhone(input: string, pos: number, len: number): number {
	if (input.charCodeAt(pos) !== 0x2b) return -1; // '+'
	let i = pos + 1;
	if (i >= len) return -1;
	if (input.charCodeAt(i) === 0x28) {
		// '('
		i++;
		if (i >= len || !isDigit(input.charCodeAt(i))) return -1;
		while (i < len && isDigit(input.charCodeAt(i))) i++;
		if (i >= len || input.charCodeAt(i) !== 0x29) return -1; // ')'
		i++;
		while (i < len && (isDigit(input.charCodeAt(i)) || input.charCodeAt(i) === 0x2d)) i++;
	} else {
		if (!isDigit(input.charCodeAt(i))) return -1;
		i++;
		while (i < len && (isDigit(input.charCodeAt(i)) || input.charCodeAt(i) === 0x2d)) i++;
	}
	const nextC = i < len ? input.charCodeAt(i) : -1;
	if (nextC === 0x2c || nextC === 0x2e || isDigit(nextC)) return -1;
	return i;
}

// =============================================================================
// HAND-WRITTEN LEXER
// =============================================================================

export class MessageLexer {
	static tokenize(input: string): LexerResult {
		const tokens: IToken[] = [];
		const errors: LexerError[] = [];
		let pos = 0;
		const len = input.length;

		while (pos < len) {
			const ch = input[pos];
			const cc = input.charCodeAt(pos);

			// ── Escape: \<special> ────────────────────────────────────────
			if (cc === 0x5c && pos + 1 < len && ESCAPE_SET.has(input[pos + 1])) {
				tokens.push(makeToken(Escape, input.slice(pos, pos + 2), pos));
				pos += 2;
				continue;
			}

			// ── LiteralBackslash ──────────────────────────────────────────
			if (cc === 0x5c) {
				tokens.push(makeToken(LiteralBackslash, '\\', pos));
				pos += 1;
				continue;
			}

			// ── DoubleNewLine ─────────────────────────────────────────────
			if (cc === 0x0a && pos + 1 < len && input.charCodeAt(pos + 1) === 0x0a) {
				tokens.push(makeToken(DoubleNewLine, '\n\n', pos));
				pos += 2;
				continue;
			}

			// ── NewLine ───────────────────────────────────────────────────
			if (cc === 0x0a) {
				tokens.push(makeToken(NewLine, '\n', pos));
				pos += 1;
				continue;
			}

			// ── CodeFence: ``` + rest of line ─────────────────────────────
			if (cc === 0x60 && input.startsWith('```', pos)) {
				const nlIdx = input.indexOf('\n', pos);
				const end = nlIdx === -1 ? len : nlIdx;
				tokens.push(makeToken(CodeFence, input.slice(pos, end), pos));
				pos = end;
				continue;
			}

			// ── Email (before Url — mailto: also matches Url) ─────────────
			{
				const end = tryMatchEmail(input, pos, len);
				if (end !== -1) {
					tokens.push(makeToken(Email, input.slice(pos, end), pos));
					pos = end;
					continue;
				}
			}

			// ── Url ───────────────────────────────────────────────────────
			{
				const end = tryMatchUrl(input, pos, len);
				if (end !== -1) {
					tokens.push(makeToken(Url, input.slice(pos, end), pos));
					pos = end;
					continue;
				}
			}

			// ── Phone ─────────────────────────────────────────────────────
			if (cc === 0x2b) {
				const end = tryMatchPhone(input, pos, len);
				if (end !== -1) {
					tokens.push(makeToken(Phone, input.slice(pos, end), pos));
					pos = end;
					continue;
				}
			}

			// ── Plain: greedy run of non-stop characters ──────────────────
			if (!PLAIN_STOP_SET.has(ch)) {
				let end = pos + 1;
				while (end < len && !PLAIN_STOP_SET.has(input[end])) end++;
				tokens.push(makeToken(Plain, input.slice(pos, end), pos));
				pos = end;
				continue;
			}

			// ── SpecialChar ───────────────────────────────────────────────
			if (SPECIAL_CHAR_SET.has(ch)) {
				tokens.push(makeToken(SpecialChar, ch, pos));
				pos += 1;
				continue;
			}

			// ── Fallback ──────────────────────────────────────────────────
			errors.push({ message: `Unexpected character '${ch}' at offset ${pos}`, offset: pos });
			tokens.push(makeToken(Plain, ch, pos));
			pos += 1;
		}

		return { tokens, errors };
	}
}
