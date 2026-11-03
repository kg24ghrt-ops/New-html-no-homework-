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
	TEXT_OFFSET_FROM_MARGIN,
	HOLE_X,
	HOLE_RADIUS,
	HOLE_SPACING,
	FIRST_HOLE_Y,
	FONT_SIZE,
	FIT_PADDING,
} from "./paper.js";

const canvas = document.getElementById("canvas");
const msg = document.getElementById("msg");
const resetBtn = document.getElementById("resetBtn");

const isMobile = window.matchMedia("(pointer: coarse)").matches;
const dprCap = isMobile ? Math.min(window.devicePixelRatio || 1, 1.5) : (window.devicePixelRatio || 1);

function viewportSize() {
	return { w: canvas.clientWidth, h: canvas.clientHeight };
}

const textarea = document.createElement("textarea");
textarea.style.position = "fixed";
textarea.style.background = "transparent";
textarea.style.border = "none";
textarea.style.outline = "none";
textarea.style.resize = "none";
textarea.style.fontFamily = "monospace";
textarea.style.color = "#1a1a1a";
textarea.style.caretColor = "#1a1a1a";
textarea.style.padding = "0";
textarea.style.margin = "0";
textarea.style.whiteSpace = "pre";
textarea.style.overflow = "hidden";
textarea.autocapitalize = "none";
textarea.autocomplete = "off";
textarea.spellcheck = false;
textarea.setAttribute("autocorrect", "off");
document.body.appendChild(textarea);

let viewScale = 1;
let viewX = 0;
let viewY = 0;
let isPanning = false;
let lastPointerX = 0;
let lastPointerY = 0;
const pointers = new Map();
let pinchStartScale = 1;
let pinchStartDist = 0;
let pinchCenterX = 0;
let pinchCenterY = 0;

function resetView() {
	const vs = viewportSize();
	const r = paperRectFn(vs.w, vs.h);
	viewScale = r.scale;
	viewX = r.left;
	viewY = r.top;
	scheduleLayoutAndRender();
}

function screenToPaper(sx, sy) {
	return {
		x: (sx - viewX) / viewScale,
		y: (sy - viewY) / viewScale
	};
}

function paperToScreen(px, py) {
	return {
		x: px * viewScale + viewX,
		y: py * viewScale + viewY
	};
}

function clampView(vs) {
	const paperW = PAPER_WIDTH * viewScale;
	const paperH = PAPER_HEIGHT * viewScale;
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
		viewY = Math.max(maxY, Math.min(0, viewY));
	}
}

function getPinchInfo() {
	if (pointers.size < 2) return null;
	const pts = Array.from(pointers.values());
	const dx = pts[1].x - pts[0].x;
	const dy = pts[1].y - pts[0].y;
	const dist = Math.hypot(dx, dy);
	const cx = (pts[0].x + pts[1].x) / 2;
	const cy = (pts[0].y + pts[1].y) / 2;
	return { dist, cx, cy };
}

canvas.addEventListener("pointerdown", (e) => {
	if (e.target === resetBtn) return;
	if (e.button !== 0 && e.button !== 1) return;

	pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

	if (pointers.size === 1) {
		isPanning = true;
		lastPointerX = e.clientX;
		lastPointerY = e.clientY;
	} else if (pointers.size === 2) {
		isPanning = false;
		const pinch = getPinchInfo();
		if (pinch) {
			pinchStartDist = pinch.dist;
			pinchCenterX = pinch.cx;
			pinchCenterY = pinch.cy;
			pinchStartScale = viewScale;
		}
	}
	canvas.setPointerCapture(e.pointerId);
	e.preventDefault();
}, { passive: false });

canvas.addEventListener("pointermove", (e) => {
	pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
	const vs = viewportSize();

	if (pointers.size === 1 && isPanning) {
		const dx = e.clientX - lastPointerX;
		const dy = e.clientY - lastPointerY;
		viewX += dx;
		viewY += dy;
		lastPointerX = e.clientX;
		lastPointerY = e.clientY;
		clampView(vs);
		scheduleLayoutAndRender();
	} else if (pointers.size >= 2) {
		isPanning = false;
		const pinch = getPinchInfo();
		if (pinch && pinchStartDist > 0) {
			const scaleChange = pinch.dist / pinchStartDist;
			const newScale = pinchStartScale * scaleChange;

			const rect = canvas.getBoundingClientRect();
			const centerX = pinch.cx - rect.left;
			const centerY = pinch.cy - rect.top;
			const paperBefore = screenToPaper(centerX, centerY);

			viewScale = newScale;
			clampView(vs);

			const paperAfter = screenToPaper(centerX, centerY);
			viewX += (paperBefore.x - paperAfter.x) * viewScale;
			viewY += (paperBefore.y - paperAfter.y) * viewScale;
			clampView(vs);
			scheduleLayoutAndRender();
		}
	}
}, { passive: true });

canvas.addEventListener("pointerup", (e) => {
	pointers.delete(e.pointerId);
	if (pointers.size < 2) {
		isPanning = false;
	}
	canvas.releasePointerCapture(e.pointerId);
}, { passive: true });

canvas.addEventListener("pointerleave", () => {
	pointers.clear();
	isPanning = false;
}, { passive: true });

canvas.addEventListener("wheel", (e) => {
	e.preventDefault();
	const vs = viewportSize();
	const rect = canvas.getBoundingClientRect();
	const mouseX = e.clientX - rect.left;
	const mouseY = e.clientY - rect.top;

	const paperBefore = screenToPaper(mouseX, mouseY);
	const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
	viewScale *= zoomFactor;
	clampView(vs);
	const paperAfter = screenToPaper(mouseX, mouseY);
	viewX += (paperBefore.x - paperAfter.x) * viewScale;
	viewY += (paperBefore.y - paperAfter.y) * viewScale;
	clampView(vs);
	scheduleLayoutAndRender();
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
});

(async () => {
	if (!navigator.gpu) {
		msg.textContent = "WebGPU not supported";
		return;
	}

	let adapter, device;
	try {
		adapter = await navigator.gpu.requestAdapter();
		if (!adapter) { msg.textContent = "No GPU adapter"; return; }
		device = await adapter.requestDevice();
	} catch (err) {
		msg.textContent = "GPU init failed: " + (err && err.message ? err.message : err);
		return;
	}

	device.lost.then((info) => {
		msg.textContent = "GPU device lost: " + info.message;
		if (textarea) textarea.disabled = true;
	});

	const context = canvas.getContext("webgpu");
	if (!context) { msg.textContent = "WebGPU context unavailable"; return; }
	const format = navigator.gpu.getPreferredCanvasFormat();

	const paper = document.createElement("canvas");
	paper.width = PAPER_WIDTH;
	paper.height = PAPER_HEIGHT;
	const ctx = paper.getContext("2d");

	function drawPaper(text) {
		ctx.fillStyle = "#fefdf8";
		ctx.fillRect(0, 0, paper.width, paper.height);

		ctx.strokeStyle = "#e0dbc8";
		ctx.lineWidth = Math.max(1, Math.round(PAPER_HEIGHT / 2500));
		for (let y = TOP_MARGIN; y < paper.height - BOTTOM_MARGIN; y += LINE_GAP) {
			ctx.beginPath();
			ctx.moveTo(LEFT_MARGIN, y);
			ctx.lineTo(paper.width - RIGHT_MARGIN, y);
			ctx.stroke();
		}

		ctx.strokeStyle = "#d46b6b";
		ctx.lineWidth = Math.max(1, Math.round(PAPER_WIDTH / 1466));
		ctx.beginPath();
		ctx.moveTo(MARGIN_LINE_X, TOP_MARGIN);
		ctx.lineTo(MARGIN_LINE_X, paper.height - BOTTOM_MARGIN);
		ctx.stroke();

		ctx.fillStyle = "#d46b6b";
		for (let hy = FIRST_HOLE_Y; hy < paper.height - BOTTOM_MARGIN; hy += HOLE_SPACING) {
			ctx.beginPath();
			ctx.arc(HOLE_X, hy, HOLE_RADIUS, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.fillStyle = "#2d2d2d";
		ctx.font = `${FONT_SIZE}px monospace`;
		ctx.textBaseline = "alphabetic";
		const textX = MARGIN_LINE_X + TEXT_OFFSET_FROM_MARGIN;
		const baselineOffset = Math.round(FONT_SIZE * 0.8);
		text.split("\n").forEach((line, i) => {
			const y = TOP_MARGIN + i * LINE_GAP + baselineOffset;
			ctx.fillText(line, textX, y);
		});
	}

	let notes = "";
	try { notes = localStorage.getItem("htmlhje-notes") || ""; } catch {}
	drawPaper(notes);
	const bitmap = await createImageBitmap(paper);
	console.log("Paper bitmap created:", bitmap.width, bitmap.height);

	const texture = device.createTexture({
		size: [bitmap.width, bitmap.height, 1],
		format: "rgba8unorm",
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
	});
	device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
	if (typeof bitmap.close === "function") bitmap.close();
	console.log("Texture uploaded");

	const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

	const shader = device.createShaderModule({
		code: `
struct U { offset: vec2f, scale: vec2f };
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var t: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
	var p = array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
	var uv = array<vec2f,6>(vec2f(0,1),vec2f(1,1),vec2f(0,0),vec2f(0,0),vec2f(1,1),vec2f(1,0));
	var o: VSOut;
	o.pos = vec4f(p[i]*u.scale+u.offset,0,1);
	o.uv = uv[i];
	return o;
}
@fragment fn fs(in: VSOut) -> @location(0) vec4f {
	return textureSample(t, s, in.uv);
}`,
	});

	const uniformBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const uniformData = new Float32Array(4);

	const pipeline = device.createRenderPipeline({
		layout: "auto",
		vertex: { module: shader, entryPoint: "vs" },
		fragment: { module: shader, entryPoint: "fs", targets: [{ format }] },
		primitive: { topology: "triangle-list" },
	});

	const bindGroup = device.createBindGroup({
		layout: pipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: sampler },
			{ binding: 1, resource: texture.createView() },
			{ binding: 2, resource: { buffer: uniformBuf } },
		],
	});

	let configured = false;
	let fitScale = 1;
	function resize() {
		const dpr = isMobile ? dprCap : (window.devicePixelRatio || 1);
		canvas.width = Math.floor(window.innerWidth * dpr);
		canvas.height = Math.floor(window.innerHeight * dpr);
		if (!configured) {
			context.configure({ device, format, alphaMode: "premultiplied" });
			configured = true;
		}
		const vs = viewportSize();
		const r = paperRectFn(vs.w, vs.h);
		fitScale = r.scale;
		if (viewScale <= fitScale * 1.001) {
			viewScale = r.scale;
			viewX = r.left;
			viewY = r.top;
		}
	}
	resize();
	window.addEventListener("resize", resize);

	textarea.addEventListener("input", async () => {
		try { localStorage.setItem("htmlhje-notes", textarea.value); } catch {}
		drawPaper(textarea.value);
		try {
			const bmp = await createImageBitmap(paper);
			device.queue.copyExternalImageToTexture({ source: bmp }, { texture }, [paper.width, paper.height]);
			if (typeof bmp.close === "function") bmp.close();
			console.log("Texture updated");
		} catch (err) {
			console.error("Texture update failed:", err);
			msg.textContent = "Render failed: " + (err && err.message ? err.message : err);
		}
	});

	let layoutScheduled = false;
	function layoutOverlay() {
		const paperLeft = viewX;
		const paperTop = viewY;
		const paperW = PAPER_WIDTH * viewScale;
		const paperH = PAPER_HEIGHT * viewScale;
		const scale = viewScale;

		textarea.style.left = (paperLeft + LEFT_MARGIN * scale + TEXT_OFFSET_FROM_MARGIN * scale) + "px";
		textarea.style.top = (paperTop + TOP_MARGIN * scale) + "px";
		textarea.style.width = (paperW - LEFT_MARGIN * scale - RIGHT_MARGIN * scale - TEXT_OFFSET_FROM_MARGIN * scale * 2) + "px";
		textarea.style.height = (paperH - TOP_MARGIN * scale - BOTTOM_MARGIN * scale) + "px";
		textarea.style.lineHeight = (LINE_GAP * scale) + "px";
		textarea.style.fontSize = (FONT_SIZE * scale) + "px";
	}
	function scheduleLayoutAndRender() {
		if (layoutScheduled) return;
		layoutScheduled = true;
		requestAnimationFrame(() => {
			layoutScheduled = false;
			layoutOverlay();
			render();
		});
	}
	layoutOverlay();
	window.addEventListener("resize", scheduleLayoutAndRender);

	let tapTimeout = 0;
	canvas.addEventListener("pointerdown", (e) => {
		if (e.pointerType === "touch" && pointers.size === 1) {
			tapTimeout = setTimeout(() => {
				const rect = canvas.getBoundingClientRect();
				const paperLeft = viewX;
				const paperTop = viewY;
				const paperW = PAPER_WIDTH * viewScale;
				const paperH = PAPER_HEIGHT * viewScale;
				const x = e.clientX - rect.left;
				const y = e.clientY - rect.top;
				if (x >= paperLeft && x <= paperLeft + paperW && y >= paperTop && y <= paperTop + paperH) {
					textarea.focus();
				}
			}, 150);
		}
	}, { passive: true });

	canvas.addEventListener("pointerup", () => {
		clearTimeout(tapTimeout);
	}, { passive: true });

	function render() {
		if (!device || !context) return;
		try {
			const vs = viewportSize();
			const paperW = PAPER_WIDTH * viewScale;
			const paperH = PAPER_HEIGHT * viewScale;
			const sx = paperW / vs.w;
			const sy = paperH / vs.h;
			const cx = (viewX + paperW / 2) / vs.w * 2 - 1;
			const cy = 1 - (viewY + paperH / 2) / vs.h * 2;
			uniformData[0] = cx;
			uniformData[1] = cy;
			uniformData[2] = sx;
			uniformData[3] = sy;
			device.queue.writeBuffer(uniformBuf, 0, uniformData);
			const view = context.getCurrentTexture().createView();
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({
				colorAttachments: [{ view, clearValue: { r: 0.91, g: 0.89, b: 0.86, a: 1 }, loadOp: "clear", storeOp: "store" }],
			});
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, bindGroup);
			pass.draw(6);
			pass.end();
			device.queue.submit([encoder.finish()]);
			console.log("Render frame");
		} catch (err) {
			console.error("Render failed:", err);
			msg.textContent = "Render failed: " + (err && err.message ? err.message : err);
		}
	}
	render();
	window.addEventListener("resize", render);

	textarea.addEventListener("focus", () => {
		msg.textContent = "";
	});
	textarea.addEventListener("blur", () => {
		msg.textContent = "Click to type";
	});
	msg.textContent = "Click to type. Pan: drag. Zoom: wheel / pinch. Reset: button or R";
	console.log("Initialization complete");
})();