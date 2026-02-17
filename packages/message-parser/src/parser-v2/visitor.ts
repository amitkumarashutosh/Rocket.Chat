/**
 * CST to AST Visitor — optimized
 *
 * Performance notes:
 * - nodeLocationTracking is 'none' in the parser, so block.location is
 *   always undefined. The document() visitor uses the natural array order
 *   from the parser (which is already source order) instead of sorting by
 *   offset. This is safe because Chevrotain always appends rule results in
 *   the order they were parsed.
 * - collectOrdered() still sorts by token.startOffset when multiple token
 *   types are present — individual tokens always carry startOffset.
 * - inlineContent() uses direct property checks instead of a string-key loop.
 */

import { messageParser } from './parser';
import * as ast from './ast';
import type { Root, Paragraph, Inlines, Blocks, Markup } from '../definitions';

const BaseVisitor = messageParser.getBaseCstVisitorConstructor();

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Collect tokens from multiple CST context keys, sort by startOffset, and
 * join their images.
 *
 * Fast path: when only one key has tokens, skip the sort entirely.
 */
function collectOrdered(ctx: Record<string, any[] | undefined>, keys: string[]): string {
	let firstKey: string | null = null;
	let multipleKeys = false;

	for (const key of keys) {
		if (ctx[key] && ctx[key]!.length > 0) {
			if (firstKey === null) {
				firstKey = key;
			} else {
				multipleKeys = true;
				break;
			}
		}
	}

	if (firstKey === null) return '';

	if (!multipleKeys) {
		const arr = ctx[firstKey]!;
		if (arr.length === 1) return arr[0].image as string;
		let s = '';
		for (let i = 0; i < arr.length; i++) s += arr[i].image;
		return s;
	}

	const tokens: Array<{ offset: number; image: string }> = [];
	for (const key of keys) {
		const arr = ctx[key];
		if (!arr) continue;
		for (let i = 0; i < arr.length; i++) {
			tokens.push({ offset: arr[i].startOffset, image: arr[i].image });
		}
	}

	tokens.sort((a, b) => a.offset - b.offset);
	let s = '';
	for (let i = 0; i < tokens.length; i++) s += tokens[i].image;
	return s;
}

// ============================================================================
// VISITOR
// ============================================================================

export class MessageVisitor extends BaseVisitor {
	constructor() {
		super();
		this.validateVisitor();
	}

	// ========================================================================
	// ROOT
	// ========================================================================

	/**
	 * With nodeLocationTracking: 'none', rule node .location is always
	 * undefined. We rely on the parser's natural push order instead —
	 * Chevrotain always appends blocks in source order, so no sort is needed.
	 *
	 * The only exception is top-level Newline tokens (lineBreak nodes), which
	 * are emitted by the parser inline with blocks. Because the parser pushes
	 * them into the same `blocks` array in source order via the MANY() loop,
	 * they too arrive in the correct order — no sort needed here either.
	 *
	 * However Chevrotain's CST separates rule results (ctx.paragraph[],
	 * ctx.codeBlock[], etc.) from token results (ctx.Newline[]) into different
	 * arrays. We must interleave them by token offset to restore source order.
	 */
	document(ctx: any): Root {
		type Entry = { offset: number; node: Paragraph | Blocks };
		const entries: Entry[] = [];

		const blockTypes = ['codeBlock', 'heading', 'quote', 'taskList', 'orderedList', 'unorderedList', 'katexBlock', 'paragraph'];

		for (let t = 0; t < blockTypes.length; t++) {
			const arr = ctx[blockTypes[t]];
			if (!arr) continue;
			for (let i = 0; i < arr.length; i++) {
				// With nodeLocationTracking:'none', location is undefined.
				// Use the first token of the rule's children as the offset.
				const block = arr[i];
				const offset = this._firstTokenOffset(block);
				const result = this.visit(block);
				if (result) entries.push({ offset, node: result });
			}
		}

		if (ctx.Newline && ctx.Newline.length > 0) {
			for (let i = 0; i < ctx.Newline.length; i++) {
				entries.push({ offset: ctx.Newline[i].startOffset, node: ast.lineBreak() });
			}
		}

		// Sort by first-token offset to interleave blocks and lineBreaks correctly.
		entries.sort((a, b) => a.offset - b.offset);

		const blocks: Array<Paragraph | Blocks> = new Array(entries.length);
		for (let i = 0; i < entries.length; i++) blocks[i] = entries[i].node;

		return ast.checkBigEmoji(blocks as Paragraph[]);
	}

	/**
	 * Extract the startOffset of the first token inside a CST rule node.
	 * Works regardless of nodeLocationTracking setting because individual
	 * tokens always carry startOffset.
	 */
	private _firstTokenOffset(cstNode: any): number {
		if (!cstNode || !cstNode.children) return 0;
		const children = cstNode.children;
		for (const key of Object.keys(children)) {
			const arr = children[key];
			if (arr && arr.length > 0) {
				const first = arr[0];
				// Token nodes have startOffset directly; rule nodes recurse
				if (typeof first.startOffset === 'number') return first.startOffset;
				const nested = this._firstTokenOffset(first);
				if (nested > 0 || nested === 0) return nested;
			}
		}
		return 0;
	}

	// ========================================================================
	// BLOCK ELEMENTS
	// ========================================================================

	paragraph(ctx: any): Paragraph {
		const inlines: Inlines[] = [];

		if (ctx.inlineContent) {
			const arr: any[] = ctx.inlineContent;
			for (let i = 0; i < arr.length; i++) {
				const result = this.visit(arr[i]);
				if (result) inlines.push(result);
			}
		}

		if (ctx.WhiteSpace) {
			const arr: any[] = ctx.WhiteSpace;
			for (let i = 0; i < arr.length; i++) inlines.push(ast.plain(arr[i].image));
		}

		return ast.paragraph(ast.reducePlainTexts(inlines));
	}

	codeBlock(ctx: any): Blocks {
		const language = ctx.CodeLanguage ? ctx.CodeLanguage[0].image.trim() : undefined;
		const raw = collectOrdered(ctx, ['TextContent', 'WhiteSpace', 'Newline']);
		const codeLines = raw.split('\n').map((line) => ast.codeLine(ast.plain(line)));
		return ast.code(codeLines, language || 'none');
	}

	heading(ctx: any): Blocks {
		const level = Math.min(ctx.Hash.length, 4) as 1 | 2 | 3 | 4;
		const text = collectOrdered(ctx, [
			'TextContent',
			'WhiteSpace',
			'Dot',
			'At',
			'Colon',
			'Dash',
			'Plus',
			'Slash',
			'Backslash',
			'LessThan',
			'GreaterThan',
			'Pipe',
			'LeftParen',
			'RightParen',
			'LinkStart',
			'RightBracket',
		]).trim();
		return ast.heading([ast.plain(text)], level);
	}

	quote(ctx: any): Blocks {
		const paragraphs: Paragraph[] = [];
		if (ctx.QuoteMarker) {
			const markers: any[] = ctx.QuoteMarker;
			for (let index = 0; index < markers.length; index++) {
				const inlines: Inlines[] = [];
				if (ctx.inlineContent && ctx.inlineContent[index]) {
					const result = this.visit(ctx.inlineContent[index]);
					if (result) inlines.push(result);
				}
				if (inlines.length > 0) {
					paragraphs.push(ast.paragraph(ast.reducePlainTexts(inlines)));
				}
			}
		}
		return ast.quote(paragraphs);
	}

	taskList(ctx: any): Blocks {
		const tasks: any[] = [];
		if (ctx.taskItem) {
			const arr: any[] = ctx.taskItem;
			for (let i = 0; i < arr.length; i++) {
				const result = this.visit(arr[i]);
				if (result) tasks.push(result);
			}
		}
		return ast.tasks(tasks);
	}

	taskItem(ctx: any): any {
		const checked = !!ctx.TaskChecked;
		const inlines: Inlines[] = [];
		if (ctx.inlineContent) {
			const arr: any[] = ctx.inlineContent;
			for (let i = 0; i < arr.length; i++) {
				const result = this.visit(arr[i]);
				if (result) inlines.push(result);
			}
		}
		return ast.task(ast.reducePlainTexts(inlines), checked);
	}

	orderedList(ctx: any): Blocks {
		const items: any[] = [];
		if (ctx.orderedListItem) {
			const arr: any[] = ctx.orderedListItem;
			for (let i = 0; i < arr.length; i++) {
				const result = this.visit(arr[i]);
				if (result) items.push(ast.listItem(result, i + 1));
			}
		}
		return ast.orderedList(items);
	}

	orderedListItem(ctx: any): Inlines[] {
		const inlines: Inlines[] = [];
		if (ctx.inlineContent) {
			const arr: any[] = ctx.inlineContent;
			for (let i = 0; i < arr.length; i++) {
				const result = this.visit(arr[i]);
				if (result) inlines.push(result);
			}
		}
		if (ctx.WhiteSpace) {
			const arr: any[] = ctx.WhiteSpace;
			for (let i = 0; i < arr.length; i++) inlines.push(ast.plain(arr[i].image));
		}
		return ast.reducePlainTexts(inlines);
	}

	unorderedList(ctx: any): Blocks {
		const items: any[] = [];
		if (ctx.unorderedListItem) {
			const arr: any[] = ctx.unorderedListItem;
			for (let i = 0; i < arr.length; i++) {
				const result = this.visit(arr[i]);
				if (result) items.push(ast.listItem(result));
			}
		}
		return ast.unorderedList(items);
	}

	unorderedListItem(ctx: any): Inlines[] {
		const inlines: Inlines[] = [];
		if (ctx.inlineContent) {
			const arr: any[] = ctx.inlineContent;
			for (let i = 0; i < arr.length; i++) {
				const result = this.visit(arr[i]);
				if (result) inlines.push(result);
			}
		}
		if (ctx.WhiteSpace) {
			const arr: any[] = ctx.WhiteSpace;
			for (let i = 0; i < arr.length; i++) inlines.push(ast.plain(arr[i].image));
		}
		return ast.reducePlainTexts(inlines);
	}

	katexBlock(ctx: any): Blocks {
		return ast.katex(collectOrdered(ctx, ['TextContent', 'WhiteSpace', 'Newline']));
	}

	// ========================================================================
	// INLINE HELPERS
	// ========================================================================

	private _buildInlineContent(ctx: any, subRuleKeys: string[], wrapFn: (value: any) => Inlines): Inlines {
		type Entry = { offset: number; node: Inlines };
		const entries: Entry[] = [];

		for (let k = 0; k < subRuleKeys.length; k++) {
			const key = subRuleKeys[k];
			const arr = ctx[key];
			if (!arr) continue;
			for (let i = 0; i < arr.length; i++) {
				const item = arr[i];
				// Tokens have startOffset; rule nodes need first-token extraction
				const offset = typeof item.startOffset === 'number' ? item.startOffset : this._firstTokenOffset(item);
				const result = this.visit(item);
				if (result) entries.push({ offset, node: result });
			}
		}

		if (ctx.TextContent) {
			const arr: any[] = ctx.TextContent;
			for (let i = 0; i < arr.length; i++) {
				entries.push({ offset: arr[i].startOffset, node: ast.plain(arr[i].image) });
			}
		}

		if (ctx.WhiteSpace) {
			const arr: any[] = ctx.WhiteSpace;
			for (let i = 0; i < arr.length; i++) {
				entries.push({ offset: arr[i].startOffset, node: ast.plain(arr[i].image) });
			}
		}

		if (entries.length > 1) entries.sort((a, b) => a.offset - b.offset);

		return wrapFn(ast.reducePlainTexts(entries.map((e) => e.node)) as any);
	}

	bold(ctx: any): Inlines {
		return this._buildInlineContent(ctx, ['italic', 'strike', 'inlineCode', 'link', 'emoji', 'userMention', 'channelMention'], (c) =>
			ast.bold(c),
		);
	}

	italic(ctx: any): Inlines {
		return this._buildInlineContent(ctx, ['bold', 'strike', 'inlineCode', 'link', 'emoji', 'userMention', 'channelMention'], (c) =>
			ast.italic(c),
		);
	}

	strike(ctx: any): Inlines {
		return this._buildInlineContent(
			ctx,
			['bold', 'italic', 'inlineCode', 'link', 'emoji', 'userMention', 'channelMention', 'timestamp'],
			(c) => ast.strike(c),
		);
	}

	inlineCode(ctx: any): Inlines {
		return ast.inlineCode(ast.plain(collectOrdered(ctx, ['TextContent', 'WhiteSpace'])));
	}

	katexInline(ctx: any): Inlines {
		return ast.inlineKatex(collectOrdered(ctx, ['TextContent', 'WhiteSpace']));
	}

	link(ctx: any): Inlines {
		type Entry = { offset: number; node: Markup };
		const labelEntries: Entry[] = [];
		if (ctx.inlineContent) {
			const arr: any[] = ctx.inlineContent;
			for (let i = 0; i < arr.length; i++) {
				const offset = typeof arr[i].startOffset === 'number' ? arr[i].startOffset : this._firstTokenOffset(arr[i]);
				const result = this.visit(arr[i]);
				if (result) labelEntries.push({ offset, node: result as Markup });
			}
		}
		if (ctx.WhiteSpace) {
			const arr: any[] = ctx.WhiteSpace;
			for (let i = 0; i < arr.length; i++) {
				labelEntries.push({ offset: arr[i].startOffset, node: ast.plain(arr[i].image) });
			}
		}
		if (labelEntries.length > 1) labelEntries.sort((a, b) => a.offset - b.offset);
		const label = labelEntries.map((e) => e.node);
		return ast.link(collectOrdered(ctx, ['TextContent', 'URL']), label.length > 0 ? label : undefined);
	}

	image(ctx: any): Inlines {
		return ast.image(
			collectOrdered(ctx, ['URL', 'TextContent']),
			collectOrdered(ctx, ['TextContent', 'WhiteSpace']).trim()
				? ast.plain(collectOrdered(ctx, ['TextContent', 'WhiteSpace']).trim())
				: undefined,
		);
	}

	autoLink(ctx: any): Inlines {
		return ast.autoLink(ctx.URL[0].image);
	}
	email(ctx: any): Inlines {
		return ast.autoEmail(ctx.Email[0].image);
	}
	phone(ctx: any): Inlines {
		const n = ctx.Phone[0].image;
		return ast.phoneChecker(n, n);
	}
	userMention(ctx: any): Inlines {
		return ast.mentionUser(ctx.UserMention[0].image.substring(1));
	}
	channelMention(ctx: any): Inlines {
		return ast.mentionChannel(ctx.ChannelMention[0].image.substring(1));
	}

	timestamp(ctx: any): Inlines {
		return ast.timestamp(ctx.TextContent[0].image, (ctx.TimestampFormat?.[0].image ?? 't') as any);
	}

	color(ctx: any): Inlines {
		const s = ctx.Color[0].image;
		return ast.parseColor(s) || ast.plain(s);
	}

	emoji(ctx: any): Inlines {
		if (ctx.EmojiShortcode) return ast.emoji(ast.cleanEmojiShortcode(ctx.EmojiShortcode[0].image));
		if (ctx.EmojiUnicode) return ast.emojiUnicode(ctx.EmojiUnicode[0].image);
		return ast.plain('');
	}

	emoticon(ctx: any): Inlines {
		const e = ctx.Emoticon[0].image;
		return ast.emoticonToEmoji(e) || ast.plain(e);
	}

	plainText(ctx: any): Inlines {
		return ast.plain(ctx.TextContent[0].image);
	}

	bareSpecial(ctx: any): Inlines {
		const keys = [
			'Hash',
			'At',
			'Colon',
			'Dot',
			'Dash',
			'Plus',
			'Slash',
			'Backslash',
			'LessThan',
			'GreaterThan',
			'Pipe',
			'LeftParen',
			'RightParen',
			'RightBracket',
			'ItalicMarker',
			'StrikeMarker',
			'UnderscoreItalicMarker',
			'InlineCodeMarker',
			'BoldMarker',
			'KaTeXInlineStart',
		];
		for (let i = 0; i < keys.length; i++) {
			const arr = ctx[keys[i]];
			if (arr && arr.length > 0) return ast.plain(arr[0].image);
		}
		return ast.plain('');
	}

	inlineContent(ctx: any): Inlines | null {
		if (ctx.bold) return this.visit(ctx.bold[0]);
		if (ctx.italic) return this.visit(ctx.italic[0]);
		if (ctx.strike) return this.visit(ctx.strike[0]);
		if (ctx.inlineCode) return this.visit(ctx.inlineCode[0]);
		if (ctx.katexInline) return this.visit(ctx.katexInline[0]);
		if (ctx.link) return this.visit(ctx.link[0]);
		if (ctx.image) return this.visit(ctx.image[0]);
		if (ctx.autoLink) return this.visit(ctx.autoLink[0]);
		if (ctx.email) return this.visit(ctx.email[0]);
		if (ctx.userMention) return this.visit(ctx.userMention[0]);
		if (ctx.channelMention) return this.visit(ctx.channelMention[0]);
		if (ctx.timestamp) return this.visit(ctx.timestamp[0]);
		if (ctx.color) return this.visit(ctx.color[0]);
		if (ctx.emoji) return this.visit(ctx.emoji[0]);
		if (ctx.emoticon) return this.visit(ctx.emoticon[0]);
		if (ctx.phone) return this.visit(ctx.phone[0]);
		if (ctx.plainText) return this.visit(ctx.plainText[0]);
		if (ctx.bareSpecial) return this.visit(ctx.bareSpecial[0]);
		return null;
	}
}

export const messageVisitor = new MessageVisitor();
