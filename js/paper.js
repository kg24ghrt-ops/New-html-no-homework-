export const MM = 10;

export const PAPER_WIDTH_MM = 182;
export const PAPER_HEIGHT_MM = 257;
export const PAPER_WIDTH = PAPER_WIDTH_MM * MM;
export const PAPER_HEIGHT = PAPER_HEIGHT_MM * MM;

export const LINE_GAP_MM = 7;
export const LINE_GAP = LINE_GAP_MM * MM;

// Font size derived from line gap (~0.65 * LINE_GAP)
export const FONT_SIZE_MM = Math.round(LINE_GAP_MM * 0.65 * 10) / 10;
export const FONT_SIZE = FONT_SIZE_MM * MM;

export const TOP_MARGIN_MM = 10;
export const BOTTOM_MARGIN_MM = 8;
export const RIGHT_MARGIN_MM = 5;
export const LEFT_MARGIN_MM = 10;

export const TOP_MARGIN = TOP_MARGIN_MM * MM;
export const BOTTOM_MARGIN = BOTTOM_MARGIN_MM * MM;
export const RIGHT_MARGIN = RIGHT_MARGIN_MM * MM;
export const LEFT_MARGIN = LEFT_MARGIN_MM * MM;

export const MARGIN_LINE_X_MM = 22;
export const MARGIN_LINE_X = MARGIN_LINE_X_MM * MM;

// Text inset from LEFT_MARGIN (not from margin line). Wide text area is deliberate - user can type outside red margin.
export const TEXT_INSET_MM = 3;
export const TEXT_INSET = TEXT_INSET_MM * MM;

export const HOLE_X_MM = 6;
export const HOLE_RADIUS_MM = 2.5;
// Hole spacing so holes are evenly distributed between top and bottom margins, never touching them
export const HOLE_SPACING_MM = 32;
export const FIRST_HOLE_Y_MM = TOP_MARGIN_MM + 10;

export const HOLE_X = HOLE_X_MM * MM;
export const HOLE_RADIUS = HOLE_RADIUS_MM * MM;
export const HOLE_SPACING = HOLE_SPACING_MM * MM;
export const FIRST_HOLE_Y = FIRST_HOLE_Y_MM * MM;

export const FIT_PADDING = 0.94;

export function paperRect(viewportWidth, viewportHeight, paperWidth = PAPER_WIDTH, paperHeight = PAPER_HEIGHT) {
	const aspect = paperWidth / paperHeight;
	let w;
	let h;
	if (viewportWidth / viewportHeight > aspect) {
		h = viewportHeight * FIT_PADDING;
		w = h * aspect;
	} else {
		w = viewportWidth * FIT_PADDING;
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