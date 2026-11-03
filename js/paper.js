// JIS B5 paper: 182mm × 257mm. At 10px/mm = 1820 × 2570
export const PAPER_WIDTH = 1820;
export const PAPER_HEIGHT = 2570;

export function paperRect(viewportWidth, viewportHeight, paperWidth = PAPER_WIDTH, paperHeight = PAPER_HEIGHT) {
	const aspect = paperWidth / paperHeight;
	let w;
	let h;
	if (viewportWidth / viewportHeight > aspect) {
		h = viewportHeight * 0.99;
		w = h * aspect;
	} else {
		w = viewportWidth * 0.99;
		h = w / aspect;
	}
	return {
		left: (viewportWidth - w) / 2,
		top: (viewportHeight - h) / 2,
		w,
		h,
		scale: h / paperHeight,
	};
}
