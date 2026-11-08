import { graphemeOffsets } from "./text.js";

// Caret placement is pure text math: no DOM, no canvas. The app feeds it the
// browser's visual lines and a measureText() implementation; the tests feed it
// mocks. Keeping it here means Node/Jest can cover the offsets that matter
// (soft wraps, hard newlines, combining marks and Myanmar clusters).

// Never split a grapheme cluster just to measure a caret. The browser keeps a
// Myanmar syllable together, so the caret must too.
export function snapToGrapheme(text, index) {
	const clamped = Math.max(0, Math.min(text.length, index));
	let boundary = 0;
	for (const cluster of graphemeOffsets(text)) {
		if (cluster.offset > clamped) break;
		boundary = cluster.offset;
		const end = cluster.offset + cluster.segment.length;
		if (end <= clamped) boundary = end;
	}
	return boundary;
}

// Which visual line owns an offset. A soft wrap has no separator, so the caret
// at the break belongs to the next row; a hard newline keeps it on the row it
// ends.
export function lineIndexForOffset(lines, index) {
	for (let i = 0; i < lines.length; i++) {
		const end = lines[i].start + lines[i].text.length;
		if (index < end) return i;
		if (index === end) {
			const next = lines[i + 1];
			if (next && next.start === end) continue;
			return i;
		}
	}
	return Math.max(0, lines.length - 1);
}

// x and baseline in paper pixels. `measure` is anything with
// measureText(str).width (a canvas 2d context in the app).
export function caretMetricsForOffset(text, offset, lines, measure, textX, baselineForLine) {
	const index = snapToGrapheme(text, offset);
	const lineIndex = lineIndexForOffset(lines, index);
	const line = lines[lineIndex] || { text: "", start: 0 };
	const relative = Math.max(0, Math.min(line.text.length, index - line.start));
	return {
		offset: index,
		lineIndex,
		lineStart: line.start,
		x: textX + measure.measureText(line.text.slice(0, relative)).width,
		baseline: baselineForLine(lineIndex),
	};
}
