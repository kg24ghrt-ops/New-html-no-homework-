const { test, expect } = require("@playwright/test");

async function openApp(page) {
	await page.addInitScript(() => localStorage.clear());
	await page.goto("/index.html");
	await page.waitForFunction(() => window.__b5 && window.__b5.ready === true);
	// The initial fit-view animation runs after __b5.ready is published.
	await page.waitForTimeout(900);
}

function canvasSnapshot(page) {
	return page.evaluate(() => document.getElementById("canvas").toDataURL());
}

function view(page) {
	return page.evaluate(() => window.__b5.getView());
}

async function ctrlWheel(page, deltaY) {
	await page.evaluate((delta) => {
		const canvas = document.getElementById("canvas");
		const rect = canvas.getBoundingClientRect();
		canvas.dispatchEvent(new WheelEvent("wheel", {
			deltaY: delta,
			ctrlKey: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			bubbles: true,
			cancelable: true,
		}));
	}, deltaY);
}

test("reset returns the canvas to the fit view after a ctrl+wheel zoom", async ({ page }) => {
	await openApp(page);
	const fit = await canvasSnapshot(page);

	await ctrlWheel(page, -240);
	await page.waitForTimeout(300);
	expect(await canvasSnapshot(page)).not.toBe(fit);

	await page.click("#resetBtn");
	await page.waitForTimeout(900);
	expect(await canvasSnapshot(page)).toBe(fit);
});

test("double-tap on the paper zooms within 600ms", async ({ page }) => {
	await openApp(page);
	const before = await canvasSnapshot(page);
	const fitScale = (await view(page)).fitScale;
	const box = await page.locator("#canvas").boundingBox();
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;

	await page.touchscreen.tap(x, y);
	await page.waitForTimeout(80);
	await page.touchscreen.tap(x, y);
	await page.waitForTimeout(500);

	expect(await canvasSnapshot(page)).not.toBe(before);
	expect((await view(page)).scale).toBeGreaterThan(fitScale * 1.1);
});

test("double-tap zooms without opening the keyboard", async ({ page }) => {
	await openApp(page);
	const box = await page.locator("#canvas").boundingBox();
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;

	await page.touchscreen.tap(x, y);
	await page.waitForTimeout(80);
	await page.touchscreen.tap(x, y);
	await page.waitForTimeout(500);

	expect(await page.evaluate(() => document.activeElement && document.activeElement.tagName)).not.toBe("TEXTAREA");
});

test.describe("wide viewport", () => {
	test.use({ viewport: { width: 1000, height: 500 }, hasTouch: false, isMobile: false });

	test("a slight zoom keeps the paper horizontally centred", async ({ page }) => {
		await openApp(page);
		await ctrlWheel(page, -120);
		await page.waitForTimeout(300);

		const current = await view(page);
		const paperCenter = current.x + current.paperWidth * current.scale / 2;
		expect(paperCenter).toBeCloseTo(current.width / 2, 0);
	});
});

test("typing past page 2 of 3 pushes its overflow to page 3", async ({ page }) => {
	await openApp(page);
	const pageTwo = Array.from({ length: 40 }, (_, i) => `page two line ${i + 1}`).join("\n");
	await page.evaluate((text) => {
		window.__b5.setPages(["page one", text, "PAGE THREE"], 1);
		const textarea = document.querySelector("textarea");
		textarea.focus();
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);
	}, pageTwo);
	await page.waitForTimeout(100);

	await page.keyboard.type("!");
	await page.waitForTimeout(300);

	const state = await page.evaluate(() => window.__b5.getPages());
	expect(state.pages).toHaveLength(3);
	expect(state.pages[1]).not.toContain("page two line 40");
	expect(state.pages[2]).toContain("page two line 40");
	expect(state.pages[2]).toContain("PAGE THREE");
	expect(state.pageIds).toHaveLength(3);
	expect(new Set(state.pageIds).size).toBe(3);
});
