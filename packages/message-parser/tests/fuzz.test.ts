import fc from 'fast-check';
import { parse } from '../src';

describe('message parser fuzz testing', () => {
	it('does not crash on arbitrary input', () => {
		fc.assert(
			fc.property(fc.string(), (input) => {
				try {
					parse(input);
				} catch (err) {
					expect(err).toBeInstanceOf(Error);
				}
			}),
			{ numRuns: 10_000 },
		);
	});
});
