// Font stacks shared by the canvas ink layer, the transparent textarea and the
// offscreen line-break mirror. Keep them in one place so the three can never
// drift apart.

export const LATIN_HAND_FONT = "Handwriting";
export const MYANMAR_FONT = "MyanmarInk";
export const MONOSPACE_FONT_STACK = "monospace";

// Caveat covers Latin; Noto Sans Myanmar covers the Myanmar script (and the
// Latin characters inside a mixed run). The generic monospace is only a last
// resort while the woff2 files load.
export const INK_FONT_STACK = `"${LATIN_HAND_FONT}", "${MYANMAR_FONT}", ${MONOSPACE_FONT_STACK}`;

export const FONT_MODES = ["handwriting", "monospace"];

export function fontStack(mode) {
	return mode === "monospace" ? MONOSPACE_FONT_STACK : INK_FONT_STACK;
}

export function fontSpec(mode, sizePx) {
	return `${sizePx}px ${fontStack(mode)}`;
}

// Resolve the real font faces before the first measurement and paint. A device
// without document.fonts (or with fonts blocked) simply keeps the fallback
// stack; the safe monospace mode still works.
export async function loadInkFonts(sizePx) {
	if (typeof document === "undefined" || !document.fonts || !document.fonts.load) {
		return false;
	}
	const loads = [
		document.fonts.load(`${sizePx}px "${LATIN_HAND_FONT}"`, "Aa"),
		document.fonts.load(`${sizePx}px "${MYANMAR_FONT}"`, "မြန်မာ"),
	];
	try {
		await Promise.all(loads);
		if (document.fonts.ready) await document.fonts.ready;
		return true;
	} catch {
		// A blocked font request must not stop the notebook from opening.
		return false;
	}
}
