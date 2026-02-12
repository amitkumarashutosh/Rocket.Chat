import fc from 'fast-check';
import { parse } from '../src/index';

console.log('Running parser-v2 fuzz test…');

fc.assert(
	fc.property(fc.string(), (input) => {
		parse(input);
	}),
	{
		numRuns: 10_000,
	},
);

console.log('✅ parser-v2 fuzz test passed');
