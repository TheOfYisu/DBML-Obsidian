import { ErdModel, ErdTable, TableNode } from "../model/erd-model";

export const HEADER_H = 38;
export const ROW_H = 27;
export const BOTTOM_PAD = 10;
export const PAD = 16;
export const GAP_X = 90;
export const GAP_Y = 50;

export interface Measurer {
	measure(text: string, font: string): number;
}

export function measureTable(table: ErdTable, m: Measurer, fonts: { header: string; field: string; type: string; badge: string }): { w: number; h: number } {
	const title = table.schema ? `${table.schema}.${table.name}` : table.name;
	let nameMax = 0;
	let typeMax = 0;
	let badgeMax = 0;

	for (const f of table.fields) {
		const label = f.pk && f.fk ? "PK·FK" : f.pk ? "PK" : f.fk ? "FK" : f.unique ? "UQ" : "";
		const bw = label ? m.measure(label, fonts.badge) + 14 : 0;
		badgeMax = Math.max(badgeMax, bw);
		nameMax = Math.max(nameMax, m.measure(f.name, fonts.field));
		typeMax = Math.max(typeMax, m.measure(f.type, fonts.type));
	}

	const contentW = PAD + badgeMax + (badgeMax > 0 ? 8 : 0) + nameMax + 24 + typeMax + PAD;
	const titleW = m.measure(title, fonts.header) + 2 * PAD;
	const w = Math.max(170, Math.min(360, Math.ceil(Math.max(contentW, titleW))));
	const h = HEADER_H + table.fields.length * ROW_H + BOTTOM_PAD;

	return { w, h };
}

export function autoLayout(
	model: ErdModel,
	m: Measurer,
	fonts: { header: string; field: string; type: string; badge: string },
	prevPositions: Map<string, { x: number; y: number }>
): Map<string, TableNode> {
	const nodes = new Map<string, TableNode>();
	if (model.tables.length === 0) return nodes;

	// Build adjacency and degree
	const degree = new Map<string, number>();
	const adj = new Map<string, Set<string>>();
	for (const t of model.tables) {
		degree.set(t.id, 0);
		adj.set(t.id, new Set());
	}
	for (const r of model.relations) {
		degree.set(r.fromTable, (degree.get(r.fromTable) ?? 0) + 1);
		degree.set(r.toTable, (degree.get(r.toTable) ?? 0) + 1);
		adj.get(r.fromTable)?.add(r.toTable);
		adj.get(r.toTable)?.add(r.fromTable);
	}

	// Find root: most connected table
	let rootId = model.tables[0].id;
	let maxDeg = 0;
	for (const [id, d] of degree) {
		if (d > maxDeg) { maxDeg = d; rootId = id; }
	}

	// Split connected vs disconnected
	const layers: string[][] = [];
	const connected = new Set<string>();
	const queue: { id: string; layer: number }[] = [{ id: rootId, layer: 0 }];
	connected.add(rootId);

	while (queue.length > 0) {
		const { id, layer } = queue.shift()!;
		if (layers.length <= layer) layers.push([]);
		layers[layer].push(id);

		const neighbors = Array.from(adj.get(id) || [])
			.filter(n => !connected.has(n))
			.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0));

		for (const n of neighbors) {
			connected.add(n);
			queue.push({ id: n, layer: layer + 1 });
		}
	}

	// Collect disconnected tables
	const disconnected = model.tables.filter(t => !connected.has(t.id)).map(t => t.id);

	// Measure all
	const measured = new Map<string, { w: number; h: number }>();
	for (const t of model.tables) {
		measured.set(t.id, measureTable(t, m, fonts));
	}
	const rootMeasured = measured.get(rootId)!;
	const ih = Math.max(...Array.from(measured.values(), v => v.h));

	// Position connected layers: root centered, neighbors fanned out
	let x = 0;
	let maxLayerBottom = 0;

	for (let l = 0; l < layers.length; l++) {
		const layer = layers[l];
		layer.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0));

		const maxW = Math.max(...layer.map(id => measured.get(id)!.w));
		const totalH = layer.reduce((s, id) => s + measured.get(id)!.h, 0) + (layer.length - 1) * GAP_Y;

		let y = l === 0 ? -rootMeasured.h / 2 : -totalH / 2;

		for (const id of layer) {
			const { w, h } = measured.get(id)!;
			const prev = prevPositions.get(id);
			const t = model.tables.find(t => t.id === id)!;
			const nx = prev ? prev.x : x;
			const ny = prev ? prev.y : y;
			nodes.set(id, { table: t, x: nx, y: ny, w, h });
			y += h + GAP_Y;
		}
		maxLayerBottom = Math.max(maxLayerBottom, y - GAP_Y + ih);
		x += maxW + GAP_X;
	}

	// Post-process: bring far-apart connected tables closer
	const layerMap = new Map<string, number>();
	for (let l = 0; l < layers.length; l++) {
		for (const id of layers[l]) layerMap.set(id, l);
	}

	for (const r of model.relations) {
		const la = layerMap.get(r.fromTable);
		const lb = layerMap.get(r.toTable);
		if (la == null || lb == null) continue;
		const node = nodes.get(r.fromTable)!;
		// If tables are > 1 layer apart, move the higher-layer one closer
		if (Math.abs(la - lb) > 1) {
			const closer = Math.min(la, lb) + 1;
			const targetLayer = layers[closer];
			if (targetLayer) {
				// Place the distant table at the same X as the closer layer
				const closerNode = nodes.get(layers[Math.min(la, lb)][0])!;
				node.x = closerNode.x;
				layerMap.set(r.fromTable, closer);
			}
		}
	}

	// Calculate maxBottom and centerX from all connected tables
	let maxBottom = 0;
	let minCX = Infinity, maxCX = -Infinity;
	for (const id of connected) {
		const node = nodes.get(id);
		if (node) {
			maxBottom = Math.max(maxBottom, node.y + node.h);
			minCX = Math.min(minCX, node.x);
			maxCX = Math.max(maxCX, node.x + node.w);
		}
	}
	const centerX = isFinite(minCX) ? (minCX + maxCX) / 2 : 0;
	const connectedWidth = isFinite(minCX) ? maxCX - minCX + GAP_X : 400;

	// Disconnected: centered under connected area, stack if wider
	if (disconnected.length > 0) {
		const maxConnectedH = connected.size > 0 ? Math.max(...Array.from(connected).map(id => measured.get(id)!.h)) : 200;
		const discMeasured = disconnected.map(id => measured.get(id)!);
		const maxDiscH = Math.max(...discMeasured.map(m => m.h));
		const perRow = Math.max(1, Math.floor(connectedWidth / (maxDiscH > 0 ? maxDiscH * 2 : 200)));

		let rowY = maxBottom + maxConnectedH * 0.5;
		let i = 0;
		while (i < disconnected.length) {
			const rowEnd = Math.min(i + Math.max(1, Math.floor(disconnected.length / Math.ceil(disconnected.length / Math.max(1, Math.ceil(disconnected.length * (maxDiscH + GAP_X) / connectedWidth))))), disconnected.length);
			// Simpler: just split into rows that fit width
			const row: string[] = [];
			let rowW = 0;
			while (i < disconnected.length) {
				const w = measured.get(disconnected[i])!.w;
				if (row.length > 0 && rowW + w + GAP_X > connectedWidth) break;
				rowW += w + (row.length > 0 ? GAP_X : 0);
				row.push(disconnected[i]);
				i++;
			}
			let dx = centerX - rowW / 2;
			for (const id of row) {
				const { w, h } = measured.get(id)!;
				nodes.set(id, { table: model.tables.find(t => t.id === id)!, x: prevPositions.get(id)?.x ?? dx, y: prevPositions.get(id)?.y ?? rowY, w, h });
				dx += w + GAP_X;
			}
			rowY += maxDiscH + GAP_Y;
		}
	}

	return nodes;
}
