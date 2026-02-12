import { Bench } from 'tinybench';

// @ts-ignore
import grammar from '../src/grammar.js';

// Chevrotain parser
import { parse } from '../src/parser-v2';

// Use this message once the test cases are fixed.
// const message = `
// Hello **world**

// > quoted text
// > second line

// @user :smile:
// https://rocket.chat
// `.trim();

const message = `
Hello world
Another line
`.trim();

const astOld = grammar.parse(message);
const astNew = parse(message);

if (JSON.stringify(astOld) !== JSON.stringify(astNew)) {
	console.warn('⚠️ AST mismatch between parsers');
} else {
	console.log('✅ ASTs match');
}

const bench = new Bench({
	time: 1000, // run each test for ~1 second
	iterations: 0, // let tinybench decide
});

bench
	.add('PeggyJS parser', () => {
		grammar.parse(message);
	})
	.add('Chevrotain parser (parser-v2)', () => {
		parse(message);
	});

(async () => {
	await bench.run();
	console.log('\n📊 Parser Benchmark Results');
	console.table(bench.table());
})();
