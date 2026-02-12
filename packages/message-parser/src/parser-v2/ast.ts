import { MarkdownParser } from './parser';
import { heading, paragraph, plain, lineBreak, mentionChannel } from '../utils';

const parserInstance = new MarkdownParser();

export class MarkdownAstVisitor extends parserInstance.getBaseCstVisitorConstructor() {
	constructor() {
		super();
		this.validateVisitor();
	}

	document(ctx: any) {
		const result: any[] = [];

		const blocks = [...(ctx.headingLine ?? []), ...(ctx.paragraphLine ?? [])];

		for (const block of blocks) {
			const value = this.visit(block);

			if (Array.isArray(value)) {
				result.push(...value);
			} else {
				result.push(value);
			}
		}

		return result;
	}

	headingLine(ctx: any) {
		const level = ctx.HeadingHash[0].image.length;
		const content = this.extractInline(ctx);

		const nodes: any[] = [heading(content, level)];

		if (ctx.NewLine) {
			nodes.push(lineBreak());
		}

		return nodes;
	}

	paragraphLine(ctx: any) {
		const content = this.extractInline(ctx);

		const nodes: any[] = [paragraph(content)];

		if (ctx.NewLine) {
			nodes.push(lineBreak());
		}

		return nodes;
	}

	inline(ctx: any) {
		return ctx;
	}

	private extractInline(ctx: any) {
		const inlineNodes = ctx.inline ?? [];
		const result: any[] = [];

		for (let i = 0; i < inlineNodes.length; i++) {
			const node = inlineNodes[i];
			const token = node.children;

			if (token.Hash && i + 1 < inlineNodes.length && inlineNodes[i + 1].children.Text && (i === 0 || inlineNodes[i - 1].children.Space)) {
				const nextText = inlineNodes[i + 1].children.Text[0].image;

				result.push(mentionChannel(nextText));
				i++;
				continue;
			}

			if (token.Text) {
				result.push(plain(token.Text[0].image));
			} else if (token.Hash) {
				result.push(plain(token.Hash[0].image));
			} else if (token.Space) {
				result.push(plain(token.Space[0].image));
			}
		}

		const merged: any[] = [];

		for (const node of result) {
			if (merged.length > 0 && node.type === 'PLAIN_TEXT' && merged[merged.length - 1].type === 'PLAIN_TEXT') {
				merged[merged.length - 1].value += node.value;
			} else {
				merged.push(node);
			}
		}

		return merged;
	}
}
