import {App, Plugin, PluginSettingTab, Setting} from "obsidian";
import {SyntaxStyle} from "./metadata-utils";
import {MigrationModal} from "./migration-modal";

export interface EmbedMetadataSettings {
	syntaxStyle: SyntaxStyle;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	underlineColorEnabled: boolean;
	underlineColor: string;
	highlight: boolean;
	highlightColorEnabled: boolean;
	highlightColor: string;
	hoverEmphasis: boolean;
}

// Defaults for newly installed or reset settings.
export const DEFAULT_SETTINGS: EmbedMetadataSettings = {
	syntaxStyle: "brackets",
	bold: false,
	italic: false,
	underline: true,
	underlineColorEnabled: false,
	underlineColor: "#000000",
	highlight: false,
	highlightColorEnabled: false,
	highlightColor: "#fff59d",
	hoverEmphasis: true,
};

// Satisfy linter.
export type EmbedMetadataPlugin = Plugin & {
	settings: EmbedMetadataSettings;
	saveSettings: () => Promise<void>;
};

// Settings UI for the plugin.
export class EmbedMetadataSettingTab extends PluginSettingTab {
	private plugin: EmbedMetadataPlugin;

	constructor(app: App, plugin: EmbedMetadataPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Render the settings form.
	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Syntax")
			.setHeading();

		new Setting(containerEl)
			.setName("Syntax format")
			.setDesc("Choose the syntax used to embed frontmatter values.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("brackets", "[%key]")
					.addOption("doubleBraces", "{{key}}")
					.setValue(this.plugin.settings.syntaxStyle)
					.onChange(async (value) => {
						this.plugin.settings.syntaxStyle = value as SyntaxStyle;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Visual aid in live preview")
			.setHeading();

		new Setting(containerEl)
			.setName("Bold")
			.setDesc("Render values in bold.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.bold)
					.onChange(async (value) => {
						this.plugin.settings.bold = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Italic")
			.setDesc("Render values in italics.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.italic)
					.onChange(async (value) => {
						this.plugin.settings.italic = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Underline")
			.setDesc("Underline rendered values.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.underline)
					.onChange(async (value) => {
						this.plugin.settings.underline = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Underline color")
			.setDesc("Override underline color (otherwise uses text color).")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.underlineColorEnabled)
					.onChange(async (value) => {
						this.plugin.settings.underlineColorEnabled = value;
						await this.plugin.saveSettings();
					});
			})
			.addColorPicker((picker) => {
				picker
					.setValue(this.plugin.settings.underlineColor)
					.onChange(async (value) => {
						this.plugin.settings.underlineColor = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Highlight")
			.setDesc("Highlight rendered values.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.highlight)
					.onChange(async (value) => {
						this.plugin.settings.highlight = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Highlight color")
			.setDesc("Override highlight color (otherwise uses theme highlight).")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.highlightColorEnabled)
					.onChange(async (value) => {
						this.plugin.settings.highlightColorEnabled = value;
						await this.plugin.saveSettings();
					});
			})
			.addColorPicker((picker) => {
				picker
					.setValue(this.plugin.settings.highlightColor)
					.onChange(async (value) => {
						this.plugin.settings.highlightColor = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Hover emphasis")
			.setDesc("Shift styling slightly on hover in live preview.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.hoverEmphasis)
					.onChange(async (value) => {
						this.plugin.settings.hoverEmphasis = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Migration")
			.setHeading();

		new Setting(containerEl)
			.setName("Migrate from dataview")
			.setDesc("Convert backticked `=this.key` syntax to the selected format.")
			.addButton((button) => {
				button.setButtonText("Review").onClick(() => {
					new MigrationModal(this.app, this.plugin, "dataview").open();
				});
			});

		new Setting(containerEl)
			.setName("Migrate to current syntax")
			.setDesc("Convert other supported syntax formats to the selected format.")
			.addButton((button) => {
				button.setButtonText("Review").onClick(() => {
					new MigrationModal(this.app, this.plugin, "otherSyntax").open();
				});
			});
	}
}
