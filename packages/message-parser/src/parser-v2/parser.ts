import { CstParser } from 'chevrotain';
import * as tokens from './tokens';
import type { Root } from '../definitions';

export class MessageParser extends CstParser {
	constructor() {
		super(tokens.allTokens, {
			// PERF FIX: This was the primary cause of the 300k → 40k regression.
			// 'full' records start+end offsets on every CST rule node on every
			// parse — enormous overhead for a deeply nested grammar called at
			// high frequency. 'none' disables rule-node location tracking entirely.
			// Individual tokens always carry startOffset regardless of this setting,
			// and that is all the visitor needs for correct ordering.
			nodeLocationTracking: 'none',

			// PERF: error recovery wraps every rule with bookkeeping overhead
			// even when there are no errors. Disable for the hot path.
			recoveryEnabled: false,

			// 2 is sufficient — isHeading() resolves heading ambiguity manually
			// via LA(), all other alternatives resolve within 2 tokens.
			maxLookahead: 2,
		});

		this.performSelfAnalysis();
	}

	// ========================================================================
	// ROOT RULE
	// ========================================================================

	public document = this.RULE('document', () => {
		const blocks: any[] = [];

		this.MANY(() => {
			this.OR([
				{ ALT: () => blocks.push(this.SUBRULE(this.codeBlock)) },
				{
					GATE: () => this.isHeading(),
					ALT: () => blocks.push(this.SUBRULE(this.heading)),
				},
				{ ALT: () => blocks.push(this.SUBRULE(this.quote)) },
				{ ALT: () => blocks.push(this.SUBRULE(this.taskList)) },
				{ ALT: () => blocks.push(this.SUBRULE(this.orderedList)) },
				{ ALT: () => blocks.push(this.SUBRULE(this.unorderedList)) },
				{ ALT: () => blocks.push(this.SUBRULE(this.katexBlock)) },
				{ ALT: () => blocks.push(this.SUBRULE(this.paragraph)) },
				{
					ALT: () => {
						const nl = this.CONSUME(tokens.Newline);
						blocks.push({ type: 'lineBreak', token: nl });
					},
				},
			]);
		});

		return blocks;
	});

	private isHeading(): boolean {
		let offset = 1;
		while (this.LA(offset).tokenType === tokens.Hash) {
			offset++;
		}
		return this.LA(offset).tokenType === tokens.WhiteSpace;
	}

	// ========================================================================
	// BLOCK ELEMENTS
	// ========================================================================

	private paragraph = this.RULE('paragraph', () => {
		const inlines: any[] = [];

		this.AT_LEAST_ONE(() => {
			this.OR([
				{ ALT: () => inlines.push(this.SUBRULE(this.inlineContent)) },
				{
					ALT: () => {
						const ws = this.CONSUME(tokens.WhiteSpace);
						inlines.push({ type: 'space', image: ws.image, startOffset: ws.startOffset });
					},
				},
			]);
		});

		return { type: 'paragraph', inlines };
	});

	private codeBlock = this.RULE('codeBlock', () => {
		this.CONSUME(tokens.TripleBacktick);
		const language = this.OPTION(() => this.CONSUME(tokens.CodeLanguage).image);
		const lines: string[] = [];
		this.MANY(() => {
			this.OR([
				{ ALT: () => lines.push(this.CONSUME(tokens.TextContent).image) },
				{ ALT: () => lines.push(this.CONSUME(tokens.WhiteSpace).image) },
				{
					ALT: () => {
						this.CONSUME(tokens.Newline);
						lines.push('\n');
					},
				},
			]);
		});
		this.CONSUME2(tokens.TripleBacktick);
		return { type: 'codeBlock', language: language || 'none', lines };
	});

	private heading = this.RULE('heading', () => {
		const hashes: any[] = [];
		this.AT_LEAST_ONE(() => hashes.push(this.CONSUME(tokens.Hash)));
		const level = Math.min(hashes.length, 4);
		this.CONSUME(tokens.WhiteSpace);
		const content: any[] = [];
		this.MANY(() => {
			this.OR([
				{ ALT: () => content.push(this.CONSUME(tokens.TextContent)) },
				{ ALT: () => content.push(this.CONSUME2(tokens.WhiteSpace)) },
				{ ALT: () => content.push(this.CONSUME(tokens.Dot)) },
				{ ALT: () => content.push(this.CONSUME(tokens.At)) },
				{ ALT: () => content.push(this.CONSUME(tokens.Colon)) },
				{ ALT: () => content.push(this.CONSUME(tokens.Dash)) },
				{ ALT: () => content.push(this.CONSUME(tokens.Plus)) },
				{ ALT: () => content.push(this.CONSUME(tokens.Slash)) },
				{ ALT: () => content.push(this.CONSUME(tokens.Backslash)) },
				{ ALT: () => content.push(this.CONSUME(tokens.LessThan)) },
				{ ALT: () => content.push(this.CONSUME(tokens.GreaterThan)) },
				{ ALT: () => content.push(this.CONSUME(tokens.Pipe)) },
				{ ALT: () => content.push(this.CONSUME(tokens.LeftParen)) },
				{ ALT: () => content.push(this.CONSUME(tokens.RightParen)) },
				{ ALT: () => content.push(this.CONSUME(tokens.LinkStart)) },
				{ ALT: () => content.push(this.CONSUME(tokens.RightBracket)) },
			]);
		});
		return { type: 'heading', level, content };
	});

	private quote = this.RULE('quote', () => {
		const lines: any[] = [];
		this.AT_LEAST_ONE(() => {
			this.CONSUME(tokens.QuoteMarker);
			const lineContent: any[] = [];
			this.MANY(() => {
				this.OR([
					{ ALT: () => lineContent.push(this.SUBRULE(this.inlineContent)) },
					{ ALT: () => lineContent.push(this.CONSUME(tokens.WhiteSpace).image) },
				]);
			});
			lines.push(lineContent);
			this.OPTION(() => this.CONSUME(tokens.Newline));
		});
		return { type: 'quote', lines };
	});

	private taskList = this.RULE('taskList', () => {
		const tasks: any[] = [];
		this.AT_LEAST_ONE(() => tasks.push(this.SUBRULE(this.taskItem)));
		return { type: 'taskList', tasks };
	});

	private taskItem = this.RULE('taskItem', () => {
		this.CONSUME(tokens.TaskStart);
		const checked = this.OR([
			{
				ALT: () => {
					this.CONSUME(tokens.TaskChecked);
					return true;
				},
			},
			{
				ALT: () => {
					this.CONSUME(tokens.TaskUnchecked);
					return false;
				},
			},
		]);
		this.OPTION(() => this.CONSUME(tokens.WhiteSpace));
		const content: any[] = [];
		this.MANY(() => {
			this.OR2([
				{ ALT: () => content.push(this.SUBRULE(this.inlineContent)) },
				{ ALT: () => content.push(this.CONSUME2(tokens.WhiteSpace).image) },
			]);
		});
		this.OPTION2(() => this.CONSUME(tokens.Newline));
		return { type: 'task', checked, content };
	});

	private orderedList = this.RULE('orderedList', () => {
		const items: any[] = [];
		this.AT_LEAST_ONE(() => items.push(this.SUBRULE(this.orderedListItem)));
		return { type: 'orderedList', items };
	});

	private orderedListItem = this.RULE('orderedListItem', () => {
		this.CONSUME(tokens.OrderedListMarker);
		const content: any[] = [];
		this.MANY(() => {
			this.OR([
				{ ALT: () => content.push(this.SUBRULE(this.inlineContent)) },
				{ ALT: () => content.push(this.CONSUME(tokens.WhiteSpace).image) },
			]);
		});
		this.OPTION(() => this.CONSUME(tokens.Newline));
		return { type: 'listItem', content };
	});

	private unorderedList = this.RULE('unorderedList', () => {
		const items: any[] = [];
		this.AT_LEAST_ONE(() => items.push(this.SUBRULE(this.unorderedListItem)));
		return { type: 'unorderedList', items };
	});

	private unorderedListItem = this.RULE('unorderedListItem', () => {
		this.CONSUME(tokens.UnorderedListMarker);
		const content: any[] = [];
		this.MANY(() => {
			this.OR([
				{ ALT: () => content.push(this.SUBRULE(this.inlineContent)) },
				{ ALT: () => content.push(this.CONSUME(tokens.WhiteSpace).image) },
			]);
		});
		this.OPTION(() => this.CONSUME(tokens.Newline));
		return { type: 'listItem', content };
	});

	private katexBlock = this.RULE('katexBlock', () => {
		this.CONSUME(tokens.KaTeXBlockStart);
		const content: string[] = [];
		this.MANY(() => {
			this.OR([
				{ ALT: () => content.push(this.CONSUME(tokens.TextContent).image) },
				{ ALT: () => content.push(this.CONSUME(tokens.WhiteSpace).image) },
				{ ALT: () => content.push(this.CONSUME(tokens.Newline).image) },
			]);
		});
		this.CONSUME2(tokens.KaTeXBlockStart);
		return { type: 'katex', content: content.join('') };
	});

	// ========================================================================
	// INLINE ELEMENTS
	// ========================================================================

	private inlineContent = this.RULE('inlineContent', () => {
		return this.OR([
			{ ALT: () => this.SUBRULE(this.bold) },
			{ ALT: () => this.SUBRULE(this.italic) },
			{ ALT: () => this.SUBRULE(this.strike) },
			{ ALT: () => this.SUBRULE(this.inlineCode) },
			{ ALT: () => this.SUBRULE(this.katexInline) },
			{ ALT: () => this.SUBRULE(this.link) },
			{ ALT: () => this.SUBRULE(this.image) },
			{ ALT: () => this.SUBRULE(this.autoLink) },
			{ ALT: () => this.SUBRULE(this.email) },
			{ ALT: () => this.SUBRULE(this.userMention) },
			{ ALT: () => this.SUBRULE(this.channelMention) },
			{ ALT: () => this.SUBRULE(this.timestamp) },
			{ ALT: () => this.SUBRULE(this.color) },
			{ ALT: () => this.SUBRULE(this.emoji) },
			{ ALT: () => this.SUBRULE(this.emoticon) },
			{ ALT: () => this.SUBRULE(this.phone) },
			{ ALT: () => this.SUBRULE(this.plainText) },
			{ ALT: () => this.SUBRULE(this.bareSpecial) },
		]);
	});

	private bold = this.RULE('bold', () => {
		this.CONSUME(tokens.BoldMarker);
		const content: any[] = [];
		this.AT_LEAST_ONE(() => {
			this.OR([
				{ ALT: () => content.push(this.SUBRULE(this.italic)) },
				{ ALT: () => content.push(this.SUBRULE(this.strike)) },
				{ ALT: () => content.push(this.SUBRULE(this.inlineCode)) },
				{ ALT: () => content.push(this.SUBRULE(this.link)) },
				{ ALT: () => content.push(this.SUBRULE(this.emoji)) },
				{ ALT: () => content.push(this.SUBRULE(this.userMention)) },
				{ ALT: () => content.push(this.SUBRULE(this.channelMention)) },
				{ ALT: () => content.push(this.CONSUME(tokens.TextContent)) },
				{ ALT: () => content.push(this.CONSUME(tokens.WhiteSpace)) },
			]);
		});
		this.CONSUME2(tokens.BoldMarker);
		return { type: 'bold', content };
	});

	private italic = this.RULE('italic', () => {
		this.OR([{ ALT: () => this.CONSUME(tokens.ItalicMarker) }, { ALT: () => this.CONSUME(tokens.UnderscoreItalicMarker) }]);
		const content: any[] = [];
		this.AT_LEAST_ONE(() => {
			this.OR2([
				{ ALT: () => content.push(this.SUBRULE(this.bold)) },
				{ ALT: () => content.push(this.SUBRULE(this.strike)) },
				{ ALT: () => content.push(this.SUBRULE(this.inlineCode)) },
				{ ALT: () => content.push(this.SUBRULE(this.link)) },
				{ ALT: () => content.push(this.SUBRULE(this.emoji)) },
				{ ALT: () => content.push(this.SUBRULE(this.userMention)) },
				{ ALT: () => content.push(this.SUBRULE(this.channelMention)) },
				{ ALT: () => content.push(this.CONSUME(tokens.TextContent)) },
				{ ALT: () => content.push(this.CONSUME(tokens.WhiteSpace)) },
			]);
		});
		this.OR3([{ ALT: () => this.CONSUME2(tokens.ItalicMarker) }, { ALT: () => this.CONSUME2(tokens.UnderscoreItalicMarker) }]);
		return { type: 'italic', content };
	});

	private strike = this.RULE('strike', () => {
		this.CONSUME(tokens.StrikeMarker);
		const content: any[] = [];
		this.AT_LEAST_ONE(() => {
			this.OR([
				{ ALT: () => content.push(this.SUBRULE(this.bold)) },
				{ ALT: () => content.push(this.SUBRULE(this.italic)) },
				{ ALT: () => content.push(this.SUBRULE(this.inlineCode)) },
				{ ALT: () => content.push(this.SUBRULE(this.link)) },
				{ ALT: () => content.push(this.SUBRULE(this.emoji)) },
				{ ALT: () => content.push(this.SUBRULE(this.userMention)) },
				{ ALT: () => content.push(this.SUBRULE(this.channelMention)) },
				{ ALT: () => content.push(this.SUBRULE(this.timestamp)) },
				{ ALT: () => content.push(this.CONSUME(tokens.TextContent)) },
				{ ALT: () => content.push(this.CONSUME(tokens.WhiteSpace)) },
			]);
		});
		this.CONSUME2(tokens.StrikeMarker);
		return { type: 'strike', content };
	});

	private inlineCode = this.RULE('inlineCode', () => {
		this.CONSUME(tokens.InlineCodeMarker);
		const content: string[] = [];
		this.AT_LEAST_ONE(() => {
			this.OR([
				{ ALT: () => content.push(this.CONSUME(tokens.TextContent).image) },
				{ ALT: () => content.push(this.CONSUME(tokens.WhiteSpace).image) },
			]);
		});
		this.CONSUME2(tokens.InlineCodeMarker);
		return { type: 'inlineCode', content: content.join('') };
	});

	private katexInline = this.RULE('katexInline', () => {
		this.CONSUME(tokens.KaTeXInlineStart);
		const content: string[] = [];
		this.AT_LEAST_ONE(() => {
			this.OR([
				{ ALT: () => content.push(this.CONSUME(tokens.TextContent).image) },
				{ ALT: () => content.push(this.CONSUME(tokens.WhiteSpace).image) },
			]);
		});
		this.CONSUME2(tokens.KaTeXInlineStart);
		return { type: 'inlineKatex', content: content.join('') };
	});

	private link = this.RULE('link', () => {
		this.CONSUME(tokens.LinkStart);
		const label: any[] = [];
		this.MANY(() => {
			this.OR([
				{ ALT: () => label.push(this.SUBRULE(this.inlineContent)) },
				{ ALT: () => label.push(this.CONSUME(tokens.WhiteSpace).image) },
			]);
		});
		this.CONSUME(tokens.LinkMiddle);
		const url: string[] = [];
		this.AT_LEAST_ONE(() => {
			this.OR2([{ ALT: () => url.push(this.CONSUME2(tokens.TextContent).image) }, { ALT: () => url.push(this.CONSUME(tokens.URL).image) }]);
		});
		this.CONSUME(tokens.RightParen);
		return { type: 'link', label, url: url.join('') };
	});

	private image = this.RULE('image', () => {
		this.CONSUME(tokens.ImageStart);
		const alt: string[] = [];
		this.MANY(() => {
			this.OR([
				{ ALT: () => alt.push(this.CONSUME(tokens.TextContent).image) },
				{ ALT: () => alt.push(this.CONSUME(tokens.WhiteSpace).image) },
			]);
		});
		this.CONSUME(tokens.LinkMiddle);
		const url: string[] = [];
		this.AT_LEAST_ONE(() => {
			this.OR2([{ ALT: () => url.push(this.CONSUME2(tokens.TextContent).image) }, { ALT: () => url.push(this.CONSUME(tokens.URL).image) }]);
		});
		this.CONSUME(tokens.RightParen);
		return { type: 'image', alt: alt.join(''), url: url.join('') };
	});

	private autoLink = this.RULE('autoLink', () => {
		return { type: 'autoLink', url: this.CONSUME(tokens.URL).image };
	});

	private email = this.RULE('email', () => {
		return { type: 'email', address: this.CONSUME(tokens.Email).image };
	});

	private phone = this.RULE('phone', () => {
		return { type: 'phone', number: this.CONSUME(tokens.Phone).image };
	});

	private userMention = this.RULE('userMention', () => {
		return { type: 'userMention', value: this.CONSUME(tokens.UserMention).image.substring(1) };
	});

	private channelMention = this.RULE('channelMention', () => {
		return { type: 'channelMention', value: this.CONSUME(tokens.ChannelMention).image.substring(1) };
	});

	private timestamp = this.RULE('timestamp', () => {
		this.CONSUME(tokens.TimestampStart);
		const value = this.CONSUME(tokens.TextContent).image;
		this.CONSUME(tokens.Colon);
		const format = this.OPTION(() => this.CONSUME(tokens.TimestampFormat).image);
		this.CONSUME(tokens.GreaterThan);
		return { type: 'timestamp', value, format: format || 't' };
	});

	private color = this.RULE('color', () => {
		return { type: 'color', value: this.CONSUME(tokens.Color).image };
	});

	private emoji = this.RULE('emoji', () => {
		return this.OR([
			{ ALT: () => ({ type: 'emoji', shortcode: this.CONSUME(tokens.EmojiShortcode).image }) },
			{ ALT: () => ({ type: 'emojiUnicode', unicode: this.CONSUME(tokens.EmojiUnicode).image }) },
		]);
	});

	private emoticon = this.RULE('emoticon', () => {
		return { type: 'emoticon', value: this.CONSUME(tokens.Emoticon).image };
	});

	private plainText = this.RULE('plainText', () => {
		return { type: 'plainText', value: this.CONSUME(tokens.TextContent).image };
	});

	private bareSpecial = this.RULE('bareSpecial', () => {
		const token = this.OR([
			{ ALT: () => this.CONSUME(tokens.Hash) },
			{ ALT: () => this.CONSUME(tokens.At) },
			{ ALT: () => this.CONSUME(tokens.Colon) },
			{ ALT: () => this.CONSUME(tokens.Dot) },
			{ ALT: () => this.CONSUME(tokens.Dash) },
			{ ALT: () => this.CONSUME(tokens.Plus) },
			{ ALT: () => this.CONSUME(tokens.Slash) },
			{ ALT: () => this.CONSUME(tokens.Backslash) },
			{ ALT: () => this.CONSUME(tokens.LessThan) },
			{ ALT: () => this.CONSUME(tokens.GreaterThan) },
			{ ALT: () => this.CONSUME(tokens.Pipe) },
			{ ALT: () => this.CONSUME(tokens.LeftParen) },
			{ ALT: () => this.CONSUME(tokens.RightParen) },
			{ ALT: () => this.CONSUME(tokens.RightBracket) },
			{ ALT: () => this.CONSUME(tokens.ItalicMarker) },
			{ ALT: () => this.CONSUME(tokens.StrikeMarker) },
			{ ALT: () => this.CONSUME(tokens.UnderscoreItalicMarker) },
			{ ALT: () => this.CONSUME(tokens.InlineCodeMarker) },
			{ ALT: () => this.CONSUME(tokens.BoldMarker) },
			{ ALT: () => this.CONSUME(tokens.KaTeXInlineStart) },
		]);
		return { type: 'bareSpecial', value: token.image };
	});
}

export const messageParser = new MessageParser();
