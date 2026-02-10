import { Bench } from 'tinybench';

// @ts-ignore – grammar.js is generated JS
import * as grammar from '../src/grammar.js';

// Chevrotain parser
import { parseV2 } from '../src/parser-v2';

const message = `
Hello **world**

> quoted text
> second line

@user :smile:
https://rocket.chat
`;

const astOld = grammar.parse(message);
const astNew = parseV2(message);

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
		parseV2(message);
	});

// Run
(async () => {
	await bench.run();
	console.log('\n📊 Parser Benchmark Results');
	console.table(bench.table());
})();
