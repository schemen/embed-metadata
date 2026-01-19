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

type MarkdownStyle = {
	italic: boolean;
	bold: boolean;
	strike: boolean;
	highlight: boolean;
};

type FenceState = {
	inFence: boolean;
	fenceChar: string;
	fenceLen: number;
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

// Force a Live Preview refresh for all open editor views.
export function refreshAllLivePreview(): void {
	for (const instance of livePreviewInstances) {
		instance.requestRefresh();
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
		let forceFullScan = false;

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
			forceFullScan = true;
		}

		if (needsRebuild) {
			this.decorations = buildDecorations(update.view, this.plugin, this.lineCache, forceFullScan);
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
	lineCache: Map<number, LineMarkers>,
	forceFullScan = false
): DecorationSet {
	if (!view.state.field(editorLivePreviewField)) {
		return Decoration.none;
	}

	const info = view.state.field(editorInfoField);
	const file = info?.file;
	if (!file || !(file instanceof TFile)) {
		return Decoration.none;
	}

	const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
	if (!frontmatter && !plugin.settings.builtInKeysEnabled) {
		return Decoration.none;
	}

	const builder = new RangeSetBuilder<Decoration>();
	const selectionRanges = view.state.selection.ranges;
	const styleKey = getStyleKey(plugin.settings);
	const syntaxOpen = getSyntaxOpen(plugin.settings.syntaxStyle);
	const syntaxRegex = getSyntaxRegex(plugin.settings.syntaxStyle);
	const seenLines = new Set<number>();
	const resolveValue = createFrontmatterResolver(
		frontmatter ?? {},
		plugin.settings.caseInsensitiveKeys,
		file,
		plugin.settings.builtInKeysEnabled
	);

	const ranges = forceFullScan
		? [{from: 0, to: view.state.doc.length}]
		: view.visibleRanges;

	for (const range of ranges) {
		const startLine = view.state.doc.lineAt(range.from).number;
		const endLine = view.state.doc.lineAt(Math.max(range.to - 1, range.from)).number;
		const fenceState = getFenceStateBeforeLine(view.state.doc, startLine);

		for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
			const line = view.state.doc.line(lineNumber);
			const {lineInFence, isFenceLine} = updateFenceStateForLine(line.text, fenceState);
			if (seenLines.has(lineNumber)) {
				continue;
			}
			seenLines.add(lineNumber);

			const markers = getLineMarkers(lineNumber, line, lineCache, syntaxRegex, syntaxOpen);
			if (markers.length === 0) {
				continue;
			}

			const inlineCodeRanges = lineInFence || isFenceLine ? [] : getInlineCodeRanges(line.text);
			// Mask marker contents so underscores in keys don't confuse markdown emphasis parsing.
			const maskedText = maskMarkerText(line.text, markers);
			const emphasisRanges = lineInFence || isFenceLine
				? []
				: getEmphasisRanges(maskedText, inlineCodeRanges);
			const strikeRanges = lineInFence || isFenceLine
				? []
				: getDelimitedRanges(maskedText, "~~", inlineCodeRanges);
			const highlightRanges = lineInFence || isFenceLine
				? []
				: getDelimitedRanges(maskedText, "==", inlineCodeRanges);

			for (const marker of markers) {
				if (lineInFence || isFenceLine || isMarkerInInlineCode(marker, inlineCodeRanges)) {
					continue;
				}

				const start = line.from + marker.from;
				const end = line.from + marker.to;

				if (selectionRanges.some((sel) => sel.from === sel.to && sel.from >= start && sel.to <= end)) {
					continue;
				}

				const value = resolveValue(marker.key);
				if (value === null) {
					continue;
				}

				const markdownStyle = getMarkdownStyleForMarker(
					marker,
					emphasisRanges,
					strikeRanges,
					highlightRanges
				);
				builder.add(
					start,
					end,
					Decoration.replace({
						widget: new MetadataWidget(value, file.path, plugin, styleKey, markdownStyle),
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

function maskMarkerText(text: string, markers: LineMarker[]): string {
	if (markers.length === 0) {
		return text;
	}

	const chars = text.split("");
	for (const marker of markers) {
		const start = Math.max(0, marker.from);
		const end = Math.min(chars.length, marker.to);
		for (let i = start; i < end; i += 1) {
			chars[i] = "x";
		}
	}
	return chars.join("");
}

function getFenceStateBeforeLine(doc: Text, lineNumber: number): FenceState {
	const state: FenceState = {inFence: false, fenceChar: "", fenceLen: 0};
	for (let line = 1; line < lineNumber; line += 1) {
		updateFenceStateForLine(doc.line(line).text, state);
	}
	return state;
}

function updateFenceStateForLine(
	lineText: string,
	state: FenceState
): {lineInFence: boolean; isFenceLine: boolean} {
	const wasInFence = state.inFence;
	const match = lineText.match(/^\s*([`~]{3,})/);
	let isFenceLine = false;

	if (match) {
		isFenceLine = true;
		const marker = match[1] ?? "";
		const fenceChar = marker[0] ?? "";
		const fenceLen = marker.length;

		if (!state.inFence) {
			state.inFence = true;
			state.fenceChar = fenceChar;
			state.fenceLen = fenceLen;
		} else if (fenceChar && fenceChar === state.fenceChar && fenceLen >= state.fenceLen) {
			state.inFence = false;
			state.fenceChar = "";
			state.fenceLen = 0;
		}
	}

	return {lineInFence: wasInFence, isFenceLine};
}

type InlineCodeRange = {from: number; to: number};
type EmphasisRange = {from: number; to: number; italic: boolean; bold: boolean};
type DelimitedRange = {from: number; to: number};

function getInlineCodeRanges(text: string): InlineCodeRange[] {
	const ranges: InlineCodeRange[] = [];
	let i = 0;
	let openTicks: string | null = null;
	let openStart = 0;

	while (i < text.length) {
		if (text[i] !== "`") {
			i += 1;
			continue;
		}

		let j = i;
		while (j < text.length && text[j] === "`") {
			j += 1;
		}
		const ticks = text.slice(i, j);

		if (openTicks === null) {
			openTicks = ticks;
			openStart = i;
		} else if (ticks === openTicks) {
			ranges.push({from: openStart, to: j});
			openTicks = null;
		}

		i = j;
	}

	return ranges;
}

function isMarkerInInlineCode(marker: LineMarker, ranges: InlineCodeRange[]): boolean {
	for (const range of ranges) {
		if (rangesOverlap(marker.from, marker.to, range.from, range.to)) {
			return true;
		}
	}
	return false;
}

function getDelimitedRanges(
	text: string,
	delimiter: string,
	inlineCodeRanges: InlineCodeRange[]
): DelimitedRange[] {
	const ranges: DelimitedRange[] = [];
	let openStart: number | null = null;
	let i = 0;

	while (i <= text.length - delimiter.length) {
		const inlineRange = findInlineRangeAt(i, inlineCodeRanges);
		if (inlineRange) {
			i = inlineRange.to;
			continue;
		}

		if (text.slice(i, i + delimiter.length) !== delimiter) {
			i += 1;
			continue;
		}

		if (openStart === null) {
			openStart = i;
		} else {
			ranges.push({from: openStart + delimiter.length, to: i});
			openStart = null;
		}

		i += delimiter.length;
	}

	return ranges;
}

function getEmphasisRanges(text: string, inlineCodeRanges: InlineCodeRange[]): EmphasisRange[] {
	const ranges: EmphasisRange[] = [];
	const stack: {char: string; len: number; pos: number}[] = [];
	let i = 0;

	while (i < text.length) {
		const inlineRange = findInlineRangeAt(i, inlineCodeRanges);
		if (inlineRange) {
			i = inlineRange.to;
			continue;
		}

		const ch = text[i];
		if (ch !== "*" && ch !== "_") {
			i += 1;
			continue;
		}

		let j = i;
		while (j < text.length && text[j] === ch) {
			j += 1;
		}
		const len = Math.min(j - i, 3);
		const top = stack[stack.length - 1];

		if (top && top.char === ch && top.len === len) {
			const from = top.pos + top.len;
			const to = i;
			ranges.push({
				from,
				to,
				italic: len === 1 || len === 3,
				bold: len === 2 || len === 3,
			});
			stack.pop();
		} else {
			stack.push({char: ch, len, pos: i});
		}

		i = j;
	}

	return ranges;
}

function findInlineRangeAt(pos: number, ranges: InlineCodeRange[]): InlineCodeRange | null {
	for (const range of ranges) {
		if (pos >= range.from && pos < range.to) {
			return range;
		}
	}
	return null;
}

function getMarkdownStyleForMarker(
	marker: LineMarker,
	emphasisRanges: EmphasisRange[],
	strikeRanges: DelimitedRange[],
	highlightRanges: DelimitedRange[]
): MarkdownStyle {
	let italic = false;
	let bold = false;
	let strike = false;
	let highlight = false;

	for (const range of emphasisRanges) {
		if (rangesOverlap(marker.from, marker.to, range.from, range.to)) {
			italic = italic || range.italic;
			bold = bold || range.bold;
		}
	}

	for (const range of strikeRanges) {
		if (rangesOverlap(marker.from, marker.to, range.from, range.to)) {
			strike = true;
			break;
		}
	}

	for (const range of highlightRanges) {
		if (rangesOverlap(marker.from, marker.to, range.from, range.to)) {
			highlight = true;
			break;
		}
	}

	return {italic, bold, strike, highlight};
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
	private readonly markdownStyle: MarkdownStyle;
	private readonly isEmpty: boolean;

	constructor(
		value: string,
		sourcePath: string,
		plugin: EmbedMetadataPlugin,
		styleKey: string,
		markdownStyle: MarkdownStyle
	) {
		super();
		this.value = value;
		this.sourcePath = sourcePath;
		this.plugin = plugin;
		this.styleKey = styleKey;
		this.markdownStyle = markdownStyle;
		this.isEmpty = value.length === 0;
	}

	eq(other: MetadataWidget): boolean {
		return this.value === other.value
			&& this.sourcePath === other.sourcePath
			&& this.styleKey === other.styleKey
			&& this.markdownStyle.italic === other.markdownStyle.italic
			&& this.markdownStyle.bold === other.markdownStyle.bold
			&& this.markdownStyle.strike === other.markdownStyle.strike
			&& this.markdownStyle.highlight === other.markdownStyle.highlight;
	}

	ignoreEvent(): boolean {
		return !this.isEmpty;
	}

	// Render the replacement widget node for a single syntax marker.
	toDOM(): HTMLElement {
		const span = document.createElement("span");
		applyValueStyles(span, this.plugin.settings);
		let container = span;
		if (this.markdownStyle.highlight) {
			const mark = document.createElement("mark");
			mark.classList.add("cm-highlight");
			container.appendChild(mark);
			container = mark;
		}
		if (this.markdownStyle.strike) {
			const del = document.createElement("del");
			del.classList.add("cm-strikethrough");
			container.appendChild(del);
			container = del;
		}
		if (this.markdownStyle.bold) {
			const strong = document.createElement("strong");
			strong.classList.add("cm-strong");
			container.appendChild(strong);
			container = strong;
		}
		if (this.markdownStyle.italic) {
			const em = document.createElement("em");
			em.classList.add("cm-em");
			container.appendChild(em);
			container = em;
		}
		renderInlineMarkdown(this.plugin.app, this.sourcePath, container, this.value, this.plugin);
		if (this.isEmpty) {
			span.classList.add("embed-metadata-empty");
		}
		return span;
	}
}
