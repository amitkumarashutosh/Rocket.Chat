import fc from 'fast-check';
import { parseV2 } from '../src/parser-v2';

console.log('Running parser-v2 fuzz test…');

fc.assert(
	fc.property(fc.string(), (input) => {
		parseV2(input);
	}),
	{
		numRuns: 10_000,
	},
);

console.log('✅ parser-v2 fuzz test passed');
