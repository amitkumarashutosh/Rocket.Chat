// =============================================================================
// PATTERNS
// Single source of truth for all character-matching utilities.
// Zero regex. All matching via charCode comparisons, Uint8Array lookup tables
// for O(1) ASCII checks, flat Int32Array ranges for Unicode, and a single-pass
// combined plain-text scanner replacing 4 separate passes.
// =============================================================================

// =============================================================================
// FAST ASCII LOOKUP TABLES  (Uint8Array = 1 byte/slot, CPU cache-friendly)
// =============================================================================

const _ASCII = new Uint8Array(128);
const F_WORD = 1; // [a-zA-Z0-9]
const F_ALPHA = 2; // [a-zA-Z]
const F_WS = 8; // whitespace
const F_HEX = 16; // [0-9a-fA-F]
const F_WORD_DOT = 32; // [a-zA-Z0-9.]
const F_GENERIC_W = 64; // [a-zA-Z0-9_]
const F_EMAIL_LOCAL = 128; // [a-zA-Z0-9'_.+-]

for (let c = 0x30; c <= 0x39; c++) _ASCII[c] |= F_WORD | F_HEX | F_WORD_DOT | F_GENERIC_W | F_EMAIL_LOCAL;
for (let c = 0x41; c <= 0x5a; c++) _ASCII[c] |= F_WORD | F_ALPHA | F_WORD_DOT | F_GENERIC_W | F_EMAIL_LOCAL;
for (let c = 0x61; c <= 0x7a; c++) _ASCII[c] |= F_WORD | F_ALPHA | F_WORD_DOT | F_GENERIC_W | F_EMAIL_LOCAL;
for (let c = 0x41; c <= 0x46; c++) _ASCII[c] |= F_HEX;
for (let c = 0x61; c <= 0x66; c++) _ASCII[c] |= F_HEX;
_ASCII[0x5f] |= F_GENERIC_W | F_EMAIL_LOCAL; // _
_ASCII[0x27] |= F_EMAIL_LOCAL; // '
_ASCII[0x2e] |= F_EMAIL_LOCAL | F_WORD_DOT; // .
_ASCII[0x2b] |= F_EMAIL_LOCAL; // +
_ASCII[0x2d] |= F_EMAIL_LOCAL; // -
_ASCII[0x20] |= F_WS;
_ASCII[0x09] |= F_WS;
_ASCII[0x0a] |= F_WS;
_ASCII[0x0d] |= F_WS;
_ASCII[0x0c] |= F_WS;
_ASCII[0x0b] |= F_WS;

// =============================================================================
// UNICODE RANGE FLAT ARRAYS  — sorted [lo,hi,lo,hi,...] for early-exit scan
// =============================================================================

const UW_FLAT = new Int32Array([0x0030, 0x0039, 0x0041, 0x005a, 0x0061, 0x007a, 0x00c0, 0x00ff, 0x0400, 0x04ff]);

const UM_FLAT = new Int32Array([
	0x0030, 0x0039, 0x0041, 0x005a, 0x0061, 0x007a, 0x00c0, 0x00ff, 0x0400, 0x04ff, 0x0900, 0x097f, 0x0e00, 0x0e7f, 0x3040, 0x309f, 0x30a0,
	0x30ff, 0x4e00, 0x9fff,
]);

function inFlatRanges(cp: number, flat: Int32Array): boolean {
	for (let i = 0; i < flat.length; i += 2) {
		if (cp < flat[i]) return false;
		if (cp <= flat[i + 1]) return true;
	}
	return false;
}

// =============================================================================
// CHARACTER CLASS HELPERS
// =============================================================================

export function isWordChar(ch: string | undefined): boolean {
	if (!ch) return false;
	const c = ch.charCodeAt(0);
	return c < 128 ? (_ASCII[c] & F_WORD) !== 0 : inFlatRanges(c, UW_FLAT);
}

export function isWordCharWithDot(ch: string | undefined): boolean {
	if (!ch) return false;
	const c = ch.charCodeAt(0);
	return c < 128 ? (_ASCII[c] & F_WORD_DOT) !== 0 : false;
}

export function isWhitespace(ch: string | undefined): boolean {
	if (!ch) return false;
	const c = ch.charCodeAt(0);
	return c < 128 && (_ASCII[c] & F_WS) !== 0;
}

export function isWhitespaceOrColon(ch: string | undefined): boolean {
	if (!ch) return false;
	if (ch.charCodeAt(0) === 0x3a) return true;
	const c = ch.charCodeAt(0);
	return c < 128 && (_ASCII[c] & F_WS) !== 0;
}

export function isNonSpaceStart(s: string): boolean {
	if (s.length === 0) return false;
	const c = s.charCodeAt(0);
	return !(c < 128 && (_ASCII[c] & F_WS) !== 0);
}

export function isAlpha(ch: string | undefined): boolean {
	if (!ch) return false;
	const c = ch.charCodeAt(0);
	return c < 128 && (_ASCII[c] & F_ALPHA) !== 0;
}

export function isDigit(ch: string | undefined): boolean {
	if (!ch) return false;
	const c = ch.charCodeAt(0);
	return c >= 0x30 && c <= 0x39;
}

export function isGenericWordChar(ch: string | undefined): boolean {
	if (!ch) return false;
	const c = ch.charCodeAt(0);
	return c < 128 && (_ASCII[c] & F_GENERIC_W) !== 0;
}

export function isHexChar(ch: string | undefined): boolean {
	if (!ch) return false;
	const c = ch.charCodeAt(0);
	return c < 128 && (_ASCII[c] & F_HEX) !== 0;
}

export function isUnicodeWord(ch: string): boolean {
	const c = ch.charCodeAt(0);
	return c < 128 ? (_ASCII[c] & F_WORD) !== 0 : inFlatRanges(c, UW_FLAT);
}

export function isUnicodeMentionChar(ch: string): boolean {
	const c = ch.charCodeAt(0);
	if (c < 128) return (_ASCII[c] & F_WORD) !== 0 || c === 0x2e || c === 0x40 || c === 0x3a || c === 0x2d;
	return inFlatRanges(c, UM_FLAT);
}

export function stripNonDigits(s: string): string {
	let result = '';
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c >= 0x30 && c <= 0x39) result += s[i];
	}
	return result;
}

// =============================================================================
// URL TRAILING CHARS
// =============================================================================

export const URL_TRAILING_CHARS: string = '.!,';

// =============================================================================
// PHONE URL CHECK
// =============================================================================

export function isPhoneUrl(s: string): boolean {
	if (!s || s.charCodeAt(0) !== 0x2b) return false;
	let i = 1;
	if (i >= s.length) return false;
	if (s.charCodeAt(i) === 0x28) {
		i++;
		if (i >= s.length || s.charCodeAt(i) < 0x30 || s.charCodeAt(i) > 0x39) return false;
		while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++;
		if (i >= s.length || s.charCodeAt(i) !== 0x29) return false;
		i++;
		while (i < s.length && ((s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) || s.charCodeAt(i) === 0x2d)) i++;
	} else {
		if (s.charCodeAt(i) < 0x30 || s.charCodeAt(i) > 0x39) return false;
		i++;
		while (i < s.length && ((s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) || s.charCodeAt(i) === 0x2d)) i++;
	}
	return i === s.length;
}

// =============================================================================
// ORDERED LIST CHECK
// =============================================================================

export function isOrderedListStart(s: string): boolean {
	let i = 0;
	if (!s || s.charCodeAt(0) < 0x30 || s.charCodeAt(0) > 0x39) return false;
	while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++;
	return i < s.length - 1 && s.charCodeAt(i) === 0x2e && s.charCodeAt(i + 1) === 0x20;
}

export function matchOrderedListItem(s: string): [number, string] | null {
	let i = 0;
	if (!s || s.charCodeAt(0) < 0x30 || s.charCodeAt(0) > 0x39) return null;
	while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++;
	if (i >= s.length || s.charCodeAt(i) !== 0x2e) return null;
	i++;
	if (i >= s.length || s.charCodeAt(i) !== 0x20) return null;
	i++;
	return [parseInt(s.slice(0, i - 2), 10), s.slice(i)];
}

// =============================================================================
// HEX COLOR CHECK
// =============================================================================

export function isValidHexString(s: string): boolean {
	if (!s) return false;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c >= 128 || (_ASCII[c] & F_HEX) === 0) return false;
	}
	return true;
}

// =============================================================================
// TIMESTAMP HELPERS
// =============================================================================

export const TIMESTAMP_SENTINEL_PREFIX: string = '\x00TS\x00';

export function encodeTimestamps(input: string): { encoded: string; map: string[] } {
	if (!input.includes('<t:')) return { encoded: input, map: [] };
	const map: string[] = [];
	let result = '';
	let i = 0;
	while (i < input.length) {
		const ltIdx = input.indexOf('<', i);
		if (ltIdx === -1) {
			result += input.slice(i);
			break;
		}
		result += input.slice(i, ltIdx);
		i = ltIdx;
		if (input.charCodeAt(i + 1) === 0x74 && input.charCodeAt(i + 2) === 0x3a) {
			const end = input.indexOf('>', i);
			if (end !== -1) {
				map.push(input.slice(i, end + 1));
				result += `${TIMESTAMP_SENTINEL_PREFIX}${map.length - 1}${TIMESTAMP_SENTINEL_PREFIX}`;
				i = end + 1;
				continue;
			}
		}
		result += input[i++];
	}
	return { encoded: result, map };
}

export function decodeSentinels(s: string, map: string[]): string {
	if (!s.includes(TIMESTAMP_SENTINEL_PREFIX)) return s;
	let result = '';
	let i = 0;
	const prefix = TIMESTAMP_SENTINEL_PREFIX;
	const pLen = prefix.length;
	while (i < s.length) {
		const pi = s.indexOf(prefix, i);
		if (pi === -1) {
			result += s.slice(i);
			break;
		}
		result += s.slice(i, pi);
		const start = pi + pLen;
		let j = start;
		while (j < s.length && s.charCodeAt(j) >= 0x30 && s.charCodeAt(j) <= 0x39) j++;
		if (j > start && s.startsWith(prefix, j)) {
			result += map[parseInt(s.slice(start, j), 10)] ?? '';
			i = j + pLen;
		} else {
			result += prefix;
			i = pi + pLen;
		}
	}
	return result;
}

export function findTimestampTag(s: string): [number, string] | null {
	const i = s.indexOf('<t:');
	if (i === -1) return null;
	const end = s.indexOf('>', i);
	return end !== -1 ? [i, s.slice(i, end + 1)] : null;
}

export function parseTimestampTagParts(raw: string): { value: string; format: string } | null {
	if (!raw.startsWith('<t:') || raw.charCodeAt(raw.length - 1) !== 0x3e) return null;
	const inner = raw.slice(3, -1);
	const lastColon = inner.lastIndexOf(':');
	if (lastColon !== -1) {
		const candidate = inner.slice(lastColon + 1);
		if (candidate.length === 1 && isAlpha(candidate)) {
			return { value: inner.slice(0, lastColon), format: candidate };
		}
	}
	return { value: inner, format: 't' };
}

export function isEpochString(s: string): boolean {
	if (!s) return false;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 0x30 || c > 0x39) return false;
	}
	return true;
}

export function parseRelativeTimestamp(s: string): [string, string, string, string] | null {
	let i = 0;
	const hStart = i;
	while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++;
	const hLen = i - hStart;
	if (hLen < 1 || hLen > 2) return null;
	const h = s.slice(hStart, i);
	if (i >= s.length || s.charCodeAt(i) !== 0x3a) return null;
	i++;
	const mStart = i;
	while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++;
	if (i - mStart !== 2) return null;
	const m = s.slice(mStart, i);
	let sec = '00';
	if (i < s.length && s.charCodeAt(i) === 0x3a) {
		i++;
		const sStart = i;
		while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++;
		if (i - sStart !== 2) return null;
		sec = s.slice(sStart, i);
	}
	if (i >= s.length) return null;
	const tzStart = i;
	const tzCh = s.charCodeAt(i);
	if (tzCh === 0x5a) {
		i++;
	} else if (tzCh === 0x2b || tzCh === 0x2d) {
		i++;
		const tzHStart = i;
		while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++;
		if (i - tzHStart !== 2) return null;
		if (i >= s.length || s.charCodeAt(i) !== 0x3a) return null;
		i++;
		const tzMStart = i;
		while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++;
		if (i - tzMStart !== 2) return null;
	} else {
		return null;
	}
	if (i !== s.length) return null;
	return [h, m, sec, s.slice(tzStart)];
}

// =============================================================================
// MENTION HELPERS
// =============================================================================

export function findMentionUser(s: string, startIndex: number = 0): [number, string] | null {
	let i = s.indexOf('@', startIndex);
	while (i !== -1) {
		const next = i + 1;
		if (next < s.length && isUnicodeMentionChar(s[next])) {
			let j = next + 1;
			while (j < s.length) {
				const c = s.charCodeAt(j);
				if (c < 128) {
					if ((_ASCII[c] & F_GENERIC_W) !== 0 || c === 0x2e || c === 0x40 || c === 0x3a || c === 0x2d) {
						j++;
						continue;
					}
					break;
				}
				if (inFlatRanges(c, UM_FLAT)) {
					j++;
					continue;
				}
				break;
			}
			return [i, s.slice(i, j)];
		}
		i = s.indexOf('@', i + 1);
	}
	return null;
}

export function stripTrailingUnderscores(s: string): [string, string] {
	let end = s.length;
	while (end > 0 && s.charCodeAt(end - 1) === 0x5f) end--;
	return [s.slice(0, end), s.slice(end)];
}

export function matchAtDomain(s: string): string | null {
	if (!s || s.charCodeAt(0) !== 0x40) return null;
	let i = 1;
	while (i < s.length) {
		const c = s.charCodeAt(i);
		if (c < 128 && (_ASCII[c] & F_WS) !== 0) break;
		if (c === 0x0a || c === 0x0d) break;
		i++;
	}
	return i > 1 ? s.slice(0, i) : null;
}

// =============================================================================
// EMOJI CODE HELPERS
// =============================================================================

const EMOJI_NAME_CHAR = new Uint8Array(128);
for (let c = 0x30; c <= 0x39; c++) EMOJI_NAME_CHAR[c] = 1;
for (let c = 0x41; c <= 0x5a; c++) EMOJI_NAME_CHAR[c] = 1;
for (let c = 0x61; c <= 0x7a; c++) EMOJI_NAME_CHAR[c] = 1;
EMOJI_NAME_CHAR[0x5f] = 1;
EMOJI_NAME_CHAR[0x2b] = 1;
EMOJI_NAME_CHAR[0x2d] = 1;

export function findEmojiCode(s: string, startIndex: number, prevChar: string): [number, string] | null {
	let i = s.indexOf(':', startIndex);
	while (i !== -1) {
		const before = i > 0 ? s[i - 1] : prevChar;
		if (i > startIndex && !isWhitespaceOrColon(before)) {
			i = s.indexOf(':', i + 1);
			continue;
		}
		let j = i + 1;
		while (j < s.length) {
			const c = s.charCodeAt(j);
			if (c < 128 && EMOJI_NAME_CHAR[c]) {
				j++;
				continue;
			}
			break;
		}
		if (j > i + 1 && j < s.length && s.charCodeAt(j) === 0x3a) {
			const after = s[j + 1];
			if (after === undefined || isWhitespaceOrColon(after)) {
				return [i, s.slice(i, j + 1)];
			}
		}
		i = s.indexOf(':', i + 1);
	}
	return null;
}

// =============================================================================
// UNICODE EMOJI DETECTION
// Flat sorted Int32Array for fast range check with early exit
// =============================================================================

const EMOJI_CP_FLAT = new Int32Array([
	0x00a9, 0x00a9, 0x00ae, 0x00ae, 0x203c, 0x203c, 0x2049, 0x2049, 0x231a, 0x231b, 0x23e9, 0x23f3, 0x23f8, 0x23fa, 0x25aa, 0x25ab, 0x25b6,
	0x25b6, 0x25c0, 0x25c0, 0x25fb, 0x25fe, 0x2600, 0x27bf, 0x2934, 0x2935, 0x2b05, 0x2b07, 0x2b1b, 0x2b1c, 0x2b50, 0x2b50, 0x2b55, 0x2b55,
	0x3030, 0x3030, 0x303d, 0x303d, 0x3297, 0x3297, 0x3299, 0x3299, 0x1f004, 0x1f004, 0x1f0cf, 0x1f0cf, 0x1f170, 0x1f171, 0x1f17e, 0x1f17f,
	0x1f18e, 0x1f18e, 0x1f191, 0x1f19a, 0x1f1e0, 0x1f1ff, 0x1f201, 0x1f202, 0x1f21a, 0x1f21a, 0x1f22f, 0x1f22f, 0x1f232, 0x1f23a, 0x1f250,
	0x1f251, 0x1f300, 0x1f6ff, 0x1f700, 0x1f77f, 0x1f780, 0x1f7ff, 0x1f800, 0x1f8ff, 0x1f900, 0x1f9ff, 0x1fa00, 0x1fa6f, 0x1fa70, 0x1faff,
]);

const VARIATION_SELECTOR_16 = 0xfe0f;
const ZERO_WIDTH_JOINER = 0x200d;
const COMBINING_ENCLOSING_KEYCAP = 0x20e3;

function isEmojiCodePoint(cp: number): boolean {
	if (cp < 0x00a9) return false;
	for (let i = 0; i < EMOJI_CP_FLAT.length; i += 2) {
		if (cp < EMOJI_CP_FLAT[i]) return false;
		if (cp <= EMOJI_CP_FLAT[i + 1]) return true;
	}
	return false;
}

export function findUnicodeEmoji(s: string, startIndex: number = 0): [number, string] | null {
	let i = startIndex;
	while (i < s.length) {
		const c = s.charCodeAt(i);
		if (c < 0xa9) {
			i++;
			continue;
		} // fast ASCII skip
		const cp = s.codePointAt(i)!;
		const cpLen = cp > 0xffff ? 2 : 1;
		if (isEmojiCodePoint(cp)) {
			let end = i + cpLen;
			if (end < s.length && s.codePointAt(end) === VARIATION_SELECTOR_16) end++;
			if (end < s.length && s.codePointAt(end) === COMBINING_ENCLOSING_KEYCAP) end++;
			while (end < s.length && s.codePointAt(end) === ZERO_WIDTH_JOINER) {
				end++;
				if (end >= s.length) break;
				const nextCp = s.codePointAt(end)!;
				if (!isEmojiCodePoint(nextCp)) break;
				end += nextCp > 0xffff ? 2 : 1;
				if (end < s.length && s.codePointAt(end) === VARIATION_SELECTOR_16) end++;
			}
			return [i, s.slice(i, end)];
		}
		i += cpLen;
	}
	return null;
}

// =============================================================================
// EMAIL HELPERS
// =============================================================================

function isEmailLocalCharCode(c: number): boolean {
	return c < 128 && (_ASCII[c] & F_EMAIL_LOCAL) !== 0;
}

function isEmailDomainCharCode(c: number): boolean {
	if (c < 128) return (_ASCII[c] & F_WORD) !== 0 || c === 0x2d;
	return inFlatRanges(c, UW_FLAT);
}

export function tryMatchEmailAt(s: string, pos: number): string | null {
	let i = pos;
	if (s.startsWith('mailto:', i)) i += 7;
	const localStart = i;
	while (i < s.length && isEmailLocalCharCode(s.charCodeAt(i))) i++;
	if (i === localStart || i >= s.length || s.charCodeAt(i) !== 0x40) return null;
	i++;
	const domainStart = i;
	if (i >= s.length || !isEmailDomainCharCode(s.charCodeAt(i))) return null;
	while (i < s.length && isEmailDomainCharCode(s.charCodeAt(i))) i++;
	if (i >= s.length || s.charCodeAt(i) !== 0x2e) return null;
	let lastWasLabel = false;
	while (i < s.length && s.charCodeAt(i) === 0x2e) {
		i++;
		const labelStart = i;
		while (i < s.length && (isEmailDomainCharCode(s.charCodeAt(i)) || s.charCodeAt(i) === 0x2e)) i++;
		if (i > labelStart) lastWasLabel = true;
	}
	if (!lastWasLabel && i <= domainStart + 1) return null;
	if (!isUnicodeWord(s[i - 1])) return null;
	const result = s.slice(pos, i);
	return result.includes('@') ? result : null;
}

export function findEmailInText(s: string, startIndex: number = 0): [number, string] | null {
	// Fast pre-check: no '@' = no email
	if (!s.includes('@')) return null;
	let i = s.indexOf('@', startIndex + 1);
	while (i !== -1) {
		let localStart = i - 1;
		while (localStart > startIndex && isEmailLocalCharCode(s.charCodeAt(localStart - 1))) localStart--;
		if (localStart >= 7 && s.slice(localStart - 7, localStart) === 'mailto:') localStart -= 7;
		const match = tryMatchEmailAt(s, localStart);
		if (match && localStart + match.indexOf('@') === i) return [localStart, match];
		i = s.indexOf('@', i + 1);
	}
	return null;
}

// =============================================================================
// SINGLE-PASS PLAIN TEXT SCANNER
// Finds the earliest of: timestamp, mention, emoji, unicode emoji, emoticon
// Returns one ScanHit at the earliest position, or null if none found.
// Caller loops calling this after consuming each hit.
// =============================================================================

export type ScanHit =
	| { type: 'mention'; idx: number; text: string }
	| { type: 'emoji'; idx: number; text: string }
	| { type: 'unicode'; idx: number; text: string }
	| { type: 'emoticon'; idx: number; key: string }
	| { type: 'timestamp'; idx: number; text: string };

export function scanPlainText(
	s: string,
	prevChar: string,
	noTimestamp: boolean,
	emoticons: boolean,
	emoticonList: string[],
): ScanHit | null {
	let best: ScanHit | null = null;
	let bestIdx = Infinity;

	// ── Timestamp — only if '<t:' exists ─────────────────────────────────────
	if (!noTimestamp && s.includes('<t:')) {
		const ts = findTimestampTag(s);
		if (ts && ts[0] < bestIdx) {
			best = { type: 'timestamp', idx: ts[0], text: ts[1] };
			bestIdx = ts[0];
		}
	}

	// ── @mention — only if '@' exists ────────────────────────────────────────
	if (s.includes('@')) {
		const mr = findMentionUser(s, 0);
		if (mr && mr[0] < bestIdx) {
			const cb = mr[0] > 0 ? s[mr[0] - 1] : prevChar;
			if (!isWordChar(cb)) {
				best = { type: 'mention', idx: mr[0], text: mr[1] };
				bestIdx = mr[0];
			}
		}
	}

	// ── :emoji: — only if ':' exists ─────────────────────────────────────────
	if (s.includes(':')) {
		const ef = findEmojiCode(s, 0, prevChar);
		if (ef && ef[0] < bestIdx) {
			best = { type: 'emoji', idx: ef[0], text: ef[1] };
			bestIdx = ef[0];
		}
	}

	// ── Unicode emoji — only if high chars exist ──────────────────────────────
	let hasHigh = false;
	for (let i = 0; i < s.length; i++) {
		if (s.charCodeAt(i) >= 0xa9) {
			hasHigh = true;
			break;
		}
	}
	if (hasHigh) {
		const uf = findUnicodeEmoji(s, 0);
		if (uf && uf[0] < bestIdx) {
			best = { type: 'unicode', idx: uf[0], text: uf[1] };
			bestIdx = uf[0];
		}
	}

	// ── Emoticons ─────────────────────────────────────────────────────────────
	if (emoticons) {
		const len = emoticonList.length;
		for (let i = 0; i < len; i++) {
			const key = emoticonList[i];
			const idx = s.indexOf(key);
			if (idx === -1 || idx >= bestIdx) continue;
			const before = idx > 0 ? s[idx - 1] : prevChar;
			const after = s[idx + key.length];
			const validBefore = idx === 0 ? prevChar === '' || isWhitespace(prevChar) : isWhitespace(before);
			if (!validBefore) continue;
			if (after === undefined || isWhitespace(after)) {
				best = { type: 'emoticon', idx, key };
				bestIdx = idx;
			}
		}
	}

	return best;
}

// =============================================================================
// EMOTICONS
// =============================================================================

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

export const EMOTICON_LIST = Object.keys(EMOTICONS).sort((a, b) => b.length - a.length);
