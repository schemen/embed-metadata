// Live Preview renderer using CodeMirror decorations
import {Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType} from "@codemirror/view";
import {RangeSetBuilder} from "@codemirror/state";
import {editorInfoField, editorLivePreviewField, TFile} from "obsidian";
import {getSyntaxOpen, getSyntaxRegex, resolveFrontmatterString} from "./metadata-utils";
import {renderInlineMarkdown} from "./markdown-render";
import {applyValueStyles, getStyleKey} from "./metadata-style";
import {EmbedMetadataPlugin} from "./settings";

// Build the Live Preview view plugin that renders syntax markers in the editor.
export function createEditorExtension(plugin: EmbedMetadataPlugin) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, plugin);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = buildDecorations(update.view, plugin);
				}
			}
		},
		{
			decorations: (value) => value.decorations,
		}
	);
}

// Scan visible ranges and replace syntax markers with widgets (skipping active edits).
function buildDecorations(view: EditorView, plugin: EmbedMetadataPlugin): DecorationSet {
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

	for (const range of view.visibleRanges) {
		const text = view.state.doc.sliceString(range.from, range.to);
		if (!text.includes(syntaxOpen)) {
			continue;
		}
		syntaxRegex.lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = syntaxRegex.exec(text)) !== null) {
			const start = range.from + match.index;
			const end = start + match[0].length;

			if (selectionRanges.some((sel) => sel.from === sel.to && sel.from >= start && sel.to <= end)) {
				continue;
			}

			const key = (match[1] ?? "").trim();
			if (!key) {
				continue;
			}

			const value = resolveFrontmatterString(
				frontmatter,
				key,
				plugin.settings.caseInsensitiveKeys
			);
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

	return builder.finish();
}

class MetadataWidget extends WidgetType {
	private readonly value: string;
	private readonly sourcePath: string;
	private readonly plugin: EmbedMetadataPlugin;
	private readonly styleKey: string;

	constructor(value: string, sourcePath: string, plugin: EmbedMetadataPlugin, styleKey: string) {
		super();
		this.value = value;
		this.sourcePath = sourcePath;
		this.plugin = plugin;
		this.styleKey = styleKey;
	}

	eq(other: MetadataWidget): boolean {
		return this.value === other.value
			&& this.sourcePath === other.sourcePath
			&& this.styleKey === other.styleKey;
	}

	// Render the replacement widget node for a single syntax marker.
	toDOM(): HTMLElement {
		const span = document.createElement("span");
		renderInlineMarkdown(this.plugin.app, this.sourcePath, span, this.value, this.plugin);
		applyValueStyles(span, this.plugin.settings);
		return span;
	}
}
