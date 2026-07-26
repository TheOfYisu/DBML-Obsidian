import { MarkdownPostProcessorContext, MarkdownRenderChild, setIcon, Notice } from "obsidian";
import { ErdRenderer } from "../diagram/erd-renderer";
import { parseDbml, extractParseError } from "../parser/dbml-parser";
import { exportSql, SQL_DIALECTS, SqlDialect } from "../export/sql-exporter";
import type DBMLDiagrammerPlugin from "../main";

export function registerDbmlCodeBlock(plugin: DBMLDiagrammerPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor("dbml", (source, el, ctx) => {
		const child = new DbmlRenderChild(el, source, plugin, ctx.sourcePath);
		ctx.addChild(child);
	});
}

class DbmlRenderChild extends MarkdownRenderChild {
	private source: string;
	private plugin: DBMLDiagrammerPlugin;
	private renderer: ErdRenderer | null = null;
	private sourcePath: string;

	constructor(containerEl: HTMLElement, source: string, plugin: DBMLDiagrammerPlugin, sourcePath: string) {
		super(containerEl);
		this.source = source;
		this.plugin = plugin;
		this.sourcePath = sourcePath;
	}

	onload(): void {
		const root = this.containerEl.createDiv("erd-embed");

		const toolbar = root.createDiv("erd-toolbar");

		const navGroup = toolbar.createDiv("erd-toolbar-group");
		const fitBtn = navGroup.createEl("button", { cls: "erd-btn", attr: { title: "Fit to content", "aria-label": "Fit to content" } });
		setIcon(fitBtn, "maximize");
		fitBtn.addEventListener("click", () => this.renderer?.fit());

		const zoomInBtn = navGroup.createEl("button", { cls: "erd-btn", attr: { title: "Zoom in", "aria-label": "Zoom in" } });
		setIcon(zoomInBtn, "zoom-in");
		zoomInBtn.addEventListener("click", () => this.renderer?.zoomIn());

		const zoomOutBtn = navGroup.createEl("button", { cls: "erd-btn", attr: { title: "Zoom out", "aria-label": "Zoom out" } });
		setIcon(zoomOutBtn, "zoom-out");
		zoomOutBtn.addEventListener("click", () => this.renderer?.zoomOut());

		toolbar.createDiv("erd-toolbar-sep");

		const exportImgGroup = toolbar.createDiv("erd-toolbar-group");
		const exportSvgBtn = exportImgGroup.createEl("button", { cls: "erd-btn", attr: { title: "Export SVG", "aria-label": "Export SVG" } });
		setIcon(exportSvgBtn, "image");
		exportSvgBtn.addEventListener("click", () => {
			if (this.renderer) this.renderer.exportSvg(this.getFilename());
		});

		const exportPngBtn = exportImgGroup.createEl("button", { cls: "erd-btn", attr: { title: "Export PNG", "aria-label": "Export PNG" } });
		setIcon(exportPngBtn, "file-image");
		exportPngBtn.addEventListener("click", () => {
			if (this.renderer) this.renderer.exportPng(this.getFilename());
		});

		toolbar.createDiv("erd-toolbar-sep");

		const exportSqlGroup = toolbar.createDiv("erd-toolbar-group");
		const sqlDialect = exportSqlGroup.createEl("select", { cls: "erd-sql-select" });
		for (const d of SQL_DIALECTS) {
			sqlDialect.createEl("option", { text: d.label, value: d.value });
		}
		const exportSqlBtn = exportSqlGroup.createEl("button", { cls: "erd-btn erd-btn-accent", attr: { title: "Export SQL", "aria-label": "Export SQL" } });
		setIcon(exportSqlBtn, "file-code");
		exportSqlBtn.createEl("span", { cls: "erd-btn-label", text: "SQL" });
		exportSqlBtn.addEventListener("click", () => {
			const dialect = sqlDialect.value as SqlDialect;
			this.exportSqlToClipboard(dialect);
		});

		toolbar.createDiv("erd-toolbar-spacer");
		toolbar.createEl("span", { cls: "erd-toolbar-help", text: "Scroll: pan   Shift: horiz   Ctrl: zoom" });

		const diagramContainer = root.createDiv("erd-diagram-container");
		diagramContainer.style.height = `${this.plugin.settings.embedHeight}px`;

		try {
			const model = parseDbml(this.source);
			if (model.tables.length === 0) {
				const placeholder = diagramContainer.createDiv("erd-placeholder");
				placeholder.textContent = "No tables defined";
				return;
			}
			this.renderer = new ErdRenderer(diagramContainer);
			this.renderer.setData(model);
		} catch (err) {
			const error = extractParseError(err);
			const errorBox = diagramContainer.createDiv("erd-error");
			errorBox.style.position = "relative";
			errorBox.textContent = `Parse error: ${error.message}`;
			if (error.line) {
				errorBox.textContent += ` (line ${error.line}${error.col ? `, col ${error.col}` : ""})`;
			}
		}
	}

	onunload(): void {
		if (this.renderer) {
			this.renderer.destroy();
			this.renderer = null;
		}
	}

	private getFilename(): string {
		if (this.sourcePath) {
			const parts = this.sourcePath.split("/");
			const filename = parts[parts.length - 1];
			return filename.replace(/\.md$/, "");
		}
		return "diagram";
	}

	private async exportSqlToClipboard(dialect: SqlDialect): Promise<void> {
		try {
			const sql = exportSql(this.source, dialect);
			await navigator.clipboard.writeText(sql);
			const d = SQL_DIALECTS.find((d) => d.value === dialect);
			new Notice(`SQL (${d?.label ?? dialect}) copied to clipboard!`);
		} catch (err) {
			new Notice(`SQL export failed`);
		}
	}
}
