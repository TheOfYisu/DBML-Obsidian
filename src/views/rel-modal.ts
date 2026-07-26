import { App, Modal, Setting } from "obsidian";
import { ErdModel, ErdTable } from "../model/erd-model";

export class AddRelationModal extends Modal {
	private model: ErdModel;
	private onSubmit: (refText: string) => void;
	private sourceTable = "";
	private sourceColumn = "";
	private targetTable = "";
	private targetColumn = "";
	private relType = ">";

	constructor(app: App, model: ErdModel, onSubmit: (refText: string) => void) {
		super(app);
		this.model = model;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("erd-relation-modal");

		contentEl.createEl("h3", { text: "Add Relationship" });

		const sourceTableSelect = this.createTableSelect(contentEl, "Source Table", (val) => {
			this.sourceTable = val;
			this.sourceColumn = "";
			this.updateColumnDropdowns();
		});

		const sourceColumnSelect = this.createColumnSelect(contentEl, "Source Column", (val) => {
			this.sourceColumn = val;
		}, () => this.sourceTable);

		const relSelect = this.createRelationType(contentEl, (val) => {
			this.relType = val;
		});

		const targetTableSelect = this.createTableSelect(contentEl, "Target Table", (val) => {
			this.targetTable = val;
			this.targetColumn = "";
			this.updateColumnDropdowns();
		});

		const targetColumnSelect = this.createColumnSelect(contentEl, "Target Column", (val) => {
			this.targetColumn = val;
		}, () => this.targetTable);

		this.updateColumnDropdowns = () => {
			this.rebuildSelect(sourceColumnSelect, this.sourceTable);
			this.rebuildSelect(targetColumnSelect, this.targetTable);
		};

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Add Relation")
					.setCta()
					.onClick(() => {
						if (!this.sourceTable || !this.sourceColumn || !this.targetTable || !this.targetColumn) {
							return;
						}
						const st = this.getDisplayName(this.sourceTable);
						const tt = this.getDisplayName(this.targetTable);
						const ref = `Ref: ${st}.${this.sourceColumn} ${this.relType} ${tt}.${this.targetColumn}`;
						this.onSubmit(ref);
						this.close();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close())
			);
	}

	private createTableSelect(container: HTMLElement, title: string, onChange: (val: string) => void): HTMLSelectElement {
		const wrapper = container.createDiv("setting");
		wrapper.createDiv("setting-item-info").createDiv("setting-item-name").setText(title);
		const ctl = wrapper.createDiv("setting-item-control");
		const select = ctl.createEl("select");
		select.createEl("option", { text: "— Select —", value: "" });
		for (const t of this.model.tables) {
			select.createEl("option", { text: this.getDisplayName(t.id), value: t.id });
		}
		select.addEventListener("change", () => onChange(select.value));
		return select;
	}

	private createColumnSelect(
		container: HTMLElement,
		title: string,
		onChange: (val: string) => void,
		getTable: () => string
	): HTMLSelectElement {
		const wrapper = container.createDiv("setting");
		wrapper.createDiv("setting-item-info").createDiv("setting-item-name").setText(title);
		const ctl = wrapper.createDiv("setting-item-control");
		const select = ctl.createEl("select");
		select.createEl("option", { text: "— Select —", value: "" });
		select.addEventListener("change", () => onChange(select.value));
		return select;
	}

	private createRelationType(container: HTMLElement, onChange: (val: string) => void): HTMLSelectElement {
		const wrapper = container.createDiv("setting");
		wrapper.createDiv("setting-item-info").createDiv("setting-item-name").setText("Type");
		const ctl = wrapper.createDiv("setting-item-control");
		const select = ctl.createEl("select");
		select.createEl("option", { text: "One-to-Many (<)", value: "<" });
		select.createEl("option", { text: "Many-to-One (>)", value: ">" });
		select.createEl("option", { text: "One-to-One (-)", value: "-" });
		select.addEventListener("change", () => onChange(select.value));
		return select;
	}

	private rebuildSelect(select: HTMLSelectElement, tableId: string): void {
		select.innerHTML = "";
		select.createEl("option", { text: "— Select —", value: "" });
		const table = this.model.tables.find((t) => t.id === tableId);
		if (table) {
			for (const f of table.fields) {
				select.createEl("option", { text: f.name, value: f.name });
			}
		}
	}

	private getDisplayName(id: string): string {
		const t = this.model.tables.find((t) => t.id === id);
		return t ? (t.schema ? `${t.schema}.${t.name}` : t.name) : id;
	}

	private updateColumnDropdowns: () => void = () => {};

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
