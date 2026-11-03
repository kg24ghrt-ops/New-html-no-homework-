import { paperRect as paperRectFn, PAPER_WIDTH, PAPER_HEIGHT } from "./paper.js";

const canvas = document.getElementById("canvas");
const msg = document.getElementById("msg");
const resetBtn = document.getElementById("resetBtn");

const isMobile = window.matchMedia("(pointer: coarse)").matches;
const dprCap = isMobile ? Math.min(window.devicePixelRatio || 1, 1.5) : (window.devicePixelRatio || 1);

function visibleSize() {
	const vv = window.visualViewport;
	return { w: vv ? vv.width : window.innerWidth, h: vv ? vv.height : window.innerHeight };
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
let pinchStartScale = 1;
let pinchStartDist = 0;
let pinchCenterX = 0;
let pinchCenterY = 0;

function resetView() {
	const vs = visibleSize();
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
	const minScale = 0.05;
	const maxScale = 50;
	viewScale = Math.max(minScale, Math.min(maxScale, viewScale));

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

canvas.addEventListener("pointerdown", (e) => {
	if (e.target === resetBtn) return;
	if (e.button !== 0 && e.button !== 1) return;
	isPanning = true;
	lastPointerX = e.clientX;
	lastPointerY = e.clientY;
	canvas.setPointerCapture(e.pointerId);
	e.preventDefault();
}, { passive: false });

canvas.addEventListener("pointermove", (e) => {
	if (!isPanning) return;
	const dx = e.clientX - lastPointerX;
	const dy = e.clientY - lastPointerY;
	viewX += dx;
	viewY += dy;
	lastPointerX = e.clientX;
	lastPointerY = e.clientY;
	clampView(visibleSize());
	scheduleLayoutAndRender();
}, { passive: true });

canvas.addEventListener("pointerup", (e) => {
	isPanning = false;
	canvas.releasePointerCapture(e.pointerId);
}, { passive: true });

canvas.addEventListener("pointerleave", () => {
	isPanning = false;
}, { passive: true });

canvas.addEventListener("wheel", (e) => {
	e.preventDefault();
	const vs = visibleSize();
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

canvas.addEventListener("pointerdown", (e) => {
	if (e.pointerType === "touch") {
		const touches = e.targetTouches || [e];
		if (touches.length === 2) {
			const t1 = touches[0];
			const t2 = touches[1];
			pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
			pinchCenterX = (t1.clientX + t2.clientX) / 2;
			pinchCenterY = (t1.clientY + t2.clientY) / 2;
			pinchStartScale = viewScale;
			isPanning = false;
		}
	}
}, { passive: true });

canvas.addEventListener("pointermove", (e) => {
	if (e.pointerType === "touch" && e.targetTouches && e.targetTouches.length === 2) {
		const t1 = e.targetTouches[0];
		const t2 = e.targetTouches[1];
		const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
		if (pinchStartDist > 0) {
			const vs = visibleSize();
			const scaleChange = dist / pinchStartDist;
			viewScale = pinchStartScale * scaleChange;
			clampView(vs);

			const rect = canvas.getBoundingClientRect();
			const centerX = pinchCenterX - rect.left;
			const centerY = pinchCenterY - rect.top;
			const paperBefore = screenToPaper(centerX, centerY);
			const paperAfter = screenToPaper(centerX, centerY);
			viewX += (paperBefore.x - paperAfter.x) * viewScale;
			viewY += (paperBefore.y - paperAfter.y) * viewScale;
			clampView(vs);
			scheduleLayoutAndRender();
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

	const lineGap = Math.round(PAPER_HEIGHT / 96);
	const topMargin = Math.round(PAPER_HEIGHT * 0.0288);
	const bottomMargin = Math.round(PAPER_HEIGHT * 0.0192);
	const leftMargin = Math.round(PAPER_WIDTH * 0.0318);
	const rightMargin = Math.round(PAPER_WIDTH * 0.0227);
	const marginLineX = Math.round(PAPER_WIDTH * 0.0477);
	const holeRadius = Math.round(PAPER_WIDTH * 0.0034);
	const holeX = Math.round(PAPER_WIDTH * 0.017);
	const holeSpacing = Math.round(PAPER_HEIGHT * 0.064);
	const firstHoleY = Math.round(PAPER_HEIGHT * 0.032);

	function drawPaper(text) {
		ctx.fillStyle = "#fefdf8";
		ctx.fillRect(0, 0, paper.width, paper.height);

		ctx.strokeStyle = "#e0dbc8";
		ctx.lineWidth = Math.max(1, Math.round(PAPER_HEIGHT / 2500));
		for (let y = topMargin; y < paper.height - bottomMargin; y += lineGap) {
			ctx.beginPath();
			ctx.moveTo(leftMargin, y);
			ctx.lineTo(paper.width - rightMargin, y);
			ctx.stroke();
		}

		ctx.strokeStyle = "#d46b6b";
		ctx.lineWidth = Math.max(1, Math.round(PAPER_WIDTH / 1466));
		ctx.beginPath();
		ctx.moveTo(marginLineX, topMargin);
		ctx.lineTo(marginLineX, paper.height - bottomMargin);
		ctx.stroke();

		ctx.fillStyle = "#d46b6b";
		for (let hy = firstHoleY; hy < paper.height - bottomMargin; hy += holeSpacing) {
			ctx.beginPath();
			ctx.arc(holeX, hy, holeRadius, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.fillStyle = "#2d2d2d";
		const fontSize = Math.round(PAPER_HEIGHT / 166);
		ctx.font = `${fontSize}px monospace`;
		text.split("\n").forEach((line, i) => {
			ctx.fillText(line, leftMargin + Math.round(PAPER_WIDTH / 50), topMargin + i * lineGap);
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
	function resize() {
		const dpr = isMobile ? dprCap : (window.devicePixelRatio || 1);
		canvas.width = Math.floor(window.innerWidth * dpr);
		canvas.height = Math.floor(window.innerHeight * dpr);
		if (!configured) {
			context.configure({ device, format, alphaMode: "premultiplied" });
			configured = true;
		}
		const vs = visibleSize();
		const r = paperRectFn(vs.w, vs.h);
		viewScale = r.scale;
		viewX = r.left;
		viewY = r.top;
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

		textarea.style.left = (paperLeft + leftMargin * scale + Math.round(PAPER_WIDTH / 50) * scale) + "px";
		textarea.style.top = (paperTop + topMargin * scale) + "px";
		textarea.style.width = (paperW - leftMargin * scale - rightMargin * scale - Math.round(PAPER_WIDTH / 50) * scale * 2) + "px";
		textarea.style.height = (paperH - topMargin * scale - bottomMargin * scale) + "px";
		textarea.style.lineHeight = (lineGap * scale) + "px";
		textarea.style.fontSize = (Math.round(PAPER_HEIGHT / 166) * scale) + "px";
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
	if (window.visualViewport) {
		window.visualViewport.addEventListener("resize", scheduleLayoutAndRender);
	}
	if (isMobile) {
		canvas.addEventListener("pointerdown", () => textarea.focus(), { passive: true });
	}

	function render() {
		if (!device || !context) return;
		try {
			const vs = visibleSize();
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



