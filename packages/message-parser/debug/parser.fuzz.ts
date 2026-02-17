/**
 * Standalone Fuzz Testing Runner for Rocket.Chat Message Parser
 *
 * Run:
 *   yarn tsx debug/parser.fuzz.ts
 *
 * This validates that the new Chevrotain parser is a drop-in replacement
 * for the PeggyJS grammar by comparing BOTH success/failure semantics.
 */

import fc from 'fast-check';
import assert from 'node:assert';
import { performance } from 'node:perf_hooks';

// Legacy PeggyJS parser (source of truth)
// @ts-ignore - PeggyJS doesn't have types
import grammar from '../src/grammar.js';

// New Chevrotain parser
import { parse as newParse } from '../src/parser-v2';

/**
 * ---------------------------
 * Arbitrary Input Generators
 * ---------------------------
 */

// Characters frequently used in Rocket.Chat messages
const specialCharArbitrary = fc.constantFrom(
	'*',
	'_',
	'~',
	'`',
	'@',
	'#',
	'>',
	'[',
	']',
	'(',
	')',
	'\n',
	' ',
	':',
	'-',
	'+',
	'=',
	'!',
	'?',
	'.',
	',',
);

// Printable ASCII characters (safe fuzz range)
const printableCharArbitrary = fc.integer({ min: 32, max: 126 }).map((code) => String.fromCharCode(code));

// Mix realistic + random content
const chatCharArbitrary = fc.oneof(specialCharArbitrary, printableCharArbitrary);

// Build message strings (replacement for removed stringOf)
const messageArbitrary = fc.array(chatCharArbitrary, { minLength: 0, maxLength: 500 }).map((chars) => chars.join(''));

// Pathological performance cases
const pathologicalArbitrary = fc.oneof(
	fc.constant('*'.repeat(2000)),
	fc.constant('_'.repeat(2000)),
	fc.constant('`'.repeat(2000)),
	fc.constant('@'.repeat(2000)),
	fc.constant('['.repeat(2000)),
	fc.constant('('.repeat(2000)),
	fc.constant('> '.repeat(1000)),
);

/**
 * ---------------------------
 * Execution Wrappers
 * ---------------------------
 * We must compare BEHAVIOR, not just AST.
 */

function runLegacy(input: string) {
	try {
		return { ok: true as const, value: grammar.parse(input) };
	} catch (error) {
		return { ok: false as const, error };
	}
}

function runNew(input: string) {
	try {
		return { ok: true as const, value: newParse(input) };
	} catch (error) {
		return { ok: false as const, error };
	}
}

/**
 * Validate AST invariants when parsing succeeds
 */
function validateAstShape(ast: unknown) {
	assert.ok(Array.isArray(ast), 'AST must be an array');

	for (const node of ast as any[]) {
		assert.ok(typeof node === 'object', 'Node must be object');
		assert.ok(typeof node.type === 'string', 'Node must have type');

		if ('children' in node && node.children !== undefined) {
			assert.ok(Array.isArray(node.children), 'children must be array');
		}
	}
}

/**
 * ---------------------------
 * Fuzz Runner
 * ---------------------------
 */

async function runFuzz() {
	console.log('🚀 Starting parser fuzz testing...\n');

	/**
	 * 1️⃣ Behavior Parity (CRITICAL TEST)
	 */
	console.log('🔍 Checking behavior parity with PeggyJS...');
	fc.assert(
		fc.property(messageArbitrary, (input) => {
			const legacy = runLegacy(input);
			const modern = runNew(input);

			// Both failed → correct behavior
			if (!legacy.ok && !modern.ok) return;

			// One failed but the other didn't → incompatibility
			if (legacy.ok !== modern.ok) {
				throw new Error(
					`Behavior mismatch detected\nInput: ${JSON.stringify(input)}\n` + `Legacy success: ${legacy.ok}\nNew success: ${modern.ok}`,
				);
			}

			// Both succeeded → compare AST
			assert.deepStrictEqual(modern.value, legacy.value);

			// Validate structure as extra safety
			validateAstShape(modern.value);
		}),
		{
			numRuns: 5000,
			verbose: true,
		},
	);
	console.log('✅ Behavior parity passed\n');

	/**
	 * 2️⃣ Crash Resistance
	 */
	console.log('🛡 Checking crash resistance...');
	fc.assert(
		fc.property(messageArbitrary, (input) => {
			assert.doesNotThrow(() => newParse(input));
		}),
		{ numRuns: 10000 },
	);
	console.log('✅ No crashes detected\n');

	/**
	 * 3️⃣ Pathological Performance Detection
	 */
	console.log('⚡ Checking pathological performance...');
	fc.assert(
		fc.property(pathologicalArbitrary, (input) => {
			const start = performance.now();
			newParse(input);
			const duration = performance.now() - start;

			assert.ok(duration < 50, `Slow parse detected: ${duration}ms`);
		}),
		{ numRuns: 200 },
	);
	console.log('✅ No catastrophic slowdowns\n');

	console.log('🎉 All fuzz tests passed successfully!');
}

/**
 * Execute fuzzing
 */
runFuzz().catch((err) => {
	console.error('\n❌ Fuzz testing failed!');
	console.error(err);
	process.exit(1);
});
