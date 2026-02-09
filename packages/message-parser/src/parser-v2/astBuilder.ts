import { CstNode, IToken } from 'chevrotain';

type AnyCstNode = CstNode & {
	children: Record<string, any[]>;
};

export function buildAst(cst: CstNode | undefined) {
	if (!cst) return [];

	const root = cst as AnyCstNode;
	const result: any[] = [];

	const quotes = root.children.quote ?? [];
	const paragraphs = root.children.paragraph ?? [];

	const items = [...quotes, ...paragraphs];

	for (const node of items as AnyCstNode[]) {
		if (node.name === 'quote') {
			const para = node.children.paragraph[0] as AnyCstNode;
			const inlineValue = buildInline(para.children.inline ?? []);

			// 🚫 skip empty quote paragraphs
			if (inlineValue.length === 0) continue;

			result.push({
				type: 'QUOTE',
				value: [
					{
						type: 'PARAGRAPH',
						value: inlineValue,
					},
				],
			});
			continue;
		}

		// paragraph
		const inlineValue = buildInline(node.children.inline ?? []);

		// 🚫 skip empty paragraphs
		if (inlineValue.length === 0) continue;

		result.push({
			type: 'PARAGRAPH',
			value: inlineValue,
		});
	}

	return result;
}

function buildInline(inlineNodes: AnyCstNode[]) {
	const result: any[] = [];

	for (const inline of inlineNodes) {
		// inlineCode
		if (inline.children.inlineCode) {
			const codeNode = inline.children.inlineCode[0] as AnyCstNode;
			const text = codeNode.children.Text?.map((t: IToken) => t.image).join('') ?? '';

			result.push({
				type: 'INLINE_CODE',
				value: {
					type: 'PLAIN_TEXT',
					value: text,
				},
			});
			continue;
		}

		// bold
		if (inline.children.bold) {
			const boldNode = inline.children.bold[0] as AnyCstNode;
			const text = boldNode.children.Text?.map((t: IToken) => t.image).join('') ?? '';

			result.push({
				type: 'BOLD',
				value: [
					{
						type: 'PLAIN_TEXT',
						value: text,
					},
				],
			});
			continue;
		}

		// plain text
		if (inline.children.Text) {
			for (const t of inline.children.Text as IToken[]) {
				result.push({
					type: 'PLAIN_TEXT',
					value: t.image,
				});
			}
		}

		// stray stars
		if (inline.children.Star) {
			for (const s of inline.children.Star as IToken[]) {
				result.push({
					type: 'PLAIN_TEXT',
					value: s.image,
				});
			}
		}
	}

	return result;
}
