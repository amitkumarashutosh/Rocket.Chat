export function isNewline(ch: string): boolean {
	return ch === '\n' || ch === '\r';
}

export function isSpace(ch: string): boolean {
	return ch === ' ' || ch === '\t';
}

export function isWhiteSpace(ch: string): boolean {
	return isSpace(ch) || isNewline(ch);
}

export function isAlpha(ch: string): boolean {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

export function isDigit(ch: string): boolean {
	return ch >= '0' && ch <= '9';
}

export function isAlphaNum(ch: string): boolean {
	return isAlpha(ch) || isDigit(ch);
}

export function isMarkupChar(ch: string): boolean {
	return '*_~`#@:|\\[!<$+'.includes(ch);
}

export function isPlainChar(ch: string): boolean {
	return ch !== '' && !isNewline(ch) && !isMarkupChar(ch);
}
