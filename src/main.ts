import {Plugin} from "obsidian";
import {createEditorExtension, refreshAllLivePreview, refreshLivePreviewForFile} from "./editor-metadata";
import {registerMetadataRenderer} from "./metadata-renderer";
import {MetadataSuggest} from "./metadata-suggest";
import {registerOutlineRenderer} from "./outline-renderer";
import {MarkdownRefresher, registerMarkdownRefresh} from "./metadata-utils";
import {DEFAULT_SETTINGS, EmbedMetadataSettingTab, EmbedMetadataSettings} from "./settings";

export default class EmbedMetadata extends Plugin {
	settings: EmbedMetadataSettings;
	private refreshOutlineViews: (() => void) | null = null;
	private markdownRefresher: MarkdownRefresher | null = null;

	async onload() {
		await this.loadSettings();

		this.markdownRefresher = registerMarkdownRefresh(this, refreshLivePreviewForFile);
		this.registerEditorExtension(createEditorExtension(this));
		registerMetadataRenderer(this);
		this.refreshOutlineViews = registerOutlineRenderer(this);
		this.registerEditorSuggest(new MetadataSuggest(this));
		this.addSettingTab(new EmbedMetadataSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<EmbedMetadataSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.markdownRefresher?.refreshAll();
		refreshAllLivePreview();
		this.refreshOutlineViews?.();
	}
}
