import { CstParser } from 'chevrotain';
import { Star, Backtick, GreaterThan, Text, Newline } from './tokens';

export class MessageParser extends CstParser {
	constructor() {
		super(
			{
				Star,
				Backtick,
				GreaterThan,
				Text,
				Newline,
			},
			{
				recoveryEnabled: true,
			},
		);

		this.performSelfAnalysis();
	}
}
