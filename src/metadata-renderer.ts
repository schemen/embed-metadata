// Reading view renderer that replaces syntax markers in the preview DOM.
import {MarkdownView, TFile} from "obsidian";
import {
	createFrontmatterResolver,
	getSyntaxClose,
	getSyntaxOpen,
	getSyntaxRegex,
} from "./metadata-utils";
import {renderInlineMarkdown} from "./markdown-render";
import {EmbedMetadataPlugin} from "./settings";

// Render syntax markers in Reading view by post-processing the preview DOM.
export function registerMetadataRenderer(plugin: EmbedMetadataPlugin) {
	plugin.registerMarkdownPostProcessor((el, ctx) => {
		if (el.closest(".markdown-source-view.mod-cm6") || el.closest(".cm-editor")) {
			return;
		}
		if (!ctx.sourcePath) {
			return;
		}

		const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!(file instanceof TFile)) {
			return;
		}

		const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) {
			return;
		}

		const resolveValue = createFrontmatterResolver(frontmatter, plugin.settings.caseInsensitiveKeys);
		const doc = el.ownerDocument;
		const syntaxOpen = getSyntaxOpen(plugin.settings.syntaxStyle);
		const syntaxRegex = getSyntaxRegex(plugin.settings.syntaxStyle);
		const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				if (!node.nodeValue || !node.nodeValue.includes(syntaxOpen)) {
					return NodeFilter.FILTER_SKIP;
				}

				const parent = node.parentElement;
				if (!parent || parent.closest("code, pre, .cm-inline-code, .cm-hmd-internal-code, .embed-metadata-value")) {
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
			replaceSyntaxInTextNode(
				textNode,
				(key) => resolveValue(key),
				doc,
				syntaxRegex,
				syntaxOpen,
				ctx.sourcePath ?? "",
				plugin
			);
		}
	});

	plugin.registerEvent(plugin.app.metadataCache.on("changed", (file) => {
		refreshRenderedValuesForFile(plugin, file);
	}));
}

// Replace inline syntax markers in a single text node with rendered spans.
function replaceSyntaxInTextNode(
	textNode: Text,
	resolveValue: (key: string) => string | null,
	doc: Document,
	syntaxRegex: RegExp,
	syntaxOpen: string,
	sourcePath: string,
	plugin: EmbedMetadataPlugin
): void {
	const text = textNode.nodeValue ?? "";
	if (!text.includes(syntaxOpen)) {
		return;
	}

	syntaxRegex.lastIndex = 0;
	let match: RegExpExecArray | null;
	let lastIndex = 0;
	const fragment = doc.createDocumentFragment();
	let didReplace = false;

	while ((match = syntaxRegex.exec(text)) !== null) {
		const before = text.slice(lastIndex, match.index);
		if (before) {
			fragment.append(before);
		}

		const key = (match[1] ?? "").trim();
		const value = resolveValue(key);
		if (value === null) {
			fragment.append(match[0]);
		} else {
			const span = doc.createElement("span");
			span.className = "embed-metadata-value";
			span.dataset.embedMetadataKey = key;
			renderInlineMarkdown(plugin.app, sourcePath, span, value, plugin);
			fragment.append(span);
			didReplace = true;
		}

		lastIndex = match.index + match[0].length;
	}

	const after = text.slice(lastIndex);
	if (after) {
		fragment.append(after);
	}

	if (didReplace) {
		textNode.replaceWith(fragment);
	}
}

function refreshRenderedValuesForFile(plugin: EmbedMetadataPlugin, file: TFile): void {
	const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
	if (!frontmatter) {
		return;
	}

	const resolveValue = createFrontmatterResolver(frontmatter, plugin.settings.caseInsensitiveKeys);
	const syntaxOpen = getSyntaxOpen(plugin.settings.syntaxStyle);
	const syntaxClose = getSyntaxClose(plugin.settings.syntaxStyle);
	const leaves = plugin.app.workspace.getLeavesOfType("markdown");

	for (const leaf of leaves) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) {
			continue;
		}
		if (view.file?.path !== file.path) {
			continue;
		}

		const rendered = view.containerEl.querySelectorAll<HTMLElement>(".embed-metadata-value[data-embed-metadata-key]");
		for (const el of Array.from(rendered)) {
			const key = el.dataset.embedMetadataKey;
			if (!key) {
				continue;
			}
			const value = resolveValue(key);
			if (value === null) {
				el.textContent = `${syntaxOpen}${key}${syntaxClose}`;
				continue;
			}
			renderInlineMarkdown(plugin.app, file.path, el, value, plugin);
		}
	}
}
