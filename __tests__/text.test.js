import { splitPage, wrapText } from "../js/text.js";

// Every character is 10 units wide, so the expected wraps are easy to read.
const measure = { measureText: (s) => ({ width: s.length * 10 }) };

describe("text wrapping", () => {
	test("wraps on spaces", () => {
		expect(wrapText("hello world", 50, measure)).toEqual(["hello", "world"]);
	});

	test("keeps blank lines", () => {
		expect(wrapText("a\n\nb", 100, measure)).toEqual(["a", "", "b"]);
	});

	test("breaks a word that is wider than the line", () => {
		expect(wrapText("abcdefgh", 30, measure)).toEqual(["abc", "def", "gh"]);
	});
});

describe("page splitting", () => {
	test("returns null when the whole text fits", () => {
		expect(splitPage("hello", 100, 10, measure)).toBeNull();
	});

	test("moves only the overflow and keeps every character", () => {
		const texts = [
			"one two three four five six seven eight nine ten",
			"short lines\nwith a few\nbreaks in them\nand more text",
			"averylongwordwithoutspacesatallthatmustbreaksomewhere",
		];

		for (const text of texts) {
			const split = splitPage(text, 40, 3, measure);
			expect(split).not.toBeNull();
			expect(split.head + split.tail).toBe(text);
			expect(split.head.length).toBeGreaterThan(0);
			expect(split.tail.length).toBeGreaterThan(0);
			expect(split.cut).toBe(split.head.length);
			expect(wrapText(split.head, 40, measure).length).toBeLessThanOrEqual(3);
		}
	});
});
