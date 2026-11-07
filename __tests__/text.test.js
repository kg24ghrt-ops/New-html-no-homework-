import { layoutTextLines, splitPage, wrapText } from "../js/text.js";

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

	test("does not split a combining mark from its base character", () => {
		// "a" + combining acute, twice. Each visible cluster is two code units.
		expect(wrapText("a\u0301b\u0301", 10, measure)).toEqual(["a\u0301", "b\u0301"]);
	});

	test("visual lines keep their absolute source offsets", () => {
		const lines = layoutTextLines("one two three", 60, measure);
		expect(lines.map((line) => line.text)).toEqual(["one", "two", "three"]);
		expect(lines.map((line) => line.start)).toEqual([0, 4, 8]);
	});

	test("blank lines still advance the source offset", () => {
		const lines = layoutTextLines("a\n\nb", 100, measure);
		expect(lines).toEqual([
			{ text: "a", start: 0 },
			{ text: "", start: 2 },
			{ text: "b", start: 3 },
		]);
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
