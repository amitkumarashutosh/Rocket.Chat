import { MarkdownParser } from './parser';
import { heading, paragraph, plain, lineBreak, mentionChannel, quote, bold, italic, code, codeLine, color } from '../utils';

const parserInstance = new MarkdownParser();

export class MarkdownAstVisitor extends parserInstance.getBaseCstVisitorConstructor() {
	private options: any;

	constructor(options?: any) {
		super();
		this.options = options || {};
		this.validateVisitor();
	}

	// ========================================
	// DOCUMENT & BLOCK LEVEL
	// ========================================

	document(ctx: any) {
		const result: any[] = [];

		// Collect all block types
		const allBlocks: Array<{ node: any; offset: number }> = [
			...(ctx.codeBlock ?? []),
			...(ctx.headingLine ?? []),
			...(ctx.blockquote ?? []),
			...(ctx.paragraphLine ?? []),
		]
			.map((node) => ({
				node,
				offset: this.getFirstTokenOffset(node),
			}))
			.sort((a, b) => a.offset - b.offset);

		// Visit each block and flatten arrays
		for (const { node } of allBlocks) {
			const value = this.visit(node);
			if (value) {
				if (Array.isArray(value)) {
					result.push(...value);
				} else {
					result.push(value);
				}
			}
		}

		return result;
	}

	// ========================================
	// CODE BLOCKS
	// ========================================

	codeBlock(ctx: any) {
		const startToken = ctx.CodeFence[0].image;
		const language = startToken.slice(3).trim() || undefined;

		const lines = ctx.codeLine ?? [];
		const rawLines = lines.map((line: any) => this.extractCodeLineContent(line.children));

		// Find minimum indentation (excluding empty lines)
		const minIndent = this.findMinIndentation(rawLines);

		// Strip common indentation
		const trimmedLines = rawLines.map((line: any) => (line.trim().length === 0 ? '' : line.slice(minIndent)));

		const codeLines = trimmedLines.map((content: any) => codeLine(plain(content)));

		return code(codeLines, language);
	}

	codeLine(ctx: any) {
		return ctx;
	}

	// ========================================
	// HEADINGS
	// ========================================

	headingLine(ctx: any) {
		const level = ctx.HeadingHash[0].image.trim().length as 1 | 2 | 3 | 4;
		const content = this.extractPlainTextFromInline(ctx.inline ?? []);
		const hasNewLine = ctx.NewLine && ctx.NewLine.length > 0;

		return hasNewLine ? [heading([plain(content)], level), lineBreak()] : heading([plain(content)], level);
	}

	// ========================================
	// BLOCKQUOTES
	// ========================================

	blockquote(ctx: any) {
		const lines = ctx.blockquoteLine ?? [];
		const paragraphs = lines.map((line: any) => paragraph(this.extractInline(line.children.inline)));
		return quote(paragraphs);
	}

	blockquoteLine(ctx: any) {
		return ctx;
	}

	// ========================================
	// PARAGRAPHS
	// ========================================

	paragraphLine(ctx: any) {
		const content = this.extractInline(ctx.inline);
		return paragraph(content);
	}

	// ========================================
	// INLINE FORMATTING
	// ========================================

	bold(ctx: any) {
		const hasClosing = ctx.Asterisk && ctx.Asterisk.length === 2;
		const content = this.extractBoldContent(ctx.boldContent);

		return hasClosing ? bold(content) : [plain('*'), ...content];
	}

	boldContent(ctx: any) {
		return ctx;
	}

	italic(ctx: any) {
		const hasClosing = ctx.Underscore && ctx.Underscore.length === 2;
		const content = this.extractItalicContent(ctx.italicContent);

		return hasClosing ? italic(content) : [plain('_'), ...content];
	}

	italicContent(ctx: any) {
		return ctx;
	}

	color(ctx: any) {
		const colorToken = ctx.Color[0].image;
		// Extract hex value: "color:#c7c7c7" -> "c7c7c7"
		const hexValue = colorToken.slice(7); // Remove "color:#"

		const { r, g, b, a } = this.parseHexColor(hexValue);
		return color(r, g, b, a);
	}

	inline(ctx: any) {
		return ctx;
	}

	// ========================================
	// EXTRACTION HELPERS
	// ========================================

	private extractCodeLineContent(lineCtx: any): string {
		const allTokens = [
			...(lineCtx.Text ?? []),
			...(lineCtx.Space ?? []),
			...(lineCtx.Hash ?? []),
			...(lineCtx.Asterisk ?? []),
			...(lineCtx.Underscore ?? []),
			...(lineCtx.GreaterThan ?? []),
			...(lineCtx.Backtick ?? []),
		].sort((a, b) => a.startOffset - b.startOffset);

		return allTokens.map((token) => token.image).join('');
	}

	private extractPlainTextFromInline(inlineNodes: any[]): string {
		const textParts: string[] = [];

		for (const inline of inlineNodes) {
			const token = inline.children;
			if (token.Text) textParts.push(token.Text[0].image);
			if (token.Space) textParts.push(token.Space[0].image);
			if (token.Hash) textParts.push(token.Hash[0].image);
			if (token.GreaterThan) textParts.push(token.GreaterThan[0].image);
			if (token.Asterisk) textParts.push(token.Asterisk[0].image);
			if (token.Underscore) textParts.push(token.Underscore[0].image);
			if (token.Backtick) textParts.push(token.Backtick[0].image);
			if (token.Color) textParts.push(token.Color[0].image);
		}

		return textParts.join('').trim();
	}

	private extractBoldContent(contentNodes: any[]) {
		if (!contentNodes?.length) return [];

		const result: any[] = [];

		for (const node of contentNodes) {
			const { children } = node;

			// Handle nested italic
			if (children.italic) {
				const italicResult = this.visit(children.italic[0]);
				result.push(...(Array.isArray(italicResult) ? italicResult : [italicResult]));
				continue;
			}

			// Handle tokens
			this.addTokenToResult(result, children, ['Text', 'Space', 'Hash', 'GreaterThan', 'Underscore', 'Backtick']);
		}

		return this.mergePlainTexts(result);
	}

	private extractItalicContent(contentNodes: any[]) {
		if (!contentNodes?.length) return [];

		const result: any[] = [];

		for (const node of contentNodes) {
			const { children } = node;

			// Handle nested bold
			if (children.bold) {
				const boldResult = this.visit(children.bold[0]);
				result.push(...(Array.isArray(boldResult) ? boldResult : [boldResult]));
				continue;
			}

			// Handle tokens
			this.addTokenToResult(result, children, ['Text', 'Space', 'Hash', 'GreaterThan', 'Asterisk', 'Backtick']);
		}

		return this.mergePlainTexts(result);
	}

	private extractInline(inlineNodes: any[]) {
		if (!inlineNodes?.length) return [];

		const result: any[] = [];

		for (let i = 0; i < inlineNodes.length; i++) {
			const node = inlineNodes[i];
			const { children } = node;

			// Handle color
			if (children.color) {
				// Check if colors are enabled (default: true)
				if (this.options.colors !== false) {
					result.push(this.visit(children.color[0]));
				} else {
					// If colors disabled, treat as plain text
					result.push(plain(children.color[0].children.Color[0].image));
				}
				continue;
			}

			// Handle bold
			if (children.bold) {
				const boldResult = this.visit(children.bold[0]);
				result.push(...(Array.isArray(boldResult) ? boldResult : [boldResult]));
				continue;
			}

			// Handle italic
			if (children.italic) {
				const italicResult = this.visit(children.italic[0]);
				result.push(...(Array.isArray(italicResult) ? italicResult : [italicResult]));
				continue;
			}

			// Handle channel mentions (#channel-name)
			if (this.isChannelMention(children, inlineNodes, i)) {
				const { channelName, remaining } = this.extractChannelMention(inlineNodes[i + 1].children.Text[0].image);
				result.push(mentionChannel(channelName));
				if (remaining) result.push(plain(remaining));
				i++; // Skip next token
				continue;
			}

			// Handle regular tokens
			this.addTokenToResult(result, children, ['Text', 'Hash', 'Space', 'GreaterThan', 'Asterisk', 'Underscore', 'Backtick']);
		}

		return this.mergePlainTexts(result);
	}

	// ========================================
	// UTILITY HELPERS
	// ========================================

	private parseHexColor(hex: string): { r: number; g: number; b: number; a: number } {
		let r, g, b;
		let a = 255;

		if (hex.length === 3) {
			// #RGB -> #RRGGBB
			r = parseInt(hex[0] + hex[0], 16);
			g = parseInt(hex[1] + hex[1], 16);
			b = parseInt(hex[2] + hex[2], 16);
		} else if (hex.length === 4) {
			// #RGBA -> #RRGGBBAA
			r = parseInt(hex[0] + hex[0], 16);
			g = parseInt(hex[1] + hex[1], 16);
			b = parseInt(hex[2] + hex[2], 16);
			a = parseInt(hex[3] + hex[3], 16);
		} else if (hex.length === 6) {
			// #RRGGBB
			r = parseInt(hex.slice(0, 2), 16);
			g = parseInt(hex.slice(2, 4), 16);
			b = parseInt(hex.slice(4, 6), 16);
		} else if (hex.length === 8) {
			// #RRGGBBAA
			r = parseInt(hex.slice(0, 2), 16);
			g = parseInt(hex.slice(2, 4), 16);
			b = parseInt(hex.slice(4, 6), 16);
			a = parseInt(hex.slice(6, 8), 16);
		} else {
			// Fallback (shouldn't happen if token pattern is correct)
			r = g = b = 0;
		}

		return { r, g, b, a };
	}

	private addTokenToResult(result: any[], children: any, tokenTypes: string[]) {
		for (const tokenType of tokenTypes) {
			if (children[tokenType]) {
				result.push(plain(children[tokenType][0].image));
				return;
			}
		}
	}

	private isChannelMention(children: any, inlineNodes: any[], index: number): boolean {
		return (
			children.Hash &&
			index + 1 < inlineNodes.length &&
			inlineNodes[index + 1].children.Text &&
			(index === 0 || inlineNodes[index - 1].children.Space || inlineNodes[index - 1].children.NewLine)
		);
	}

	private extractChannelMention(text: string): { channelName: string; remaining: string } {
		const match = text.match(/^[a-zA-Z0-9_-]+/);
		const channelName = match?.[0] || '';
		const remaining = text.slice(channelName.length);
		return { channelName, remaining };
	}

	private findMinIndentation(lines: string[]): number {
		let minIndent = Infinity;

		for (const line of lines) {
			if (line.trim().length > 0) {
				const leadingSpaces = line.match(/^[ \t]*/)?.[0].length || 0;
				minIndent = Math.min(minIndent, leadingSpaces);
			}
		}

		return minIndent === Infinity ? 0 : minIndent;
	}

	private mergePlainTexts(nodes: any[]): any[] {
		if (nodes.length === 0) return [];

		const merged: any[] = [];

		for (const node of nodes) {
			const lastNode = merged[merged.length - 1];

			if (lastNode?.type === 'PLAIN_TEXT' && node.type === 'PLAIN_TEXT') {
				lastNode.value += node.value;
			} else {
				merged.push(node);
			}
		}

		return merged;
	}

	private getFirstTokenOffset(node: any): number {
		if (!node?.children) return Infinity;

		let minOffset = Infinity;

		const findFirstToken = (obj: any): void => {
			if (!obj || typeof obj !== 'object') return;

			if (typeof obj.startOffset === 'number') {
				minOffset = Math.min(minOffset, obj.startOffset);
				return;
			}

			const items = Array.isArray(obj) ? obj : Object.values(obj);
			for (const item of items) {
				findFirstToken(item);
				if (minOffset !== Infinity) return;
			}
		};

		findFirstToken(node);
		return minOffset;
	}
}
