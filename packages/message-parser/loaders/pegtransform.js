import pegjs from 'peggy';

export default {
	process: (content) => ({
		code: pegjs.generate(content, {
			output: 'source',
			format: 'commonjs',
		}),
	}),
};
