import { parse } from '../src';

const inputs = [
	'hello',
	'**hello**',
	'*italic*',
	'normal text',
	'> quoted text',
	'**bold *nested italic***',
	'`code`',
	'broken **bold',
	'hello\nworld',
	'> quoted **bold**',
	'`code`',
];

for (const input of inputs) {
	console.log('INPUT:', input);
	console.log(JSON.stringify(parse(input), null, 2));
	console.log('----------------------');
}
