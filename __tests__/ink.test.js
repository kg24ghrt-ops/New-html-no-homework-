import * as paper from "../js/paper.js";
import { inkBaselineY } from "../js/ink.js";

describe("ink text layout", () => {
	test("keeps the existing baseline positions", () => {
		for (const i of [0, 1, 33]) {
			const expected = paper.TOP_MARGIN + (i + 1) * paper.LINE_GAP - 1.5 * paper.MM;
			expect(inkBaselineY(i)).toBe(expected);
		}
	});
});
