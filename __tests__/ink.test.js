import * as paper from "../js/paper.js";
import {
	INK_LIMITS,
	baselineWander,
	drawCharacters,
	glyphJitter,
	inkBaselineY,
	wordJitter,
} from "../js/ink.js";

function mockCtx() {
	const calls = [];
	return {
		calls,
		globalAlpha: 1,
		fillStyle: "",
		save() {},
		restore() {},
		translate() {},
		rotate() {},
		transform() {},
		scale() {},
		measureText: (text) => ({ width: text.length * 10 }),
		fillText(text, x, y) {
			calls.push({ text, x, y, alpha: this.globalAlpha, style: this.fillStyle });
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
