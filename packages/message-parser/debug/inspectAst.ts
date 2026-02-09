// import { parse } from '../src';

// const input = '**hello** @user https://rocket.chat';

// const ast = parse(input);
// console.dir(ast, { depth: null });

import { parse } from '../src';

const inputs = ['**hello**', '*italic*', 'normal text', '> quoted text', '**bold *nested italic***', '`code`', 'broken **bold'];

for (const input of inputs) {
	console.log('INPUT:', input);
	console.log(JSON.stringify(parse(input), null, 2));
	console.log('----------------------');
}
