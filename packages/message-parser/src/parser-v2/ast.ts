/**
 * AST Node Constructors — optimized
 *
 * Changes vs original:
 * 1. parseColor()       — pre-compiled regex; char-code hex parser replaces
 *                         parseInt(substring, 16) calls (avoids string alloc)
 * 2. emoticonToEmoji()  — Map replaces Record for O(1) lookup without
 *                         prototype-chain walk; built once at module load
 * 3. normalizeURL()     — pre-compiled protocol regex
 * 4. cleanEmojiShortcode() — pre-compiled colon-strip regex
 * 5. checkBigEmoji()    — early exits tightened
 * 6. mergePlainText()   — for-of replaced with indexed loop (minor, avoids
 *                         iterator allocation on hot path)
 */

import type { Root, Paragraph, Inlines, Blocks } from '../definitions';
import * as utils from '../utils';

export * from '../utils';

// ============================================================================
// PRE-COMPILED CONSTANTS
// ============================================================================

/** Strips `color:#` prefix from a color token image */
const COLOR_PREFIX_RE = /^color:#/;

/** Matches strings that already have a protocol */
const HAS_PROTOCOL_RE = /^[a-z]+:/i;

/** Strips surrounding colons from emoji shortcodes */
const COLON_STRIP_RE = /^:|:$/g;

// ============================================================================
// EMOTICON MAP — built once at module load
// ============================================================================

const EMOTICON_MAP: ReadonlyMap<string, string> = new Map([
	['<3', 'heart'],
	['</3', 'broken_heart'],
	[':D', 'smiley'],
	[':-D', 'smiley'],
	['=D', 'smiley'],
	['>:)', 'smiling_imp'],
	['>;)', 'smiling_imp'],
	['>:-)', 'smiling_imp'],
	['>=)', 'smiling_imp'],
	[':)', 'slight_smile'],
	[':-)', 'slight_smile'],
	['=]', 'slight_smile'],
	['=)', 'slight_smile'],
	[':]', 'slight_smile'],
	[';)', 'wink'],
	[';-)', 'wink'],
	[':P', 'stuck_out_tongue'],
	[':-P', 'stuck_out_tongue'],
	['=P', 'stuck_out_tongue'],
	[':(', 'disappointed'],
	[':-(', 'disappointed'],
	['=(', 'disappointed'],
	[':/', 'confused'],
	[':-/', 'confused'],
	['=\\', 'confused'],
	[':\\', 'confused'],
	[':O', 'open_mouth'],
	[':-O', 'open_mouth'],
	[':*', 'kissing_heart'],
	[':-*', 'kissing_heart'],
]);

// ============================================================================
// ROOT
// ============================================================================

export function root(children: Array<Paragraph | Blocks> | [any]): Root {
	if (children.length === 1 && children[0]?.type === 'BIG_EMOJI') {
		return children as Root;
	}
	return children as Root;
}

export function checkBigEmoji(paragraphs: Paragraph[]): Root {
	if (paragraphs.length !== 1) return paragraphs;

	const para = paragraphs[0];
	if (para.type !== 'PARAGRAPH') return paragraphs;

	const inlines = para.value;
	const len = inlines.length;
	if (len < 1 || len > 3) return paragraphs;

	for (let i = 0; i < len; i++) {
		if (inlines[i].type !== 'EMOJI') return paragraphs;
	}

	return [utils.bigEmoji(inlines as any)] as Root;
}

// ============================================================================
// INLINE HELPERS
// ============================================================================

export function mergePlainText(items: Inlines[]): Inlines[] {
	if (items.length === 0) return items;

	const result: Inlines[] = [];
	let currentPlain: string | null = null;

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (item.type === 'PLAIN_TEXT') {
			currentPlain = currentPlain === null ? item.value : currentPlain + item.value;
		} else {
			if (currentPlain !== null) {
				result.push(utils.plain(currentPlain));
				currentPlain = null;
			}
			result.push(item);
		}
	}

	if (currentPlain !== null) {
		result.push(utils.plain(currentPlain));
	}

	return result;
}

export function createParagraphs(content: Inlines[][]): Paragraph[] {
	return content.map((inlines) => {
		const merged = mergePlainText(inlines);
		return utils.paragraph(utils.reducePlainTexts(merged));
	});
}

// ============================================================================
// TEXT UTILITIES
// ============================================================================

export function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

export function extractText(image: string): string {
	return image || '';
}

// ============================================================================
// COLOR PARSING
// ============================================================================

/**
 * Parse a single hex digit char to its numeric value (0–15).
 * Avoids parseInt() and substring allocation.
 */
function hexVal(ch: string): number {
	const c = ch.charCodeAt(0);
	if (c >= 48 && c <= 57) return c - 48; // '0'–'9'
	if (c >= 65 && c <= 70) return c - 55; // 'A'–'F'
	if (c >= 97 && c <= 102) return c - 87; // 'a'–'f'
	return 0;
}

export function parseColor(colorStr: string): ReturnType<typeof utils.color> | null {
	const hex = colorStr.replace(COLOR_PREFIX_RE, '');

	if (hex.length === 3) {
		const r = (hexVal(hex[0]) << 4) | hexVal(hex[0]);
		const g = (hexVal(hex[1]) << 4) | hexVal(hex[1]);
		const b = (hexVal(hex[2]) << 4) | hexVal(hex[2]);
		return utils.color(r, g, b);
	}

	if (hex.length === 6) {
		const r = (hexVal(hex[0]) << 4) | hexVal(hex[1]);
		const g = (hexVal(hex[2]) << 4) | hexVal(hex[3]);
		const b = (hexVal(hex[4]) << 4) | hexVal(hex[5]);
		return utils.color(r, g, b);
	}

	if (hex.length === 8) {
		const r = (hexVal(hex[0]) << 4) | hexVal(hex[1]);
		const g = (hexVal(hex[2]) << 4) | hexVal(hex[3]);
		const b = (hexVal(hex[4]) << 4) | hexVal(hex[5]);
		const a = (hexVal(hex[6]) << 4) | hexVal(hex[7]);
		return utils.color(r, g, b, a);
	}

	return null;
}

// ============================================================================
// EMOJI / EMOTICON
// ============================================================================

export function cleanEmojiShortcode(shortcode: string): string {
	return shortcode.replace(COLON_STRIP_RE, '');
}

export function emoticonToEmoji(emoticon: string): ReturnType<typeof utils.emoticon> | null {
	const shortCode = EMOTICON_MAP.get(emoticon);
	return shortCode ? utils.emoticon(emoticon, shortCode) : null;
}

// ============================================================================
// TIMESTAMP / LINK UTILITIES
// ============================================================================

export function createTimestamp(value: string, format?: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R'): ReturnType<typeof utils.timestamp> {
	return utils.timestamp(value, format);
}

export function extractLinkLabel(text: string): string {
	return text.trim();
}

export function normalizeURL(url: string): string {
	if (url.startsWith('//')) return url;
	if (!HAS_PROTOCOL_RE.test(url)) return `//${url}`;
	return url;
}
