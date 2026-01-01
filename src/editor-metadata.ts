// Live Preview renderer using CodeMirror decorations
import {Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType} from "@codemirror/view";
import {RangeSetBuilder} from "@codemirror/state";
import {editorInfoField, editorLivePreviewField, TFile} from "obsidian";
import {getSyntaxRegex, resolveFrontmatterString} from "./metadata-utils";
import {renderInlineMarkdown} from "./markdown-render";
import {applyValueStyles} from "./metadata-style";
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
	const syntaxRegex = getSyntaxRegex(plugin.settings.syntaxStyle);

	for (const range of view.visibleRanges) {
		const text = view.state.doc.sliceString(range.from, range.to);
		syntaxRegex.lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = syntaxRegex.exec(text)) !== null) {
			const start = range.from + match.index;
			const end = start + match[0].length;

			if (selectionRanges.some((sel) => sel.from <= end && sel.to >= start)) {
				continue;
			}

			if (selectionRanges.some((sel) => {
				const head = sel.head ?? sel.from;
				return head >= start && head <= end;
			})) {
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
					widget: new MetadataWidget(value, file.path, plugin),
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

	constructor(value: string, sourcePath: string, plugin: EmbedMetadataPlugin) {
		super();
		this.value = value;
		this.sourcePath = sourcePath;
		this.plugin = plugin;
	}

	// Render the replacement widget node for a single syntax marker.
	toDOM(): HTMLElement {
		const span = document.createElement("span");
		renderInlineMarkdown(this.plugin.app, this.sourcePath, span, this.value, this.plugin);
		applyValueStyles(span, this.plugin.settings);
		return span;
	}
}
