// Autocomplete & Suggester for frontmatter keys
import {Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile} from "obsidian";
import {
	collectFrontmatterKeys,
	findMetadataMarkers,
	getBuiltInKeys,
	getSyntaxClose,
	getSyntaxOpen,
	getSyntaxTriggerRegex,
	parseMetadataReference,
	resolveMetadataTargetFile,
	type MetadataTarget,
	type SyntaxStyle,
} from "./metadata-utils";
import {EmbedMetadataPlugin} from "./settings";

type SuggestMode =
	| {type: "local"}
	| {type: "remote"; targetFile: TFile};

export class MetadataSuggest extends EditorSuggest<string> {
	private plugin: EmbedMetadataPlugin;
	private suggestMode: SuggestMode | null = null;

	constructor(plugin: EmbedMetadataPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

// Start suggesting once the syntax opener is detected on the current line.
	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		this.suggestMode = null;
		if (!file) {
			return null;
		}

		const line = editor.getLine(cursor.line);
		const prefix = line.slice(0, cursor.ch);
		const remoteTrigger = getRemotePropertyTrigger(prefix, this.plugin.settings.syntaxStyle);
		if (remoteTrigger) {
			const targetFile = resolveMetadataTargetFile(this.plugin.app, file.path, remoteTrigger.target);
			if (!targetFile) {
				return null;
			}
			this.suggestMode = {type: "remote", targetFile};
			return {
				start: {line: cursor.line, ch: cursor.ch - remoteTrigger.query.length},
				end: cursor,
				query: remoteTrigger.query,
			};
		}

		const triggerRegex = getSyntaxTriggerRegex(this.plugin.settings.syntaxStyle);
		const match = prefix.match(triggerRegex);
		if (!match) {
			return null;
		}

		const query = match[1] ?? "";
		this.suggestMode = {type: "local"};
		return {
			start: {line: cursor.line, ch: cursor.ch - query.length},
			end: cursor,
			query,
		};
	}

	// Return sorted frontmatter keys that match the current query
	getSuggestions(context: EditorSuggestContext): string[] {
		const file = this.suggestMode?.type === "remote"
			? this.suggestMode.targetFile
			: context.file;
		const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
		const keys = frontmatter ? collectFrontmatterKeys(frontmatter) : [];
		if (this.plugin.settings.builtInKeysEnabled) {
			keys.push(...getBuiltInKeys());
		}
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

	// Insert the selected key and close the syntax marker if needed.
	selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
		if (!this.context) {
			return;
		}

		const editor = this.context.editor;
		const lineText = editor.getLine(this.context.start.line);
		const close = getSyntaxClose(this.plugin.settings.syntaxStyle);
		const nextText = lineText.slice(this.context.end.ch, this.context.end.ch + close.length);
		const hasClosing = nextText === close;
		const replacement = value + (hasClosing ? "" : close);

		editor.replaceRange(replacement, this.context.start, this.context.end);

		const cursorCh = this.context.start.ch + value.length + close.length;
		editor.setCursor(this.context.start.line, cursorCh);
	}
}

function getRemotePropertyTrigger(
	prefix: string,
	style: SyntaxStyle
): {query: string; target: MetadataTarget} | null {
	const open = getSyntaxOpen(style);
	const markerStart = prefix.lastIndexOf(open);
	if (markerStart === -1 || hasClosedMarkerBeforeCursor(prefix, markerStart, style)) {
		return null;
	}

	const content = prefix.slice(markerStart + open.length);
	const reference = parseMetadataReference(content, true);
	if (!reference?.target || !/^[A-Za-z0-9_.-]*$/.test(reference.key)) {
		return null;
	}

	// Only the canonical `@` separator gets autocomplete. The deprecated `#`
	// form still renders, but withholding the assist nudges notes toward `@`.
	const beforeKey = content.slice(0, content.length - reference.key.length).trimEnd();
	if (!beforeKey.endsWith("@")) {
		return null;
	}

	return {
		query: reference.key,
		target: reference.target,
	};
}

function hasClosedMarkerBeforeCursor(prefix: string, markerStart: number, style: SyntaxStyle): boolean {
	const markerText = prefix.slice(markerStart);
	return findMetadataMarkers(markerText, style).some((found) => found.from === 0);
}
