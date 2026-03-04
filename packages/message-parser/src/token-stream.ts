import type { IToken } from './lexer';

// =============================================================================
// TOKEN STREAM
// A simple cursor over a flat token array. Completely stateless with respect
// to markdown — knows nothing about token types beyond their names.
// =============================================================================

export class TokenStream {
	private tokens: IToken[];
	private pos: number = 0;

	constructor(tokens: IToken[]) {
		this.tokens = tokens;
	}

	peek(): IToken | undefined {
		return this.tokens[this.pos];
	}

	peekAt(n: number): IToken | undefined {
		return this.tokens[this.pos + n];
	}

	consume(): IToken {
		return this.tokens[this.pos++];
	}

	isAtEnd(): boolean {
		return this.pos >= this.tokens.length;
	}

	getPos(): number {
		return this.pos;
	}

	setPos(pos: number): void {
		this.pos = pos;
	}

	tokenAt(i: number): IToken | undefined {
		return this.tokens[i];
	}

	inject(newTokens: IToken[]): void {
		this.tokens.splice(this.pos, 0, ...newTokens);
	}

	check(type: { name: string }): boolean {
		return this.peek()?.tokenType.name === type.name;
	}

	checkImage(type: { name: string }, image: string): boolean {
		const t = this.peek();
		return t?.tokenType.name === type.name && t.image === image;
	}

	match(type: { name: string }): IToken | undefined {
		return this.check(type) ? this.consume() : undefined;
	}

	matchImage(type: { name: string }, image: string): IToken | undefined {
		return this.checkImage(type, image) ? this.consume() : undefined;
	}
}
