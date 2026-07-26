import { Plugin, TFile, Notice } from "obsidian";
import { DbmlFileView, VIEW_TYPE_DBML } from "./views/dbml-file-view";
import { registerDbmlCodeBlock } from "./views/code-block";
import { DbDiagrammerSettings, DEFAULT_SETTINGS, DbDiagrammerSettingTab } from "./settings";

export default class DBMLDiagrammerPlugin extends Plugin {
	settings: DbDiagrammerSettings = DEFAULT_SETTINGS;
	private savedLayouts: Record<string, Record<string, { x: number; y: number }>> = {};

	async onload(): Promise<void> {
		await this.loadSettings();

		const data = await this.loadData();
		this.savedLayouts = data?.savedLayouts || {};

		this.registerView(VIEW_TYPE_DBML, (leaf) => new DbmlFileView(leaf, this));
		this.registerExtensions(["dbml"], VIEW_TYPE_DBML);

		registerDbmlCodeBlock(this);

		this.addSettingTab(new DbDiagrammerSettingTab(this.app, this));

		this.addRibbonIcon("database", "Open DBML Diagrammer", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-dbml-diagrammer",
			name: "Open DBML Diagrammer",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "create-dbml-diagram",
			name: "Create new DBML diagram",
			callback: async () => {
				await this.createNewDbmlFile();
			},
		});
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings || {});
		this.savedLayouts = data?.savedLayouts || {};
	}

	async saveSettings(): Promise<void> {
		await this.saveData({ settings: this.settings, savedLayouts: this.savedLayouts });
	}

	getLayout(filePath: string): Record<string, { x: number; y: number }> {
		return this.savedLayouts[filePath] || {};
	}

	async saveLayout(filePath: string, positions: Map<string, { x: number; y: number }>): Promise<void> {
		this.savedLayouts[filePath] = Object.fromEntries(positions);
		await this.saveSettings();
	}

	private async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_DBML);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		await this.createNewDbmlFile();
	}

	private async createNewDbmlFile(): Promise<void> {
		const template = `Table users {
  id integer [pk, increment]
  username varchar [not null, unique]
  email varchar [not null]
  created_at timestamp
}

Table posts {
  id integer [pk, increment]
  title varchar [not null]
  body text
  user_id integer [ref: > users.id]
  status varchar [default: 'draft']
  created_at timestamp
}

Table comments {
  id integer [pk, increment]
  body text [not null]
  user_id integer [ref: > users.id]
  post_id integer [ref: > posts.id]
  created_at timestamp
}`;

		let filename = "Untitled.dbml";
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(filename)) {
			filename = `Untitled ${counter}.dbml`;
			counter++;
		}

		try {
			const file = await this.app.vault.create(filename, template);
			const leaf = this.app.workspace.getLeaf("tab");
			await leaf.openFile(file);
		} catch (err) {
			new Notice("Failed to create DBML file");
			console.error(err);
		}
	}
}
