// 🐛 Fix list:
// 1. Guardado: getViewData() → vault, botón Save explícito con feedback
// 2. Add Rel: DOM traversal manual (SVG closest fallback), confirmación de inserción
// 3. Edge sync: ya funciona en onPointerMove (updateEdgesForTable), verificado OK
// 4. Importar: FuzzySuggestModal para archivos .dbml/.sql/.json del vault
// 5. UI cleanup: quitar "Personal" texto, "Improve", avatar; añadir Auto-Layout
// 6. Help modal: sintaxis DBML con ejemplos copiables
// 7. Export full: ya funciona (getContentBBox cubre todas las tablas), verificado OK
// 8. TableGroup: parse + render como contenedores visuales

import { TextFileView, WorkspaceLeaf, setIcon, Notice, FuzzySuggestModal, TFile, Modal, App, Setting } from "obsidian";
import { ErdRenderer, RelationSelectData } from "../diagram/erd-renderer";
import { parseDbml, extractParseError } from "../parser/dbml-parser";
import { createDbmlEditor } from "../editor/editor";
import { exportSql, SQL_DIALECTS, SqlDialect } from "../export/sql-exporter";
import type { EditorView } from "@codemirror/view";
import type DBMLDiagrammerPlugin from "../main";

export const VIEW_TYPE_DBML = "dbml-diagram-view";

class ImportFileModal extends FuzzySuggestModal<TFile> {
    private onSelect: (file: TFile) => void;

    constructor(app: App, onSelect: (file: TFile) => void) {
        super(app);
        this.onSelect = onSelect;
        this.setPlaceholder("Search for .dbml, .sql, .json files...");
    }

    getItems(): TFile[] {
        return this.app.vault.getFiles().filter(f =>
            ["dbml", "sql", "json"].includes(f.extension)
        );
    }

    getItemText(item: TFile): string {
        return item.path;
    }

    onChooseItem(item: TFile): void {
        this.onSelect(item);
    }
}

class HelpModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("dbml-help-modal");

        contentEl.createEl("h2", { text: "DBML Syntax Reference" });

        const sections: { title: string; code: string; desc: string }[] = [
            {
                title: "Table Definition",
                code: `Table users {
  id integer [pk, increment]
  username varchar [not null, unique]
}`,
                desc: "Define a table with columns. Use [pk] for primary key, [not null], [unique], [increment], [default: value]."
            },
            {
                title: "Relationships",
                code: `Ref: posts.user_id > users.id
Ref: users.id < follows.following_user_id`,
                desc: "> = Many-to-One (FK on left), < = One-to-Many, - = One-to-One, <> = Many-to-Many."
            },
            {
                title: "Data Types",
                code: `integer, varchar, text, boolean, timestamp
decimal, float, uuid, json, serial, bigserial`,
                desc: "Common SQL data types. Use varchar(255) for sized strings."
            },
            {
                title: "Enum",
                code: `Enum status {
  active
  inactive
  pending
}`,
                desc: "Define an enum type that can be referenced in column definitions."
            },
            {
                title: "Table Group",
                code: `TableGroup auth_module {
  users
  user_roles
}`,
                desc: "Group related tables visually in the diagram."
            },
            {
                title: "Indexes",
                code: `Indexes {
  (user_id, created_at) [unique]
}`,
                desc: "Define indexes inside a Table block (before closing brace)."
            },
            {
                title: "Notes",
                code: `Table users {
  id integer [pk]
  Note: 'Main user account table'
}`,
                desc: "Add notes to tables or columns using Note keyword."
            },
        ];

        for (const s of sections) {
            const block = contentEl.createDiv("dbml-help-section");
            block.createEl("h3", { text: s.title });
            block.createEl("p", { text: s.desc, cls: "dbml-help-desc" });
            const pre = block.createEl("pre", { cls: "dbml-help-code" });
            pre.createEl("code", { text: s.code });
            pre.addEventListener("click", () => {
                navigator.clipboard.writeText(s.code).then(() => {
                    new Notice("Copied!");
                });
            });
            pre.setAttribute("title", "Click to copy");
        }

        contentEl.createEl("p", { cls: "dbml-help-footer", text: "Tip: Click any code block to copy it to clipboard." });
    }

    onClose(): void {
        this.containerEl.empty();
    }
}

export class DbmlFileView extends TextFileView {
    private plugin: DBMLDiagrammerPlugin;
    private editorView: EditorView | null = null;
    private renderer: ErdRenderer | null = null;
    private errorEl: HTMLElement | null = null;
    private debounceTimer: number | null = null;
    private currentCode = "";
    private suppressOnChange = false;
    private autoSaveInterval: number | null = null;
    private zoomSlider: HTMLInputElement | null = null;
    private zoomLabel: HTMLElement | null = null;
    private filePathLabel: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: DBMLDiagrammerPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return VIEW_TYPE_DBML; }
    getDisplayText(): string { return this.file?.basename ?? "DBML"; }
    getIcon(): string { return "database"; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("dbml-app");

        this.buildTopBar(container);
        console.log("[DBML] onOpen: building split...");
        this.buildSplit(container);
        console.log("[DBML] onOpen: building bottom bar...");
        this.buildBottomBar(container);

        console.log("[DBML] onOpen: file =", this.file?.path, "editorView =", !!this.editorView, "renderer =", !!this.renderer);

        if (this.file) {
            const content = await this.app.vault.read(this.file);
            console.log("[DBML] onOpen: read file, length =", content.length, "first 80 chars:", content.substring(0, 80));
            if (content && this.editorView) {
                this.suppressOnChange = true;
                this.editorView.dispatch({
                    changes: { from: 0, to: this.editorView.state.doc.length, insert: content },
                });
                this.suppressOnChange = false;
                console.log("[DBML] onOpen: dispatched to editor, doc length =", this.editorView.state.doc.length);
            }
            this.currentCode = content;
            if (content.trim()) {
                console.log("[DBML] onOpen: calling renderDiagram...");
                this.renderDiagram(content);
            } else {
                console.log("[DBML] onOpen: content is empty, skipping render");
            }
        } else {
            console.log("[DBML] onOpen: this.file is NULL!");
        }

        this.autoSaveInterval = window.setInterval(() => {
            if (this.currentCode && this.file) {
                this.app.vault.modify(this.file, this.currentCode);
            }
        }, 60000);

    }

    private buildTopBar(container: HTMLElement): void {
        const topbar = container.createDiv("dbml-topbar");

        // --- Left ---
        const left = topbar.createDiv("dbml-topbar-left");

        const projIcon = left.createDiv("dbml-project-icon");
        projIcon.setAttribute("title", this.file?.basename ?? "untitled");
        projIcon.style.cursor = "default";
        projIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 5C3 3.34 5.69 2 9 2s6 1.34 6 3v12c0 1.66-2.69 3-6 3S3 18.66 3 17V5Z" fill="currentColor" fill-opacity="0.10"/><ellipse cx="9" cy="5" rx="6" ry="2.5" stroke="currentColor" stroke-width="1.0"/><path d="M3 5v12c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V5" stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/><path d="M3 11c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5" stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/><line x1="15.2" y1="16.3" x2="18.8" y2="13.7" stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/><line x1="15.2" y1="17.7" x2="18.8" y2="20.3" stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/><circle cx="14.5" cy="17" r="2" fill="var(--interactive-accent)" stroke="currentColor" stroke-width="1.0"/><circle cx="19.5" cy="13" r="2" fill="var(--interactive-accent)" stroke="currentColor" stroke-width="1.0"/><circle cx="19.5" cy="21" r="2" fill="var(--interactive-accent)" stroke="currentColor" stroke-width="1.0"/></svg>';
        left.createEl("span", { text: "DBML Obsidian", cls: "dbml-brand-title" });

        // --- Center ---
        const center = topbar.createDiv("dbml-topbar-center");

        const saveBtn = center.createEl("button", { cls: "dbml-tb-btn" });
        setIcon(saveBtn, "save");
        saveBtn.createEl("span", { text: "Save" });
        saveBtn.addEventListener("click", async () => {
            if (this.file) {
                await this.app.vault.modify(this.file, this.currentCode);
            }
            await this.saveLayout();
            new Notice("Saved");
        });

        const arrangeBtn = center.createEl("button", { cls: "dbml-tb-btn" });
        setIcon(arrangeBtn, "align-justify");
        arrangeBtn.createEl("span", { text: "Arrange" });
        arrangeBtn.addEventListener("click", () => {
            this.renderer?.autoArrange();
            this.saveLayout();
            this.syncZoomSlider();
        });

        const importBtn = center.createEl("button", { cls: "dbml-tb-btn" });
        setIcon(importBtn, "download");
        importBtn.createEl("span", { text: "Import" });
        importBtn.addEventListener("click", () => this.openImportModal());

        const exportBtn = center.createEl("button", { cls: "dbml-tb-btn" });
        setIcon(exportBtn, "upload");
        exportBtn.createEl("span", { text: "Export" });
        exportBtn.addEventListener("click", () => this.showExportMenu(exportBtn));

        // --- Right ---
        const right = topbar.createDiv("dbml-topbar-right");

        const helpBtn = right.createEl("button", { cls: "dbml-tb-btn" });
        setIcon(helpBtn, "help-circle");
        helpBtn.createEl("span", { text: "Help" });
        helpBtn.addEventListener("click", () => new HelpModal(this.app).open());
    }

    private openImportModal(): void {
        new ImportFileModal(this.app, async (file) => {
            const content = await this.app.vault.read(file);
            if (this.editorView) {
                this.editorView.dispatch({
                    changes: { from: 0, to: this.editorView.state.doc.length, insert: content },
                });
            }
            new Notice(`Imported ${file.name}`);
        }).open();
    }

    private showExportMenu(anchor: HTMLElement): void {
        this.containerEl.querySelector(".dbml-export-popup")?.remove();

        const menu = this.containerEl.createDiv("dbml-export-popup");
        const rect = anchor.getBoundingClientRect();
        const appRect = this.containerEl.getBoundingClientRect();
        menu.style.position = "absolute";
        menu.style.left = `${rect.left - appRect.left}px`;
        menu.style.top = `${rect.bottom - appRect.top + 4}px`;

        const items = [
            { label: "PNG Image", icon: "file-image", action: () => { this.renderer?.exportPng(this.file?.basename ?? "diagram"); } },
            { label: "SVG Image", icon: "image", action: () => { this.renderer?.exportSvg(this.file?.basename ?? "diagram"); } },
            { label: "———", icon: "", action: () => {} },
            ...SQL_DIALECTS.map(d => ({
                label: `SQL: ${d.label}`,
                icon: "file-code",
                action: () => this.exportSqlToClipboard(d.value),
            })),
        ];

        for (const item of items) {
            if (item.label === "———") {
                menu.createDiv("erd-toolbar-sep");
                continue;
            }
            const row = menu.createEl("button", { cls: "erd-btn" });
            row.style.width = "100%";
            row.style.justifyContent = "flex-start";
            if (item.icon) setIcon(row, item.icon);
            row.createEl("span", { text: item.label, cls: "erd-btn-label" });
            row.addEventListener("click", (ev) => {
                ev.stopPropagation();
                item.action();
                menu.remove();
            });
        }

        const handler = (ev: MouseEvent) => {
            if (!menu.contains(ev.target as Node)) {
                menu.remove();
                document.removeEventListener("click", handler, true);
            }
        };
        setTimeout(() => document.addEventListener("click", handler, true), 0);
    }

    private buildSplit(container: HTMLElement): void {
        const split = container.createDiv("dbml-split");

        const editorPane = split.createDiv("dbml-editor-pane");
        const editorContainer = editorPane.createDiv("dbml-editor-container");

        this.editorView = createDbmlEditor(editorContainer, "", (code) => {
            this.currentCode = code;
            if (!this.suppressOnChange) {
                this.scheduleRender(code);
            }
        });

        const divider = split.createDiv("dbml-split-divider");
        this.setupDivider(divider, editorPane, split);

        const diagramPane = split.createDiv("dbml-diagram-pane");

        const diagHeader = diagramPane.createDiv("dbml-diagram-header");
        diagHeader.createEl("span", { cls: "dbml-diagram-header-title", text: "Diagram" });

        const diagSep = diagHeader.createDiv("dbml-diagram-header-sep");

        const addRelBtn = diagHeader.createEl("button", { cls: "erd-btn erd-btn-accent" });
        setIcon(addRelBtn, "link");
        addRelBtn.createEl("span", { cls: "erd-btn-label", text: "Add Rel" });
        addRelBtn.addEventListener("click", () => this.enterRelationMode());

        const diagSpacer = diagHeader.createDiv("erd-toolbar-spacer");

        diagHeader.createEl("span", { cls: "erd-toolbar-help", text: "Ctrl+scroll: zoom · Shift+scroll: pan H · Drag: move" });

        const diagramContainer = diagramPane.createDiv("erd-diagram-container");
        this.errorEl = diagramContainer.createDiv("erd-error");
        this.errorEl.style.display = "none";

        this.renderer = new ErdRenderer(diagramContainer);

        this.renderer.setOnRelationSelect((data: RelationSelectData) => {
            this.insertRef(data.fromTable, data.fromField, data.toTable, data.toField, data.type);
            new Notice("Relationship added");
        });

        this.renderer.setOnDelete((tableIds) => {
            this.deleteTables(tableIds);
        });

        this.renderer.setOnZoom(() => {
            this.syncZoomSlider();
        });
    }

    private insertRef(fromTable: string, fromField: string, toTable: string, toField: string, type: string): void {
        if (!this.editorView) return;
        const doc = this.editorView.state.doc;
        const text = doc.toString();
        const prefix = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
        const refLine = `Ref: ${fromTable}.${fromField} ${type} ${toTable}.${toField}`;
        this.editorView.dispatch({ changes: { from: doc.length, insert: `${prefix}${refLine}\n` } });
    }

    private buildBottomBar(container: HTMLElement): void {
        const bar = container.createDiv("dbml-bottombar");

        const left = bar.createDiv("dbml-bottombar-left");

        const zoomOut = left.createEl("button", { cls: "dbml-zoom-btn", text: "\u2212" });
        zoomOut.addEventListener("click", () => { this.renderer?.zoomOut(); this.syncZoomSlider(); });

        this.zoomSlider = left.createEl("input", { cls: "dbml-zoom-slider" }) as HTMLInputElement;
        this.zoomSlider.type = "range";
        this.zoomSlider.min = "15";
        this.zoomSlider.max = "300";
        this.zoomSlider.value = "100";
        this.zoomSlider.addEventListener("input", () => {
            this.renderer?.setZoomPercent(parseInt(this.zoomSlider!.value));
            this.updateZoomLabel();
        });

        const zoomIn = left.createEl("button", { cls: "dbml-zoom-btn", text: "+" });
        zoomIn.addEventListener("click", () => { this.renderer?.zoomIn(); this.syncZoomSlider(); });

        this.zoomLabel = left.createEl("span", { cls: "dbml-zoom-label", text: "100%" });

        const fitBtn = left.createEl("button", { cls: "dbml-zoom-btn", attr: { title: "Fit to content" } });
        setIcon(fitBtn, "maximize");
        fitBtn.addEventListener("click", () => { this.renderer?.fit(); this.syncZoomSlider(); });

        bar.createDiv("dbml-bottombar-spacer");

        const tips = bar.createEl("span", { cls: "erd-toolbar-help", text: "Ctrl+scroll: zoom · Shift+scroll: pan H · Drag: move" });
    }

    private syncZoomSlider(): void {
        if (this.zoomSlider && this.renderer) {
            this.zoomSlider.value = String(this.renderer.getZoomPercent());
            this.updateZoomLabel();
        }
    }

    private updateZoomLabel(): void {
        if (this.zoomLabel) {
            this.zoomLabel.textContent = `${this.zoomSlider?.value ?? "100"}%`;
        }
    }

    private setupDivider(divider: HTMLElement, leftPanel: HTMLElement, container: HTMLElement): void {
        let isDragging = false;

        divider.addEventListener("mousedown", (e) => {
            isDragging = true;
            divider.addClass("dragging");
            e.preventDefault();
        });

        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            const rect = container.getBoundingClientRect();
            const percentage = ((e.clientX - rect.left) / rect.width) * 100;
            leftPanel.style.width = `${Math.min(Math.max(percentage, 18), 55)}%`;
        });

        document.addEventListener("mouseup", () => {
            if (isDragging) { isDragging = false; divider.removeClass("dragging"); }
        });
    }

    async onClose(): Promise<void> {
        if (this.debounceTimer) { window.clearTimeout(this.debounceTimer); this.debounceTimer = null; }
        if (this.autoSaveInterval) { window.clearInterval(this.autoSaveInterval); this.autoSaveInterval = null; }
        this.renderer?.destroy(); this.renderer = null;
        this.editorView?.destroy(); this.editorView = null;
        this.containerEl.children[1]?.empty();
    }

    getViewData(): string { return this.currentCode; }

    setViewData(data: string, clear: boolean): void {
        console.log("[DBML] setViewData", clear ? "CLEAR" : "SET", "len =", data.length);
        if (data === this.currentCode) {
            console.log("[DBML] setViewData: data unchanged, skip");
            return;
        }
        this.currentCode = data;
        console.log("[DBML] setViewData: updating, editorView =", !!this.editorView, "file =", !!this.file);
        if (this.editorView && this.editorView.state.doc.toString() !== data) {
            this.suppressOnChange = true;
            this.editorView.dispatch({
                changes: { from: 0, to: this.editorView.state.doc.length, insert: data },
            });
            this.suppressOnChange = false;
            console.log("[DBML] setViewData: dispatched, doc now =", this.editorView.state.doc.length);
        }
        // Restore saved layout on initial load
        if (clear && this.file && this.renderer) {
            const saved = this.loadLayout();
            if (saved.size > 0) {
                this.renderer.setInitialPositions(saved);
                console.log("[DBML] setViewData: restored layout,", saved.size, "tables");
            }
        }
        this.scheduleRender(data);
    }

    clear(): void {
        this.currentCode = "";
        if (this.editorView) {
            this.suppressOnChange = true;
            this.editorView.dispatch({ changes: { from: 0, to: this.editorView.state.doc.length, insert: "" } });
            this.suppressOnChange = false;
        }
        this.showError(null);
        this.renderDiagram("");
    }

    private scheduleRender(code: string): void {
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        this.debounceTimer = window.setTimeout(() => {
            this.renderDiagram(code);
            this.debounceTimer = null;
        }, this.plugin.settings.renderDebounceMs);
    }

    private renderDiagram(code: string): void {
        if (!this.renderer) { console.log("[DBML] renderDiagram: renderer is NULL, skip"); return; }
        console.log("[DBML] renderDiagram: len =", code.length, "tables =", (code.match(/^Table\s+/gm) || []).length);
        if (!code.trim()) { this.renderer.setData({ tables: [], relations: [], tableGroups: [] }); this.showError(null); return; }
        try {
            const model = parseDbml(code);
            this.renderer.setData(model);
            this.showError(null);
            this.saveLayout();
        } catch (err) {
            const perr = extractParseError(err);
            console.error("DBML render error:", perr.message, perr.line ? `(line ${perr.line})` : "");
            this.showError(perr.message, perr.line, perr.col);
        }
    }

    private loadLayout(): Map<string, { x: number; y: number }> {
        if (!this.file) return new Map();
        const data = this.plugin.getLayout(this.file.path);
        return new Map(Object.entries(data));
    }

    private async saveLayout(): Promise<void> {
        if (!this.file || !this.renderer) return;
        await this.plugin.saveLayout(this.file.path, this.renderer.getAllPositions());
    }

    private showError(message: string | null, line?: number, col?: number): void {
        if (!this.errorEl) return;
        if (!message) { this.errorEl.style.display = "none"; return; }
        let text = `Parse error: ${message}`;
        if (line) text += ` (line ${line}${col ? `, col ${col}` : ""})`;
        this.errorEl.textContent = text;
        this.errorEl.style.display = "block";
    }

    private enterRelationMode(): void {
        if (!this.renderer) return;
        try {
            const model = parseDbml(this.currentCode);
            if (model.tables.length < 2) { new Notice("Need at least 2 tables to create a relationship"); return; }
            this.renderer.enterRelationMode();
            new Notice("Click source column, then target column (ESC to cancel)");
        } catch (err) {
            new Notice(`Cannot create relation: ${extractParseError(err).message}`);
        }
    }

    private async exportSqlToClipboard(dialect: SqlDialect): Promise<void> {
        try {
            const sql = exportSql(this.currentCode, dialect);
            await navigator.clipboard.writeText(sql);
            const d = SQL_DIALECTS.find((x) => x.value === dialect);
            new Notice(`SQL (${d?.label ?? dialect}) copied to clipboard!`);
        } catch (err) {
            new Notice(`SQL export failed: ${extractParseError(err).message}`);
        }
    }

    private deleteTables(tableIds: string[]): void {
        if (!this.editorView || tableIds.length === 0) return;
        let code = this.editorView.state.doc.toString();
        for (const id of tableIds) {
            const name = id.replace(/^.*\./, "");
            code = code.replace(new RegExp(`^Table\\s+${this.escapeRegExp(name)}\\s*\\{[^}]*\\}\\s*`, "gm"), "");
            code = code.replace(new RegExp(`^Ref:\\s*${this.escapeRegExp(id)}\\.\\S+\\s*[<>\\-]+\\s*\\S+\\.\\S+\\s*`, "gm"), "");
            code = code.replace(new RegExp(`^Ref:\\s*\\S+\\.\\S+\\s*[<>\\-]+\\s*${this.escapeRegExp(id)}\\.\\S+\\s*`, "gm"), "");
            code = code.replace(new RegExp(`^TableGroup[^\\{]*\\{[^}]*\\b${this.escapeRegExp(name)}\\b[^}]*\\}\\s*`, "gm"), "");
        }
        code = code.replace(/\n{3,}/g, "\n\n").trim() + "\n";
        this.editorView.dispatch({
            changes: { from: 0, to: this.editorView.state.doc.length, insert: code },
        });
        new Notice(`Deleted ${tableIds.length} table(s)`);
    }

    private escapeRegExp(s: string): string {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}
