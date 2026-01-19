// Live Preview renderer using CodeMirror decorations
import {Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType} from "@codemirror/view";
import {RangeSetBuilder, StateEffect, Text} from "@codemirror/state";
import {editorInfoField, editorLivePreviewField, TFile} from "obsidian";
import {createFrontmatterResolver, getSyntaxOpen, getSyntaxRegex} from "./metadata-utils";
import {renderInlineMarkdown} from "./markdown-render";
import {applyValueStyles, getStyleKey} from "./metadata-style";
import {EmbedMetadataPlugin} from "./settings";

type LineMarker = {
	from: number;
	to: number;
	key: string;
};

type LineMarkers = {
	text: string;
	markers: LineMarker[];
};

const livePreviewRefreshEffect = StateEffect.define<null>();
const livePreviewInstances = new Set<MetadataViewPlugin>();

// Force a Live Preview refresh for a given file after metadata changes.
export function refreshLivePreviewForFile(file: TFile): void {
	for (const instance of livePreviewInstances) {
		if (instance.matchesFile(file)) {
			instance.requestRefresh();
		}
	}
}

// Build the Live Preview view plugin that renders syntax markers in the editor.
export function createEditorExtension(plugin: EmbedMetadataPlugin) {
	return ViewPlugin.fromClass(MetadataViewPlugin.bind(null, plugin), {
		decorations: (value) => value.decorations,
	});
}

class MetadataViewPlugin {
	decorations: DecorationSet;
	private plugin: EmbedMetadataPlugin;
	private view: EditorView;
	private cursorMarkerKey: string;
	private lineCache: Map<number, LineMarkers>;
	private syntaxStyle: string;

	constructor(plugin: EmbedMetadataPlugin, view: EditorView) {
		this.plugin = plugin;
		this.view = view;
		this.lineCache = new Map();
		this.syntaxStyle = plugin.settings.syntaxStyle;
		this.decorations = buildDecorations(view, plugin, this.lineCache);
		this.cursorMarkerKey = getCursorMarkerKey(view, plugin);
		livePreviewInstances.add(this);
	}

	update(update: ViewUpdate) {
		let needsRebuild = false;

		if (this.syntaxStyle !== this.plugin.settings.syntaxStyle) {
			this.syntaxStyle = this.plugin.settings.syntaxStyle;
			this.lineCache.clear();
			needsRebuild = true;
		}

		if (update.docChanged) {
			this.decorations = this.decorations.map(update.changes);
			pruneLineCache(this.lineCache, update.state.doc.lines);
			if (shouldRebuildForChanges(update, this.plugin)) {
				needsRebuild = true;
			}
		}

		if (update.viewportChanged) {
			needsRebuild = true;
		}

		if (update.docChanged || update.selectionSet) {
			const nextCursorMarkerKey = getCursorMarkerKey(update.view, this.plugin);
			if (nextCursorMarkerKey !== this.cursorMarkerKey) {
				this.cursorMarkerKey = nextCursorMarkerKey;
				needsRebuild = true;
			}
		}

		if (update.transactions.some((tr) => tr.effects.some((effect) => effect.is(livePreviewRefreshEffect)))) {
			needsRebuild = true;
		}

		if (needsRebuild) {
			this.decorations = buildDecorations(update.view, this.plugin, this.lineCache);
		}
	}

	destroy() {
		livePreviewInstances.delete(this);
	}

	matchesFile(file: TFile): boolean {
		const info = this.view.state.field(editorInfoField);
		return info?.file?.path === file.path;
	}

	requestRefresh(): void {
		this.view.dispatch({effects: livePreviewRefreshEffect.of(null)});
	}
}

// Scan visible ranges and replace syntax markers with widgets (skipping active edits).
function buildDecorations(
	view: EditorView,
	plugin: EmbedMetadataPlugin,
	lineCache: Map<number, LineMarkers>
): DecorationSet {
	if (!view.state.field(editorLivePreviewField)) {
		return Decoration.none;
	}

	const info = view.state.field(editorInfoField);
	const file = info?.file;
	if (!file || !(file instanceof TFile)) {
		return Decoration.none;
	}

	const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
	if (!frontmatter) {
		return Decoration.none;
	}

	const builder = new RangeSetBuilder<Decoration>();
	const selectionRanges = view.state.selection.ranges;
	const styleKey = getStyleKey(plugin.settings);
	const syntaxOpen = getSyntaxOpen(plugin.settings.syntaxStyle);
	const syntaxRegex = getSyntaxRegex(plugin.settings.syntaxStyle);
	const seenLines = new Set<number>();
	const resolveValue = createFrontmatterResolver(frontmatter, plugin.settings.caseInsensitiveKeys);

	for (const range of view.visibleRanges) {
		const startLine = view.state.doc.lineAt(range.from).number;
		const endLine = view.state.doc.lineAt(Math.max(range.to - 1, range.from)).number;

		for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
			if (seenLines.has(lineNumber)) {
				continue;
			}
			seenLines.add(lineNumber);

			const line = view.state.doc.line(lineNumber);
			const markers = getLineMarkers(lineNumber, line, lineCache, syntaxRegex, syntaxOpen);
			if (markers.length === 0) {
				continue;
			}

			for (const marker of markers) {
				const start = line.from + marker.from;
				const end = line.from + marker.to;

				if (selectionRanges.some((sel) => sel.from === sel.to && sel.from >= start && sel.to <= end)) {
					continue;
				}

				const value = resolveValue(marker.key);
				if (value === null) {
					continue;
				}

				builder.add(
					start,
					end,
					Decoration.replace({
						widget: new MetadataWidget(value, file.path, plugin, styleKey),
						inclusive: false,
					})
				);
			}
		}
	}

	return builder.finish();
}

function getLineMarkers(
	lineNumber: number,
	line: {from: number; text: string},
	lineCache: Map<number, LineMarkers>,
	syntaxRegex: RegExp,
	syntaxOpen: string
): LineMarker[] {
	const cached = lineCache.get(lineNumber);
	if (cached && cached.text === line.text) {
		return cached.markers;
	}

	const markers: LineMarker[] = [];
	if (line.text.includes(syntaxOpen)) {
		syntaxRegex.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = syntaxRegex.exec(line.text)) !== null) {
			const key = (match[1] ?? "").trim();
			if (!key) {
				continue;
			}

			const start = match.index;
			const end = start + match[0].length;
			markers.push({from: start, to: end, key});
		}
	}

	lineCache.set(lineNumber, {text: line.text, markers});
	return markers;
}

function pruneLineCache(lineCache: Map<number, LineMarkers>, maxLine: number): void {
	for (const lineNumber of lineCache.keys()) {
		if (lineNumber > maxLine) {
			lineCache.delete(lineNumber);
		}
	}
}

function shouldRebuildForChanges(update: ViewUpdate, plugin: EmbedMetadataPlugin): boolean {
	const syntaxOpen = getSyntaxOpen(plugin.settings.syntaxStyle);
	const syntaxRegex = getSyntaxRegex(plugin.settings.syntaxStyle);
	const nextDoc = update.state.doc;
	const prevDoc = update.startState.doc;
	const prevFrontmatter = getFrontmatterRange(prevDoc);
	const nextFrontmatter = getFrontmatterRange(nextDoc);
	let needsRebuild = false;

	update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
		if (needsRebuild) {
			return;
		}

		if (prevFrontmatter && rangesOverlap(fromA, toA, prevFrontmatter.from, prevFrontmatter.to)) {
			needsRebuild = true;
			return;
		}

		if (nextFrontmatter && rangesOverlap(fromB, toB, nextFrontmatter.from, nextFrontmatter.to)) {
			needsRebuild = true;
			return;
		}

		if (changeTouchesMarker(prevDoc, fromA, toA, syntaxRegex, syntaxOpen)) {
			needsRebuild = true;
			return;
		}

		if (changeTouchesMarker(nextDoc, fromB, toB, syntaxRegex, syntaxOpen)) {
			needsRebuild = true;
		}
	});

	return needsRebuild;
}

function changeTouchesMarker(
	doc: Text,
	from: number,
	to: number,
	syntaxRegex: RegExp,
	syntaxOpen: string
): boolean {
	const safeTo = Math.max(to - 1, from);
	const startLine = doc.lineAt(from).number;
	const endLine = doc.lineAt(safeTo).number;

	for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
		const line = doc.line(lineNumber);
		if (!line.text.includes(syntaxOpen)) {
			continue;
		}

		syntaxRegex.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = syntaxRegex.exec(line.text)) !== null) {
			const start = line.from + match.index;
			const end = start + match[0].length;
			if (rangesOverlap(from, to, start, end)) {
				return true;
			}
		}
	}

	return false;
}

function rangesOverlap(from: number, to: number, start: number, end: number): boolean {
	if (from === to) {
		return from >= start && from <= end;
	}
	return start < to && end > from;
}

function getFrontmatterRange(doc: Text): {from: number; to: number} | null {
	if (doc.lines === 0) {
		return null;
	}

	const firstLine = doc.line(1);
	if (!/^---\s*$/.test(firstLine.text)) {
		return null;
	}

	for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
		const line = doc.line(lineNumber);
		if (/^(---|\.\.\.)\s*$/.test(line.text)) {
			return {from: firstLine.from, to: line.to};
		}
	}

	return null;
}

function getCursorMarkerKey(view: EditorView, plugin: EmbedMetadataPlugin): string {
	const syntaxOpen = getSyntaxOpen(plugin.settings.syntaxStyle);
	const syntaxRegex = getSyntaxRegex(plugin.settings.syntaxStyle);
	const markerKeys: string[] = [];

	for (const range of view.state.selection.ranges) {
		if (range.from !== range.to) {
			continue;
		}

		const pos = range.from;
		const line = view.state.doc.lineAt(pos);
		if (!line.text.includes(syntaxOpen)) {
			continue;
		}

		syntaxRegex.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = syntaxRegex.exec(line.text)) !== null) {
			const start = line.from + match.index;
			const end = start + match[0].length;
			if (pos >= start && pos <= end) {
				markerKeys.push(`${start}:${end}`);
				break;
			}
		}
	}

	if (markerKeys.length === 0) {
		return "";
	}

	markerKeys.sort();
	return markerKeys.join("|");
}

class MetadataWidget extends WidgetType {
	private readonly value: string;
	private readonly sourcePath: string;
	private readonly plugin: EmbedMetadataPlugin;
	private readonly styleKey: string;
	private readonly isEmpty: boolean;

	constructor(value: string, sourcePath: string, plugin: EmbedMetadataPlugin, styleKey: string) {
		super();
		this.value = value;
		this.sourcePath = sourcePath;
		this.plugin = plugin;
		this.styleKey = styleKey;
		this.isEmpty = value.length === 0;
	}

	eq(other: MetadataWidget): boolean {
		return this.value === other.value
			&& this.sourcePath === other.sourcePath
			&& this.styleKey === other.styleKey;
	}

	ignoreEvent(): boolean {
		return !this.isEmpty;
	}

	// Render the replacement widget node for a single syntax marker.
	toDOM(): HTMLElement {
		const span = document.createElement("span");
		renderInlineMarkdown(this.plugin.app, this.sourcePath, span, this.value, this.plugin);
		applyValueStyles(span, this.plugin.settings);
		if (this.isEmpty) {
			span.classList.add("embed-metadata-empty");
		}
		return span;
	}
}
