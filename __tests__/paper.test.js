
test("centers paper in wide viewport", async () => {
	const { paperRect, PAPER_WIDTH, PAPER_HEIGHT } = await import("../js/paper.js");
	const r = paperRect(1000, 500, PAPER_WIDTH, PAPER_HEIGHT);
	expect(r.left).toBeGreaterThan(0);
	expect(r.top).toBeCloseTo(2.5, 0);
	expect(r.scale).toBeCloseTo(r.h / PAPER_HEIGHT);
});

test("centers paper in tall viewport", async () => {
	const { paperRect, PAPER_WIDTH, PAPER_HEIGHT } = await import("../js/paper.js");
	const r = paperRect(500, 1000, PAPER_WIDTH, PAPER_HEIGHT);
	expect(r.top).toBeGreaterThan(0);
	expect(r.left).toBeCloseTo(2.5, 0);
	expect(r.scale).toBeCloseTo(r.w / PAPER_WIDTH);
});

test("paper stays fully visible with spacing in mobile viewport", async () => {
	const { paperRect, PAPER_WIDTH, PAPER_HEIGHT } = await import("../js/paper.js");
	const r = paperRect(390, 844, PAPER_WIDTH, PAPER_HEIGHT);
	expect(r.w).toBeLessThanOrEqual(390);
	expect(r.h).toBeLessThanOrEqual(844);
	expect(r.left).toBeGreaterThan(0);
	expect(r.top).toBeGreaterThan(0);
	expect(r.scale).toBeCloseTo(r.h / PAPER_HEIGHT);
});

test("B5 aspect ratio is correct", async () => {
	const { PAPER_WIDTH, PAPER_HEIGHT } = await import("../js/paper.js");
	expect(PAPER_WIDTH / PAPER_HEIGHT).toBeCloseTo(176 / 250);
});
