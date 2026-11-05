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
import { drawInkText } from "./ink.js";
import { splitPage, wrapText } from "./text.js";

const canvas = document.getElementById("canvas");
const msg = document.getElementById("msg");
const resetBtn = document.getElementById("resetBtn");

const textarea = document.createElement("textarea");
textarea.autocapitalize = "none";
textarea.autocomplete = "off";
textarea.spellcheck = false;
textarea.setAttribute("autocorrect", "off");
document.body.appendChild(textarea);

let viewScale = 1;
let viewX = 0;
let viewY = 0;
let animating = false;
let animStart = 0;
let animDur = 0;
let animFrom = { scale: 1, x: 0, y: 0 };
let animTo = { scale: 1, x: 0, y: 0 };

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

let pages = [""];
let currentPage = 0;
let undoStack = [];
let redoStack = [];
let pendingUndo = null;
let undoTimer = null;
let template = "ruled";
let showMargin = true;
let showHoles = true;

const STORAGE_KEY = "b5-notebook-v1";

let ctx;
let bgCanvas, bgCtx;
let dpr = 1;
let dirty = true;
let rafId = null;

const isMobile = window.matchMedia("(pointer: coarse)").matches;

// Measure the same monospace font the textarea uses. The textarea has to place
// its first baseline exactly where the canvas draws line 0.
const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d");

function textPadTop() {
	measureCtx.font = FONT_SIZE + "px monospace";
	const metrics = measureCtx.measureText("Mg");
	const ascent = metrics.fontBoundingBoxAscent ?? FONT_SIZE * 0.8;
	const descent = metrics.fontBoundingBoxDescent ?? FONT_SIZE * 0.2;
	const halfLeading = (LINE_GAP - ascent - descent) / 2;
	const firstBaseline = LINE_GAP - 1.5 * MM;
	return Math.max(0, firstBaseline - halfLeading - ascent);
}

const TEXT_PAD_TOP = textPadTop();

function saveState() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			pages,
			currentPage,
			template,
			showMargin,
			showHoles,
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
		}
		if (["ruled", "grid", "dotted"].includes(saved.template)) template = saved.template;
		if (typeof saved.showMargin === "boolean") showMargin = saved.showMargin;
		if (typeof saved.showHoles === "boolean") showHoles = saved.showHoles;
	} catch {
		// Ignore a corrupt save rather than blocking startup.
	}
}

loadState();

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

function drawText(c, text) {
	c.font = FONT_SIZE + "px monospace";
	c.textBaseline = "alphabetic";
	const textX = LEFT_MARGIN + TEXT_INSET;
	const maxWidth = PAPER_WIDTH - RIGHT_MARGIN - textX;
	const wrapped = wrapText(text, maxWidth, c);
	drawInkText(c, wrapped);
	return wrapped.length;
}

function render() {
	if (!ctx) return;

	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	// Work in CSS pixels; dpr only controls how many device pixels back the
	// canvas. Without this the paper and the textarea drift apart on hi-dpi
	// screens.
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.translate(viewX, viewY);
	ctx.scale(viewScale, viewScale);

	if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0);
	drawText(ctx, pages[currentPage]);

	ctx.restore();

	const scale = viewScale;
	const textX = LEFT_MARGIN + TEXT_INSET;
	const textWidth = PAPER_WIDTH - RIGHT_MARGIN - textX;

	textarea.style.left = (viewX + textX * scale) + "px";
	textarea.style.top = (viewY + TOP_MARGIN * scale) + "px";
	textarea.style.width = (textWidth * scale) + "px";
	textarea.style.height = ((PAPER_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN) * scale) + "px";
	textarea.style.fontSize = (FONT_SIZE * scale) + "px";
	textarea.style.lineHeight = (LINE_GAP * scale) + "px";

	const padTop = TEXT_PAD_TOP * scale;
	textarea.style.paddingTop = Math.max(0, padTop) + "px";

	dirty = false;
}

function animate(now) {
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
	} else if (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1) {
		viewX += vx;
		viewY += vy;
		vx *= 0.92;
		vy *= 0.92;
		dirty = true;
	} else {
		vx = 0;
		vy = 0;
	}

	clampView();
	if (dirty) {
		render();
	}

	if (animating || Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1 || dirty) {
		rafId = requestAnimationFrame(animate);
	} else {
		rafId = null;
	}
}

function scheduleRender() {
	dirty = true;
	if (!rafId && !animating) {
		rafId = requestAnimationFrame(animate);
	}
}

function clampView() {
	const vs = { w: canvas.clientWidth, h: canvas.clientHeight };
	const fit = fitRect(vs.w, vs.h);
	const fitScale = fit.scale;
	const paperW = PAPER_WIDTH * viewScale;
	const paperH = PAPER_HEIGHT * viewScale;

	viewScale = clampScale(viewScale, fitScale);

	const maxX = vs.w - paperW;
	const maxY = vs.h - paperH;

	if (paperW < vs.w) {
		viewX = vs.w / 2 - paperW / 2;
	} else {
		viewX = Math.max(maxX, Math.min(0, viewX));
	}

	if (paperH < vs.h) {
		viewY = vs.h / 2 - paperH / 2;
	} else {
		const over = 20;
		viewX = Math.max(maxX - over, Math.min(over, viewX));
		viewY = Math.max(maxY - over, Math.min(over, viewY));
	}
}

function startAnimTo(scale, x, y, dur = 220) {
	animFrom = { scale: viewScale, x: viewX, y: viewY };
	animTo = { scale, x, y };
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

	ctx.font = FONT_SIZE + "px monospace";
	const text = textarea.value;
	const maxWidth = PAPER_WIDTH - RIGHT_MARGIN - (LEFT_MARGIN + TEXT_INSET);
	const wrapped = wrapText(text, maxWidth, ctx);
	const lineIndex = Math.max(0, Math.min(wrapped.length - 1, Math.floor((paper.y - TOP_MARGIN) / LINE_GAP)));
	const line = wrapped[lineIndex] || "";

	let column = 0;
	let width = 0;
	const target = paper.x - (LEFT_MARGIN + TEXT_INSET);
	for (const ch of line) {
		const w = ctx.measureText(ch).width;
		if (target < width + w / 2) break;
		width += w;
		column += ch.length;
	}

	let offset = 0;
	for (let i = 0; i < lineIndex; i++) {
		const visual = wrapped[i];
		if (visual === "") {
			offset += 1;
			continue;
		}
		const at = text.indexOf(visual, offset);
		if (at < 0) break;
		offset = at + visual.length;
		if (text[offset] === " " || text[offset] === "\n") offset += 1;
	}

	return Math.min(offset + column, text.length);
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
	if (!isTap) return;

	const rect = canvas.getBoundingClientRect();
	const cx = pointer.x - rect.left;
	const cy = pointer.y - rect.top;

	const dx = Math.abs(pointer.x - lastTapX);
	const dy = Math.abs(pointer.y - lastTapY);
	if (lastTapTime > 0 && dx < 20 && dy < 20 && now - lastTapTime < 300) {
		lastTapTime = 0;
		zoomAtTap(cx, cy);
		return;
	}

	lastTapTime = now;
	lastTapX = pointer.x;
	lastTapY = pointer.y;
	focusCaretAt(cx, cy);
}

canvas.addEventListener("pointerdown", (e) => {
	if (e.target === resetBtn) return;
	if (e.button !== 0 && e.button !== 1) return;

	const now = performance.now();
	if (pointers.size === 0) gesturePinched = false;
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

	if (pointers.size === 2) {
		gesturePinched = true;
		const pinch = getPinchCenter();
		if (pinch) {
			pinchStartDist = pinch.dist;
			pinchStartScale = viewScale;
		}
	}
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
		vx = dx * 2;
		vy = dy * 2;
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
		clampView();
		scheduleRender();
	} else if (pointers.size === 1) {
		const remaining = pointers.values().next().value;
		lastPointerX = remaining.x;
		lastPointerY = remaining.y;
	}
}, { passive: true });

canvas.addEventListener("pointercancel", (e) => {
	pointers.delete(e.pointerId);
	if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
	if (pointers.size === 0) {
		gesturePinched = false;
		vx = 0;
		vy = 0;
		clampView();
		scheduleRender();
	}
}, { passive: true });

canvas.addEventListener("lostpointercapture", (e) => {
	pointers.delete(e.pointerId);
	if (pointers.size === 0) {
		gesturePinched = false;
		vx = 0;
		vy = 0;
		clampView();
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
	return { pages: pages.slice(), currentPage };
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
	currentPage = Math.max(0, Math.min(pages.length - 1, state.currentPage));
	textarea.value = pages[currentPage];
	dirty = true;
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
	scheduleRender();
	checkPageFlow();
	saveState();
});

textarea.addEventListener("focus", () => { msg.textContent = ""; });
textarea.addEventListener("blur", () => { msg.textContent = "Click to type"; });

// Move overflowing text from the last page onto a new page.
function checkPageFlow() {
	if (currentPage !== pages.length - 1) return;

	ctx.font = FONT_SIZE + "px monospace";
	const maxLines = Math.floor((PAPER_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN) / LINE_GAP);
	const textX = LEFT_MARGIN + TEXT_INSET;
	const maxWidth = PAPER_WIDTH - RIGHT_MARGIN - textX;
	const split = splitPage(textarea.value, maxWidth, maxLines, ctx);
	if (!split) return;

	pages[currentPage] = split.head;
	pages.push(split.tail);
	currentPage = pages.length - 1;

	const caret = Math.max(0, Math.min(split.tail.length, textarea.selectionStart - split.cut));
	textarea.value = split.tail;
	textarea.setSelectionRange(caret, caret);

	updatePageUI();
	dirty = true;
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
document.body.appendChild(templateToggle);

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
	drawText(outCtx, pages[currentPage]);

	const filename = `page-${currentPage + 1}.png`;
	downloadCanvas(out, filename);
	msg.textContent = `Saved ${filename}`;
}

exportBtn.addEventListener("click", exportPage);
document.body.appendChild(exportBtn);

function createBackgroundCache() {
	if (!bgCanvas) {
		bgCanvas = document.createElement("canvas");
		bgCtx = bgCanvas.getContext("2d");
	}
	bgCanvas.width = PAPER_WIDTH;
	bgCanvas.height = PAPER_HEIGHT;
	drawBackground(bgCtx);
	dirty = true;
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
});
ro.observe(canvas);

function init() {
	ctx = canvas.getContext("2d");
	const vs = { w: canvas.clientWidth, h: canvas.clientHeight };
	const dp = isMobile ? Math.min(window.devicePixelRatio || 1, 1.5) : (window.devicePixelRatio || 1);
	canvas.width = Math.floor(vs.w * dp);
	canvas.height = Math.floor(vs.h * dp);
	dpr = vs.w > 0 ? canvas.width / vs.w : 1;
	createBackgroundCache();
	resetView();
	textarea.value = pages[currentPage];
	render();
	updatePageUI();
	msg.textContent = "Click to type. Pan: drag. Zoom: wheel / pinch. Reset: button or R";
}

init();