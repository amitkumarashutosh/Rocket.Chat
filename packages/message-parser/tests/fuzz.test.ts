import fc from 'fast-check';
import { parse } from '../src';

describe('Fuzz Testing - parser should never throw', () => {
	// Test 1: completely random strings
	test('handles any random string without crashing', () => {
		fc.assert(
			fc.property(fc.string(), (input: string) => {
				expect(() => parse(input)).not.toThrow();
			}),
		);
	});

	// Test 2: random strings with markdown-like characters
	test('handles strings with special markdown characters', () => {
		fc.assert(
			fc.property(
				fc
					.array(fc.constantFrom('*', '_', '~', '`', '#', '>', '[', ']', '(', ')', '!', '|', '\\', ':', '@', '\n', ' ', 'a', '1'))
					.map((arr) => arr.join('')),
				(input: string) => {
					expect(() => parse(input)).not.toThrow();
				},
			),
		);
	});

	// Test 3: very long strings
	test('handles very long strings without crashing', () => {
		fc.assert(
			fc.property(fc.string({ minLength: 1000, maxLength: 10000 }), (input: string) => {
				expect(() => parse(input)).not.toThrow();
			}),
		);
	});

	// Test 4: deeply nested formatting
	test('handles deeply nested formatting characters', () => {
		fc.assert(
			fc.property(fc.nat(50), (depth: number) => {
				const input = '*'.repeat(depth) + 'text' + '*'.repeat(depth);
				expect(() => parse(input)).not.toThrow();
			}),
		);
	});

	// Test 5: random emoji-like patterns
	test('handles random emoji-like patterns', () => {
		fc.assert(
			fc.property(fc.string(), (code: string) => {
				const input = `:${code}:`;
				expect(() => parse(input)).not.toThrow();
			}),
		);
	});

	// Test 6: random URLs
	test('handles random URL-like strings', () => {
		fc.assert(
			fc.property(fc.string(), (path: string) => {
				const input = `https://${path}`;
				expect(() => parse(input)).not.toThrow();
			}),
		);
	});

	// Test 7: output is always a valid array
	test('always returns an array', () => {
		fc.assert(
			fc.property(fc.string(), (input: string) => {
				const result = parse(input);
				expect(Array.isArray(result)).toBe(true);
			}),
		);
	});
});
