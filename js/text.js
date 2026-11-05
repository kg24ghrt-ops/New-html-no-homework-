// Text layout shared by drawing and page splitting. `measure` is any object
// with a measureText(str).width method (a canvas 2d context in the app).

function fitWord(word, maxWidth, result, measure) {
	if (measure.measureText(word).width <= maxWidth) {
		result.push(word);
		return;
	}
	let chunk = "";
	for (const ch of word) {
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
	const words = line.split(" ");
	let current = "";
	for (const word of words) {
		const test = current ? current + " " + word : word;
		if (measure.measureText(test).width <= maxWidth) {
			current = test;
		} else {
			if (current) result.push(current);
			current = word;
			if (measure.measureText(word).width > maxWidth) {
				fitWord(word, maxWidth, result, measure);
				current = "";
			}
		}
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
