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

let pages = [""];
let currentPage = 0;
let undoStack = [];
let redoStack = [];
let template = "ruled";
let showMargin = true;
let showHoles = true;

let ctx;
let bgCanvas, bgCtx;
let dpr = 1;
let dirty = true;
let rafId = null;

const isMobile = window.matchMedia("(pointer: coarse)").matches;
const dprCap = isMobile ? Math.min(window.devicePixelRatio || 1, 1.5) : (window.devicePixelRatio || 1);

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

function fitWord(word, maxWidth, result) {
	if (ctx.measureText(word).width <= maxWidth) {
		result.push(word);
		return;
	}
	let chunk = "";
	for (const ch of word) {
		const t2 = chunk + ch;
		if (ctx.measureText(t2).width <= maxWidth) {
			chunk = t2;
		} else {
			if (chunk) result.push(chunk);
			chunk = ch;
		}
	}
	if (chunk) result.push(chunk);
}

function wrapLine(line, maxWidth, result) {
	const words = line.split(" ");
	let current = "";
	for (const word of words) {
		const test = current ? current + " " + word : word;
		if (ctx.measureText(test).width <= maxWidth) {
			current = test;
		} else {
			if (current) result.push(current);
			current = word;
			if (ctx.measureText(word).width > maxWidth) {
				fitWord(word, maxWidth, result);
				current = "";
			}
		}
	}
	if (current) result.push(current);
}

function wrapText(text, maxWidth) {
	const lines = text.split("\n");
	const result = [];
	for (const line of lines) {
		if (line === "") {
			result.push("");
			continue;
		}
		wrapLine(line, maxWidth, result);
	}
	return result;
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
	c.fillStyle = "#2d2d2d";
	c.font = FONT_SIZE + "px monospace";
	c.textBaseline = "alphabetic";
	const textX = LEFT_MARGIN + TEXT_INSET;
	const maxWidth = PAPER_WIDTH - RIGHT_MARGIN - textX;
	const wrapped = wrapText(text, maxWidth);
	const baselineOffset = -1.5 * MM;
	wrapped.forEach((line, i) => {
		const y = TOP_MARGIN + (i + 1) * LINE_GAP + baselineOffset;
		c.fillText(line, textX, y);
	});
	return wrapped.length;
}

function render() {
	if (!ctx) return;

	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
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

	const padTop = (TOP_MARGIN + LINE_GAP - 1.5 * MM - FONT_SIZE * 0.8) * scale;
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

canvas.addEventListener("pointerdown", (e) => {
	if (e.target === resetBtn) return;
	if (e.button !== 0 && e.button !== 1) return;

	pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
	lastPointerX = e.clientX;
	lastPointerY = e.clientY;
	canvas.setPointerCapture(e.pointerId);
	vx = 0;
	vy = 0;
	animating = false;

	if (pointers.size === 2) {
		const pinch = getPinchCenter();
		if (pinch) {
			pinchStartDist = pinch.dist;
			pinchStartScale = viewScale;
		}
	}
	e.preventDefault();
}, { passive: false });

canvas.addEventListener("pointermove", (e) => {
	pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

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
	pointers.delete(e.pointerId);
	canvas.releasePointerCapture(e.pointerId);

	if (pointers.size === 0) {
		const now = performance.now();
		const dx = Math.abs(e.clientX - lastTapX);
		const dy = Math.abs(e.clientY - lastTapY);
		const dt = now - lastTapTime;

		if (dx < 8 && dy < 8 && dt < 250 && lastTapTime > 0) {
			lastTapTime = 0;
			const fit = fitRect(canvas.clientWidth, canvas.clientHeight);
			if (viewScale <= fit.scale * 1.01) {
				startAnimTo(viewScale * 2.5, viewX, viewY);
			} else {
				resetView();
			}
		} else {
			lastTapTime = now;
			lastTapX = e.clientX;
			lastTapY = e.clientY;
		}

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
	canvas.releasePointerCapture(e.pointerId);
	if (pointers.size === 0) {
		vx = 0;
		vy = 0;
		clampView();
		scheduleRender();
	}
}, { passive: true });

canvas.addEventListener("lostpointercapture", (e) => {
	pointers.delete(e.pointerId);
	if (pointers.size === 0) {
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

canvas.addEventListener("pointerdown", (e) => {
	if (e.pointerType === "touch" && pointers.size === 1) {
		const t = performance.now();
		if (t - lastTapTime > 250) {
			lastTapTime = t;
			lastTapX = e.clientX;
			lastTapY = e.clientY;
		}
	}
}, { passive: true });

canvas.addEventListener("pointerup", (e) => {
	if (e.pointerType === "touch") {
		const now = performance.now();
		if (now - lastTapTime < 250 && Math.abs(e.clientX - lastTapX) < 8 && Math.abs(e.clientY - lastTapY) < 8) {
			const rect = canvas.getBoundingClientRect();
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			const paper = screenToPaper(cx, cy);
			if (paper.x >= 0 && paper.x <= PAPER_WIDTH && paper.y >= 0 && paper.y <= PAPER_HEIGHT) {
				textarea.focus();
				const line = Math.floor((paper.y - TOP_MARGIN) / LINE_GAP);
				const col = Math.floor((paper.x - (LEFT_MARGIN + TEXT_INSET)) / (FONT_SIZE * 0.6));
				const text = pages[currentPage];
				const lines = text.split("\n");
				let charIndex = 0;
				for (let i = 0; i < Math.min(line, lines.length); i++) {
					charIndex += lines[i].length + 1;
				}
				charIndex = Math.min(charIndex + Math.min(col, lines[line]?.length || 0), text.length);
				textarea.setSelectionRange(charIndex, charIndex);
			}
		}
	}
}, { passive: true });

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

function pushUndo() {
	undoStack.push({ page: currentPage, text: pages[currentPage] });
	redoStack = [];
	if (undoStack.length > 50) undoStack.shift();
}

function undo() {
	if (undoStack.length === 0) return;
	const state = undoStack.pop();
	redoStack.push({ page: currentPage, text: pages[currentPage] });
	currentPage = state.page;
	pages[currentPage] = state.text;
	textarea.value = state.text;
	dirty = true;
	scheduleRender();
	updatePageUI();
}

function redo() {
	if (redoStack.length === 0) return;
	const state = redoStack.pop();
	undoStack.push({ page: currentPage, text: pages[currentPage] });
	currentPage = state.page;
	pages[currentPage] = state.text;
	textarea.value = state.text;
	dirty = true;
	scheduleRender();
	updatePageUI();
}

textarea.addEventListener("input", () => {
	pages[currentPage] = textarea.value;
	pushUndo();
	dirty = true;
	scheduleRender();
	checkPageFlow();
});

textarea.addEventListener("focus", () => { msg.textContent = ""; });
textarea.addEventListener("blur", () => { msg.textContent = "Click to type"; });

function checkPageFlow() {
	const maxLines = Math.floor((PAPER_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN) / LINE_GAP);
	const textX = LEFT_MARGIN + TEXT_INSET;
	const maxWidth = PAPER_WIDTH - RIGHT_MARGIN - textX;
	const wrapped = wrapText(textarea.value, maxWidth);
	if (wrapped.length > maxLines && currentPage === pages.length - 1) {
		const allLines = textarea.value.split("\n");
		const overflowLines = allLines.slice(maxLines);
		const keepLines = allLines.slice(0, maxLines);
		pages[currentPage] = keepLines.join("\n");
		textarea.value = pages[currentPage];
		pages.push(overflowLines.join("\n"));
		currentPage = pages.length - 1;
		updatePageUI();
		dirty = true;
		scheduleRender();
	}
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
	}
});
btnNext.addEventListener("click", () => {
	if (currentPage < pages.length - 1) {
		currentPage++;
		textarea.value = pages[currentPage];
		dirty = true;
		scheduleRender();
		updatePageUI();
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
exportBtn.title = "Export PNG";
exportBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
exportBtn.addEventListener("click", () => {
	const link = document.createElement("a");
	link.download = `page-${currentPage + 1}.png`;
	link.href = canvas.toDataURL();
	link.click();
});
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
	createBackgroundCache();
	resetView();
	render();
	updatePageUI();
	msg.textContent = "Click to type. Pan: drag. Zoom: wheel / pinch. Reset: button or R";
}

init();