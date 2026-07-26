export function buildStandaloneSvg(svgEl: SVGSVGElement, bbox: { x: number; y: number; w: number; h: number }, padding: number = 10): string {
	const clone = svgEl.cloneNode(true) as SVGSVGElement;
	const vx = bbox.x - padding;
	const vy = bbox.y - padding;
	const vw = bbox.w + 2 * padding;
	const vh = bbox.h + 2 * padding;

	// Reset viewport transform so content maps to absolute coordinates
	const viewport = clone.querySelector(".erd-viewport");
	if (viewport) viewport.setAttribute("transform", "translate(0, 0) scale(1)");

	clone.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
	clone.setAttribute("width", String(Math.ceil(vw)));
	clone.setAttribute("height", String(Math.ceil(vh)));
	clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
	clone.removeAttribute("class");

	const style = collectErdStyles(svgEl);
	const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
	styleEl.textContent = style;
	clone.insertBefore(styleEl, clone.firstChild);

	const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
	bg.setAttribute("x", String(vx));
	bg.setAttribute("y", String(vy));
	bg.setAttribute("width", String(vw));
	bg.setAttribute("height", String(vh));
	bg.setAttribute("fill", getComputedStyle(svgEl).getPropertyValue("--background-primary").trim() || "#1e1e1e");
	if (clone.firstChild) {
		clone.insertBefore(bg, clone.firstChild.nextSibling);
	} else {
		clone.appendChild(bg);
	}

	const serializer = new XMLSerializer();
	return serializer.serializeToString(clone);
}

function collectErdStyles(svgEl: SVGSVGElement): string {
	const styles: string[] = [];
	const sheets = Array.from(document.styleSheets);
	for (const sheet of sheets) {
		try {
			const rules = Array.from(sheet.cssRules || []);
			for (const rule of rules) {
				const text = rule.cssText;
				if (text.includes(".erd-")) {
					styles.push(resolveCssVars(text, svgEl));
				}
			}
		} catch {}
	}
	return styles.join("\n");
}

function resolveCssVars(css: string, el: Element): string {
	const computed = getComputedStyle(el);
	return css.replace(/var\((--[^,)]+)(?:,\s*([^)]+))?\)/g, (match: string, name: string, fallback?: string): string => {
		const val = computed.getPropertyValue(name).trim();
		return val || fallback || "";
	});
}

export async function svgToPngBlob(svgText: string, width: number, height: number, scale: number = 4): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		img.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = width * scale;
			canvas.height = height * scale;
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				URL.revokeObjectURL(url);
				reject(new Error("Canvas not supported"));
				return;
			}
			ctx.scale(scale, scale);
			ctx.drawImage(img, 0, 0, width, height);
			URL.revokeObjectURL(url);
			canvas.toBlob((b) => {
				if (!b) reject(new Error("Failed to create PNG"));
				else resolve(b);
			}, "image/png");
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("Failed to load SVG"));
		};
		img.src = url;
	});
}

export function downloadText(filename: string, text: string, mime: string = "text/plain"): void {
	const blob = new Blob([text], { type: mime });
	downloadBlob(filename, blob);
}

export function downloadBlob(filename: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
