// Utils for all other modules
import {MarkdownView, Plugin, TFile} from "obsidian";

// Syntax parsing and frontmatter resolution utilities.
export type SyntaxStyle = "brackets" | "doubleBraces";
export type FrontmatterResolver = (keyPath: string) => string | null;

// Get the syntax opener for the selected style.
export function getSyntaxOpen(style: SyntaxStyle): string {
	return style === "doubleBraces" ? "{{" : "[%";
}

// Get the syntax closer for the selected style.
export function getSyntaxClose(style: SyntaxStyle): string {
	return style === "doubleBraces" ? "}}" : "]";
}

// Regex for matching full syntax markers, including the key.
export function getSyntaxRegex(style: SyntaxStyle): RegExp {
	return style === "doubleBraces"
		? /\{\{([^{}]+)\}\}/g
		: /\[%([^[\]%]+)\]/g;
}

// Regex for triggering autocomplete from the current cursor prefix.
export function getSyntaxTriggerRegex(style: SyntaxStyle): RegExp {
	return style === "doubleBraces"
		? /\{\{([A-Za-z0-9_.-]*)$/
		: /\[%([A-Za-z0-9_.-]*)$/;
}

// Refresh markdown views after metadata changes.
export type MarkdownRefresher = {
	refreshAll: () => void;
	refreshForFile: (file: TFile) => void;
};

export function registerMarkdownRefresh(
	plugin: Plugin,
	onLivePreviewRefresh?: (file: TFile) => void
): MarkdownRefresher {
	const refreshForFile = (file: TFile) => {
		const leaves = plugin.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) {
				continue;
			}
			if (view.file?.path !== file.path) {
				continue;
			}

			view.previewMode?.rerender(true);

			const editor = view.editor;
			if (editor) {
				const cursor = editor.getCursor();
				editor.setCursor(cursor);
				editor.refresh();
			}
		}
	};

	const refreshAll = () => {
		const leaves = plugin.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) {
				continue;
			}

			view.previewMode?.rerender(true);

			const editor = view.editor;
			if (editor) {
				const cursor = editor.getCursor();
				editor.setCursor(cursor);
				editor.refresh();
			}
		}
	};

	plugin.registerEvent(plugin.app.metadataCache.on("changed", (file) => {
		refreshForFile(file);
		onLivePreviewRefresh?.(file);
	}));

	return {refreshAll, refreshForFile};
}

// Resolve a dot-path in frontmatter and stringify the result.
// We'll keep it in for proper frontmatter BUT Obsidian Properties do not
// support nested values (yet?).
export function resolveFrontmatterString(
	frontmatter: Record<string, unknown>,
	keyPath: string,
	caseInsensitive = false,
	keyMapCache?: WeakMap<object, Map<string, string>>
): string | null {
	const value = resolveFrontmatterValue(frontmatter, keyPath, caseInsensitive, keyMapCache);
	if (value === undefined) {
		return null;
	}
	if (value === null) {
		return "";
	}
	return formatFrontmatterValue(value);
}

// Create a cached resolver for frontmatter lookups within a render pass.
export function createFrontmatterResolver(
	frontmatter: Record<string, unknown>,
	caseInsensitive: boolean
): FrontmatterResolver {
	let valueCache: Map<string, string | null> | null = null;
	let keyMapCache: WeakMap<object, Map<string, string>> | undefined;

	return (keyPath: string) => {
		if (valueCache && valueCache.has(keyPath)) {
			return valueCache.get(keyPath) ?? null;
		}

		if (!valueCache) {
			valueCache = new Map();
		}
		if (caseInsensitive && !keyMapCache) {
			keyMapCache = new WeakMap();
		}

		const value = resolveFrontmatterString(frontmatter, keyPath, caseInsensitive, keyMapCache);
		valueCache.set(keyPath, value);
		return value;
	};
}

// Collect flat and nested frontmatter keys for suggestions.
export function collectFrontmatterKeys(frontmatter: Record<string, unknown>): string[] {
	const keys: string[] = [];

	const walk = (value: unknown, prefix: string) => {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return;
		}

		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			const path = prefix ? `${prefix}.${key}` : key;
			keys.push(path);
			walk(child, path);
		}
	};

	walk(frontmatter, "");
	return keys;
}

// Walk the frontmatter object to resolve a dot-path.
function resolveFrontmatterValue(
	frontmatter: Record<string, unknown>,
	keyPath: string,
	caseInsensitive: boolean,
	keyMapCache?: WeakMap<object, Map<string, string>>
): unknown {
	const parts = keyPath
		.split(".")
		.map((part) => part.trim())
		.filter(Boolean);
	let current: unknown = frontmatter;

	for (const part of parts) {
		if (!current || typeof current !== "object" || Array.isArray(current)) {
			return undefined;
		}

		const record = current as Record<string, unknown>;
		if (part in record) {
			current = record[part];
			continue;
		}

		if (caseInsensitive) {
			const matched = getCaseInsensitiveKey(record, part, keyMapCache);
			if (matched) {
				current = record[matched];
				continue;
			}
		}

		return undefined;
	}

	return current;
}

function getCaseInsensitiveKey(
	record: Record<string, unknown>,
	part: string,
	keyMapCache?: WeakMap<object, Map<string, string>>
): string | null {
	const lowered = part.toLowerCase();
	if (!keyMapCache) {
		return Object.keys(record).find((key) => key.toLowerCase() === lowered) ?? null;
	}

	let keyMap = keyMapCache.get(record);
	if (!keyMap) {
		keyMap = new Map();
		for (const key of Object.keys(record)) {
			keyMap.set(key.toLowerCase(), key);
		}
		keyMapCache.set(record, keyMap);
	}

	return keyMap.get(lowered) ?? null;
}

// Convert frontmatter values into a readable inline string.
function formatFrontmatterValue(value: unknown): string {
	if (Array.isArray(value)) {
		return value.map((item) => formatFrontmatterValue(item)).filter(Boolean).join(", ");
	}

	if (value && typeof value === "object") {
		return JSON.stringify(value);
	}

	return String(value);
}
