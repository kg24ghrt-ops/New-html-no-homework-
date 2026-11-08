// Font stacks shared by the canvas ink layer, the transparent textarea and the
// offscreen line-break mirror. Keep them in one place so the three can never
// drift apart.

export const LATIN_HAND_FONT = "Handwriting";
export const MYANMAR_FONT = "MyanmarInk";
export const MONOSPACE_FONT = "MonospaceInk";
const GENERIC_MONOSPACE = "monospace";

// A local monospace face with the same metric overrides as the two bundled
// faces, then the bundled Myanmar face, then the generic fallback. This keeps
// Latin and Myanmar line boxes the same height in monospace mode too.
export const MONOSPACE_FONT_STACK = `"${MONOSPACE_FONT}", "${MYANMAR_FONT}", ${GENERIC_MONOSPACE}`;

// Caveat covers Latin; Noto Sans Myanmar covers the Myanmar script. The
// generic monospace is only a last resort while the woff2 files load.
export const INK_FONT_STACK = `"${LATIN_HAND_FONT}", "${MYANMAR_FONT}", ${GENERIC_MONOSPACE}`;

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
		document.fonts.load(`${sizePx}px "${MONOSPACE_FONT}"`, "Aa"),
	];
	try {
		// A missing local monospace face must not block the bundled fonts.
		await Promise.allSettled(loads);
		if (document.fonts.ready) await document.fonts.ready;
		return true;
	} catch {
		// A blocked font request must not stop the notebook from opening.
		return false;
	}
}
