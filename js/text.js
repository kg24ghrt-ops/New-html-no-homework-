// Text layout shared by drawing and page splitting. `measure` is any object
// with a measureText(str).width method (a canvas 2d context in the app).

// Grapheme clusters keep combining marks attached to their base character.
// That matters for Burmese/Myanmar and other scripts where one visible glyph
// is several code points.
const graphemeSegmenter =
	typeof Intl !== "undefined" && Intl.Segmenter
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: null;

export function graphemes(text) {
	if (!graphemeSegmenter) return Array.from(text);
	return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

const MYANMAR_CHAR = /\p{Script=Myanmar}/u;

// Split a visual line into script runs. Everything that is not Myanmar
// (Latin, digits, punctuation, spaces) is one "other" run. The returned
// offsets are UTF-16 offsets into the line.
export function scriptRuns(line) {
	const runs = [];
	let current = null;
	for (const cluster of graphemeOffsets(line)) {
		const script = MYANMAR_CHAR.test(cluster.segment) ? "myanmar" : "latin";
		if (!current || current.script !== script) {
			current = { script, text: "", start: cluster.offset };
			runs.push(current);
		}
		current.text += cluster.segment;
	}
	return runs;
}

// Grapheme clusters with their UTF-16 offsets in the original string. Caret
// placement and source-stable ink seeds both need the offset, not just the
// visible cluster.
export function graphemeOffsets(text) {
	if (!graphemeSegmenter) {
		return Array.from(text, (segment, offset) => ({ segment, offset }));
	}
	return Array.from(graphemeSegmenter.segment(text), (part) => ({
		segment: part.segment,
		offset: part.index,
	}));
}

function fitWord(word, maxWidth, result, measure) {
	if (measure.measureText(word).width <= maxWidth) {
		result.push(word);
		return;
	}
	let chunk = "";
	for (const ch of graphemes(word)) {
		const t2 = chunk + ch;
		if (measure.measureText(t2).width <= maxWidth) {
			chunk = t2;
		} else {
			if (chunk) result.push(chunk);
			chunk = ch;
		}
	}
	if (chunk) result.push(chunk);
}

function wrapLine(line, maxWidth, result, measure) {
	// Leading spaces are part of the line's advance. Dropping them would draw
	// an indented line at the left edge while the caret stays indented.
	const leading = line.match(/^ +/)?.[0] ?? "";
	const body = line.slice(leading.length);
	if (body === "") {
		result.push(line);
		return;
	}

	const words = body.split(" ");
	let current = "";
	let firstWord = true;
	for (const word of words) {
		const base = firstWord ? leading + word : word;
		const test = current ? current + " " + word : base;
		if (measure.measureText(test).width <= maxWidth) {
			current = test;
		} else {
			if (current) result.push(current);
			current = base;
			if (measure.measureText(base).width > maxWidth) {
				fitWord(base, maxWidth, result, measure);
				current = "";
			}
		}
		firstWord = false;
	}
	if (current) result.push(current);
}

export function wrapText(text, maxWidth, measure) {
	const lines = text.split("\n");
	const result = [];
	for (const line of lines) {
		if (line === "") {
			result.push("");
			continue;
		}
		wrapLine(line, maxWidth, result, measure);
	}
	return result;
}

// Same wrapping as wrapText, but each visual line remembers where it starts in
// the source text. That absolute offset is what keeps ink seeds stable and
// lets a tap map back to the right character.
export function layoutTextLines(text, maxWidth, measure) {
	const wrapped = wrapText(text, maxWidth, measure);
	const lines = [];
	let offset = 0;
	for (const visual of wrapped) {
		if (visual === "") {
			lines.push({ text: "", start: offset });
			offset += 1;
			continue;
		}
		const at = text.indexOf(visual, offset);
		const start = at < 0 ? offset : at;
		lines.push({ text: visual, start });
		offset = start + visual.length;
		if (text[offset] === " " || text[offset] === "\n") offset += 1;
	}
	return lines;
}

// Find the largest prefix that still fits on one page. Binary search keeps the
// split based on the real wrapped lines instead of counting "\n" characters.
export function splitPage(text, maxWidth, maxLines, measure) {
	if (wrapText(text, maxWidth, measure).length <= maxLines) return null;

	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (wrapText(text.slice(0, mid), maxWidth, measure).length <= maxLines) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}

	// shortcut: may split in the middle of a word at the page edge; the next
	// page continues it. Preferring a break would risk overflowing the page.
	if (lo <= 0 || lo >= text.length) return null;
	return { head: text.slice(0, lo), tail: text.slice(lo), cut: lo };
}
