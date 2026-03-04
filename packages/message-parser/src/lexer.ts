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

// ─── Singleton token type objects ─────────────────────────────────────────────
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
// CHARACTER SETS
// =============================================================================

// Characters that stop a Plain token
const PLAIN_STOP_SET = new Set(['*', '_', '~', '`', '#', '\\', '[', ']', '\n', '+']);

// Characters emitted as a single SpecialChar token
const SPECIAL_CHAR_SET = new Set(['*', '_', '~', '`', '#', '[', ']', '+']);

// =============================================================================
// MATCH HELPERS
// =============================================================================

const UW = 'a-zA-Z0-9\u00C0-\u00FF\u0400-\u04FF';
const EMAIL_LOCAL_RE = new RegExp(`^(?:mailto:)?[${UW}'_.+-]+`);
const EMAIL_DOMAIN_RE = new RegExp(`^@[${UW}-]+(?:\\.[${UW}.-]+)*[${UW}]`);

function tryMatchEmail(input: string, pos: number): string | null {
	const slice = input.slice(pos);
	const localMatch = EMAIL_LOCAL_RE.exec(slice);
	if (!localMatch) return null;
	const localEnd = localMatch[0].length;
	if (input[pos + localEnd] !== '@') return null;
	const domainMatch = EMAIL_DOMAIN_RE.exec(slice.slice(localEnd));
	if (!domainMatch) return null;
	return localMatch[0] + domainMatch[0];
}

const URL_SCHEME_RE = /^(?:[a-zA-Z][a-zA-Z0-9+\-]*):\/\//;
const URL_WWW_RE = /^www\./;
const URL_NONWS_RE = /^\S+/;

function tryMatchUrl(input: string, pos: number): string | null {
	const slice = input.slice(pos);
	const hasScheme = URL_SCHEME_RE.test(slice);
	const hasWww = !hasScheme && URL_WWW_RE.test(slice);
	if (!hasScheme && !hasWww) return null;
	const m = URL_NONWS_RE.exec(slice);
	return m ? m[0] : null;
}

const PHONE_BODY_RE = /^(\(\d+\)[\d-]*|\d[\d-]*)/;
const PHONE_TRAIL_RE = /^[.,\d]/;

function tryMatchPhone(input: string, pos: number): string | null {
	if (input[pos] !== '+') return null;
	const m = PHONE_BODY_RE.exec(input.slice(pos + 1));
	if (!m) return null;
	const full = '+' + m[0];
	const nextCh = input[pos + full.length];
	if (nextCh !== undefined && PHONE_TRAIL_RE.test(nextCh)) return null;
	return full;
}

// =============================================================================
// HAND-WRITTEN LEXER
// Token priority order (mirrors original Chevrotain allTokens order):
//   Escape, LiteralBackslash, DoubleNewLine, NewLine, CodeFence,
//   Email, Url, Phone, Plain, SpecialChar
// =============================================================================

export class MessageLexer {
	static tokenize(input: string): LexerResult {
		const tokens: IToken[] = [];
		const errors: LexerError[] = [];
		let pos = 0;
		const len = input.length;

		while (pos < len) {
			const ch = input[pos];

			// ── Escape: \<special> ─────────────────────────────────────────
			if (ch === '\\' && pos + 1 < len && /[*_~`#.]/.test(input[pos + 1])) {
				tokens.push(makeToken(Escape, input.slice(pos, pos + 2), pos));
				pos += 2;
				continue;
			}

			// ── LiteralBackslash ───────────────────────────────────────────
			if (ch === '\\') {
				tokens.push(makeToken(LiteralBackslash, '\\', pos));
				pos += 1;
				continue;
			}

			// ── DoubleNewLine ──────────────────────────────────────────────
			if (ch === '\n' && pos + 1 < len && input[pos + 1] === '\n') {
				tokens.push(makeToken(DoubleNewLine, '\n\n', pos));
				pos += 2;
				continue;
			}

			// ── NewLine ────────────────────────────────────────────────────
			if (ch === '\n') {
				tokens.push(makeToken(NewLine, '\n', pos));
				pos += 1;
				continue;
			}

			// ── CodeFence: ``` + rest of line ──────────────────────────────
			if (ch === '`' && input.startsWith('```', pos)) {
				const nlIdx = input.indexOf('\n', pos);
				const end = nlIdx === -1 ? len : nlIdx;
				tokens.push(makeToken(CodeFence, input.slice(pos, end), pos));
				pos = end;
				continue;
			}

			// ── Email (before Url — mailto: also matches Url) ─────────────
			{
				const m = tryMatchEmail(input, pos);
				if (m !== null) {
					tokens.push(makeToken(Email, m, pos));
					pos += m.length;
					continue;
				}
			}

			// ── Url ────────────────────────────────────────────────────────
			{
				const m = tryMatchUrl(input, pos);
				if (m !== null) {
					tokens.push(makeToken(Url, m, pos));
					pos += m.length;
					continue;
				}
			}

			// ── Phone ──────────────────────────────────────────────────────
			if (ch === '+') {
				const m = tryMatchPhone(input, pos);
				if (m !== null) {
					tokens.push(makeToken(Phone, m, pos));
					pos += m.length;
					continue;
				}
			}

			// ── Plain: greedy run of non-stop characters ───────────────────
			if (!PLAIN_STOP_SET.has(ch)) {
				let end = pos + 1;
				while (end < len && !PLAIN_STOP_SET.has(input[end])) end++;
				tokens.push(makeToken(Plain, input.slice(pos, end), pos));
				pos = end;
				continue;
			}

			// ── SpecialChar: single special character ──────────────────────
			if (SPECIAL_CHAR_SET.has(ch)) {
				tokens.push(makeToken(SpecialChar, ch, pos));
				pos += 1;
				continue;
			}

			// ── Fallback: unexpected character, emit as Plain ──────────────
			errors.push({ message: `Unexpected character '${ch}' at offset ${pos}`, offset: pos });
			tokens.push(makeToken(Plain, ch, pos));
			pos += 1;
		}

		return { tokens, errors };
	}
}
