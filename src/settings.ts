import { App, PluginSettingTab, Setting } from "obsidian";
import type DBMLDiagrammerPlugin from "./main";

export interface DbDiagrammerSettings {
	embedHeight: number;
	renderDebounceMs: number;
}

export const DEFAULT_SETTINGS: DbDiagrammerSettings = {
	embedHeight: 420,
	renderDebounceMs: 400,
};

export class DbDiagrammerSettingTab extends PluginSettingTab {
	plugin: DBMLDiagrammerPlugin;

	constructor(app: App, plugin: DBMLDiagrammerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "DBML Diagrammer Settings" });

		new Setting(containerEl)
			.setName("Embed height")
			.setDesc("Height in pixels for DBML code block diagrams in reading view")
			.addText((text) =>
				text
					.setPlaceholder("420")
					.setValue(String(this.plugin.settings.embedHeight))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num >= 200 && num <= 1200) {
							this.plugin.settings.embedHeight = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Render debounce")
			.setDesc("Delay in milliseconds before re-rendering diagram after editing (for .dbml files)")
			.addText((text) =>
				text
					.setPlaceholder("400")
					.setValue(String(this.plugin.settings.renderDebounceMs))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num >= 100 && num <= 2000) {
							this.plugin.settings.renderDebounceMs = num;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
