import { Options } from './index';
import { paragraph, plain } from './utils';

export function parse(input: string, options: Options = {}) {
	return [paragraph([plain(input)])];
}
