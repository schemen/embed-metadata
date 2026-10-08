import {App, Plugin, PluginSettingTab, Setting} from "obsidian";
import {SyntaxStyle} from "./metadata-utils";
import {MigrationModal} from "./migration-modal";

export interface EmbedMetadataSettings {
	syntaxStyle: SyntaxStyle;
	caseInsensitiveKeys: boolean;
	builtInKeysEnabled: boolean;
	renderOutline: boolean;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	highlight: boolean;
	highlightColorEnabled: boolean;
	highlightColor: string;
	hoverEmphasis: boolean;
}

// Defaults for newly installed or reset settings.
export const DEFAULT_SETTINGS: EmbedMetadataSettings = {
	syntaxStyle: "brackets",
	caseInsensitiveKeys: false,
	builtInKeysEnabled: true,
	renderOutline: false,
	bold: false,
	italic: false,
	underline: true,
	highlight: false,
	highlightColorEnabled: false,
	highlightColor: "#fff59d",
	hoverEmphasis: true,
};

// Validate persisted data so malformed or stale values cannot leak into the UI.
export function normalizeSettings(data: unknown): EmbedMetadataSettings {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return {...DEFAULT_SETTINGS};
	}

	const saved = data as Record<string, unknown>;
	const booleanSetting = (key: string, fallback: boolean): boolean => {
		const value = saved[key];
		return typeof value === "boolean" ? value : fallback;
	};
	const syntaxStyle = saved.syntaxStyle === "brackets" || saved.syntaxStyle === "doubleBraces"
		? saved.syntaxStyle
		: DEFAULT_SETTINGS.syntaxStyle;
	const highlightColor = typeof saved.highlightColor === "string"
		&& /^#[0-9a-f]{6}$/i.test(saved.highlightColor)
		? saved.highlightColor
		: DEFAULT_SETTINGS.highlightColor;

	return {
		syntaxStyle,
		caseInsensitiveKeys: booleanSetting("caseInsensitiveKeys", DEFAULT_SETTINGS.caseInsensitiveKeys),
		builtInKeysEnabled: booleanSetting("builtInKeysEnabled", DEFAULT_SETTINGS.builtInKeysEnabled),
		renderOutline: booleanSetting("renderOutline", DEFAULT_SETTINGS.renderOutline),
		bold: booleanSetting("bold", DEFAULT_SETTINGS.bold),
		italic: booleanSetting("italic", DEFAULT_SETTINGS.italic),
		underline: booleanSetting("underline", DEFAULT_SETTINGS.underline),
		highlight: booleanSetting("highlight", DEFAULT_SETTINGS.highlight),
		highlightColorEnabled: booleanSetting(
			"highlightColorEnabled",
			DEFAULT_SETTINGS.highlightColorEnabled
		),
		highlightColor,
		hoverEmphasis: booleanSetting("hoverEmphasis", DEFAULT_SETTINGS.hoverEmphasis),
	};
}

// Satisfy linter.
export type EmbedMetadataPlugin = Plugin & {
	settings: EmbedMetadataSettings;
	saveSettings: () => Promise<void>;
};

// `id` is a stable per-setting key (Obsidian 1.14+); older versions ignore it.
type RenderedSettingDefinition = {
	id?: string;
	name: string;
	desc?: string;
	render: (setting: Setting) => void;
	control?: never;
	action?: never;
};

type InformationalSettingDefinition = {
	id?: string;
	name: string;
	desc?: string;
	render?: never;
	control?: never;
	action?: never;
};

type CompatibleSettingDefinition = RenderedSettingDefinition | InformationalSettingDefinition;

type CompatibleSettingGroup = {
	type: "group";
	heading: string;
	items: CompatibleSettingDefinition[];
};

type BooleanSettingKey =
	| "caseInsensitiveKeys"
	| "builtInKeysEnabled"
	| "renderOutline"
	| "bold"
	| "italic"
	| "underline"
	| "highlight"
	| "highlightColorEnabled"
	| "hoverEmphasis";

// Settings UI for the plugin.
export class EmbedMetadataSettingTab extends PluginSettingTab {
	private plugin: EmbedMetadataPlugin;

	constructor(app: App, plugin: EmbedMetadataPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Obsidian 1.13+ uses these definitions for rendering and settings search.
	getSettingDefinitions(): CompatibleSettingGroup[] {
		return [
			{
				type: "group",
				heading: "Syntax",
				items: [
					{
						id: "syntaxStyle",
						name: "Syntax format",
						desc: "Choose the syntax used to embed frontmatter values.",
						render: (setting) => {
							setting.addDropdown((dropdown) => {
								dropdown
									.addOption("brackets", "[%key]")
									.addOption("doubleBraces", "{{key}}")
									.setValue(this.plugin.settings.syntaxStyle)
									.onChange(async (value) => {
										this.plugin.settings.syntaxStyle = value as SyntaxStyle;
										await this.plugin.saveSettings();
									});
							});
						},
					},
					this.createToggleDefinition(
						"caseInsensitiveKeys",
						"Case-insensitive keys",
						"Treat keys as case-insensitive (Age matches {{age}})."
					),
					this.createToggleDefinition(
						"builtInKeysEnabled",
						"Built-in keys",
						"Enable built-ins like {{filename}}, {{path}}, and {{mtime}}."
					),
					{
						id: "remoteSyntaxInfo",
						name: "Remote property syntax",
						desc: "Reference another note's property with [[Note]]@key; autocomplete is offered after @."
							+ " The older [[Note]]#key form still renders but is deprecated and will be removed in a"
							+ " future release, because Obsidian indexes the #key as a tag. Switch existing references"
							+ " to @ to avoid stray tags.",
					},
					this.createToggleDefinition(
						"renderOutline",
						"Render in outline (experimental)",
						"Render metadata markers in the outline view."
					),
				],
			},
			{
				type: "group",
				heading: "Visual aid in live preview",
				items: [
					this.createToggleDefinition("bold", "Bold", "Render values in bold."),
					this.createToggleDefinition("italic", "Italic", "Render values in italics."),
					this.createToggleDefinition("underline", "Underline", "Underline rendered values."),
					this.createToggleDefinition("highlight", "Highlight", "Highlight rendered values."),
					{
						id: "highlightColor",
						name: "Highlight color",
						desc: "Override highlight color (otherwise uses theme highlight).",
						render: (setting) => {
							setting
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
						},
					},
					this.createToggleDefinition(
						"hoverEmphasis",
						"Hover emphasis",
						"Shift styling slightly on hover in live preview."
					),
				],
			},
			{
				type: "group",
				heading: "Migration",
				items: [
					{
						id: "migrateDataview",
						name: "Migrate from dataview",
						desc: "Convert backticked `=this.key` syntax to the selected format.",
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText("Review").onClick(() => {
									new MigrationModal(this.app, this.plugin, "dataview").open();
								});
							});
						},
					},
					{
						id: "migrateSyntax",
						name: "Migrate to current syntax",
						desc: "Convert other supported syntax formats to the selected format.",
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText("Review").onClick(() => {
									new MigrationModal(this.app, this.plugin, "otherSyntax").open();
								});
							});
						},
					},
				],
			},
		];
	}

	private createToggleDefinition(
		key: BooleanSettingKey,
		name: string,
		desc: string
	): RenderedSettingDefinition {
		return {
			id: key,
			name,
			desc,
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings[key])
						.onChange(async (value) => {
							this.plugin.settings[key] = value;
							await this.plugin.saveSettings();
						});
				});
			},
		};
	}
}
