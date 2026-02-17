import { Lexer, IToken } from 'chevrotain';
import { allTokens } from './tokens';

export class MessageLexer {
	private lexer: Lexer;

	private skipBold = false;
	private skipItalic = false;
	private skipStrikethrough = false;
	private skipReferences = false;
	private skipBoldEmoji = false;
	private skipItalicEmoji = false;
	private skipInlineEmoji = false;
	private skipColors = false;
	private skipEmoticons = false;
	private skipKatex = false;

	/**
	 * Tracks whether ANY skip flag is active.
	 * When false we can return the raw token array without a scan — the
	 * common-path fast exit.
	 */
	private anySkip = false;

	/**
	 * Pre-built Set of token-type names that should be converted to
	 * TextContent.  Rebuilt only when options change, not on every token.
	 */
	private skipSet: Set<string> = new Set();

	/**
	 * Reusable plain-text token-type descriptor.
	 * Avoids allocating a new object literal in convertToText() every call.
	 */
	private static readonly TEXT_TOKEN_TYPE = {
		name: 'TextContent',
		PATTERN: /.*/,
	} as any;

	constructor() {
		this.lexer = new Lexer(allTokens, {
			positionTracking: 'full',
			ensureOptimizations: false,
		});
	}

	tokenize(text: string, options?: LexerOptions): IToken[] {
		if (options) {
			this.skipBold = options.skipBold ?? false;
			this.skipItalic = options.skipItalic ?? false;
			this.skipStrikethrough = options.skipStrikethrough ?? false;
			this.skipReferences = options.skipReferences ?? false;
			this.skipBoldEmoji = options.skipBoldEmoji ?? false;
			this.skipItalicEmoji = options.skipItalicEmoji ?? false;
			this.skipInlineEmoji = options.skipInlineEmoji ?? false;
			this.skipColors = options.skipColors ?? false;
			this.skipEmoticons = options.skipEmoticons ?? false;
			this.skipKatex = options.skipKatex ?? false;
			this.rebuildSkipSet();
		}

		const lexResult = this.lexer.tokenize(text);

		if (lexResult.errors.length > 0) {
			throw new Error(`Lexing errors: ${lexResult.errors.map((e) => e.message).join(', ')}`);
		}

		// Fast path: no skip flags active — return tokens as-is, zero allocation
		if (!this.anySkip) {
			return lexResult.tokens;
		}

		return this.postProcessTokens(lexResult.tokens);
	}

	/**
	 * Rebuild the skip-name set and anySkip flag from current state.
	 * Called only when options change, not per-token.
	 */
	private rebuildSkipSet(): void {
		const s = this.skipSet;
		s.clear();

		if (this.skipBold) s.add('BoldMarker');
		if (this.skipItalic) {
			s.add('ItalicMarker');
			s.add('UnderscoreItalicMarker');
		}
		if (this.skipStrikethrough) s.add('StrikeMarker');
		if (this.skipReferences) {
			s.add('LinkStart');
			s.add('ImageStart');
		}
		// All three emoji-skip flags map to the same token name
		if (this.skipBoldEmoji || this.skipItalicEmoji || this.skipInlineEmoji) {
			s.add('EmojiShortcode');
		}
		if (this.skipColors) s.add('Color');
		if (this.skipEmoticons) s.add('Emoticon');
		if (this.skipKatex) {
			s.add('KaTeXBlockStart');
			s.add('KaTeXInlineStart');
		}

		this.anySkip = s.size > 0;
	}

	/**
	 * Only called when anySkip is true.
	 * Single-pass O(n) scan; uses the shared TEXT_TOKEN_TYPE descriptor
	 * instead of creating a new object per converted token.
	 */
	private postProcessTokens(tokens: IToken[]): IToken[] {
		const processed: IToken[] = [];
		const skip = this.skipSet;

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (skip.has(token.tokenType.name)) {
				processed.push(this.convertToText(token));
			} else {
				processed.push(token);
			}
		}

		return processed;
	}

	/**
	 * Re-uses the static TEXT_TOKEN_TYPE descriptor to avoid per-call
	 * object allocation.  Only the tokenType reference changes.
	 */
	private convertToText(token: IToken): IToken {
		return {
			...token,
			tokenType: MessageLexer.TEXT_TOKEN_TYPE,
		};
	}

	getErrors() {
		return this.lexer.lexerDefinitionErrors;
	}
}

export interface LexerOptions {
	skipBold?: boolean;
	skipItalic?: boolean;
	skipStrikethrough?: boolean;
	skipReferences?: boolean;
	skipBoldEmoji?: boolean;
	skipItalicEmoji?: boolean;
	skipInlineEmoji?: boolean;
	skipColors?: boolean;
	skipEmoticons?: boolean;
	skipKatex?: boolean;
	customDomains?: string[];
}

export const messageLexer = new MessageLexer();
