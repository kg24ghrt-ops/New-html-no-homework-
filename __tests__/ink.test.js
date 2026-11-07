import * as paper from "../js/paper.js";
import {
	INK_LIMITS,
	LINE_CANVAS_HEIGHT,
	LINE_PAD,
	baselineWander,
	drawCharacters,
	glyphJitter,
	inkBaselineY,
	wordJitter,
} from "../js/ink.js";
import { graphemeOffsets, graphemes } from "../js/text.js";

function mockCtx() {
	const calls = [];
	const stack = [];
	let tx = 0;
	let ty = 0;
	return {
		calls,
		globalAlpha: 1,
		fillStyle: "",
		save() {
			stack.push({ tx, ty, alpha: this.globalAlpha, style: this.fillStyle });
		},
		restore() {
			const state = stack.pop();
			tx = state.tx;
			ty = state.ty;
			this.globalAlpha = state.alpha;
			this.fillStyle = state.style;
		},
		translate(x, y) {
			tx += x;
			ty += y;
		},
		rotate() {},
		transform() {},
		scale() {},
		measureText: (text) => ({ width: text.length * 10 }),
		fillText(text, x, y) {
			calls.push({ text, x: x + tx, y: y + ty, alpha: this.globalAlpha, style: this.fillStyle });
		},
	};
}

describe("ink text layout", () => {
	test("keeps the existing baseline positions", () => {
		for (const i of [0, 1, 33]) {
			const expected = paper.TOP_MARGIN + (i + 1) * paper.LINE_GAP - 1.5 * paper.MM;
			expect(inkBaselineY(i)).toBe(expected);
		}
	});

	test("draws a Burmese line as one whole run, never one code point at a time", () => {
		const g = mockCtx();
		const line = "မြန်မာစာ";
		drawCharacters(g, line, 100, { pageId: "p1", start: 0 });
		expect(g.calls).toHaveLength(1);
		expect(g.calls[0].text).toBe(line);
	});

	test("mixed lines keep the Myanmar run in a single call", () => {
		const g = mockCtx();
		drawCharacters(g, "Hello မြန်မာ world", 100, { pageId: "p1", start: 0 });
		const myanmar = g.calls.filter((call) => call.text === "မြန်မာ");
		expect(myanmar).toHaveLength(1);
		expect(g.calls.map((call) => call.text).join("")).toBe("Helloမြန်မာworld");
	});

	test("Burmese fillText strings are whole grapheme clusters and concatenate to the line", () => {
		const g = mockCtx();
		const line = "မြန်မာစာ";
		drawCharacters(g, line, 100, { pageId: "p1", start: 0 });
		expect(g.calls.map((call) => call.text).join("")).toBe(line);

		const clusters = graphemes(line);
		for (const call of g.calls) {
			let rest = call.text;
			let index = 0;
			while (rest) {
				expect(rest.startsWith(clusters[index])).toBe(true);
				rest = rest.slice(clusters[index].length);
				index++;
			}
		}
	});

	test("visual drawing never changes the line's measured advance", () => {
		const g = mockCtx();
		const line = "Hello မြန်မာ world";
		const plain = g.measureText(line).width;
		drawCharacters(g, line, 100, { pageId: "p1", start: 3 });
		expect(g.measureText(line).width).toBe(plain);

		// The last cluster's cumulative prefix plus its own advance reaches the
		// same plain-text width; jitter is not part of that sum.
		const clusters = graphemeOffsets(line);
		const last = clusters[clusters.length - 1];
		const prefix = g.measureText(line.slice(0, last.offset)).width;
		const advance = g.measureText(last.segment).width;
		expect(prefix + advance).toBe(plain);
	});

	test("Latin glyphs keep the cumulative advance within the visual caps", () => {
		const g = mockCtx();
		const line = "abc";
		const textX = paper.LEFT_MARGIN + paper.TEXT_INSET;
		drawCharacters(g, line, 100, { pageId: "p1", start: 0 });

		const clusters = graphemeOffsets(line);
		expect(g.calls).toHaveLength(clusters.length);
		for (let i = 0; i < clusters.length; i++) {
			const expected = g.measureText(line.slice(0, clusters[i].offset)).width;
			const actual = g.calls[i].x - textX;
			expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
				INK_LIMITS.wordDx + INK_LIMITS.glyphDx + 1e-9,
			);
		}
	});

	test("line canvases are padded above and below the 7mm row", () => {
		expect(LINE_PAD).toBeCloseTo(3 * paper.MM);
		expect(LINE_CANVAS_HEIGHT).toBeCloseTo(paper.LINE_GAP + 6 * paper.MM);
	});

	test("appending to a line does not restyle earlier glyphs", () => {
		const before = mockCtx();
		const after = mockCtx();
		drawCharacters(before, "Hello world", 100, { pageId: "p1", start: 7 });
		drawCharacters(after, "Hello world!", 100, { pageId: "p1", start: 7 });
		expect(after.calls.slice(0, before.calls.length)).toEqual(before.calls);
	});

	test("visual offsets stay inside their caps", () => {
		for (let i = 0; i < 500; i++) {
			const glyph = glyphJitter("page", i, "a");
			expect(Math.abs(glyph.dx)).toBeLessThanOrEqual(INK_LIMITS.glyphDx + 1e-9);
			expect(Math.abs(glyph.scale - 1)).toBeLessThanOrEqual(INK_LIMITS.glyphSize + 1e-9);
			expect(Math.abs(glyph.rotation)).toBeLessThanOrEqual(INK_LIMITS.glyphRotation + 1e-9);
			expect(Math.abs(glyph.slant)).toBeLessThanOrEqual(INK_LIMITS.glyphSlant + 1e-9);

			const word = wordJitter("page", i);
			expect(Math.abs(word.dx)).toBeLessThanOrEqual(INK_LIMITS.wordDx + 1e-9);

			const wander = baselineWander(1234 + i, (i * 37) % 164);
			expect(Math.abs(wander)).toBeLessThanOrEqual(INK_LIMITS.baselineWander + 1e-9);
		}
	});

	test("baseline wander returns to zero at the widest line edge", () => {
		expect(baselineWander(42, 164)).toBeCloseTo(0, 6);
	});
});
