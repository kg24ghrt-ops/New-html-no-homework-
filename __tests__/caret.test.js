import {
	caretMetricsForOffset,
	lineIndexForOffset,
	snapToGrapheme,
} from "../js/caret.js";
import { graphemeOffsets, layoutTextLines } from "../js/text.js";

// Every character is 10 units wide, so expected x values are easy to read.
const measure = { measureText: (s) => ({ width: s.length * 10 }) };
const baselineForLine = (i) => 100 + i * 70;
const TEXT_X = 50;

describe("grapheme snapping", () => {
	test("leaves a Latin offset on a character boundary", () => {
		expect(snapToGrapheme("hello", 0)).toBe(0);
		expect(snapToGrapheme("hello", 3)).toBe(3);
		expect(snapToGrapheme("hello", 99)).toBe(5);
	});

	test("never leaves the caret inside a combining cluster", () => {
		const text = "a\u0301b\u0301"; // two visible clusters, two code units each
		expect(snapToGrapheme(text, 0)).toBe(0);
		expect(snapToGrapheme(text, 1)).toBe(0);
		expect(snapToGrapheme(text, 2)).toBe(2);
		expect(snapToGrapheme(text, 3)).toBe(2);
		expect(snapToGrapheme(text, 4)).toBe(4);
	});

	test("never leaves the caret inside a Myanmar cluster", () => {
		const text = "မြန်မာစာ";
		for (const cluster of graphemeOffsets(text)) {
			const end = cluster.offset + cluster.segment.length;
			expect(snapToGrapheme(text, cluster.offset)).toBe(cluster.offset);
			expect(snapToGrapheme(text, end)).toBe(end);
			if (cluster.segment.length > 1) {
				expect(snapToGrapheme(text, cluster.offset + 1)).toBe(cluster.offset);
			}
		}
	});
});

describe("caret line ownership", () => {
	test("a soft wrap puts the break offset on the next row", () => {
		const lines = layoutTextLines("abcdef", 30, measure);
		expect(lines).toEqual([
			{ text: "abc", start: 0 },
			{ text: "def", start: 3 },
		]);
		expect(lineIndexForOffset(lines, 0)).toBe(0);
		expect(lineIndexForOffset(lines, 2)).toBe(0);
		expect(lineIndexForOffset(lines, 3)).toBe(1);
		expect(lineIndexForOffset(lines, 6)).toBe(1);
	});

	test("a hard newline keeps the caret on the row it ends", () => {
		const lines = layoutTextLines("a\nb", 100, measure);
		expect(lines).toEqual([
			{ text: "a", start: 0 },
			{ text: "b", start: 2 },
		]);
		expect(lineIndexForOffset(lines, 1)).toBe(0);
		expect(lineIndexForOffset(lines, 2)).toBe(1);
	});

	test("an empty value still has a line", () => {
		expect(lineIndexForOffset([{ text: "", start: 0 }], 0)).toBe(0);
	});
});

describe("caret metrics", () => {
	test("x is textX plus the measured prefix on one line", () => {
		const metrics = caretMetricsForOffset(
			"hello",
			3,
			[{ text: "hello", start: 0 }],
			measure,
			TEXT_X,
			baselineForLine,
		);
		expect(metrics).toMatchObject({
			offset: 3,
			lineIndex: 0,
			lineStart: 0,
			x: TEXT_X + 30,
			baseline: 100,
		});
	});

	test("a wrapped offset uses that line's own start and baseline", () => {
		const lines = layoutTextLines("hello world", 50, measure);
		expect(lines).toEqual([
			{ text: "hello", start: 0 },
			{ text: "world", start: 6 },
		]);

		const start = caretMetricsForOffset("hello world", 6, lines, measure, TEXT_X, baselineForLine);
		expect(start).toMatchObject({ lineIndex: 1, lineStart: 6, x: TEXT_X, baseline: 170 });

		const middle = caretMetricsForOffset("hello world", 8, lines, measure, TEXT_X, baselineForLine);
		expect(middle).toMatchObject({ lineIndex: 1, lineStart: 6, x: TEXT_X + 20, baseline: 170 });
	});

	test("a hard newline starts the next row at textX", () => {
		const lines = layoutTextLines("a\nb", 100, measure);
		const before = caretMetricsForOffset("a\nb", 1, lines, measure, TEXT_X, baselineForLine);
		const after = caretMetricsForOffset("a\nb", 2, lines, measure, TEXT_X, baselineForLine);
		expect(before).toMatchObject({ lineIndex: 0, x: TEXT_X + 10, baseline: 100 });
		expect(after).toMatchObject({ lineIndex: 1, x: TEXT_X, baseline: 170 });
	});

	test("Myanmar x advances by whole clusters, never code units", () => {
		const text = "မြန်မာစာ";
		const lines = [{ text, start: 0 }];
		for (const cluster of graphemeOffsets(text)) {
			const end = cluster.offset + cluster.segment.length;
			const metrics = caretMetricsForOffset(text, end, lines, measure, TEXT_X, baselineForLine);
			expect(metrics.offset).toBe(end);
			expect(metrics.x).toBe(TEXT_X + end * 10);
		}

		// A mid-cluster offset is snapped back to the cluster start before the
		// prefix is measured.
		const first = graphemeOffsets(text).find((cluster) => cluster.segment.length > 1);
		const mid = caretMetricsForOffset(text, first.offset + 1, lines, measure, TEXT_X, baselineForLine);
		expect(mid.offset).toBe(first.offset);
		expect(mid.x).toBe(TEXT_X + first.offset * 10);
	});

	test("an empty value puts the caret at textX on the first baseline", () => {
		const metrics = caretMetricsForOffset(
			"",
			0,
			[{ text: "", start: 0 }],
			measure,
			TEXT_X,
			baselineForLine,
		);
		expect(metrics).toMatchObject({ offset: 0, lineIndex: 0, x: TEXT_X, baseline: 100 });
	});
});
