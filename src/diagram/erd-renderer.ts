import { ErdModel, ErdRelation, ErdTable, ErdTableGroup, TableNode } from "../model/erd-model";
import { autoLayout, measureTable, HEADER_H, ROW_H, Measurer } from "./layout";
import { buildStandaloneSvg, downloadText, downloadBlob, svgToPngBlob } from "../export/exporter";

interface EdgeGfx {
	rel: ErdRelation;
	path: SVGPathElement;
	hit: SVGPathElement;
	glyphs: SVGGElement[];
	label?: SVGTextElement;
	labelBg?: SVGRectElement;
	anchors: SVGCircleElement[];
	a: TableNode;
	b: TableNode;
	aSide: "l" | "r";
	bSide: "l" | "r";
}

interface DragState {
	kind: "pan" | "table" | "selectRect";
	startX: number;
	startY: number;
	origTx?: number;
	origTy?: number;
	id?: string;
	node?: TableNode;
	origX?: number;
	origY?: number;
}

export interface RelationSelectData {
	fromTable: string;
	fromField: string;
	toTable: string;
	toField: string;
	type: string;
}

type RelationSelectCallback = (data: RelationSelectData) => void;

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag: string, attrs?: Record<string, string>): SVGElement {
	const el = document.createElementNS(SVG_NS, tag);
	if (attrs) {
		for (const [k, v] of Object.entries(attrs)) {
			el.setAttribute(k, v);
		}
	}
	return el;
}

function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}

export class ErdRenderer {
	readonly container: HTMLElement;
	private svg: SVGSVGElement;
	private viewport: SVGGElement;
	private groupsLayer: SVGGElement;
	private edgesLayer: SVGGElement;
	private tablesLayer: SVGGElement;
	private topLayer: SVGGElement;
	private model: ErdModel = { tables: [], relations: [], tableGroups: [] };
	private nodes = new Map<string, TableNode>();
	private nodeEls = new Map<string, SVGGElement>();
	private edges: EdgeGfx[] = [];
	private positions = new Map<string, { x: number; y: number }>();
	private t = { x: 20, y: 20, k: 1 };
	private fonts: { header: string; field: string; type: string; badge: string };
	private fitted = false;
	private resizeObs: ResizeObserver | null = null;
	private listeners: Array<() => void> = [];
	private drag: DragState | null = null;
	private moved = false;
	private selectedEdge: string | null = null;
	private hoveredTable: string | null = null;
	private relationMode = false;
	private relationSource: { tableId: string; fieldName: string } | null = null;
	private relPickerEl: HTMLElement | null = null;
	private onRelationSelectCallback: RelationSelectCallback | null = null;
	private boundKeyDown: (e: KeyboardEvent) => void;

	// Multi-select
	private selectedTableIds = new Set<string>();
	private selectRect: SVGRectElement | null = null;
	private selectStart = { x: 0, y: 0 };
	private onDeleteCallback: ((tableIds: string[]) => void) | null = null;
	private savedEdgeSides = new Map<string, { aSide: "l" | "r"; bSide: "l" | "r" }>();
	private onZoomCallback: (() => void) | null = null;
	private tooltipEl: HTMLElement | null = null;

	setOnDelete(cb: (tableIds: string[]) => void): void { this.onDeleteCallback = cb; }
	setOnZoom(cb: () => void): void { this.onZoomCallback = cb; }

	constructor(container: HTMLElement) {
		this.container = container;
		container.addClass("erd-container");
		this.svg = svgEl("svg", { class: "erd-svg" }) as SVGSVGElement;
		this.viewport = svgEl("g", { class: "erd-viewport" }) as SVGGElement;
		this.groupsLayer = svgEl("g", { class: "erd-groups" }) as SVGGElement;
		this.edgesLayer = svgEl("g", { class: "erd-edges" }) as SVGGElement;
		this.tablesLayer = svgEl("g", { class: "erd-tables" }) as SVGGElement;
		this.topLayer = svgEl("g", { class: "erd-overlay" }) as SVGGElement;
		this.viewport.append(this.groupsLayer, this.edgesLayer, this.tablesLayer, this.topLayer);
		this.svg.appendChild(this.viewport);
		container.appendChild(this.svg);
		this.fonts = this.readFonts();
		this.boundKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
		document.addEventListener("keydown", this.boundKeyDown);
		this.listeners.push(() => document.removeEventListener("keydown", this.boundKeyDown));
		this.bindEvents();
		this.resizeObs = new ResizeObserver(() => {
			if (!this.fitted && this.model.tables.length > 0) this.fit();
		});
		this.resizeObs.observe(container);
	}

	setOnRelationSelect(cb: RelationSelectCallback): void {
		this.onRelationSelectCallback = cb;
	}

	enterRelationMode(): void {
		this.relationMode = true;
		this.relationSource = null;
		this.container.addClass("erd-relation-mode");
		this.clearFieldHighlights();
	}

	exitRelationMode(): void {
		this.relationMode = false;
		this.relationSource = null;
		this.container.removeClass("erd-relation-mode");
		this.clearFieldHighlights();
		this.removeRelPicker();
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Escape" && this.relationMode) {
			this.exitRelationMode();
		}
		if ((e.key === "Delete" || e.key === "Backspace") && this.selectedTableIds.size > 0) {
			if (this.onDeleteCallback) {
				this.onDeleteCallback(Array.from(this.selectedTableIds));
			}
			this.selectedTableIds.clear();
			this.updateSelectionVisual();
		}
	}

	private readFonts(): { header: string; field: string; type: string; badge: string } {
		const cs = getComputedStyle(this.container);
		const ui = cs.getPropertyValue("--font-text").trim() || "Inter, sans-serif";
		const mono = cs.getPropertyValue("--font-monospace").trim() || "monospace";
		return {
			header: `600 13px ${ui}`,
			field: `12px ${mono}`,
			type: `12px ${mono}`,
			badge: `bold 9px ${ui}`,
		};
	}

	private measurer(): Measurer {
		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d")!;
		return {
			measure: (text: string, font: string) => {
				ctx.font = font;
				return ctx.measureText(text).width;
			},
		};
	}

	private bindEvents(): void {
		this.on(this.svg, "wheel", this.onWheel, { passive: false });
		this.on(this.svg, "pointerdown", this.onPointerDown);
		this.on(this.svg, "pointermove", this.onPointerMove);
		this.on(this.svg, "pointerup", this.onPointerUp);
		this.on(this.svg, "pointercancel", this.onPointerUp);
	}

	private on(el: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions): void {
		el.addEventListener(type, fn as EventListener, opts);
		this.listeners.push(() => el.removeEventListener(type, fn as EventListener, opts));
	}

	private onWheel = (e: WheelEvent): void => {
		e.preventDefault();
		const rect = this.svg.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		if (e.ctrlKey || e.metaKey) {
			const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
			this.zoomAt(mx, my, factor);
		} else if (e.shiftKey) {
			this.t.x -= e.deltaY * 0.5 / this.t.k;
			this.applyTransform();
		} else {
			this.t.y -= e.deltaY * 0.5 / this.t.k;
			this.applyTransform();
		}
	};

	zoomAt(mx: number, my: number, factor: number): void {
		const k2 = clamp(this.t.k * factor, 0.15, 3);
		const s = k2 / this.t.k;
		this.t.x = mx - (mx - this.t.x) * s;
		this.t.y = my - (my - this.t.y) * s;
		this.t.k = k2;
		this.applyTransform();
		if (this.onZoomCallback) this.onZoomCallback();
	}

	private onPointerDown = (e: PointerEvent): void => {
		if (e.button !== 0 && e.button !== 1) return;
		const target = e.target as Element;

		if (this.relationMode) {
			e.preventDefault();
			if (this.relPickerEl && (target.closest?.(".erd-rel-picker") || this.relPickerEl.contains(target))) return;
			const fieldRow = this.findFieldRow(target);
			if (fieldRow) {
				const tableId = fieldRow.getAttribute("data-table-id")!;
				const fieldName = fieldRow.getAttribute("data-field-name")!;
				this.handleRelationClick(tableId, fieldName, fieldRow, e.clientX, e.clientY);
			}
			return;
		}

		const tableG = target.closest?.(".erd-table") as SVGGElement | null;
		this.moved = false;

		if (e.ctrlKey || e.metaKey || e.button === 1) {
			// Ctrl+drag or middle button = pan
			this.drag = { kind: "pan", startX: e.clientX, startY: e.clientY, origTx: this.t.x, origTy: this.t.y };
			this.svg.style.cursor = "grabbing";
			this.svg.setPointerCapture(e.pointerId);
			e.preventDefault();
			return;
		}

		if (tableG) {
			const id = tableG.dataset.tableId!;
			const node = this.nodes.get(id);
			if (!node) return;
			if (e.shiftKey) {
				if (this.selectedTableIds.has(id)) this.selectedTableIds.delete(id);
				else this.selectedTableIds.add(id);
			} else {
				if (!this.selectedTableIds.has(id)) {
					this.selectedTableIds.clear();
					this.selectedTableIds.add(id);
				}
			}
			this.drag = { kind: "table", startX: e.clientX, startY: e.clientY, id, node, origX: node.x, origY: node.y };
			this.updateSelectionVisual();
		} else {
			if (!e.shiftKey) this.selectedTableIds.clear();
			this.updateSelectionVisual();
			this.drag = { kind: "selectRect", startX: e.clientX, startY: e.clientY };
			if (!e.shiftKey) this.selectedTableIds.clear();
			if (!target.closest(".erd-edge-hit")) this.clearSelection();
		}
		this.svg.setPointerCapture(e.pointerId);
		e.preventDefault();
	};

	private findFieldRow(target: Element): Element | null {
		let el: Node | null = target;
		while (el && el !== this.svg) {
			if (el instanceof Element && el.classList.contains("erd-field-row")) {
				return el;
			}
			el = el.parentNode;
		}
		return null;
	}

	private handleRelationClick(tableId: string, fieldName: string, fieldRow: Element, clientX: number, clientY: number): void {
		this.removeRelPicker();
		if (!this.relationSource) {
			this.relationSource = { tableId, fieldName };
			this.clearFieldHighlights();
			fieldRow.setAttribute("data-rel-source", "true");
		} else if (this.relationSource.tableId !== tableId) {
			this.showRelPicker(tableId, fieldName, clientX, clientY);
		} else {
			this.relationSource = { tableId, fieldName };
			this.clearFieldHighlights();
			fieldRow.setAttribute("data-rel-source", "true");
		}
	}

	private showRelPicker(targetTableId: string, targetFieldName: string, clientX: number, clientY: number): void {
		this.removeRelPicker();
		const containerRect = this.container.getBoundingClientRect();
		const picker = this.container.createDiv("erd-rel-picker");
		picker.style.left = `${clientX - containerRect.left - 40}px`;
		picker.style.top = `${clientY - containerRect.top - 52}px`;

		const types = [
			{ symbol: ">", label: "N:1" },
			{ symbol: "<", label: "1:N" },
			{ symbol: "-", label: "1:1" },
		];

		for (const t of types) {
			const btn = picker.createEl("button", { cls: "erd-rel-picker-btn", attr: { title: t.label } });
			btn.textContent = t.symbol;
			btn.addEventListener("click", (ev) => {
				ev.stopPropagation();
				if (this.onRelationSelectCallback && this.relationSource) {
					this.onRelationSelectCallback({
						fromTable: this.relationSource.tableId,
						fromField: this.relationSource.fieldName,
						toTable: targetTableId,
						toField: targetFieldName,
						type: t.symbol,
					});
				}
				this.exitRelationMode();
			});
		}

		const cancelBtn = picker.createEl("button", { cls: "erd-rel-picker-btn erd-rel-picker-cancel", attr: { title: "Cancel" } });
		cancelBtn.textContent = "\u2715";
		cancelBtn.addEventListener("click", (ev) => {
			ev.stopPropagation();
			this.exitRelationMode();
		});

		this.relPickerEl = picker;

		const handler = (ev: MouseEvent) => {
			if (ev.target instanceof SVGElement) return;
			if (!picker.contains(ev.target as Node)) {
				this.exitRelationMode();
				document.removeEventListener("click", handler, true);
			}
		};
		setTimeout(() => document.addEventListener("click", handler, true), 0);
	}

	private removeRelPicker(): void {
		if (this.relPickerEl) {
			this.relPickerEl.remove();
			this.relPickerEl = null;
		}
	}

	private clearFieldHighlights(): void {
		this.container.querySelectorAll("[data-rel-source]").forEach((el) => el.removeAttribute("data-rel-source"));
	}

	private onPointerMove = (e: PointerEvent): void => {
		if (!this.drag) return;
		const dx = e.clientX - this.drag.startX;
		const dy = e.clientY - this.drag.startY;
		if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
		if (this.drag.kind === "pan") {
			this.t.x = this.drag.origTx! + dx;
			this.t.y = this.drag.origTy! + dy;
			this.applyTransform();
		} else if (this.drag.kind === "selectRect") {
			this.drawSelectRect(this.drag.startX, this.drag.startY, e.clientX, e.clientY);
		} else if (this.drag.kind === "table") {
		const node = this.nodes.get(this.drag.id!);
			if (!node) return;
			const snap = 20;
			const nx = Math.round((this.drag.origX! + dx / this.t.k) / snap) * snap;
			const ny = Math.round((this.drag.origY! + dy / this.t.k) / snap) * snap;
			const offX = nx - this.nodes.get(this.drag.id!)!.x;
			const offY = ny - this.nodes.get(this.drag.id!)!.y;
			for (const id of this.selectedTableIds) {
				const n = this.nodes.get(id);
				if (!n) continue;
				n.x += offX;
				n.y += offY;
				this.positions.set(id, { x: n.x, y: n.y });
				const el = this.nodeEls.get(id);
				if (el) el.setAttribute("transform", `translate(${n.x}, ${n.y})`);
				this.updateEdgesForTable(id);
			}
		}
	};

	private lastClick = { time: 0, id: "" };

	private onPointerUp = (e: PointerEvent): void => {
		if (!this.drag) return;
		if (this.drag.kind === "selectRect") {
			if (this.moved) {
				this.commitSelectRect(this.drag.startX, this.drag.startY, e.clientX, e.clientY);
			}
			this.hideSelectRect();
		} else if (this.drag.kind === "table") {
			if (!this.moved) {
				const now = Date.now();
				if (now - this.lastClick.time < 400 && this.lastClick.id === this.drag.id) {
					// Double click → zoom
					const node = this.nodes.get(this.drag.id!);
					if (node) this.zoomToTable(node);
					this.lastClick = { time: 0, id: "" };
				} else {
					this.lastClick = { time: now, id: this.drag.id! };
					if (!e.shiftKey) {
						this.selectedTableIds.clear();
						this.selectedTableIds.add(this.drag.id!);
					}
				}
			}
		} else {
			this.svg.style.cursor = "grab";
		}
		this.drag = null;
		this.updateSelectionVisual();
		try { this.svg.releasePointerCapture(e.pointerId); } catch {}
	};

	private updateSelectionVisual(): void {
		// Highlight selected tables
		for (const [id, el] of this.nodeEls) {
			if (this.selectedTableIds.has(id)) {
				el.classList.add("erd-selected-table");
			} else {
				el.classList.remove("erd-selected-table");
			}
		}
		// Highlight related: all tables connected to selected, and their edges
		if (this.selectedTableIds.size > 0) {
			const related = new Set(this.selectedTableIds);
			for (const rel of this.model.relations) {
				if (this.selectedTableIds.has(rel.fromTable) || this.selectedTableIds.has(rel.toTable)) {
					related.add(rel.fromTable);
					related.add(rel.toTable);
				}
			}
			for (const [id, el] of this.nodeEls) {
				if (this.selectedTableIds.has(id)) continue;
				if (related.has(id)) {
					el.classList.add("erd-highlight");
					el.classList.remove("erd-dim");
				} else {
					el.classList.remove("erd-highlight");
					el.classList.add("erd-dim");
				}
			}
			for (const edge of this.edges) {
				if (this.selectedTableIds.has(edge.a.table.id) || this.selectedTableIds.has(edge.b.table.id)) {
					edge.path.classList.add("erd-highlight");
					edge.path.classList.remove("erd-dim");
				} else {
					edge.path.classList.remove("erd-highlight");
					edge.path.classList.add("erd-dim");
				}
			}
		} else {
			for (const [, el] of this.nodeEls) {
				el.classList.remove("erd-highlight", "erd-dim");
			}
			for (const edge of this.edges) {
				edge.path.classList.remove("erd-highlight", "erd-dim");
			}
		}
	}

	private drawSelectRect(sx: number, sy: number, ex: number, ey: number): void {
		const r = this.svg.getBoundingClientRect();
		const x = Math.min(sx, ex) - r.left;
		const y = Math.min(sy, ey) - r.top;
		const w = Math.abs(ex - sx);
		const h = Math.abs(ey - sy);
		if (!this.selectRect) {
			this.selectRect = svgEl("rect", {
				fill: "rgba(59,130,246,0.12)",
				stroke: "#3b82f6",
				"stroke-width": "1",
				"stroke-dasharray": "4 2",
				class: "erd-select-rect",
			}) as SVGRectElement;
			this.svg.appendChild(this.selectRect);
		}
		this.selectRect.setAttribute("x", String(x));
		this.selectRect.setAttribute("y", String(y));
		this.selectRect.setAttribute("width", String(w));
		this.selectRect.setAttribute("height", String(h));
	}

	private hideSelectRect(): void {
		if (this.selectRect) { this.selectRect.remove(); this.selectRect = null; }
	}

	private commitSelectRect(sx: number, sy: number, ex: number, ey: number): void {
		const r = this.svg.getBoundingClientRect();
		const x1 = (Math.min(sx, ex) - r.left - this.t.x) / this.t.k;
		const y1 = (Math.min(sy, ey) - r.top - this.t.y) / this.t.k;
		const x2 = (Math.max(sx, ex) - r.left - this.t.x) / this.t.k;
		const y2 = (Math.max(sy, ey) - r.top - this.t.y) / this.t.k;

		this.selectedTableIds.clear();
		for (const [id, node] of this.nodes) {
			if (node.x + node.w > x1 && node.x < x2 && node.y + node.h > y1 && node.y < y2) {
				this.selectedTableIds.add(id);
			}
		}
	}

	private applyTransform(): void {
		this.viewport.setAttribute("transform", `translate(${this.t.x}, ${this.t.y}) scale(${this.t.k})`);
	}

	private onDblClick = (e: MouseEvent): void => {
		const target = e.target as Element;
		const tableG = target.closest?.(".erd-table") as SVGGElement | null;
		if (tableG) {
			const id = tableG.dataset.tableId!;
			const node = this.nodes.get(id);
			if (node) {
				this.zoomToTable(node);
			}
		}
	};

	zoomToTable(node: TableNode): void {
		const pad = 40;
		const cw = this.container.clientWidth;
		const ch = this.container.clientHeight;
		const bw = node.w + pad * 2;
		const bh = node.h + pad * 2;
		const k = Math.min(cw / bw, ch / bh, 2.5);
		this.t.k = k;
		this.t.x = cw / 2 - (node.x + node.w / 2) * k;
		this.t.y = ch / 2 - (node.y + node.h / 2) * k;
		this.applyTransform();
		if (this.onZoomCallback) this.onZoomCallback();
	}

	private updateEdgesForTable(tableId: string): void {
		for (const edge of this.edges) {
			if (edge.a.table.id === tableId || edge.b.table.id === tableId) {
				this.updateEdge(edge);
			}
		}
	}

	private selectTable(id: string): void {
		this.hoveredTable = id;
		const related = new Set<string>();
		related.add(id);
		for (const r of this.model.relations) {
			if (r.fromTable === id) related.add(r.toTable);
			if (r.toTable === id) related.add(r.fromTable);
		}
		for (const [tid, el] of this.nodeEls) {
			if (related.has(tid)) {
				el.classList.add("erd-highlight");
				el.classList.remove("erd-dim");
			} else {
				el.classList.remove("erd-highlight");
				el.classList.add("erd-dim");
			}
		}
		for (const edge of this.edges) {
			if (edge.a.table.id === id || edge.b.table.id === id) {
				edge.path.classList.add("erd-highlight");
				edge.path.classList.remove("erd-dim");
			} else {
				edge.path.classList.remove("erd-highlight");
				edge.path.classList.add("erd-dim");
			}
		}
	}

	private selectEdge(id: string): void {
		this.selectedEdge = id;
		for (const edge of this.edges) {
			if (edge.rel.id === id) {
				edge.path.classList.add("erd-selected");
				edge.path.classList.remove("erd-dim");
			} else {
				edge.path.classList.remove("erd-selected");
				edge.path.classList.add("erd-dim");
			}
		}
		for (const [, el] of this.nodeEls) {
			el.classList.add("erd-dim");
		}
		const selected = this.edges.find((e) => e.rel.id === id);
		if (selected) {
			const a = this.nodeEls.get(selected.a.table.id);
			const b = this.nodeEls.get(selected.b.table.id);
			if (a) {
				a.classList.remove("erd-dim");
				a.classList.add("erd-highlight");
			}
			if (b) {
				b.classList.remove("erd-dim");
				b.classList.add("erd-highlight");
			}
		}
	}

	private clearSelection(): void {
		this.hoveredTable = null;
		this.selectedEdge = null;
		for (const [, el] of this.nodeEls) {
			el.classList.remove("erd-highlight", "erd-dim");
		}
		for (const edge of this.edges) {
			edge.path.classList.remove("erd-highlight", "erd-selected", "erd-dim");
		}
	}

	autoArrange(): void {
		// Save edge sides before clearing
		for (const e of this.edges) {
			this.savedEdgeSides.set(e.rel.id, { aSide: e.aSide, bSide: e.bSide });
		}
		this.positions.clear();
		this.nodes = autoLayout(this.model, this.measurer(), this.fonts, new Map());
		for (const [id, node] of this.nodes) {
			this.positions.set(id, { x: node.x, y: node.y });
		}
		this.render();
		this.fit();
	}

	getAllPositions(): Map<string, { x: number; y: number }> {
		return new Map(this.positions);
	}

	setInitialPositions(positions: Map<string, { x: number; y: number }>): void {
		this.positions.clear();
		for (const [k, v] of positions) {
			this.positions.set(k, v);
		}
		if (this.model.tables.length > 0) {
			this.nodes = autoLayout(this.model, this.measurer(), this.fonts, this.positions);
			for (const [id, node] of this.nodes) {
				if (!this.positions.has(id)) {
					this.positions.set(id, { x: node.x, y: node.y });
				}
			}
			this.render();
			this.fit();
		}
	}

	setData(model: ErdModel): void {
		this.model = model;
		this.nodes = autoLayout(model, this.measurer(), this.fonts, this.positions);
		for (const [id, node] of this.nodes) {
			if (!this.positions.has(id)) {
				this.positions.set(id, { x: node.x, y: node.y });
			}
		}
		this.render();
		if (!this.fitted && this.container.clientWidth > 0) {
			this.fit();
		}
	}

	private render(): void {
		this.groupsLayer.innerHTML = "";
		this.tablesLayer.innerHTML = "";
		this.edgesLayer.innerHTML = "";
		this.topLayer.innerHTML = "";
		this.nodeEls.clear();
		this.edges = [];

		// render tables
		for (const [id, node] of this.nodes) {
			const g = this.renderTable(node);
			this.tablesLayer.appendChild(g);
			this.nodeEls.set(id, g);
		}

		this.renderTableGroups();
		this.renderEdges();

		this.applyTransform();
	}

	private renderTableGroups(): void {
		const groupColors = [
			"rgba(99,102,241,0.08)",
			"rgba(16,185,129,0.08)",
			"rgba(245,158,11,0.08)",
			"rgba(239,68,68,0.08)",
		];
		let ci = 0;

		for (const tg of this.model.tableGroups) {
			const memberTables = tg.tables.map((t: string) => this.nodes.get(t)).filter(Boolean) as TableNode[];
			if (memberTables.length === 0) continue;

			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (const n of memberTables) {
				minX = Math.min(minX, n.x);
				minY = Math.min(minY, n.y);
				maxX = Math.max(maxX, n.x + n.w);
				maxY = Math.max(maxY, n.y + n.h);
			}

			const pad = 16;
			const x = minX - pad;
			const y = minY - pad - 20;
			const w = maxX - minX + pad * 2;
			const h = maxY - minY + pad * 2 + 20;

			const g = svgEl("g", { class: "erd-table-group" });

			const rect = svgEl("rect", {
				x: String(x), y: String(y), width: String(w), height: String(h), rx: "8",
				fill: tg.color || groupColors[ci % groupColors.length],
				stroke: "rgba(99,102,241,0.2)",
				"stroke-width": "1",
				"stroke-dasharray": "6 3",
			});
			g.appendChild(rect);

			const label = svgEl("text", {
				x: String(x + 10), y: String(y + 14),
				class: "erd-group-label",
			});
			label.textContent = tg.name;
			g.appendChild(label);

			this.groupsLayer.appendChild(g);
			ci++;
		}
	}

	private renderTable(node: TableNode): SVGGElement {
		const { table, x, y, w, h } = node;
		const g = svgEl("g", {
			class: "erd-table",
			"data-table-id": table.id,
			transform: `translate(${x}, ${y})`,
		}) as SVGGElement;

		const shadow = svgEl("rect", {
			x: "2", y: "2", width: String(w), height: String(h), rx: "6",
			class: "erd-table-shadow",
		});
		g.appendChild(shadow);

		const body = svgEl("rect", {
			width: String(w), height: String(h), rx: "6",
			class: "erd-table-body",
		});
		g.appendChild(body);

		// Subtle row striping
		for (let ri = 0; ri < table.fields.length; ri++) {
			if (ri % 2 === 1) {
				const sr = svgEl("rect", {
					x: "0", y: String(HEADER_H + ri * ROW_H),
					width: String(w), height: String(ROW_H), rx: "0",
					class: "erd-field-stripe",
				});
				g.appendChild(sr);
			}
		}

		const headerColor = table.headerColor || "var(--interactive-accent, #3b82f6)";
		const header = svgEl("rect", {
			width: String(w), height: String(HEADER_H), rx: "6",
			fill: headerColor, class: "erd-table-header",
		});
		g.appendChild(header);

		const headerBottom = svgEl("rect", {
			y: String(HEADER_H - 6), width: String(w), height: "6",
			fill: headerColor,
		});
		g.appendChild(headerBottom);
		const title = table.schema ? `${table.schema}.${table.name}` : table.name;

		// Tooltip with field details
		const tooltip = svgEl("title");
		tooltip.textContent = table.fields.map(f =>
			`${f.pk ? "[PK] " : ""}${f.fk ? "[FK] " : ""}${f.name}: ${f.type}${f.notNull ? " NN" : ""}${f.default ? ` =${f.default}` : ""}`
		).join("\n");
		g.appendChild(tooltip);

		const titleText = svgEl("text", { x: "12", y: "22", class: "erd-table-title" });
		titleText.textContent = title;
		g.appendChild(titleText);

		let rowY = HEADER_H;
		for (const field of table.fields) {
			const row = svgEl("g", {
				class: "erd-field erd-field-row",
				"data-table-id": table.id,
				"data-field-name": field.name,
				transform: `translate(0, ${rowY})`,
			});

			const rowBg = svgEl("rect", {
				width: String(w), height: String(ROW_H),
				class: "erd-field-bg",
			});
			row.appendChild(rowBg);

			let xPos = 10;
			const label = field.pk && field.fk ? "PK·FK" : field.pk ? "PK" : field.fk ? "FK" : field.unique ? "UQ" : "";
			if (label) {
				const badge = svgEl("rect", {
					x: String(xPos), y: "4", width: String(label.length * 6 + 8), height: "16", rx: "3",
					class: field.pk ? "erd-badge-pk" : field.fk ? "erd-badge-fk" : "erd-badge-uq",
				});
				row.appendChild(badge);
				const badgeText = svgEl("text", {
					x: String(xPos + (label.length * 6 + 8) / 2), y: "15",
					"text-anchor": "middle", class: "erd-badge-text",
				});
				badgeText.textContent = label;
				row.appendChild(badgeText);
				xPos += label.length * 6 + 14;
			}

			const nameText = svgEl("text", { x: String(xPos), y: "17", class: "erd-field-name" });
			nameText.textContent = field.name;
			row.appendChild(nameText);

			const typeText = svgEl("text", { x: String(w - 10), y: "17", "text-anchor": "end", class: "erd-field-type" });
			typeText.textContent = field.type;
			row.appendChild(typeText);

			g.appendChild(row);
			rowY += ROW_H;
		}

		return g;
	}

	private getDiagramBounds(): { x: number; y: number; w: number; h: number } {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const node of this.nodes.values()) {
			minX = Math.min(minX, node.x);
			minY = Math.min(minY, node.y);
			maxX = Math.max(maxX, node.x + node.w);
			maxY = Math.max(maxY, node.y + node.h);
		}
		return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
	}

	private pathCrossesTable(midX: number, aY: number, bY: number, a: TableNode, b: TableNode): boolean {
		const yMin = Math.min(aY, bY);
		const yMax = Math.max(aY, bY);
		for (const node of this.nodes.values()) {
			if (node.table.id === a.table.id || node.table.id === b.table.id) continue;
			if (midX > node.x && midX < node.x + node.w && yMax > node.y && yMin < node.y + node.h) {
				return true;
			}
		}
		return false;
	}

	private renderEdges(): void {
		// Build field-edge count for spacing
		const fieldCount = new Map<string, number>();
		for (const rel of this.model.relations) {
			const k = `${rel.fromTable}||${rel.fromField}`;
			fieldCount.set(k, (fieldCount.get(k) || 0) + 1);
		}
		const fieldIdx = new Map<string, number>();

		for (const rel of this.model.relations) {
			const a = this.nodes.get(rel.fromTable);
			const b = this.nodes.get(rel.toTable);
			if (!a || !b) continue;
			const aIdx = a.table.fields.findIndex(f => f.name === rel.fromField);
			const bIdx = b.table.fields.findIndex(f => f.name === rel.toField);
			if (aIdx < 0 || bIdx < 0) continue;

			const aY = a.y + HEADER_H + aIdx * ROW_H + ROW_H / 2;
			const bY = b.y + HEADER_H + bIdx * ROW_H + ROW_H / 2;

			// Offset midX when same field connects to multiple targets
			const fk = `${rel.fromTable}||${rel.fromField}`;
			const total = fieldCount.get(fk) || 1;
			const idx = fieldIdx.get(fk) || 0;
			fieldIdx.set(fk, idx + 1);
			const offset = total > 1 ? (idx - (total - 1) / 2) * 18 : 0;

			const edge = this.renderEdge(rel, a, b, aY, bY, offset);
			if (edge) this.edges.push(edge);
		}
	}

	private renderEdge(rel: ErdRelation, a: TableNode, b: TableNode, aY: number, bY: number, offset: number): EdgeGfx | null {
		const route = this.calculateEdgeRoute(rel, a, b, aY, bY, true);
		if (!route) return null;
		// Apply offset to midX for multi-target edges
		if (offset !== 0) {
			const aX = route.aSide === "r" ? route.aX : route.aX;
			const bX = route.aSide === "r" ? route.bX : route.bX;
			route.midX += offset;
			route.d = Math.abs(route.aY - route.bY) < 6
				? `M ${route.aX} ${route.aY} L ${route.bX} ${route.bY}`
				: this.buildRoutePath(route.aX, route.aY, route.aSide, route.bX, route.bY, route.bSide, route.midX);
		}
		return this.buildEdgeGfx(rel, a, b, route.aX, route.aY, route.bX, route.bY, route.midX, route.aSide, route.bSide, route.d);
	}

	private renderBundledEdge(rel: ErdRelation, a: TableNode, b: TableNode, aY: number, bY: number, avgAY: number, avgBY: number, leftOuter: number, rightOuter: number): EdgeGfx | null {
		if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(b.x) || !isFinite(b.y)) return null;
		if (!a.w || !b.w) return null;

		const saved = this.savedEdgeSides.get(rel.id);
		const aSide: "l" | "r" = saved ? saved.aSide : (a.x + a.w / 2 <= b.x + b.w / 2 ? "r" : "l");
		const bSide: "l" | "r" = saved ? saved.bSide : (b.x + b.w / 2 <= a.x + a.w / 2 ? "r" : "l");
		const aX = aSide === "r" ? a.x + a.w : a.x;
		const bX = bSide === "r" ? b.x + b.w : b.x;
		const midX = (aX + bX) / 2;

		const r = 10;
		const aDir = aSide === "r" ? -1 : 1;
		const bDir = bSide === "l" ? 1 : -1;
		const vDirA = avgAY > aY ? 1 : -1;
		const vDirB = bY > avgBY ? 1 : -1;

		// Bus: A → midX at avgAY, then branch to individual aY/bY
		const d = [
			`M ${aX} ${aY}`,
			`L ${aX + aDir * 18} ${aY}`,
			`L ${aX + aDir * 18} ${avgAY}`,
			`L ${midX + aDir * r} ${avgAY}`,
			`Q ${midX} ${avgAY} ${midX} ${avgAY + vDirB * r}`,
			`L ${midX} ${avgBY - vDirB * r}`,
			`Q ${midX} ${avgBY} ${midX + bDir * r} ${avgBY}`,
			`L ${bX + bDir * 18} ${avgBY}`,
			`L ${bX + bDir * 18} ${bY}`,
			`L ${bX} ${bY}`,
		].join(" ");

		return this.buildEdgeGfx(rel, a, b, aX, aY, bX, bY, midX, aSide, bSide, d);
	}

	private buildRoutePath(aX: number, aY: number, _aSide: string, bX: number, bY: number, _bSide: string, midX: number, r: number = 10): string {
		const aDir = aX > midX ? 1 : -1;
		const bDir = bX > midX ? 1 : -1;
		const vDir = bY > aY ? 1 : -1;
		return [
			`M ${aX} ${aY}`,
			`L ${midX + aDir * r} ${aY}`,
			`Q ${midX} ${aY} ${midX} ${aY + vDir * r}`,
			`L ${midX} ${bY - vDir * r}`,
			`Q ${midX} ${bY} ${midX + bDir * r} ${bY}`,
			`L ${bX} ${bY}`,
		].join(" ");
	}

	private calculateEdgeRoute(rel: ErdRelation, a: TableNode, b: TableNode, aY: number, bY: number, preferSaved: boolean): { aX: number; aY: number; bX: number; bY: number; midX: number; aSide: "l" | "r"; bSide: "l" | "r"; d: string } | null {
		if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(b.x) || !isFinite(b.y)) return null;
		if (!a.w || !b.w) return null;

		const saved = preferSaved ? this.savedEdgeSides.get(rel.id) : null;
		const aSide: "l" | "r" = saved ? saved.aSide : (a.x + a.w / 2 <= b.x + b.w / 2 ? "r" : "l");
		const bSide: "l" | "r" = saved ? saved.bSide : (b.x + b.w / 2 <= a.x + a.w / 2 ? "r" : "l");
		const aX = aSide === "r" ? a.x + a.w : a.x;
		const bX = bSide === "r" ? b.x + b.w : b.x;

		let midX = (aX + bX) / 2;
		if (this.pathCrossesTable(midX, aY, bY, a, b)) {
			for (const node of this.nodes.values()) {
				if (node.table.id === a.table.id || node.table.id === b.table.id) continue;
				if (midX > node.x && midX < node.x + node.w &&
					Math.max(aY, bY) > node.y && Math.min(aY, bY) < node.y + node.h) {
					midX = aSide === "r" ? node.x + node.w + 20 : node.x - 20;
					break;
				}
			}
			if (this.pathCrossesTable(midX, aY, bY, a, b)) {
				const bounds = this.getDiagramBounds();
				midX = aSide === "r" ? bounds.x + bounds.w + 40 : bounds.x - 40;
			}
		}

		const d = Math.abs(bY - aY) < 6
			? `M ${aX} ${aY} L ${bX} ${bY}`
			: this.buildRoutePath(aX, aY, aSide, bX, bY, bSide, midX);

		return { aX, aY: aY, bX, bY: bY, midX, aSide, bSide, d };
	}

	private buildEdgeGfx(rel: ErdRelation, a: TableNode, b: TableNode, aX: number, aY: number, bX: number, bY: number, midX: number, aSide: "l" | "r", bSide: "l" | "r", d: string): EdgeGfx | null {
		const hit = svgEl("path", { d, class: "erd-edge-hit", "data-rel-id": rel.id, fill: "none" }) as SVGPathElement;
		this.edgesLayer.appendChild(hit);
		const path = svgEl("path", { d, class: "erd-edge", "data-rel-id": rel.id, fill: "none" }) as SVGPathElement;
		this.edgesLayer.appendChild(path);

		const glyphs: SVGGElement[] = [];
		const gA = this.renderGlyph(aX, aY, aSide, rel.fromCardinality);
		const gB = this.renderGlyph(bX, bY, bSide, rel.toCardinality);
		this.topLayer.appendChild(gA);
		this.topLayer.appendChild(gB);
		glyphs.push(gA, gB);

		const dotA = svgEl("circle", { cx: String(aX), cy: String(aY), r: "3", class: "erd-anchor" });
		const dotB = svgEl("circle", { cx: String(bX), cy: String(bY), r: "3", class: "erd-anchor" });
		this.topLayer.appendChild(dotA);
		this.topLayer.appendChild(dotB);

		const labelX = aSide === "r" ? midX + 20 : midX - 20;
		const cardLabel =
			rel.fromCardinality === "one" && rel.toCardinality === "many" ? "1:N"
			: rel.fromCardinality === "many" && rel.toCardinality === "one" ? "N:1"
			: rel.fromCardinality === "many" && rel.toCardinality === "many" ? "N:M"
			: "1:1";
		const bgX = aSide === "r" ? labelX - 4 : labelX - cardLabel.length * 6 - 4;
		const labelBox = svgEl("rect", {
			x: String(bgX), y: String((aY + bY) / 2 - 10),
			width: String(cardLabel.length * 6 + 8), height: "16", rx: "3", class: "erd-label-bg",
		});
		this.topLayer.appendChild(labelBox);

		const label = svgEl("text", {
			x: String(labelX), y: String((aY + bY) / 2 + 4),
			"text-anchor": aSide === "r" ? "start" : "end", class: "erd-edge-label",
		}) as SVGTextElement;
		label.textContent = cardLabel;
		this.topLayer.appendChild(label);

		hit.addEventListener("click", () => this.selectEdge(rel.id));
		hit.addEventListener("mouseenter", () => { if (!this.selectedEdge) path.classList.add("erd-hover"); });
		hit.addEventListener("mouseleave", () => { path.classList.remove("erd-hover"); });

		return { rel, path, hit, glyphs, label, labelBg: labelBox as SVGRectElement, anchors: [dotA, dotB] as SVGCircleElement[], a, b, aSide, bSide };
	}

	private renderGlyph(x: number, y: number, side: "l" | "r", card: "one" | "many"): SVGGElement {
		const g = svgEl("g", { class: "erd-glyph" }) as SVGGElement;
		const dir = side === "r" ? 1 : -1;
		if (card === "one") {
			const bar = svgEl("line", {
				x1: String(x + dir * 6), y1: String(y - 4),
				x2: String(x + dir * 6), y2: String(y + 4),
				class: "erd-glyph-bar",
			});
			g.appendChild(bar);
		} else {
			const p1 = svgEl("line", { x1: String(x), y1: String(y), x2: String(x + dir * 10), y2: String(y - 5), class: "erd-glyph-line" });
			const p2 = svgEl("line", { x1: String(x), y1: String(y), x2: String(x + dir * 10), y2: String(y), class: "erd-glyph-line" });
			const p3 = svgEl("line", { x1: String(x), y1: String(y), x2: String(x + dir * 10), y2: String(y + 5), class: "erd-glyph-line" });
			g.append(p1, p2, p3);
		}
		return g;
	}

	private updateEdge(edge: EdgeGfx): void {
		const { rel, a, b } = edge;
		const aFieldIdx = a.table.fields.findIndex((f) => f.name === rel.fromField);
		const bFieldIdx = b.table.fields.findIndex((f) => f.name === rel.toField);
		if (aFieldIdx < 0 || bFieldIdx < 0) return;

		const aY = a.y + HEADER_H + aFieldIdx * ROW_H + ROW_H / 2;
		const bY = b.y + HEADER_H + bFieldIdx * ROW_H + ROW_H / 2;

		const route = this.calculateEdgeRoute(rel, a, b, aY, bY, false);
		if (!route) return;
		edge.aSide = route.aSide;
		edge.bSide = route.bSide;

		edge.path.setAttribute("d", route.d);
		edge.hit.setAttribute("d", route.d);

		if (edge.label) {
			const labelX = route.aSide === "r" ? route.midX + 16 : route.midX - 16;
			edge.label.setAttribute("x", String(labelX));
			edge.label.setAttribute("y", String((aY + bY) / 2 + 4));
		}
		if (edge.labelBg) {
			const labelX = route.aSide === "r" ? route.midX + 16 : route.midX - 16;
			const txt = edge.label?.textContent ?? "1:N";
			const bgX = route.aSide === "r" ? labelX - 4 : labelX - txt.length * 6 - 4;
			edge.labelBg.setAttribute("x", String(bgX));
			edge.labelBg.setAttribute("y", String((aY + bY) / 2 - 10));
			edge.labelBg.setAttribute("width", String(txt.length * 6 + 8));
		}
		if (edge.anchors) {
			edge.anchors[0].setAttribute("cx", String(route.aX));
			edge.anchors[0].setAttribute("cy", String(route.aY));
			edge.anchors[1].setAttribute("cx", String(route.bX));
			edge.anchors[1].setAttribute("cy", String(route.bY));
		}

		edge.glyphs[0].innerHTML = "";
		edge.glyphs[1].innerHTML = "";
		const newA = this.renderGlyph(route.aX, route.aY, route.aSide, rel.fromCardinality);
		const newB = this.renderGlyph(route.bX, route.bY, route.bSide, rel.toCardinality);
		edge.glyphs[0].append(...Array.from(newA.children));
		edge.glyphs[1].append(...Array.from(newB.children));
	}

	fit(): void {
		if (this.nodes.size === 0) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const node of this.nodes.values()) {
			minX = Math.min(minX, node.x);
			minY = Math.min(minY, node.y);
			maxX = Math.max(maxX, node.x + node.w);
			maxY = Math.max(maxY, node.y + node.h);
		}
		const pad = 60;
		const bw = maxX - minX + 2 * pad;
		const bh = maxY - minY + 2 * pad;
		const cw = this.container.clientWidth;
		const ch = this.container.clientHeight;
		if (cw === 0 || ch === 0) return;
		const k = Math.min(cw / bw, ch / bh, 1.5);
		this.t.k = k;
		this.t.x = (cw - bw * k) / 2 - minX * k + pad * k;
		this.t.y = (ch - bh * k) / 2 - minY * k + pad * k;
		this.applyTransform();
		this.fitted = true;
	}

	zoomIn(): void {
		const rect = this.svg.getBoundingClientRect();
		this.zoomAt(rect.width / 2, rect.height / 2, 1.25);
	}

	zoomOut(): void {
		const rect = this.svg.getBoundingClientRect();
		this.zoomAt(rect.width / 2, rect.height / 2, 0.8);
	}

	getZoomPercent(): number {
		return Math.round(this.t.k * 100);
	}

	setZoomPercent(percent: number): void {
		const k = clamp(percent / 100, 0.15, 3);
		const rect = this.svg.getBoundingClientRect();
		const factor = k / this.t.k;
		this.zoomAt(rect.width / 2, rect.height / 2, factor);
	}

	resetView(): void {
		this.t = { x: 20, y: 20, k: 1 };
		this.applyTransform();
		this.fitted = false;
	}

	async exportSvg(basename: string): Promise<void> {
		const bbox = this.getContentBBox();
		const svgText = buildStandaloneSvg(this.svg, bbox, 50);
		downloadText(`${basename}.svg`, svgText, "image/svg+xml");
	}

	async exportPng(basename: string): Promise<void> {
		const bbox = this.getContentBBox();
		const svgText = buildStandaloneSvg(this.svg, bbox, 50);
		const scale = 4;
		const blob = await svgToPngBlob(svgText, (bbox.w + 100) * scale, (bbox.h + 100) * scale, 1);
		downloadBlob(`${basename}.png`, blob);
	}

	private getContentBBox(): { x: number; y: number; w: number; h: number } {
		if (this.nodes.size === 0) return { x: 0, y: 0, w: 100, h: 100 };
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const node of this.nodes.values()) {
			minX = Math.min(minX, node.x);
			minY = Math.min(minY, node.y);
			maxX = Math.max(maxX, node.x + node.w);
			maxY = Math.max(maxY, node.y + node.h);
		}
		return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
	}

	destroy(): void {
		this.exitRelationMode();
		this.removeRelPicker();
		document.removeEventListener("keydown", this.boundKeyDown);
		for (const off of this.listeners) off();
		this.listeners = [];
		if (this.resizeObs) {
			this.resizeObs.disconnect();
			this.resizeObs = null;
		}
		this.container.innerHTML = "";
	}
}
