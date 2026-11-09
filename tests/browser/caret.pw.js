const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "b5-notebook-v1";
const TEXT = "jkkk ပြေ";
const PHRASE = "ပြေ";
const MODES = ["handwriting", "monospace"];

// The line wobble is seeded from the page id. Pin it so the ink edge does not
// move between runs; this id's wobble cancels the Myanmar left side bearing.
async function openCaretApp(page) {
	await page.addInitScript((key) => {
		localStorage.setItem(key, JSON.stringify({
			pages: [""],
			pageIds: ["test-page"],
			currentPage: 0,
			template: "ruled",
			showMargin: true,
			showHoles: true,
			showThrough: false,
			fontMode: "handwriting",
		}));
	}, STORAGE_KEY);
	await page.goto("/index.html");
	await page.waitForFunction(() => window.__b5 && window.__b5.ready === true);
	// The initial fit-view animation runs after __b5.ready is published.
	await page.waitForTimeout(900);
}

async function showText(page, mode, zoom, text = TEXT) {
	await page.evaluate(({ mode, zoom, text }) => {
		window.__b5.setFontMode(mode);
		window.__b5.setText(text);
		const v = window.__b5.getView();
		if (zoom === 1) window.__b5.setView(v.x, v.y, v.fitScale);
		else window.__b5.setView(0, 0, v.fitScale * zoom);
	}, { mode, zoom, text });
	await page.waitForTimeout(100);
}

// Compare the caret's paper-space x (turned into a screen pixel) with the
// leftmost dark pixel of the Myanmar run on the same line. The scan window
// starts just left of the caret, inside the space before the run, so Latin
// ink and the line rule cannot be mistaken for the answer.
async function caretAndInk(page) {
	return page.evaluate((phrase) => {
		const textarea = document.querySelector("textarea");
		const text = textarea.value;
		const offset = text.indexOf(phrase);
		if (offset < 0) throw new Error(`missing phrase: ${phrase}`);
		if (document.activeElement === textarea) throw new Error("caret is focused; it would be measured as ink");

		const view = window.__b5.getView();
		const caret = window.__b5.caret(offset);
		const canvas = document.getElementById("canvas");
		const dpr = canvas.width / canvas.clientWidth;
		const ctx = canvas.getContext("2d");
		const caretPx = (view.x + caret.x * view.scale) * dpr;
		const baselinePx = (view.y + caret.baseline * view.scale) * dpr;
		const fontPx = parseFloat(getComputedStyle(textarea).fontSize) * dpr;
		const top = Math.max(0, Math.floor(baselinePx - fontPx * 1.1));
		const bottom = Math.min(canvas.height, Math.ceil(baselinePx + fontPx * 0.4));
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

		let ink = null;
		const from = Math.max(0, Math.floor(caretPx - 2 * dpr));
		const to = Math.min(canvas.width, Math.ceil(caretPx + 40 * dpr));
		for (let x = from; x < to && ink === null; x++) {
			for (let y = top; y < bottom; y++) {
				const i = (y * canvas.width + x) * 4;
				if (data[i + 3] === 0) continue;
				const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
				if (luminance < 160) {
					ink = x;
					break;
				}
			}
		}

		return {
			offset,
			lineIndex: caret.lineIndex,
			caretPx: caretPx / dpr,
			inkPx: ink === null ? null : ink / dpr,
			diff: ink === null ? null : (ink - caretPx) / dpr,
		};
	}, PHRASE);
}

async function expectCaretOnInk(page) {
	const measured = await caretAndInk(page);
	expect(measured.inkPx).not.toBeNull();
	expect(Math.abs(measured.diff)).toBeLessThanOrEqual(1);
}

// Find a phrase position that starts its own soft-wrapped line, with the whole
// "jkkk ပြေ" run kept together on that line.
async function showWrappedText(page, mode) {
	const wrapped = await page.evaluate(({ text }) => {
		for (let words = 8; words <= 40; words++) {
			const candidate = "word ".repeat(words) + text;
			window.__b5.setText(candidate);
			const lines = window.__b5.lines();
			const start = candidate.length - text.length;
			const line = lines.find((l) =>
				l.start <= start && l.start + l.text.length >= candidate.length);
			if (line && line.start > 0) {
				return { text: candidate, offset: candidate.indexOf("ပြေ"), lineStart: line.start };
			}
		}
		throw new Error("could not build a wrapped line for the phrase");
	}, { text: TEXT });

	await page.evaluate((mode) => {
		window.__b5.setFontMode(mode);
		const v = window.__b5.getView();
		window.__b5.setView(v.x, v.y, v.fitScale);
	}, mode);
	await page.waitForTimeout(100);
	return wrapped;
}

for (const mode of MODES) {
	for (const zoom of [1, 2.5]) {
		test(`${mode} caret sits on the Myanmar ink at ${zoom}x`, async ({ page }) => {
			await openCaretApp(page);
			await showText(page, mode, zoom);
			await expectCaretOnInk(page);
		});
	}

	test(`${mode} caret sits on the Myanmar ink after wrapping`, async ({ page }) => {
		await openCaretApp(page);
		const wrapped = await showWrappedText(page, mode);
		expect(wrapped.lineStart).toBeGreaterThan(0);
		await expectCaretOnInk(page);
	});

	test(`${mode} caret sits on the Myanmar ink after undo`, async ({ page }) => {
		await openCaretApp(page);
		await showText(page, mode, 1);

		await page.evaluate(() => {
			const textarea = document.querySelector("textarea");
			textarea.focus({ preventScroll: true });
			textarea.setSelectionRange(textarea.value.length, textarea.value.length);
		});
		await page.keyboard.insertText("!");
		await page.waitForTimeout(600);
		expect(await page.evaluate(() => document.querySelector("textarea").value)).toBe(`${TEXT}!`);

		await page.keyboard.press("Control+z");
		await page.waitForTimeout(300);
		expect(await page.evaluate(() => document.querySelector("textarea").value)).toBe(TEXT);

		await page.evaluate(() => document.activeElement && document.activeElement.blur());
		await page.waitForTimeout(100);
		await expectCaretOnInk(page);
	});
}
