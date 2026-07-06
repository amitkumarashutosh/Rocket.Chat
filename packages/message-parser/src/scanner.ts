export class Scanner {
	private pos: number;
	private readonly input: string;

	constructor(input: string, startPos = 0) {
		this.input = input;
		this.pos = startPos;
	}

	public char(): string {
		return this.input[this.pos] ?? '';
	}

	public charAt(offset: number): string {
		return this.input[this.pos + offset] ?? '';
	}

	public consume(n = 1): void {
		this.pos += n;
	}

	public isEnd(): boolean {
		return this.pos >= this.input.length;
	}

	public backtrack(savedPos: number): void {
		this.pos = savedPos;
	}

	public position(): number {
		return this.pos;
	}

	public matches(literal: string): boolean {
		return this.input.startsWith(literal, this.pos);
	}

	public sliceFrom(savedPos: number): string {
		return this.input.slice(savedPos, this.pos);
	}
}
