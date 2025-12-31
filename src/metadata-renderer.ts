// Reading view renderer that replaces syntax markers in the preview DOM.
import {TFile} from "obsidian";
import {getSyntaxOpen, getSyntaxRegex, resolveFrontmatterString} from "./metadata-utils";
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
				(key) => resolveFrontmatterString(frontmatter, key),
				doc,
				syntaxRegex,
				syntaxOpen,
				ctx.sourcePath ?? "",
				plugin
			);
		}
	});
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
