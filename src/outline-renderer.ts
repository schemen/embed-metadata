import {TFile, WorkspaceLeaf} from "obsidian";
import {createMetadataResolver, findMetadataMarkers, getSyntaxOpen} from "./metadata-utils";
import {renderInlineMarkdownText} from "./markdown-render";
import {EmbedMetadataPlugin} from "./settings";

const OUTLINE_VIEW_TYPE = "outline";
const OUTLINE_ITEM_SELECTOR = ".tree-item-inner";

export function registerOutlineRenderer(plugin: EmbedMetadataPlugin): () => void {
	let pending = false;
	let timerId: number | null = null;
	let lastRenderOutline = plugin.settings.renderOutline;

	const refreshOutlineViews = () => {
		const renderOutline = plugin.settings.renderOutline;
		if (!renderOutline && !lastRenderOutline) {
			return;
		}

		const leaves = plugin.app.workspace.getLeavesOfType(OUTLINE_VIEW_TYPE);
		for (const leaf of leaves) {
			if (renderOutline) {
				updateOutlineView(plugin, leaf);
			} else {
				resetOutlineView(leaf);
			}
		}

		lastRenderOutline = renderOutline;
	};

	const scheduleRefresh = () => {
		if (pending) {
			return;
		}
		pending = true;
		timerId = window.setTimeout(() => {
			pending = false;
			timerId = null;
			refreshOutlineViews();
		}, 50);
	};

	const cancelScheduled = () => {
		if (timerId !== null) {
			window.clearTimeout(timerId);
			timerId = null;
			pending = false;
		}
	};

	plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", scheduleRefresh));
	plugin.registerEvent(plugin.app.workspace.on("layout-change", scheduleRefresh));
	plugin.registerEvent(plugin.app.metadataCache.on("changed", scheduleRefresh));
	plugin.register(() => cancelScheduled());

	scheduleRefresh();
	return scheduleRefresh;
}

function updateOutlineView(plugin: EmbedMetadataPlugin, leaf: WorkspaceLeaf): void {
	const view = leaf.view as {containerEl?: HTMLElement; file?: TFile; getFile?: () => TFile | null};
	const container = view.containerEl;
	if (!container) {
		return;
	}

	const file = view.file ?? view.getFile?.();
	if (!(file instanceof TFile)) {
		resetOutlineView(leaf);
		return;
	}

	const resolver = createMetadataResolver(
		plugin.app,
		file,
		plugin.settings.caseInsensitiveKeys,
		plugin.settings.builtInKeysEnabled
	);
	const syntaxOpen = getSyntaxOpen(plugin.settings.syntaxStyle);
	const items = Array.from(container.querySelectorAll<HTMLElement>(OUTLINE_ITEM_SELECTOR));

	for (const item of items) {
		const currentText = item.textContent ?? "";
		const attributeRaw = getOutlineItemRaw(item);
		let raw = item.dataset.embedMetadataRaw ?? attributeRaw ?? currentText;

		if (!item.dataset.embedMetadataRaw && raw) {
			item.dataset.embedMetadataRaw = raw;
		} else if (attributeRaw && attributeRaw !== raw) {
			raw = attributeRaw;
			item.dataset.embedMetadataRaw = raw;
		}

		let next = raw;
		if (raw.includes(syntaxOpen)) {
			const markers = findMetadataMarkers(raw, plugin.settings.syntaxStyle);
			if (markers.length > 0) {
				let lastIndex = 0;
				const parts: string[] = [];
				for (const marker of markers) {
					parts.push(raw.slice(lastIndex, marker.from));
					const result = resolver.resolve(marker);
					parts.push(result.resolved ? result.value : marker.marker);
					lastIndex = marker.to;
				}
				parts.push(raw.slice(lastIndex));
				next = parts.join("");
			}
		}

		const previous = item.dataset.embedMetadataRendered ?? "";
		const renderedText = item.dataset.embedMetadataRenderedText ?? "";
		if (previous === next && renderedText === (item.textContent ?? "")) {
			continue;
		}

		item.dataset.embedMetadataRendered = next;
		renderInlineMarkdownText(plugin.app, file.path, item, next, plugin, (text) => {
			item.dataset.embedMetadataRenderedText = text;
		});

	}
}

function resetOutlineView(leaf: WorkspaceLeaf): void {
	const view = leaf.view as {containerEl?: HTMLElement};
	const container = view.containerEl;
	if (!container) {
		return;
	}

	const items = Array.from(container.querySelectorAll<HTMLElement>("[data-embed-metadata-raw]"));
	for (const item of items) {
		const raw = item.dataset.embedMetadataRaw;
		if (raw !== undefined) {
			item.textContent = raw;
		}
		delete item.dataset.embedMetadataRaw;
		delete item.dataset.embedMetadataRendered;
		delete item.dataset.embedMetadataRenderedText;
	}
}

function getOutlineItemRaw(item: HTMLElement): string | null {
	return item.getAttribute("data-heading")
		?? item.getAttribute("aria-label")
		?? item.getAttribute("title");
}
