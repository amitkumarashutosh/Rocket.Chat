import { parseV2 } from '../src/parser-v2';

// console.log(parseV2('hello'));
// console.log(parseV2('**bold**'));
// console.log(parseV2('> quote'));

// console.log(parseV2('hello'));
// console.log(parseV2('hello world'));
// console.log(parseV2('hello\nworld'));

// console.log(JSON.stringify(parseV2('hello\nworld'), null, 2));

// console.log(JSON.stringify(parseV2('**hello**'), null, 2));
// console.log(JSON.stringify(parseV2('*hello*'), null, 2));
// console.log(JSON.stringify(parseV2('broken **bold'), null, 2));

console.log(JSON.stringify(parseV2('hello\nworld'), null, 2));
console.log(JSON.stringify(parseV2('**bold**'), null, 2));
console.log(JSON.stringify(parseV2('`code`'), null, 2));
console.log(JSON.stringify(parseV2('> quoted **bold**'), null, 2));
