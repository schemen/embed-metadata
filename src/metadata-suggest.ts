// Autocomplete & Suggester for frontmatter keys
import {Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile} from "obsidian";
import {collectFrontmatterKeys, getTokenClose, getTriggerRegex} from "./metadata-utils";
import {EmbedMetadataPlugin} from "./settings";

export class MetadataSuggest extends EditorSuggest<string> {
	private plugin: EmbedMetadataPlugin;

	constructor(plugin: EmbedMetadataPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	// Start suggesting once the token opener is detected on the current line
	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!file) {
			return null;
		}

		const line = editor.getLine(cursor.line);
		const prefix = line.slice(0, cursor.ch);
		const triggerRegex = getTriggerRegex(this.plugin.settings.tokenStyle);
		const match = prefix.match(triggerRegex);
		if (!match) {
			return null;
		}

		const query = match[1] ?? "";
		return {
			start: {line: cursor.line, ch: cursor.ch - query.length},
			end: cursor,
			query,
		};
	}

	// Return sorted frontmatter keys that match the current query
	getSuggestions(context: EditorSuggestContext): string[] {
		const frontmatter = this.plugin.app.metadataCache.getFileCache(context.file)?.frontmatter;
		if (!frontmatter) {
			return [];
		}

		const keys = collectFrontmatterKeys(frontmatter);
		const query = context.query.toLowerCase();

		const unique = new Set<string>();
		for (const key of keys) {
			if (!query || key.toLowerCase().startsWith(query)) {
				unique.add(key);
			}
		}

		return Array.from(unique).sort((a, b) => a.localeCompare(b));
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	// Insert the selected key and close the token if needed
	selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
		if (!this.context) {
			return;
		}

		const editor = this.context.editor;
		const lineText = editor.getLine(this.context.start.line);
		const close = getTokenClose(this.plugin.settings.tokenStyle);
		const nextText = lineText.slice(this.context.end.ch, this.context.end.ch + close.length);
		const hasClosing = nextText === close;
		const replacement = value + (hasClosing ? "" : close);

		editor.replaceRange(replacement, this.context.start, this.context.end);

		const cursorCh = this.context.start.ch + value.length + close.length;
		editor.setCursor(this.context.start.line, cursorCh);
	}
}
