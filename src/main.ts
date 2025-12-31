import {MarkdownView, Plugin} from "obsidian";
import {createEditorExtension} from "./editor-metadata";
import {registerMetadataRenderer} from "./metadata-renderer";
import {MetadataSuggest} from "./metadata-suggest";
import {DEFAULT_SETTINGS, EmbedMetadataSettingTab, EmbedMetadataSettings} from "./settings";

export default class EmbedMetadata extends Plugin {
	settings: EmbedMetadataSettings;

	async onload() {
		await this.loadSettings();

		this.registerEditorExtension(createEditorExtension(this));
		registerMetadataRenderer(this);
		this.registerEditorSuggest(new MetadataSuggest(this));
		this.addSettingTab(new EmbedMetadataSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<EmbedMetadataSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.refreshAllMarkdownViews();
	}

	// Refresh rendered markdown after a change of setting
	private refreshAllMarkdownViews() {
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) {
				continue;
			}

			view.previewMode?.rerender(true);

			const editor = view.editor;
			if (editor) {
				const cursor = editor.getCursor();
				editor.setCursor(cursor);
				editor.refresh();
			}
		}
	}
}
