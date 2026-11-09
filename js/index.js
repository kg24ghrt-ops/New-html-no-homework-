import {
	paperRect as paperRectFn,
	PAPER_WIDTH,
	PAPER_HEIGHT,
	LINE_GAP,
	TOP_MARGIN,
	BOTTOM_MARGIN,
	RIGHT_MARGIN,
	LEFT_MARGIN,
	MARGIN_LINE_X,
	TEXT_INSET,
	HOLE_X,
	HOLE_RADIUS,
	HOLE_SPACING,
	FIRST_HOLE_Y,
	FONT_SIZE,
	MM,
} from "./paper.js";
import { FONT_MODES, fontSpec, fontStack, loadInkFonts } from "./fonts.js";
import { clearInkLineCache, getInkPage, inkBaselineY, releaseInkPage } from "./ink.js";
import { caretMetricsForOffset, lineIndexForOffset, snapToGrapheme } from "./caret.js";
import { graphemeOffsets, layoutTextLines, splitPage } from "./text.js";

const canvas = document.getElementById("canvas");
const msg = document.getElementById("msg");
const resetBtn = document.getElementById("resetBtn");

const textarea = document.createElement("textarea");
textarea.autocapitalize = "none";
textarea.autocomplete = "off";
textarea.spellcheck = false;
textarea.setAttribute("autocorrect", "off");
document.body.appendChild(textarea);

// Invisible copy of the textarea. It has the same font, size, width and wrap
// CSS, so the browser's own line breaker (including Myanmar syllable breaks)
// tells us exactly where each visual line starts and ends.
const mirror = document.createElement("div");
mirror.id = "inkMirror";
mirror.setAttribute("aria-hidden", "true");
document.body.appendChild(mirror);

// Zero-size inline-block at a text offset. Its rect.bottom is the real
// baseline of that line box, so padding can be measured instead of guessed.
const baselineMarker = document.createElement("span");
baselineMarker.setAttribute("aria-hidden", "true");
baselineMarker.style.display = "inline-block";
baselineMarker.style.width = "0";
baselineMarker.style.height = "0";
baselineMarker.style.verticalAlign = "baseline";

const DEBUG = new URLSearchParams(window.location.search).has("debug");

const ERROR_BANNER_ID = "b5Error";

function errorText(error) {
	const message = error?.message || error?.reason?.message || String(error?.reason ?? error ?? "Unknown error");
	const file = error?.filename || error?.sourceURL || error?.reason?.fileName;
	return file ? `${message} (${file})` : message;
}

function showErrorBanner(text) {
	let banner = document.getElementById(ERROR_BANNER_ID);
	if (!banner) {
		banner = document.createElement("div");
		banner.id = ERROR_BANNER_ID;
		banner.setAttribute("role", "alert");
		document.body.appendChild(banner);
	}

	let label = banner.querySelector(".b5-error-text");
	if (!label) {
		banner.textContent = "";
		label = document.createElement("span");
		label.className = "b5-error-text";
		const close = document.createElement("button");
		close.type = "button";
		close.setAttribute("aria-label", "Dismiss error");
		close.textContent = "\u00d7";
		close.addEventListener("click", () => banner.remove());
		banner.appendChild(label);
		banner.appendChild(close);
	}
	label.textContent = text;
	banner.hidden = false;
}

window.addEventListener("error", (event) => {
	showErrorBanner(errorText(event.error || event));
});
window.addEventListener("unhandledrejection", (event) => {
	showErrorBanner(errorText(event.reason));
});

let viewScale = 1;
let viewX = 0;
let viewY = 0;
let animating = false;
let animStart = 0;
let animDur = 0;
let animFrom = { scale: 1, x: 0, y: 0 };
let animTo = { scale: 1, x: 0, y: 0 };

const dragSamples = [];
const INERTIA_WINDOW = 80;
const INERTIA_MAX_AGE = 100;
const FRAME_MS = 1000 / 60;
const MAX_OVERSCROLL = 80;

let vx = 0;
let vy = 0;

const pointers = new Map();
let lastPointerX = 0;
let lastPointerY = 0;
let pinchStartScale = 1;
let pinchStartDist = 0;
let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;
let gesturePinched = false;
let tapFocusTimer = null;

let pages = [""];
let pageIds = [];
let currentPage = 0;
let undoStack = [];
let redoStack = [];
let pendingUndo = null;
let undoTimer = null;
let template = "ruled";
let showMargin = true;
let showHoles = true;
let showThrough = false;
let fontMode = "handwriting";

const STORAGE_KEY = "b5-notebook-v1";

let ctx;
let bgCanvas, bgCtx;
let pageCanvas = null;
let pageCtx = null;
let dpr = 1;
let dirty = true;
let pageDirty = true;
let rafId = null;
let pendingKeystrokePerf = false;
let frameCount = 0;
let fontsReady = false;

// Canvas caret. The textarea keeps the real selection, but its native caret
// would be laid out at the zoomed font size while the ink is rasterized at
// paper size; those two advances can differ by a subpixel at fit zoom.
const CARET_BLINK_MS = 530;
const CARET_SOLID_MS = 600;
let caretVisible = true;
let caretSolidUntil = 0;
let caretBlinkTimer = null;

const isMobile = window.matchMedia("(pointer: coarse)").matches;
// The target phone is fast enough for full-resolution ink and screen layers.
// Half resolution makes the handwriting visibly blurry.
const INK_QUALITY = 1;
const SCREEN_QUALITY = 1;

// The textarea has to place its first baseline exactly where the canvas draws
// line 0. Cache the measured padding per font/zoom.
const TEXT_PAD_CACHE = { key: "", value: 0 };

// The first canvas baseline is TOP_MARGIN + LINE_GAP - 1.5mm. Put a zero-size
// baseline marker at the start of a line in the mirror and read where the
// browser actually puts that baseline. No ascent/descent formula involved.
function probeBaseline(probeText) {
	mirror.textContent = "";
	mirror.appendChild(baselineMarker);
	mirror.appendChild(document.createTextNode(probeText));
	const mirrorRect = mirror.getBoundingClientRect();
	const markerRect = baselineMarker.getBoundingClientRect();
	return markerRect.bottom - mirrorRect.top;
}

function measureTextPadTop(scale) {
	const key = [fontMode, scale, mirror.style.fontSize, mirror.style.lineHeight].join("\u0000");
	if (key === TEXT_PAD_CACHE.key) return TEXT_PAD_CACHE.value;

	const previousPadding = mirror.style.paddingTop;
	mirror.style.paddingTop = "0px";

	// Measure both scripts: if the Myanmar face moves the line box the two
	// values differ, which is exactly the misalignment we must not ship.
	const latin = probeBaseline("Mg");
	const myanmar = probeBaseline("မြန်မာစာ");
	if (Math.abs(latin - myanmar) > 0.05) {
		console.warn(
			`[caret] baseline differs by ${((myanmar - latin) / scale).toFixed(2)} paper px ` +
			`between Latin and Myanmar; check font metric overrides`,
		);
	}

	// Use the taller of the two line boxes so neither script can push the
	// first baseline below the canvas one.
	const firstBaseline = (LINE_GAP - 1.5 * MM) * scale;
	const padCss = firstBaseline - Math.max(latin, myanmar);

	mirror.style.paddingTop = previousPadding;
	TEXT_PAD_CACHE.key = key;
	TEXT_PAD_CACHE.value = padCss / scale;
	return TEXT_PAD_CACHE.value;
}

let TEXT_PAD_TOP = 0;

let pageIdCounter = 0;

function makePageId() {
	if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
	if (typeof crypto !== "undefined" && crypto.getRandomValues) {
		const bytes = crypto.getRandomValues(new Uint8Array(8));
		return `page-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
	}
	pageIdCounter++;
	return `page-${Date.now().toString(36)}-${pageIdCounter.toString(36)}`;
}

function ensurePageIds() {
	while (pageIds.length < pages.length) pageIds.push(makePageId());
	if (pageIds.length > pages.length) pageIds.length = pages.length;
}

function currentPageId() {
	if (!pageIds[currentPage]) pageIds[currentPage] = makePageId();
	return pageIds[currentPage];
}

function saveState() {
	ensurePageIds();
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			pages,
			pageIds,
			currentPage,
			template,
			showMargin,
			showHoles,
			showThrough,
			fontMode,
		}));
	} catch {
		// Storage can be unavailable (private mode / file://). Typing still works.
	}
}

function loadState() {
	try {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
		if (!saved) return;
		if (Array.isArray(saved.pages) && saved.pages.every((p) => typeof p === "string")) {
			pages = saved.pages.length ? saved.pages : [""];
			currentPage = Math.max(0, Math.min(saved.pages.length - 1, Number(saved.currentPage) || 0));
			const savedIds = Array.isArray(saved.pageIds) ? saved.pageIds : [];
			pageIds = pages.map((_, i) =>
				(typeof savedIds[i] === "string" && savedIds[i]) ? savedIds[i] : makePageId());
		}
		if (["ruled", "grid", "dotted"].includes(saved.template)) template = saved.template;
		if (typeof saved.showMargin === "boolean") showMargin = saved.showMargin;
		if (typeof saved.showHoles === "boolean") showHoles = saved.showHoles;
		if (typeof saved.showThrough === "boolean") showThrough = saved.showThrough;
		if (FONT_MODES.includes(saved.fontMode)) fontMode = saved.fontMode;
	} catch {
		// Ignore a corrupt save rather than blocking startup.
	}
}

loadState();
ensurePageIds();
// Persist generated page ids immediately so ink stays identical across
// reloads even before the first keystroke.
saveState();

document.documentElement.style.setProperty("--ink-font-stack", fontStack(fontMode));
textarea.style.fontFamily = fontStack(fontMode);
mirror.style.fontFamily = fontStack(fontMode);

function easeOutCubic(t) {
	return 1 - Math.pow(1 - t, 3);
}

function clampScale(s, fitScale) {
	return Math.max(fitScale, Math.min(fitScale * 8, s));
}

function fitRect(vw, vh) {
	return paperRectFn(vw, vh, PAPER_WIDTH, PAPER_HEIGHT);
}

function screenToPaper(sx, sy) {
	return { x: (sx - viewX) / viewScale, y: (sy - viewY) / viewScale };
}

function getPinchCenter() {
	const pts = Array.from(pointers.values());
	if (pts.length < 2) return null;
	const dx = pts[1].x - pts[0].x;
	const dy = pts[1].y - pts[0].y;
	return {
		dist: Math.hypot(dx, dy),
		cx: (pts[0].x + pts[1].x) / 2,
		cy: (pts[0].y + pts[1].y) / 2,
	};
}

function drawRuledLines(c) {
	c.strokeStyle = "#e0dbc8";
	c.lineWidth = Math.max(1, Math.round(PAPER_HEIGHT / 2500));
	for (let y = TOP_MARGIN; y < PAPER_HEIGHT - BOTTOM_MARGIN; y += LINE_GAP) {
		c.beginPath();
		c.moveTo(LEFT_MARGIN, y);
		c.lineTo(PAPER_WIDTH - RIGHT_MARGIN, y);
		c.stroke();
	}
}

function drawGridLines(c) {
	c.strokeStyle = "#e0dbc8";
	c.lineWidth = Math.max(1, Math.round(PAPER_WIDTH / 2500));
	for (let x = LEFT_MARGIN; x < PAPER_WIDTH - RIGHT_MARGIN; x += LINE_GAP) {
		c.beginPath();
		c.moveTo(x, TOP_MARGIN);
		c.lineTo(x, PAPER_HEIGHT - BOTTOM_MARGIN);
		c.stroke();
	}
}

function drawDotted(c) {
	c.fillStyle = "#e0dbc8";
	const dot = Math.max(1, Math.round(PAPER_HEIGHT / 5000));
	for (let y = TOP_MARGIN; y < PAPER_HEIGHT - BOTTOM_MARGIN; y += LINE_GAP) {
		for (let x = LEFT_MARGIN; x < PAPER_WIDTH - RIGHT_MARGIN; x += LINE_GAP) {
			c.beginPath();
			c.arc(x, y, dot / 2, 0, Math.PI * 2);
			c.fill();
		}
	}
}

function drawMargin(c) {
	c.strokeStyle = "#d46b6b";
	c.lineWidth = Math.max(1, Math.round(PAPER_WIDTH / 1466));
	c.beginPath();
	c.moveTo(MARGIN_LINE_X, TOP_MARGIN);
	c.lineTo(MARGIN_LINE_X, PAPER_HEIGHT - BOTTOM_MARGIN);
	c.stroke();
}

function drawHoles(c) {
	c.fillStyle = "#d46b6b";
	for (let hy = FIRST_HOLE_Y; hy < PAPER_HEIGHT - BOTTOM_MARGIN; hy += HOLE_SPACING) {
		c.beginPath();
		c.arc(HOLE_X, hy, HOLE_RADIUS, 0, Math.PI * 2);
		c.fill();
	}
}

function drawBackground(c) {
	c.fillStyle = "#fefdf8";
	c.fillRect(0, 0, PAPER_WIDTH, PAPER_HEIGHT);

	if (template === "ruled" || template === "grid") {
		drawRuledLines(c);
	}
	if (template === "grid") {
		drawGridLines(c);
	}
	if (template === "dotted") {
		drawDotted(c);
	}
	if (showMargin) {
		drawMargin(c);
	}
	if (showHoles) {
		drawHoles(c);
	}
}

function updateTextOverlayStyles() {
	const scale = viewScale;
	const textX = LEFT_MARGIN + TEXT_INSET;
	const textWidth = PAPER_WIDTH - RIGHT_MARGIN - textX;

	textarea.style.left = (viewX + textX * scale) + "px";
	textarea.style.top = (viewY + TOP_MARGIN * scale) + "px";
	textarea.style.width = (textWidth * scale) + "px";
	textarea.style.height = ((PAPER_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN) * scale) + "px";
	textarea.style.fontSize = (FONT_SIZE * scale) + "px";
	textarea.style.lineHeight = (LINE_GAP * scale) + "px";
	textarea.style.fontFamily = fontStack(fontMode);
	textarea.style.verticalAlign = "baseline";

	mirror.style.width = textarea.style.width;
	mirror.style.fontSize = textarea.style.fontSize;
	mirror.style.lineHeight = textarea.style.lineHeight;
	mirror.style.fontFamily = textarea.style.fontFamily;
	mirror.style.verticalAlign = "baseline";

	// Negative padding is impossible, so clamp once and keep TEXT_PAD_TOP in
	// step with the value actually applied.
	TEXT_PAD_TOP = Math.max(0, measureTextPadTop(scale));
	const padTop = (TEXT_PAD_TOP * scale) + "px";
	textarea.style.paddingTop = padTop;
	mirror.style.paddingTop = padTop;
}

function visualRow(rect, state, lineHeight) {
	if (!rect || (!rect.width && !rect.height)) return state.index;
	if (state.firstTop === null) state.firstTop = rect.top;
	return Math.max(state.index, Math.round((rect.top - state.firstTop) / lineHeight));
}

function paragraphGroups(paragraph, node, range, lineHeight) {
	const groups = [];
	const state = { firstTop: null, index: 0 };
	for (const cluster of graphemeOffsets(paragraph)) {
		range.setStart(node, cluster.offset);
		range.setEnd(node, cluster.offset + cluster.segment.length);
		const rects = range.getClientRects();
		const rect = rects.length ? rects[0] : range.getBoundingClientRect();
		state.index = visualRow(rect, state, lineHeight);
		if (!groups[state.index]) groups[state.index] = { parts: [], start: cluster.offset };
		groups[state.index].parts.push(cluster.segment);
	}
	return groups;
}

// Read the browser's real line breaks. One text node per hard line keeps the
// shaper intact; a Range over each grapheme tells us which visual row it landed
// on. No spans, no per-character text nodes.
function mirrorLines(text) {
	if (text === "") return [{ text: "", start: 0 }];
	const lineHeight = parseFloat(mirror.style.lineHeight)
		|| parseFloat(getComputedStyle(mirror).lineHeight)
		|| LINE_GAP;
	const lines = [];
	const range = document.createRange();
	let paragraphStart = 0;

	for (const paragraph of text.split("\n")) {
		if (paragraph === "") {
			lines.push({ text: "", start: paragraphStart });
			paragraphStart += 1;
			continue;
		}
		mirror.textContent = paragraph;
		for (const group of paragraphGroups(paragraph, mirror.firstChild, range, lineHeight)) {
			if (group) lines.push({ text: group.parts.join(""), start: paragraphStart + group.start });
		}
		paragraphStart += paragraph.length + 1;
	}
	return lines.length ? lines : [{ text: "", start: 0 }];
}

let layoutCacheKey = "";
let layoutCacheLines = [];

function getPageLines(text, measure) {
	updateTextOverlayStyles();
	const key = [
		fontMode,
		textarea.style.width,
		textarea.style.fontSize,
		textarea.style.paddingTop,
		text,
	].join("\u0000");
	if (key === layoutCacheKey) return layoutCacheLines;

	const maxWidth = PAPER_WIDTH - RIGHT_MARGIN - (LEFT_MARGIN + TEXT_INSET);
	measure.font = fontSpec(fontMode, FONT_SIZE);
	measure.textBaseline = "alphabetic";

	let lines = null;
	try {
		lines = mirrorLines(text);
	} catch {
		// Range measurement is unavailable in very old webviews.
		lines = null;
	}
	if (!lines) lines = layoutTextLines(text, maxWidth, measure);

	layoutCacheKey = key;
	layoutCacheLines = lines;
	return lines;
}

function wrappedPage(text, measure) {
	return getPageLines(text, measure);
}

// The real caret rect, measured in the mirror at the same offset the textarea
// uses. The zero-size marker's bottom is the baseline of that line box.
function mirrorCaretMetrics(offset) {
	const text = textarea.value;
	const index = snapToGrapheme(text, offset);
	updateTextOverlayStyles();

	// Ask the browser which visual line owns this offset. The baseline marker
	// goes at the start of that line, where a zero-width inline-block cannot
	// change where a soft wrap fell.
	const lines = getPageLines(text, ctx);
	const lineIndex = lineIndexForOffset(lines, index);
	const lineStart = lines[lineIndex] ? lines[lineIndex].start : 0;

	// mirrorLines() leaves only the last paragraph in the mirror, so put the
	// whole value back before using a Range over it.
	mirror.textContent = text;
	if (!mirror.firstChild) mirror.appendChild(document.createTextNode(""));

	const node = mirror.firstChild;
	const range = document.createRange();
	range.setStart(node, index);
	range.setEnd(node, index);
	const rects = range.getClientRects();
	const caretRect = rects.length ? rects[0] : range.getBoundingClientRect();

	const baseRange = document.createRange();
	baseRange.setStart(node, lineStart);
	baseRange.setEnd(node, lineStart);
	baseRange.insertNode(baselineMarker);

	const mirrorRect = mirror.getBoundingClientRect();
	const markerRect = baselineMarker.getBoundingClientRect();
	baselineMarker.remove();
	mirror.normalize();

	const scale = viewScale;
	return {
		offset: index,
		lineIndex,
		x: (LEFT_MARGIN + TEXT_INSET) + (caretRect.left - mirrorRect.left) / scale,
		baseline: TOP_MARGIN + (markerRect.bottom - mirrorRect.top) / scale,
		top: TOP_MARGIN + (caretRect.top - mirrorRect.top) / scale,
		bottom: TOP_MARGIN + (caretRect.bottom - mirrorRect.top) / scale,
	};
}

// Where the canvas actually draws the same offset. Both numbers are in paper
// pixels, so they can be compared directly regardless of zoom.
function drawnMetricsAt(offset) {
	const text = textarea.value;
	const lines = getPageLines(text, ctx);
	ctx.font = fontSpec(fontMode, FONT_SIZE);
	ctx.textBaseline = "alphabetic";
	return caretMetricsForOffset(
		text,
		offset,
		lines,
		ctx,
		LEFT_MARGIN + TEXT_INSET,
		inkBaselineY,
	);
}

// The caret is painted where the ink is drawn, not where the zoomed textarea
// font happens to round its advance. This is the rect the user actually sees.
function customCaretMetrics(offset = textarea.selectionStart) {
	return drawnMetricsAt(offset);
}

function markCaretSolid() {
	caretSolidUntil = performance.now() + CARET_SOLID_MS;
	caretVisible = true;
}

function startCaretBlink() {
	if (caretBlinkTimer) return;
	caretBlinkTimer = setInterval(() => {
		if (document.activeElement !== textarea) return;
		// Keep the bar solid while the user is dragging the paper.
		if (pointers.size > 0 || performance.now() < caretSolidUntil) {
			if (!caretVisible) {
				caretVisible = true;
				scheduleRender();
			}
			return;
		}
		caretVisible = !caretVisible;
		scheduleRender();
	}, CARET_BLINK_MS);
}

function stopCaretBlink() {
	if (caretBlinkTimer) {
		clearInterval(caretBlinkTimer);
		caretBlinkTimer = null;
	}
	caretVisible = false;
}

function drawCaret() {
	if (!ctx || !fontsReady) return;
	if (document.activeElement !== textarea) return;
	if (textarea.selectionStart !== textarea.selectionEnd) return;
	if (!caretVisible) return;

	const caret = customCaretMetrics();
	// Constant on-screen width: a paper-pixel width would become a fat bar at
	// 8x zoom and vanish at fit zoom on a phone.
	const width = 1.2 / viewScale;
	ctx.save();
	ctx.fillStyle = "rgb(28, 38, 58)";
	ctx.fillRect(caret.x, caret.baseline - 0.8 * FONT_SIZE, width, FONT_SIZE);
	ctx.restore();
}

function rebuildPageCache() {
	if (!ctx || !bgCanvas) return;

	const t0 = isMobile ? performance.now() : 0;
	if (!pageCanvas) {
		pageCanvas = document.createElement("canvas");
		pageCanvas.width = Math.max(1, Math.round(PAPER_WIDTH * SCREEN_QUALITY));
		pageCanvas.height = Math.max(1, Math.round(PAPER_HEIGHT * SCREEN_QUALITY));
		pageCtx = pageCanvas.getContext("2d");
	}

	const wrapped = wrappedPage(pages[currentPage], ctx);
	const previous = showThrough && currentPage > 0
		? wrappedPage(pages[currentPage - 1], ctx)
		: null;
	const ink = getInkPage(wrapped, INK_QUALITY, {
		fontMode,
		pageId: currentPageId(),
		showThrough,
		previousLines: previous,
		previousPageId: pageIds[currentPage - 1],
	});

	pageCtx.setTransform(1, 0, 0, 1, 0, 0);
	pageCtx.globalCompositeOperation = "source-over";
	pageCtx.globalAlpha = 1;
	pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
	pageCtx.imageSmoothingEnabled = true;
	pageCtx.drawImage(bgCanvas, 0, 0, pageCanvas.width, pageCanvas.height);
	pageCtx.globalCompositeOperation = "multiply";
	pageCtx.drawImage(ink, 0, 0, pageCanvas.width, pageCanvas.height);
	pageCtx.globalCompositeOperation = "source-over";

	pageDirty = false;
	if (isMobile) {
		const ms = performance.now() - t0;
		const kind = pendingKeystrokePerf ? "keystroke redraw" : "page rebuild";
		pendingKeystrokePerf = false;
		if (DEBUG) {
			console.log(`[perf] ${kind} ${ms.toFixed(1)}ms`);
			window.__b5perf = { keystrokeMs: ms, pageMs: ms };
		}
	}
}

// ?debug paints the nominal baseline, the real caret rect measured from the
// mirror and each line's drawn bounding box. All coordinates are paper pixels.
function drawDebugOverlay() {
	if (!DEBUG) return;

	const text = textarea.value;
	const lines = getPageLines(text, ctx);
	const textX = LEFT_MARGIN + TEXT_INSET;
	const textWidth = PAPER_WIDTH - RIGHT_MARGIN - textX;
	const px = 1 / viewScale;

	ctx.save();
	ctx.lineWidth = Math.max(px, 0.25);
	ctx.font = fontSpec(fontMode, FONT_SIZE);
	ctx.textBaseline = "alphabetic";

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const baseline = inkBaselineY(i);

		ctx.strokeStyle = "rgba(30, 120, 255, 0.85)";
		ctx.beginPath();
		ctx.moveTo(textX - 1 * MM, baseline);
		ctx.lineTo(textX + textWidth + 1 * MM, baseline);
		ctx.stroke();

		ctx.strokeStyle = "rgba(255, 160, 0, 0.35)";
		ctx.strokeRect(textX, TOP_MARGIN + i * LINE_GAP, textWidth, LINE_GAP);

		const metrics = ctx.measureText(line.text);
		const ascent = metrics.actualBoundingBoxAscent || FONT_SIZE * 0.8;
		const descent = metrics.actualBoundingBoxDescent || FONT_SIZE * 0.2;
		ctx.strokeStyle = "rgba(20, 150, 70, 0.7)";
		ctx.strokeRect(textX, baseline - ascent, metrics.width, ascent + descent);
	}

	if (document.activeElement === textarea) {
		const caret = mirrorCaretMetrics(textarea.selectionStart);
		const caretTop = caret.bottom > caret.top ? caret.top : caret.baseline - 0.8 * FONT_SIZE;
		const caretBottom = caret.bottom > caret.top ? caret.bottom : caret.baseline + 0.2 * FONT_SIZE;
		ctx.strokeStyle = "rgba(220, 0, 0, 0.95)";
		ctx.strokeRect(caret.x, caretTop, 1.2 / viewScale, Math.max(px, caretBottom - caretTop));
		ctx.beginPath();
		ctx.arc(caret.x, caret.baseline, 1.2 * MM, 0, Math.PI * 2);
		ctx.stroke();
	}

	ctx.restore();
}

function render() {
	if (!ctx || !fontsReady) return;

	const t0 = isMobile ? performance.now() : 0;
	updateTextOverlayStyles();
	if (pageDirty) rebuildPageCache();

	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	// Work in CSS pixels; dpr only controls how many device pixels back the
	// canvas. Without this the paper and the textarea drift apart on hi-dpi
	// screens.
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.translate(viewX, viewY);
	ctx.scale(viewScale, viewScale);

	if (pageCanvas) ctx.drawImage(pageCanvas, 0, 0, PAPER_WIDTH, PAPER_HEIGHT);
	drawCaret();
	drawDebugOverlay();

	ctx.restore();

	dirty = false;
	if (isMobile && pointers.size > 0) {
		frameCount++;
		if (frameCount % 30 === 0 && DEBUG) {
			const ms = performance.now() - t0;
			console.log(`[perf] pan frame ${ms.toFixed(1)}ms`);
			window.__b5perf = { ...(window.__b5perf || {}), panMs: ms };
		}
	}
}

function springAxis(pos, vel, min, max) {
	const clamped = Math.min(max, Math.max(min, pos));
	if (pos < clamped - 0.5 || pos > clamped + 0.5) {
		// Ease back from overscroll without any bounce.
		return { pos: pos + (clamped - pos) * 0.18, vel: 0, moving: true };
	}
	if (Math.abs(vel) > 0.1) {
		return { pos: pos + vel, vel: vel * 0.92, moving: true };
	}
	return { pos: clamped, vel: 0, moving: false };
}

function animate(now) {
	let moving = false;
	if (animating) {
		const t = Math.min(1, (now - animStart) / animDur);
		const eased = easeOutCubic(t);
		viewScale = animFrom.scale + (animTo.scale - animFrom.scale) * eased;
		viewX = animFrom.x + (animTo.x - animFrom.x) * eased;
		viewY = animFrom.y + (animTo.y - animFrom.y) * eased;
		if (t >= 1) {
			viewScale = animTo.scale;
			viewX = animTo.x;
			viewY = animTo.y;
			animating = false;
		}
		dirty = true;
		moving = true;
	} else if (pointers.size === 0) {
		const bounds = viewBounds();
		const sx = springAxis(viewX, vx, bounds.xMin, bounds.xMax);
		const sy = springAxis(viewY, vy, bounds.yMin, bounds.yMax);
		if (sx.pos !== viewX || sy.pos !== viewY) dirty = true;
		viewX = sx.pos;
		viewY = sy.pos;
		vx = sx.vel;
		vy = sy.vel;
		moving = sx.moving || sy.moving;
	}

	if (dirty) {
		render();
	}

	if (moving || dirty) {
		rafId = requestAnimationFrame(animate);
	} else {
		rafId = null;
	}
}

function scheduleRender() {
	dirty = true;
	if (!rafId) {
		rafId = requestAnimationFrame(animate);
	}
}

function clampView() {
	const vs = { w: canvas.clientWidth, h: canvas.clientHeight };
	const fit = fitRect(vs.w, vs.h);
	viewScale = clampScale(viewScale, fit.scale);

	// Each axis centers on its own. A wide desktop window must not shift the
	// paper sideways just because the paper is taller than the window.
	const bounds = viewBounds();
	viewX = Math.max(bounds.xMin, Math.min(bounds.xMax, viewX));
	viewY = Math.max(bounds.yMin, Math.min(bounds.yMax, viewY));
}

function keyboardOpen() {
	const vv = window.visualViewport;
	return !!vv && vv.height < window.innerHeight - 80;
}

function viewBounds() {
	const vs = { w: canvas.clientWidth, h: canvas.clientHeight };
	const paperW = PAPER_WIDTH * viewScale;
	const paperH = PAPER_HEIGHT * viewScale;
	let yMin = paperH < vs.h ? (vs.h - paperH) / 2 : vs.h - paperH;
	let yMax = paperH < vs.h ? (vs.h - paperH) / 2 : 0;

	// While the keyboard is open the page is allowed to sit wherever the caret
	// needs it; do not spring back until the keyboard closes.
	if (keyboardOpen() && document.activeElement === textarea) {
		yMin = Math.min(yMin, viewY);
		yMax = Math.max(yMax, viewY);
	}

	return {
		xMin: paperW < vs.w ? (vs.w - paperW) / 2 : vs.w - paperW,
		xMax: paperW < vs.w ? (vs.w - paperW) / 2 : 0,
		yMin,
		yMax,
	};
}

function clampPosition(scale, x, y) {
	const vs = { w: canvas.clientWidth, h: canvas.clientHeight };
	const paperW = PAPER_WIDTH * scale;
	const paperH = PAPER_HEIGHT * scale;
	if (paperW < vs.w) x = (vs.w - paperW) / 2;
	else x = Math.max(vs.w - paperW, Math.min(0, x));
	if (paperH < vs.h) y = (vs.h - paperH) / 2;
	else y = Math.max(vs.h - paperH, Math.min(0, y));
	return { x, y };
}

function recordDragSample(x, y, now) {
	dragSamples.push({ x, y, t: now });
	const cutoff = now - INERTIA_WINDOW;
	while (dragSamples.length > 2 && dragSamples[0].t < cutoff) dragSamples.shift();
}

// Velocity is the displacement over the last ~80ms, in pixels per frame. A
// stale last sample means the finger rested before lifting, so no fling.
function startInertia(now) {
	if (dragSamples.length < 2) return;
	const last = dragSamples[dragSamples.length - 1];
	if (now - last.t > INERTIA_MAX_AGE) return;

	const first = dragSamples[0];
	const dt = last.t - first.t;
	if (dt < 8) return;

	const max = 70;
	vx = Math.max(-max, Math.min(max, ((last.x - first.x) / dt) * FRAME_MS));
	vy = Math.max(-max, Math.min(max, ((last.y - first.y) / dt) * FRAME_MS));
}

function startAnimTo(scale, x, y, dur = 220) {
	const target = clampPosition(scale, x, y);
	animFrom = { scale: viewScale, x: viewX, y: viewY };
	animTo = { scale, x: target.x, y: target.y };
	animStart = performance.now();
	animDur = dur;
	animating = true;
	vx = 0;
	vy = 0;
	scheduleRender();
}

function resetView() {
	const vs = { w: canvas.clientWidth, h: canvas.clientHeight };
	const r = fitRect(vs.w, vs.h);
	startAnimTo(r.scale, r.left, r.top);
}

// Map a tap inside the paper to a text offset. Visual wrapped lines are walked
// forward through the source so wrapped lines and hard newlines both land on
// the right character.
function caretIndexFromPoint(cx, cy) {
	const paper = screenToPaper(cx, cy);
	if (paper.x < 0 || paper.x > PAPER_WIDTH || paper.y < 0 || paper.y > PAPER_HEIGHT) return null;

	ctx.font = fontSpec(fontMode, FONT_SIZE);
	const text = textarea.value;
	const lines = getPageLines(text, ctx);
	const lineIndex = Math.max(0, Math.min(lines.length - 1, Math.floor((paper.y - TOP_MARGIN) / LINE_GAP)));
	const line = lines[lineIndex];
	if (!line) return 0;

	const target = paper.x - (LEFT_MARGIN + TEXT_INSET);
	let column = 0;
	let prefixWidth = 0;
	// Measure cumulative prefixes, never one code point at a time: shaping makes
	// a Myanmar mark's width depend on the characters before it.
	for (const cluster of graphemeOffsets(line.text)) {
		const end = cluster.offset + cluster.segment.length;
		const width = ctx.measureText(line.text.slice(0, end)).width;
		if (target < prefixWidth + (width - prefixWidth) / 2) break;
		prefixWidth = width;
		column = end;
	}

	return Math.min(line.start + column, text.length);
}

function focusCaretAt(cx, cy) {
	const index = caretIndexFromPoint(cx, cy);
	if (index === null) return;
	try {
		textarea.focus({ preventScroll: true });
	} catch {
		textarea.focus();
	}
	textarea.setSelectionRange(index, index);
	msg.textContent = "";
	ensureCaretVisible();
}

function cancelTapFocus() {
	if (!tapFocusTimer) return;
	clearTimeout(tapFocusTimer);
	tapFocusTimer = null;
}

// The visual viewport is the part of the page not covered by the soft
// keyboard. Its height shrinks while the keyboard is open, while the layout
// viewport (and our fixed canvas) usually stays the same.
function visualViewportBounds() {
	const vv = window.visualViewport;
	if (!vv) return { top: 0, bottom: canvas.clientHeight };
	return { top: vv.offsetTop, bottom: vv.offsetTop + vv.height };
}

function caretLineIndex() {
	const text = textarea.value;
	const index = Math.max(0, Math.min(text.length, textarea.selectionStart));
	const lines = getPageLines(text, ctx);
	return lineIndexForOffset(lines, index);
}

// Pan (never zoom) so the caret sits above the keyboard. The page can move
// past its normal bounds here; viewBounds() relaxes the Y axis while typing.
function ensureCaretVisible() {
	if (!ctx || document.activeElement !== textarea) return;

	const { top, bottom } = visualViewportBounds();
	const margin = 24;
	const lineIndex = caretLineIndex();
	const lineTop = viewY + (TOP_MARGIN + TEXT_PAD_TOP + lineIndex * LINE_GAP) * viewScale;
	const lineBottom = lineTop + LINE_GAP * viewScale;

	let dy = 0;
	if (lineBottom > bottom - margin) dy = bottom - margin - lineBottom;
	else if (lineTop < top + margin) dy = top + margin - lineTop;
	if (Math.abs(dy) < 0.5) return;

	viewY += dy;
	scheduleRender();
}

function zoomAtTap(cx, cy) {
	const fit = fitRect(canvas.clientWidth, canvas.clientHeight);
	if (viewScale > fit.scale * 1.01) {
		resetView();
		return;
	}

	const paper = screenToPaper(cx, cy);
	const targetScale = Math.min(fit.scale * 8, viewScale * 2.5);
	startAnimTo(targetScale, cx - paper.x * targetScale, cy - paper.y * targetScale);
}

function finishPointerGesture(pointer, now) {
	// A tap needs one pointer, little movement and a short press. Mouse
	// clicks are not time-limited; touch presses are.
	const isTap = !gesturePinched
		&& pointer.moved < 8
		&& (pointer.type === "mouse" || now - pointer.startTime < 300);
	if (!isTap) {
		if (!gesturePinched) startInertia(now);
		return;
	}

	const rect = canvas.getBoundingClientRect();
	const cx = pointer.x - rect.left;
	const cy = pointer.y - rect.top;

	const dx = Math.abs(pointer.x - lastTapX);
	const dy = Math.abs(pointer.y - lastTapY);
	if (lastTapTime > 0 && dx < 20 && dy < 20 && now - lastTapTime < 300) {
		lastTapTime = 0;
		cancelTapFocus();
		zoomAtTap(cx, cy);
		return;
	}

	lastTapTime = now;
	lastTapX = pointer.x;
	lastTapY = pointer.y;
	// Wait for the double-tap window before opening the keyboard. A second
	// tap cancels this and zooms instead.
	cancelTapFocus();
	tapFocusTimer = setTimeout(() => {
		tapFocusTimer = null;
		focusCaretAt(cx, cy);
	}, 300);
}

canvas.addEventListener("pointerdown", (e) => {
	if (e.target === resetBtn) return;
	if (e.button !== 0 && e.button !== 1) return;

	const now = performance.now();
	if (pointers.size === 0) {
		gesturePinched = false;
		cancelTapFocus();
	}
	pointers.set(e.pointerId, {
		x: e.clientX,
		y: e.clientY,
		startX: e.clientX,
		startY: e.clientY,
		startTime: now,
		moved: 0,
		type: e.pointerType,
	});
	lastPointerX = e.clientX;
	lastPointerY = e.clientY;
	canvas.setPointerCapture(e.pointerId);
	vx = 0;
	vy = 0;
	animating = false;
	if (pointers.size === 1) {
		dragSamples.length = 0;
		recordDragSample(e.clientX, e.clientY, now);
	}

	if (pointers.size === 2) {
		gesturePinched = true;
		dragSamples.length = 0;
		const pinch = getPinchCenter();
		if (pinch) {
			pinchStartDist = pinch.dist;
			pinchStartScale = viewScale;
		}
	}
	markCaretSolid();
	e.preventDefault();
}, { passive: false });

canvas.addEventListener("pointermove", (e) => {
	const pointer = pointers.get(e.pointerId);
	if (!pointer) return;

	pointer.x = e.clientX;
	pointer.y = e.clientY;
	pointer.moved = Math.max(pointer.moved, Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY));

	if (pointers.size === 1) {
		const dx = e.clientX - lastPointerX;
		const dy = e.clientY - lastPointerY;
		viewX += dx;
		viewY += dy;
		lastPointerX = e.clientX;
		lastPointerY = e.clientY;

		// Let the page follow the finger a little past its edges; the spring
		// in animate() pulls it back on release.
		const bounds = viewBounds();
		viewX = Math.max(bounds.xMin - MAX_OVERSCROLL, Math.min(bounds.xMax + MAX_OVERSCROLL, viewX));
		viewY = Math.max(bounds.yMin - MAX_OVERSCROLL, Math.min(bounds.yMax + MAX_OVERSCROLL, viewY));

		recordDragSample(e.clientX, e.clientY, performance.now());
		dirty = true;
	} else if (pointers.size >= 2) {
		gesturePinched = true;
		const pinch = getPinchCenter();
		if (pinch && pinchStartDist > 0) {
			const rect = canvas.getBoundingClientRect();
			const centerX = pinch.cx - rect.left;
			const centerY = pinch.cy - rect.top;

			const paperBefore = screenToPaper(centerX, centerY);
			const newScale = pinchStartScale * (pinch.dist / pinchStartDist);
			viewScale = newScale;
			clampView();
			const paperAfter = screenToPaper(centerX, centerY);
			viewX += (paperBefore.x - paperAfter.x) * viewScale;
			viewY += (paperBefore.y - paperAfter.y) * viewScale;

			lastPointerX = pinch.cx;
			lastPointerY = pinch.cy;
			clampView();
			dirty = true;
		}
	}
	markCaretSolid();
	scheduleRender();
}, { passive: true });

canvas.addEventListener("pointerup", (e) => {
	const pointer = pointers.get(e.pointerId);
	if (!pointer) return;

	pointers.delete(e.pointerId);
	if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

	const now = performance.now();
	if (pointers.size === 0) {
		finishPointerGesture(pointer, now);
		gesturePinched = false;
		scheduleRender();
	} else if (pointers.size === 1) {
		const remaining = pointers.values().next().value;
		lastPointerX = remaining.x;
		lastPointerY = remaining.y;
		dragSamples.length = 0;
		recordDragSample(remaining.x, remaining.y, now);
	}
}, { passive: true });

canvas.addEventListener("pointercancel", (e) => {
	pointers.delete(e.pointerId);
	if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
	if (pointers.size === 0) {
		gesturePinched = false;
		vx = 0;
		vy = 0;
		scheduleRender();
	}
}, { passive: true });

canvas.addEventListener("lostpointercapture", (e) => {
	pointers.delete(e.pointerId);
	if (pointers.size === 0) {
		gesturePinched = false;
		vx = 0;
		vy = 0;
		scheduleRender();
	}
}, { passive: true });

canvas.addEventListener("wheel", (e) => {
	e.preventDefault();
	const rect = canvas.getBoundingClientRect();
	const mouseX = e.clientX - rect.left;
	const mouseY = e.clientY - rect.top;

	const paperBefore = screenToPaper(mouseX, mouseY);

	if (e.ctrlKey) {
		viewScale *= Math.exp(-e.deltaY * 0.0015);
	} else {
		viewX -= e.deltaX;
		viewY -= e.deltaY;
		vx = -e.deltaX * 2;
		vy = -e.deltaY * 2;
	}

	clampView();
	if (e.ctrlKey) {
		const paperAfter = screenToPaper(mouseX, mouseY);
		viewX += (paperBefore.x - paperAfter.x) * viewScale;
		viewY += (paperBefore.y - paperAfter.y) * viewScale;
	}
	clampView();
	dirty = true;
	scheduleRender();
}, { passive: false });

resetBtn.addEventListener("click", resetView);
resetBtn.addEventListener("keydown", (e) => {
	if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		resetView();
	}
});

window.addEventListener("keydown", (e) => {
	if (e.key === "r" || e.key === "R") {
		if (!e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement !== textarea) {
			resetView();
		}
	}
	if (e.key.toLowerCase() === "z" && e.ctrlKey) {
		e.preventDefault();
		if (e.shiftKey) redo(); else undo();
	}
});

function snapshotState() {
	return { pages: pages.slice(), pageIds: pageIds.slice(), currentPage };
}

function commitUndo(state) {
	undoStack.push(state);
	if (undoStack.length > 50) undoStack.shift();
}

function flushUndo() {
	if (undoTimer) {
		clearTimeout(undoTimer);
		undoTimer = null;
	}
	if (pendingUndo) {
		commitUndo(pendingUndo);
		pendingUndo = null;
	}
}

// Capture the state before the first keystroke of a typing burst. The burst
// becomes one undo step after 400ms of quiet.
function queueUndo() {
	if (!pendingUndo) {
		pendingUndo = snapshotState();
		redoStack = [];
	}
	if (undoTimer) clearTimeout(undoTimer);
	undoTimer = setTimeout(flushUndo, 400);
}

function restoreState(state) {
	pages = state.pages.slice();
	pageIds = Array.isArray(state.pageIds) ? state.pageIds.slice() : [];
	ensurePageIds();
	currentPage = Math.max(0, Math.min(pages.length - 1, state.currentPage));
	textarea.value = pages[currentPage];
	dirty = true;
	pageDirty = true;
	scheduleRender();
	updatePageUI();
	saveState();
}

function undo() {
	flushUndo();
	if (undoStack.length === 0) return;
	redoStack.push(snapshotState());
	restoreState(undoStack.pop());
}

function redo() {
	flushUndo();
	if (redoStack.length === 0) return;
	undoStack.push(snapshotState());
	restoreState(redoStack.pop());
}

textarea.addEventListener("input", () => {
	queueUndo();
	pages[currentPage] = textarea.value;
	dirty = true;
	pageDirty = true;
	pendingKeystrokePerf = true;
	markCaretSolid();
	scheduleRender();
	checkPageFlow();
	ensureCaretVisible();
	saveState();
});

textarea.addEventListener("focus", () => {
	msg.textContent = "";
	markCaretSolid();
	startCaretBlink();
	ensureCaretVisible();
	scheduleRender();
});
textarea.addEventListener("blur", () => {
	msg.textContent = "Click to type";
	stopCaretBlink();
	scheduleRender();
});
textarea.addEventListener("keydown", () => {
	markCaretSolid();
	scheduleRender();
});
textarea.addEventListener("keyup", () => {
	markCaretSolid();
	ensureCaretVisible();
	scheduleRender();
});
document.addEventListener("selectionchange", () => {
	if (document.activeElement === textarea) {
		markCaretSolid();
		ensureCaretVisible();
		scheduleRender();
	}
});

if (window.visualViewport) {
	const onViewportChange = () => {
		ensureCaretVisible();
		scheduleRender();
	};
	window.visualViewport.addEventListener("resize", onViewportChange);
	window.visualViewport.addEventListener("scroll", onViewportChange);
}

// Prefer the browser's visual line starts for the page cut, so we never break
// in the middle of a Myanmar syllable that the textarea kept together. Fall
// back to wrapText if the mirror is unavailable.
function splitPageForDisplay(text, measure, maxLines, maxWidth) {
	const lines = getPageLines(text, measure);
	if (lines.length <= maxLines) return null;
	const cut = lines[maxLines] ? lines[maxLines].start : 0;
	if (cut > 0 && cut < text.length) {
		return { head: text.slice(0, cut), tail: text.slice(cut), cut };
	}
	return splitPage(text, maxWidth, maxLines, measure);
}

// Move overflow forward from the page being edited through every following
// page. Editing page 2 of 5 pushes its overflow into page 3 instead of only
// working on the last page.
function checkPageFlow() {
	ctx.font = fontSpec(fontMode, FONT_SIZE);
	const maxLines = Math.floor((PAPER_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN) / LINE_GAP);
	const textX = LEFT_MARGIN + TEXT_INSET;
	const maxWidth = PAPER_WIDTH - RIGHT_MARGIN - textX;

	let caret = textarea.selectionStart;
	let caretPage = currentPage;
	let page = currentPage;
	let carry = null;
	let splitAny = false;

	while (page < pages.length) {
		let text = pages[page];
		if (carry !== null) {
			// The overflow from the previous page becomes the start of this
			// page. Move the caret with it if it was on this page.
			if (caretPage === page) caret += carry.length;
			text = carry + text;
			pages[page] = text;
			carry = null;
		}

		const split = splitPageForDisplay(text, ctx, maxLines, maxWidth);
		if (!split) break;

		splitAny = true;
		pages[page] = split.head;
		if (caretPage === page && caret >= split.cut) {
			caretPage = page + 1;
			caret -= split.cut;
		}
		carry = split.tail;
		page++;
	}

	if (carry !== null) {
		pages.push(carry);
		splitAny = true;
	}

	if (!splitAny) return;

	// Page ids grow or shrink with the page array, so ink seeds and snapshots
	// always refer to the same page.
	ensurePageIds();

	currentPage = Math.min(caretPage, pages.length - 1);
	textarea.value = pages[currentPage];
	const pos = Math.max(0, Math.min(caret, textarea.value.length));
	textarea.setSelectionRange(pos, pos);

	updatePageUI();
	dirty = true;
	pageDirty = true;
	scheduleRender();
}

const pageNav = document.createElement("div");
pageNav.id = "pageNav";
const btnPrev = document.createElement("button");
btnPrev.className = "pageBtn";
btnPrev.textContent = "<";
const btnNext = document.createElement("button");
btnNext.className = "pageBtn";
btnNext.textContent = ">";
const pageIndicator = document.createElement("span");
pageIndicator.className = "pageIndicator";
pageNav.appendChild(btnPrev);
pageNav.appendChild(pageIndicator);
pageNav.appendChild(btnNext);
document.body.appendChild(pageNav);

function updatePageUI() {
	pageIndicator.textContent = `${currentPage + 1} / ${pages.length}`;
	btnPrev.disabled = currentPage === 0;
	btnNext.disabled = currentPage === pages.length - 1;
}

btnPrev.addEventListener("click", () => {
	if (currentPage > 0) {
		currentPage--;
		textarea.value = pages[currentPage];
		dirty = true;
		pageDirty = true;
		scheduleRender();
		updatePageUI();
		saveState();
	}
});
btnNext.addEventListener("click", () => {
	if (currentPage < pages.length - 1) {
		currentPage++;
		textarea.value = pages[currentPage];
		dirty = true;
		pageDirty = true;
		scheduleRender();
		updatePageUI();
		saveState();
	}
});

const templateToggle = document.createElement("div");
templateToggle.id = "templateToggle";
["ruled", "grid", "dotted"].forEach((t) => {
	const b = document.createElement("button");
	b.className = "templateBtn" + (t === template ? " active" : "");
	b.textContent = t[0].toUpperCase();
	b.title = t;
	b.addEventListener("click", () => {
		template = t;
		document.querySelectorAll("#templateToggle .templateBtn").forEach((el) => {
			el.classList.toggle("active", el.title === t);
		});
		createBackgroundCache();
		dirty = true;
		scheduleRender();
		saveState();
	});
	templateToggle.appendChild(b);
});

const marginBtn = document.createElement("button");
marginBtn.className = "templateBtn" + (showMargin ? " active" : "");
marginBtn.textContent = "M";
marginBtn.title = "Margin line";
marginBtn.addEventListener("click", () => {
	showMargin = !showMargin;
	marginBtn.classList.toggle("active", showMargin);
	createBackgroundCache();
	dirty = true;
	scheduleRender();
	saveState();
});
templateToggle.appendChild(marginBtn);

const holesBtn = document.createElement("button");
holesBtn.className = "templateBtn" + (showHoles ? " active" : "");
holesBtn.textContent = "H";
holesBtn.title = "Holes";
holesBtn.addEventListener("click", () => {
	showHoles = !showHoles;
	holesBtn.classList.toggle("active", showHoles);
	createBackgroundCache();
	dirty = true;
	scheduleRender();
	saveState();
});
templateToggle.appendChild(holesBtn);

const showThroughBtn = document.createElement("button");
showThroughBtn.className = "templateBtn" + (showThrough ? " active" : "");
showThroughBtn.textContent = "S";
showThroughBtn.title = "Show-through of previous page";
showThroughBtn.addEventListener("click", () => {
	showThrough = !showThrough;
	showThroughBtn.classList.toggle("active", showThrough);
	dirty = true;
	pageDirty = true;
	scheduleRender();
	saveState();
});
templateToggle.appendChild(showThroughBtn);

const fontBtn = document.createElement("button");
fontBtn.className = "templateBtn" + (fontMode === "handwriting" ? " active" : "");
fontBtn.textContent = "F";
fontBtn.addEventListener("click", () => {
	applyFontMode(fontMode === "handwriting" ? "monospace" : "handwriting");
});
templateToggle.appendChild(fontBtn);
document.body.appendChild(templateToggle);
updateFontButton();

const undoBtn = document.createElement("button");
undoBtn.id = "undoBtn";
undoBtn.title = "Undo (Ctrl+Z)";
undoBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M5 10l5-5 5 5"/></svg>';
const redoBtn = document.createElement("button");
redoBtn.id = "redoBtn";
redoBtn.title = "Redo (Ctrl+Shift+Z)";
redoBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M19 10l-5-5-5 5"/></svg>';
undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);
document.body.appendChild(undoBtn);
document.body.appendChild(redoBtn);

const exportBtn = document.createElement("button");
exportBtn.id = "exportBtn";
exportBtn.title = "Export current page as PNG";
exportBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

function downloadCanvas(source, filename) {
	const save = (url, revoke) => {
		const link = document.createElement("a");
		link.download = filename;
		link.href = url;
		link.rel = "noopener";
		document.body.appendChild(link);
		link.click();
		link.remove();
		if (revoke) setTimeout(() => URL.revokeObjectURL(url), 10000);
	};

	if (source.toBlob) {
		source.toBlob((blob) => {
			if (blob) save(URL.createObjectURL(blob), true);
			else save(source.toDataURL("image/png"));
		}, "image/png");
	} else {
		save(source.toDataURL("image/png"));
	}
}

function exportPage() {
	const out = document.createElement("canvas");
	out.width = PAPER_WIDTH;
	out.height = PAPER_HEIGHT;
	const outCtx = out.getContext("2d");
	drawBackground(outCtx);

	// Export always uses the full-resolution ink layer.
	const wrapped = wrappedPage(pages[currentPage], outCtx);
	const previous = showThrough && currentPage > 0
		? wrappedPage(pages[currentPage - 1], outCtx)
		: null;
	const ink = getInkPage(wrapped, 1, {
		fontMode,
		pageId: currentPageId(),
		showThrough,
		previousLines: previous,
		previousPageId: pageIds[currentPage - 1],
	});
	outCtx.globalCompositeOperation = "multiply";
	outCtx.drawImage(ink, 0, 0);
	outCtx.globalCompositeOperation = "source-over";
	releaseInkPage(1);

	const filename = `page-${currentPage + 1}.png`;
	downloadCanvas(out, filename);
	msg.textContent = `Saved ${filename}`;
}

exportBtn.addEventListener("click", exportPage);
document.body.appendChild(exportBtn);

function updateFontButton() {
	fontBtn.classList.toggle("active", fontMode === "handwriting");
	fontBtn.title = `Font: ${fontMode === "handwriting" ? "Handwriting" : "Monospace"}`;
}

function applyFontMode(mode) {
	fontMode = mode;
	document.documentElement.style.setProperty("--ink-font-stack", fontStack(fontMode));
	textarea.style.fontFamily = fontStack(fontMode);
	mirror.style.fontFamily = fontStack(fontMode);
	TEXT_PAD_CACHE.key = "";
	updateTextOverlayStyles();
	// The glyphs and the line breaks both change with the font, so drop every
	// cached raster and re-wrap/re-render from scratch.
	clearInkLineCache();
	releaseInkPage(INK_QUALITY);
	releaseInkPage(1);
	dirty = true;
	pageDirty = true;
	updateFontButton();
	scheduleRender();
	saveState();
}

function createBackgroundCache() {
	if (!bgCanvas) {
		bgCanvas = document.createElement("canvas");
		bgCtx = bgCanvas.getContext("2d");
	}
	bgCanvas.width = PAPER_WIDTH;
	bgCanvas.height = PAPER_HEIGHT;
	drawBackground(bgCtx);
	dirty = true;
	pageDirty = true;
}

const ro = new ResizeObserver(() => {
	const vs = { w: canvas.clientWidth, h: canvas.clientHeight };
	const dp = isMobile ? Math.min(window.devicePixelRatio || 1, 1.5) : (window.devicePixelRatio || 1);
	canvas.width = Math.floor(vs.w * dp);
	canvas.height = Math.floor(vs.h * dp);
	dpr = vs.w > 0 ? canvas.width / vs.w : 1;
	createBackgroundCache();
	const fit = fitRect(vs.w, vs.h);
	if (viewScale <= fit.scale * 1.001) {
		viewScale = fit.scale;
		viewX = fit.left;
		viewY = fit.top;
	}
	clampView();
	dirty = true;
	scheduleRender();
	ensureCaretVisible();
});
ro.observe(canvas);

async function init() {
	ctx = canvas.getContext("2d");
	const vs = { w: canvas.clientWidth, h: canvas.clientHeight };
	const dp = isMobile ? Math.min(window.devicePixelRatio || 1, 1.5) : (window.devicePixelRatio || 1);
	canvas.width = Math.floor(vs.w * dp);
	canvas.height = Math.floor(vs.h * dp);
	dpr = vs.w > 0 ? canvas.width / vs.w : 1;
	createBackgroundCache();

	// Baseline placement depends on the real font metrics, but a slow or
	// hanging font request must never leave a blank page. Paint with the
	// fallback stack after at most 1500ms, then refresh when the real fonts
	// arrive.
	const fontLoad = loadInkFonts(FONT_SIZE);
	let fontsTimedOut = false;
	await Promise.race([
		fontLoad,
		new Promise((resolve) => {
			setTimeout(() => {
				fontsTimedOut = true;
				resolve(false);
			}, 1500);
		}),
	]);
	fontsReady = true;
	TEXT_PAD_CACHE.key = "";
	updateTextOverlayStyles();
	clearInkLineCache();
	releaseInkPage(INK_QUALITY);
	releaseInkPage(1);

	const refreshFonts = () => {
		TEXT_PAD_CACHE.key = "";
		updateTextOverlayStyles();
		clearInkLineCache();
		releaseInkPage(INK_QUALITY);
		releaseInkPage(1);
		dirty = true;
		pageDirty = true;
		scheduleRender();
	};
	if (fontsTimedOut) {
		fontLoad.then((loaded) => {
			if (loaded) refreshFonts();
		});
	}
	if (document.fonts && document.fonts.ready) {
		document.fonts.ready.then(refreshFonts);
	}
	if (document.fonts && document.fonts.addEventListener) {
		document.fonts.addEventListener("loadingdone", refreshFonts);
	}

	resetView();
	textarea.value = pages[currentPage];
	render();
	updatePageUI();
	msg.textContent = "Click to type. Pan: drag. Zoom: wheel / pinch. Reset: button or R";

	// Small read-only hooks for manual caret checks. They measure the same
	// mirror Range and canvas text the app itself uses.
	window.__b5 = {
		ready: true,
		debug: DEBUG,
		setText(text) {
			textarea.value = text;
			pages[currentPage] = text;
			layoutCacheKey = "";
			dirty = true;
			pageDirty = true;
			render();
		},
		setFontMode(mode) {
			applyFontMode(mode);
			render();
		},
		setZoom(factor) {
			const fit = fitRect(canvas.clientWidth, canvas.clientHeight);
			viewScale = fit.scale * factor;
			viewX = (canvas.clientWidth - PAPER_WIDTH * viewScale) / 2;
			viewY = (canvas.clientHeight - PAPER_HEIGHT * viewScale) / 2;
			clampView();
			dirty = true;
			render();
		},
		getView() {
			const fit = fitRect(canvas.clientWidth, canvas.clientHeight);
			return {
				scale: viewScale,
				fitScale: fit.scale,
				x: viewX,
				y: viewY,
				width: canvas.clientWidth,
				height: canvas.clientHeight,
				paperWidth: PAPER_WIDTH,
				paperHeight: PAPER_HEIGHT,
				textX: LEFT_MARGIN + TEXT_INSET,
				padTop: TEXT_PAD_TOP,
				fontMode,
			};
		},
		setPages(nextPages, page = currentPage) {
			pages = nextPages.slice();
			pageIds = [];
			ensurePageIds();
			currentPage = Math.max(0, Math.min(pages.length - 1, page));
			textarea.value = pages[currentPage];
			textarea.setSelectionRange(textarea.value.length, textarea.value.length);
			layoutCacheKey = "";
			dirty = true;
			pageDirty = true;
			updatePageUI();
			saveState();
			render();
		},
		getPages() {
			return {
				pages: pages.slice(),
				pageIds: pageIds.slice(),
				currentPage,
			};
		},
		lines() {
			return getPageLines(textarea.value, ctx).map((line) => ({
				text: line.text,
				start: line.start,
			}));
		},
		boundaries() {
			const text = textarea.value;
			const points = [0, text.length];
			for (const cluster of graphemeOffsets(text)) {
				points.push(cluster.offset, cluster.offset + cluster.segment.length);
			}
			return [...new Set(points)].sort((a, b) => a - b);
		},
		caret(offset) {
			return customCaretMetrics(offset);
		},
		nativeCaret(offset) {
			return mirrorCaretMetrics(offset);
		},
		drawn(offset) {
			return drawnMetricsAt(offset);
		},
		check() {
			let maxBaseline = 0;
			let maxX = 0;
			let nativeMaxBaseline = 0;
			let nativeMaxX = 0;
			const failures = [];
			const points = window.__b5.boundaries();
			for (const offset of points) {
				const caret = customCaretMetrics(offset);
				const native = mirrorCaretMetrics(offset);
				const drawn = drawnMetricsAt(offset);
				const baselineError = Math.abs(caret.baseline - drawn.baseline);
				const xError = Math.abs(caret.x - drawn.x);
				nativeMaxBaseline = Math.max(nativeMaxBaseline, Math.abs(native.baseline - drawn.baseline));
				nativeMaxX = Math.max(nativeMaxX, Math.abs(native.x - drawn.x));
				maxBaseline = Math.max(maxBaseline, baselineError);
				maxX = Math.max(maxX, xError);
				if (baselineError > 0.3 * MM || xError > 1) {
					failures.push({ offset, baselineError, xError, caret, native, drawn });
				}
			}
			return {
				maxBaseline,
				maxX,
				nativeMaxBaseline,
				nativeMaxX,
				failures,
				count: points.length,
			};
		},
		focus(offset = 0) {
			textarea.focus({ preventScroll: true });
			textarea.setSelectionRange(offset, offset);
			dirty = true;
			render();
		},
	};
}

async function boot() {
	try {
		await init();
		window.__b5ready = true;
	} catch (error) {
		showErrorBanner(errorText(error));
		console.error(error);
	}
}

boot();