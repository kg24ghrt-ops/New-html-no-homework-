async function loadModule() {
	return await import("../js/paper.js");
}

let mod;

beforeAll(async () => {
	mod = await loadModule();
});

describe("paper constants", () => {
	test("MM is 10px/mm", () => {
		expect(mod.MM).toBe(10);
	});

	test("B5 dimensions in mm are correct", () => {
		expect(mod.PAPER_WIDTH_MM).toBe(182);
		expect(mod.PAPER_HEIGHT_MM).toBe(257);
		expect(mod.PAPER_WIDTH).toBe(mod.PAPER_WIDTH_MM * mod.MM);
		expect(mod.PAPER_HEIGHT).toBe(mod.PAPER_HEIGHT_MM * mod.MM);
	});

	test("lineGap is 7mm (70px)", () => {
		expect(mod.LINE_GAP_MM).toBe(7);
		expect(mod.LINE_GAP).toBe(mod.LINE_GAP_MM * mod.MM);
	});

	test("font size is 4.5mm (45px)", () => {
		expect(mod.FONT_SIZE_MM).toBe(4.5);
		expect(mod.FONT_SIZE).toBe(mod.FONT_SIZE_MM * mod.MM);
	});

	test("margins in mm are correct", () => {
		expect(mod.TOP_MARGIN_MM).toBe(10);
		expect(mod.BOTTOM_MARGIN_MM).toBe(8);
		expect(mod.RIGHT_MARGIN_MM).toBe(5);
		expect(mod.LEFT_MARGIN_MM).toBe(10);
		expect(mod.TOP_MARGIN).toBe(mod.TOP_MARGIN_MM * mod.MM);
		expect(mod.BOTTOM_MARGIN).toBe(mod.BOTTOM_MARGIN_MM * mod.MM);
		expect(mod.RIGHT_MARGIN).toBe(mod.RIGHT_MARGIN_MM * mod.MM);
		expect(mod.LEFT_MARGIN).toBe(mod.LEFT_MARGIN_MM * mod.MM);
	});

	test("margin line and text offset in mm are correct", () => {
		expect(mod.MARGIN_LINE_X_MM).toBe(22);
		expect(mod.TEXT_OFFSET_FROM_MARGIN_MM).toBe(3);
		expect(mod.MARGIN_LINE_X).toBe(mod.MARGIN_LINE_X_MM * mod.MM);
		expect(mod.TEXT_OFFSET_FROM_MARGIN).toBe(mod.TEXT_OFFSET_FROM_MARGIN_MM * mod.MM);
	});

	test("hole positions in mm are correct", () => {
		expect(mod.HOLE_X_MM).toBe(6);
		expect(mod.HOLE_RADIUS_MM).toBe(2.5);
		expect(mod.HOLE_SPACING_MM).toBe(16);
		expect(mod.FIRST_HOLE_Y_MM).toBe(8);
		expect(mod.HOLE_X).toBe(mod.HOLE_X_MM * mod.MM);
		expect(mod.HOLE_RADIUS).toBe(mod.HOLE_RADIUS_MM * mod.MM);
		expect(mod.HOLE_SPACING).toBe(mod.HOLE_SPACING_MM * mod.MM);
		expect(mod.FIRST_HOLE_Y).toBe(mod.FIRST_HOLE_Y_MM * mod.MM);
	});

	test("fit padding is 0.94", () => {
		expect(mod.FIT_PADDING).toBe(0.94);
	});
});

describe("paperRect", () => {
	test("aspect ratio is 182/257", () => {
		expect(mod.PAPER_WIDTH / mod.PAPER_HEIGHT).toBeCloseTo(182 / 257);
	});

	test("centers paper in wide viewport (1000x500)", () => {
		const r = mod.paperRect(1000, 500, mod.PAPER_WIDTH, mod.PAPER_HEIGHT);
		expect(r.left).toBeGreaterThan(0);
		expect(r.top).toBeGreaterThanOrEqual(0);
		expect(r.scale).toBeCloseTo(r.h / mod.PAPER_HEIGHT);
	});

	test("centers paper in tall viewport (500x1000)", () => {
		const r = mod.paperRect(500, 1000, mod.PAPER_WIDTH, mod.PAPER_HEIGHT);
		expect(r.top).toBeGreaterThan(0);
		expect(r.left).toBeGreaterThanOrEqual(0);
		expect(r.scale).toBeCloseTo(r.w / mod.PAPER_WIDTH);
	});

	test("sheet fully visible with padding on mobile viewport (390x844)", () => {
		const r = mod.paperRect(390, 844, mod.PAPER_WIDTH, mod.PAPER_HEIGHT);
		expect(r.w).toBeLessThanOrEqual(390);
		expect(r.h).toBeLessThanOrEqual(844);
		expect(r.left).toBeGreaterThanOrEqual(0);
		expect(r.top).toBeGreaterThanOrEqual(0);
		expect(r.scale).toBeCloseTo(r.w / mod.PAPER_WIDTH);
		const expectedScale = 390 * mod.FIT_PADDING / mod.PAPER_WIDTH;
		expect(r.scale).toBeCloseTo(expectedScale);
	});

	test("sheet fully visible with padding on desktop viewport (1000x500)", () => {
		const r = mod.paperRect(1000, 500, mod.PAPER_WIDTH, mod.PAPER_HEIGHT);
		expect(r.w).toBeLessThanOrEqual(1000);
		expect(r.h).toBeLessThanOrEqual(500);
		expect(r.left).toBeGreaterThanOrEqual(0);
		expect(r.top).toBeGreaterThanOrEqual(0);
		expect(r.scale).toBeCloseTo(r.h / mod.PAPER_HEIGHT);
		const expectedScale = 500 * mod.FIT_PADDING / mod.PAPER_HEIGHT;
		expect(r.scale).toBeCloseTo(expectedScale);
	});
});