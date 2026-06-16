// Reading view renderer that replaces syntax markers in the preview DOM.
import {MarkdownView, TFile} from "obsidian";
import {
	createMetadataResolver,
	findMetadataMarkers,
	getSyntaxClose,
	getSyntaxOpen,
	metadataTargetCouldResolveTo,
	parseMetadataReference,
	type MetadataReference,
	type MetadataResolution,
	type MetadataResolver,
} from "./metadata-utils";
import {renderInlineMarkdown} from "./markdown-render";
import {EmbedMetadataPlugin} from "./settings";

const VALUE_CLASS = "embed-metadata-value";
const UNRESOLVED_CLASS = "embed-metadata-unresolved";

// What each span last rendered, so refreshes can skip unchanged values.
const lastRendered = new WeakMap<HTMLElement, string>();

// Render syntax markers in Reading view by post-processing the preview DOM.
// Returns a targeted refresh that updates only the spans affected by a change.
export function registerMetadataRenderer(plugin: EmbedMetadataPlugin): (changedFile: TFile) => void {
	plugin.registerMarkdownPostProcessor((el, ctx) => {
		// Runs for Reading view and for Live Preview rendered blocks (callouts,
		// embeds). Raw editable text is handled by the CodeMirror plugin and is
		// excluded below via the `.cm-line` filter, so the two never overlap.
		if (!ctx.sourcePath) {
			return;
		}

		const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!(file instanceof TFile)) {
			return;
		}

		const resolver = createMetadataResolver(
			plugin.app,
			file,
			plugin.settings.caseInsensitiveKeys,
			plugin.settings.builtInKeysEnabled
		);
		const doc = el.ownerDocument;
		const syntaxOpen = getSyntaxOpen(plugin.settings.syntaxStyle);
		const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				if (!node.nodeValue || !node.nodeValue.includes(syntaxOpen)) {
					return NodeFilter.FILTER_SKIP;
				}

				const parent = node.parentElement;
				if (!parent || parent.closest(`.cm-line, code, pre, .cm-inline-code, .cm-hmd-internal-code, .${VALUE_CLASS}, .${UNRESOLVED_CLASS}`)) {
					return NodeFilter.FILTER_REJECT;
				}

				return NodeFilter.FILTER_ACCEPT;
			},
		});

		const textNodes: Text[] = [];
		let currentNode = walker.nextNode();
		while (currentNode) {
			textNodes.push(currentNode as Text);
			currentNode = walker.nextNode();
		}

		for (const textNode of textNodes) {
			replaceSyntaxInTextNode(textNode, resolver, doc, syntaxOpen, file.path, plugin);
		}
	});

	return (changedFile: TFile) => {
		refreshRenderedValues(plugin, changedFile);
	};
}

// Replace inline syntax markers in a single text node with rendered spans.
// Unresolved markers become placeholder spans too, so they can resolve in
// place later without a full preview rerender.
function replaceSyntaxInTextNode(
	textNode: Text,
	resolver: MetadataResolver,
	doc: Document,
	syntaxOpen: string,
	sourcePath: string,
	plugin: EmbedMetadataPlugin
): void {
	const text = textNode.nodeValue ?? "";
	if (!text.includes(syntaxOpen)) {
		return;
	}

	const markers = findMetadataMarkers(text, plugin.settings.syntaxStyle);
	if (markers.length === 0) {
		return;
	}

	let lastIndex = 0;
	const fragment = doc.createDocumentFragment();

	for (const marker of markers) {
		const before = text.slice(lastIndex, marker.from);
		if (before) {
			fragment.append(before);
		}

		const span = doc.createElement("span");
		span.dataset.embedMetadataKey = marker.key;
		span.dataset.embedMetadataReference = marker.raw;
		span.dataset.embedMetadataMarker = marker.marker;
		span.dataset.embedMetadataSourcePath = sourcePath;
		applyResolution(span, resolver.resolve(marker), marker.marker, plugin);
		fragment.append(span);

		lastIndex = marker.to;
	}

	const after = text.slice(lastIndex);
	if (after) {
		fragment.append(after);
	}

	textNode.replaceWith(fragment);
}

// Render a resolution into a span, skipping the DOM write when nothing changed.
function applyResolution(
	span: HTMLElement,
	resolution: MetadataResolution,
	markerText: string,
	plugin: EmbedMetadataPlugin
): void {
	if (!resolution.resolved) {
		span.className = UNRESOLVED_CLASS;
		if (resolution.targetFile) {
			span.dataset.embedMetadataTargetPath = resolution.targetFile.path;
		} else {
			delete span.dataset.embedMetadataTargetPath;
		}
		if (lastRendered.get(span) !== markerText) {
			lastRendered.set(span, markerText);
			span.textContent = markerText;
		}
		return;
	}

	span.className = VALUE_CLASS;
	span.dataset.embedMetadataTargetPath = resolution.targetFile.path;
	// The newline keeps render keys distinct from single-line marker text.
	const renderKey = `${resolution.targetFile.path}\n${resolution.value}`;
	if (lastRendered.get(span) === renderKey) {
		return;
	}
	lastRendered.set(span, renderKey);
	renderInlineMarkdown(plugin.app, resolution.targetFile.path, span, resolution.value, plugin);
}

// Re-resolve only the spans whose value can be affected by the changed file.
function refreshRenderedValues(plugin: EmbedMetadataPlugin, changedFile: TFile): void {
	const syntaxOpen = getSyntaxOpen(plugin.settings.syntaxStyle);
	const syntaxClose = getSyntaxClose(plugin.settings.syntaxStyle);
	const leaves = plugin.app.workspace.getLeavesOfType("markdown");

	for (const leaf of leaves) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) {
			continue;
		}
		const viewFile = view.file;
		if (!(viewFile instanceof TFile)) {
			continue;
		}

		// One resolver per source path: embedded notes resolve relative to themselves.
		const resolvers = new Map<string, MetadataResolver>();
		const spans = view.containerEl.querySelectorAll<HTMLElement>("[data-embed-metadata-reference]");
		for (const span of Array.from(spans)) {
			const raw = span.dataset.embedMetadataReference;
			if (raw === undefined) {
				continue;
			}
			const reference = parseMetadataReference(raw);
			if (!reference || !spanAffectedBy(span, reference, changedFile)) {
				continue;
			}

			const sourcePath = span.dataset.embedMetadataSourcePath ?? viewFile.path;
			let resolver = resolvers.get(sourcePath);
			if (!resolver) {
				const sourceFile = plugin.app.vault.getAbstractFileByPath(sourcePath);
				resolver = createMetadataResolver(
					plugin.app,
					sourceFile instanceof TFile ? sourceFile : viewFile,
					plugin.settings.caseInsensitiveKeys,
					plugin.settings.builtInKeysEnabled
				);
				resolvers.set(sourcePath, resolver);
			}

			const markerText = span.dataset.embedMetadataMarker ?? `${syntaxOpen}${raw}${syntaxClose}`;
			applyResolution(span, resolver.resolve(reference), markerText, plugin);
		}
	}
}

// A span is affected when the change hits its resolved target, or when the
// changed file could satisfy a target that previously failed to resolve.
function spanAffectedBy(span: HTMLElement, reference: MetadataReference, file: TFile): boolean {
	const targetPath = span.dataset.embedMetadataTargetPath;
	if (targetPath !== undefined) {
		return targetPath === file.path;
	}
	return reference.target !== null && metadataTargetCouldResolveTo(reference.target, file);
}
