const { test, expect } = require("@playwright/test");

function paperPainted(page) {
	return page.evaluate(() => {
		const canvas = document.getElementById("canvas");
		if (!canvas || !canvas.width || !canvas.height) return false;
		const ctx = canvas.getContext("2d");
		const pixel = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
		return pixel[3] > 0;
	});
}

test("paints with fallback fonts when font requests are aborted", async ({ page }) => {
	await page.route("**/fonts/*.woff2", (route) => route.abort());
	await page.goto("/index.html", { waitUntil: "domcontentloaded" });

	await expect.poll(() => paperPainted(page), { timeout: 3000 }).toBe(true);
});

test("paints with fallback fonts when font requests hang", async ({ page }) => {
	await page.route("**/fonts/*.woff2", () => {
		// Never respond: the app must not wait for the font request forever.
	});
	await page.goto("/index.html", { waitUntil: "domcontentloaded" });

	await expect.poll(() => paperPainted(page), { timeout: 3000 }).toBe(true);
});

test("shows the error banner when a module file returns 404", async ({ page }) => {
	await page.route("**/js/caret.js", (route) => route.fulfill({
		status: 404,
		contentType: "text/javascript",
		body: "",
	}));
	await page.goto("/index.html", { waitUntil: "domcontentloaded" });

	const banner = page.locator("#b5Error");
	await expect(banner).toBeVisible({ timeout: 6000 });
	await expect(banner).toContainText("The notebook failed to load");
	await expect(banner).toContainText("js/*.js");
});
