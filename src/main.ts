import {Plugin} from "obsidian";
import {createEditorExtension, refreshAllLivePreview, refreshLivePreviewForDependents} from "./editor-metadata";
import {registerMetadataRenderer} from "./metadata-renderer";
import {MetadataSuggest} from "./metadata-suggest";
import {registerOutlineRenderer} from "./outline-renderer";
import {MarkdownRefresher, registerMarkdownRefresh} from "./metadata-utils";
import {
	DEFAULT_SETTINGS,
	EmbedMetadataSettingTab,
	EmbedMetadataSettings,
	normalizeSettings,
} from "./settings";

export default class EmbedMetadata extends Plugin {
	settings: EmbedMetadataSettings = {...DEFAULT_SETTINGS};
	private refreshOutlineViews: (() => void) | null = null;
	private markdownRefresher: MarkdownRefresher | null = null;

	async onload() {
		await this.loadSettings();

		const refreshReadingView = registerMetadataRenderer(this);
		this.markdownRefresher = registerMarkdownRefresh(this, (file, previousPath) => {
			refreshLivePreviewForDependents(file, previousPath);
			refreshReadingView(file, previousPath);
		});
		this.registerEditorExtension(createEditorExtension(this));
		this.refreshOutlineViews = registerOutlineRenderer(this);
		this.registerEditorSuggest(new MetadataSuggest(this));
		this.addSettingTab(new EmbedMetadataSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.markdownRefresher?.refreshAll();
		refreshAllLivePreview();
		this.refreshOutlineViews?.();
	}
}
