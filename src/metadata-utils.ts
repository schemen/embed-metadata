// Utils for all other modules
import {App, MarkdownView, normalizePath, Plugin, TFile} from "obsidian";

// Syntax parsing and frontmatter resolution utilities.
export type SyntaxStyle = "brackets" | "doubleBraces";
export type FrontmatterResolver = (keyPath: string) => string | null;
export type MetadataResolver = {
	resolve: (reference: MetadataReference) => MetadataResolution;
	dependencies: MetadataDependencies;
};
export type MetadataResolution =
	| {resolved: true; value: string; targetFile: TFile}
	| {resolved: false; targetFile: TFile | null};
// Files that resolved values depend on, so views can refresh only when affected.
// Unresolved linkpaths are kept so a view can refresh once a matching note appears.
export type MetadataDependencies = {
	paths: Set<string>;
	unresolvedLinkpaths: Set<string>;
};
export type MetadataTarget =
	| {type: "wiki"; linktext: string}
	| {type: "markdown"; destination: string};
export type MetadataReference = {
	raw: string;
	key: string;
	target: MetadataTarget | null;
};
export type MetadataMarker = MetadataReference & {
	from: number;
	to: number;
	marker: string;
};
export type BuiltInKey =
	| "filename"
	| "basename"
	| "extension"
	| "path"
	| "folder"
	| "link"
	| "ctime"
	| "mtime";

const BUILT_IN_KEYS: BuiltInKey[] = [
	"filename",
	"basename",
	"extension",
	"path",
	"folder",
	"link",
	"ctime",
	"mtime",
];

// Get the syntax opener for the selected style.
export function getSyntaxOpen(style: SyntaxStyle): string {
	return style === "doubleBraces" ? "{{" : "[%";
}

// Get the syntax closer for the selected style.
export function getSyntaxClose(style: SyntaxStyle): string {
	return style === "doubleBraces" ? "}}" : "]";
}

// Regex for triggering autocomplete from the current cursor prefix.
export function getSyntaxTriggerRegex(style: SyntaxStyle): RegExp {
	return style === "doubleBraces"
		? /\{\{([A-Za-z0-9_.-]*)$/
		: /\[%([A-Za-z0-9_.-]*)$/;
}

export function findMetadataMarkers(text: string, style: SyntaxStyle): MetadataMarker[] {
	const markers: MetadataMarker[] = [];
	const open = getSyntaxOpen(style);
	const close = getSyntaxClose(style);
	let offset = 0;

	while (offset < text.length) {
		const start = text.indexOf(open, offset);
		if (start === -1) {
			break;
		}

		const end = findMarkerEnd(text, start, style);
		if (end === -1) {
			offset = start + open.length;
			continue;
		}

		// Keep the untrimmed inner text as `raw` so migrations round-trip spacing.
		const inner = text.slice(start + open.length, end - close.length);
		const reference = parseMetadataReference(inner);
		if (reference) {
			markers.push({
				key: reference.key,
				target: reference.target,
				raw: inner,
				from: start,
				to: end,
				marker: text.slice(start, end),
			});
		}

		offset = end;
	}

	return markers;
}

export function parseMetadataReference(raw: string, allowEmptyKey = false): MetadataReference | null {
	const reference = raw.trim();
	if (!reference) {
		return null;
	}

	const remote = parseRemoteReference(reference, allowEmptyKey);
	if (remote) {
		return remote;
	}

	return {
		raw: reference,
		key: reference,
		target: null,
	};
}

export function createMetadataResolver(
	app: App,
	sourceFile: TFile,
	caseInsensitive: boolean,
	builtInKeysEnabled: boolean
): MetadataResolver {
	const resolverCache = new Map<string, FrontmatterResolver>();
	const dependencies = createMetadataDependencies();

	const resolve = (reference: MetadataReference): MetadataResolution => {
		const targetFile = reference.target
			? resolveMetadataTargetFile(app, sourceFile.path, reference.target)
			: sourceFile;
		if (!targetFile) {
			if (reference.target) {
				dependencies.unresolvedLinkpaths.add(getTargetLinkpath(reference.target));
			}
			return {resolved: false, targetFile: null};
		}

		// The dependency holds even when the key is missing: adding the key to
		// the target's frontmatter must refresh this reference.
		dependencies.paths.add(targetFile.path);

		let resolveValue = resolverCache.get(targetFile.path);
		if (!resolveValue) {
			const frontmatter = app.metadataCache.getFileCache(targetFile)?.frontmatter ?? {};
			resolveValue = createFrontmatterResolver(
				frontmatter,
				caseInsensitive,
				targetFile,
				builtInKeysEnabled
			);
			resolverCache.set(targetFile.path, resolveValue);
		}

		const value = resolveValue(reference.key);
		if (value === null) {
			return {resolved: false, targetFile};
		}

		return {resolved: true, value, targetFile};
	};

	return {resolve, dependencies};
}

export function createMetadataDependencies(): MetadataDependencies {
	return {paths: new Set(), unresolvedLinkpaths: new Set()};
}

// Check whether a metadata change in `file` can affect values resolved with these dependencies.
export function metadataDependenciesInclude(dependencies: MetadataDependencies, file: TFile): boolean {
	if (dependencies.paths.has(file.path)) {
		return true;
	}

	for (const linkpath of dependencies.unresolvedLinkpaths) {
		if (linkpathCouldResolveTo(linkpath, file)) {
			return true;
		}
	}

	return false;
}

// Check whether `file` could be the destination of an unresolved target.
export function metadataTargetCouldResolveTo(target: MetadataTarget, file: TFile): boolean {
	return linkpathCouldResolveTo(getTargetLinkpath(target), file);
}

// Heuristic counterpart to getFirstLinkpathDest: a linkpath can resolve to a
// file when it matches the full path, a path suffix, or the bare basename.
function linkpathCouldResolveTo(linkpath: string, file: TFile): boolean {
	const normalized = normalizePath(linkpath).toLowerCase();
	if (!normalized || normalized === "/") {
		return false;
	}

	const withExtension = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
	const path = file.path.toLowerCase();
	return path === withExtension || path.endsWith(`/${withExtension}`);
}

export function resolveMetadataTargetFile(
	app: App,
	sourcePath: string,
	target: MetadataTarget
): TFile | null {
	const linkpath = getTargetLinkpath(target);
	if (!linkpath || isExternalLinkpath(linkpath)) {
		return null;
	}

	for (const candidate of getLinkpathCandidates(linkpath)) {
		const linkedFile = app.metadataCache.getFirstLinkpathDest(candidate, sourcePath);
		if (linkedFile) {
			return linkedFile;
		}
	}

	for (const candidate of getLinkpathCandidates(linkpath)) {
		const abstractFile = app.vault.getAbstractFileByPath(normalizePath(candidate));
		if (abstractFile instanceof TFile) {
			return abstractFile;
		}
	}

	return null;
}

// Refresh markdown views after metadata changes.
export type MarkdownRefresher = {
	refreshAll: () => void;
};

// Quiet period before dispatching batched metadata changes. Keeps bursts
// (typing, sync, bulk edits) from refreshing views once per event.
const METADATA_CHANGE_DEBOUNCE_MS = 150;

// Batch metadata change events and notify once per changed file. Targeted
// in-place refreshes (live preview decorations, reading view spans) happen in
// the callback; the returned refreshAll is the heavyweight full rerender for
// settings changes.
export function registerMarkdownRefresh(
	plugin: Plugin,
	onMetadataChanged: (file: TFile) => void
): MarkdownRefresher {
	const pendingFiles = new Map<string, TFile>();
	let timerId: number | null = null;

	const flush = () => {
		timerId = null;
		const files = Array.from(pendingFiles.values());
		pendingFiles.clear();
		for (const file of files) {
			onMetadataChanged(file);
		}
	};

	const schedule = (file: TFile) => {
		pendingFiles.set(file.path, file);
		if (timerId !== null) {
			window.clearTimeout(timerId);
		}
		timerId = window.setTimeout(flush, METADATA_CHANGE_DEBOUNCE_MS);
	};

	plugin.registerEvent(plugin.app.metadataCache.on("changed", schedule));
	// Deletes and renames don't fire "changed", but remote references that
	// point at the affected note must revert or resolve.
	plugin.registerEvent(plugin.app.vault.on("delete", (file) => {
		if (file instanceof TFile) {
			schedule(file);
		}
	}));
	plugin.registerEvent(plugin.app.vault.on("rename", (file) => {
		if (file instanceof TFile) {
			schedule(file);
		}
	}));
	plugin.register(() => {
		if (timerId !== null) {
			window.clearTimeout(timerId);
			timerId = null;
		}
	});

	const refreshAll = () => {
		const leaves = plugin.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) {
				continue;
			}

			if (view.getMode() === "preview") {
				const scroll = view.previewMode?.getScroll?.() ?? 0;
				view.previewMode?.rerender(true);
				view.previewMode?.applyScroll?.(scroll);
			}
		}
	};

	return {refreshAll};
}

function findMarkerEnd(text: string, start: number, style: SyntaxStyle): number {
	if (style === "doubleBraces") {
		const end = text.indexOf(getSyntaxClose(style), start + getSyntaxOpen(style).length);
		return end === -1 ? -1 : end + getSyntaxClose(style).length;
	}

	let pos = start + getSyntaxOpen(style).length;
	while (pos < text.length) {
		if (text.startsWith("[[", pos)) {
			const wikiEnd = text.indexOf("]]", pos + 2);
			if (wikiEnd === -1) {
				return -1;
			}
			pos = wikiEnd + 2;
			continue;
		}

		const markdownLinkEnd = findMarkdownLinkEnd(text, pos);
		if (markdownLinkEnd !== null) {
			pos = markdownLinkEnd;
			continue;
		}

		if (text[pos] === "]") {
			return pos + 1;
		}

		pos += 1;
	}

	return -1;
}

function parseRemoteReference(raw: string, allowEmptyKey: boolean): MetadataReference | null {
	if (raw.startsWith("[[")) {
		const wikiEnd = raw.indexOf("]]", 2);
		if (wikiEnd === -1) {
			return null;
		}

		const key = parseRemoteKey(raw.slice(wikiEnd + 2), allowEmptyKey);
		if (key === null) {
			return null;
		}

		return {
			raw,
			key,
			target: {
				type: "wiki",
				linktext: raw.slice(2, wikiEnd).trim(),
			},
		};
	}

	const markdownLinkEnd = findMarkdownLinkEnd(raw, 0);
	if (markdownLinkEnd === null) {
		return null;
	}

	const destination = parseMarkdownDestination(raw, 0);
	const key = parseRemoteKey(raw.slice(markdownLinkEnd), allowEmptyKey);
	if (destination === null || key === null) {
		return null;
	}

	return {
		raw,
		key,
		target: {
			type: "markdown",
			destination,
		},
	};
}

function parseRemoteKey(raw: string, allowEmptyKey: boolean): string | null {
	const trimmed = raw.trim();
	if (!trimmed.startsWith("#")) {
		return null;
	}

	const key = trimmed.slice(1).trim();
	if (!allowEmptyKey && !key) {
		return null;
	}
	return key;
}

function findMarkdownLinkEnd(text: string, start: number): number | null {
	if (text[start] !== "[" || text.startsWith("[[", start)) {
		return null;
	}

	const labelEnd = findClosingBracket(text, start + 1);
	if (labelEnd === -1 || text[labelEnd + 1] !== "(") {
		return null;
	}

	const destinationEnd = findClosingParen(text, labelEnd + 2);
	return destinationEnd === -1 ? null : destinationEnd + 1;
}

function parseMarkdownDestination(text: string, start: number): string | null {
	const labelEnd = findClosingBracket(text, start + 1);
	if (labelEnd === -1 || text[labelEnd + 1] !== "(") {
		return null;
	}

	const destinationEnd = findClosingParen(text, labelEnd + 2);
	if (destinationEnd === -1) {
		return null;
	}

	return text.slice(labelEnd + 2, destinationEnd).trim();
}

function findClosingBracket(text: string, start: number): number {
	for (let pos = start; pos < text.length; pos += 1) {
		if (text[pos] === "\\") {
			pos += 1;
			continue;
		}
		if (text[pos] === "]") {
			return pos;
		}
	}
	return -1;
}

function findClosingParen(text: string, start: number): number {
	let depth = 0;
	for (let pos = start; pos < text.length; pos += 1) {
		if (text[pos] === "\\") {
			pos += 1;
			continue;
		}
		if (text[pos] === "(") {
			depth += 1;
			continue;
		}
		if (text[pos] === ")") {
			if (depth === 0) {
				return pos;
			}
			depth -= 1;
		}
	}
	return -1;
}

function getTargetLinkpath(target: MetadataTarget): string {
	if (target.type === "wiki") {
		const withoutAlias = target.linktext.split("|")[0]?.trim() ?? "";
		return stripSubpath(withoutAlias);
	}

	return stripSubpath(cleanMarkdownDestination(target.destination));
}

function getLinkpathCandidates(linkpath: string): string[] {
	const candidates = new Set<string>();
	const normalized = normalizePath(linkpath);
	candidates.add(normalized);

	if (normalized.toLowerCase().endsWith(".md")) {
		candidates.add(normalized.slice(0, -3));
	} else {
		candidates.add(`${normalized}.md`);
	}

	return Array.from(candidates);
}

function stripSubpath(linkpath: string): string {
	return linkpath.split("#")[0]?.trim() ?? "";
}

function cleanMarkdownDestination(destination: string): string {
	const withoutTitle = destination.replace(/\s+["'][^"']*["']\s*$/, "").trim();
	const unwrapped = withoutTitle.startsWith("<") && withoutTitle.endsWith(">")
		? withoutTitle.slice(1, -1)
		: withoutTitle;

	try {
		return decodeURI(unwrapped);
	} catch {
		return unwrapped;
	}
}

function isExternalLinkpath(linkpath: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(linkpath) || linkpath.startsWith("//") || linkpath.startsWith("#");
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
	caseInsensitive: boolean,
	file?: TFile | null,
	builtInKeysEnabled = false
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
		if (value !== null) {
			valueCache.set(keyPath, value);
			return value;
		}

		if (builtInKeysEnabled && file) {
			const builtInValue = resolveBuiltInValue(file, keyPath, caseInsensitive);
			valueCache.set(keyPath, builtInValue);
			return builtInValue;
		}

		valueCache.set(keyPath, null);
		return null;
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

// Return the list of built-in keys available for suggestions.
export function getBuiltInKeys(): string[] {
	return [...BUILT_IN_KEYS];
}

function resolveBuiltInValue(file: TFile, keyPath: string, caseInsensitive: boolean): string | null {
	const key = caseInsensitive ? keyPath.toLowerCase() : keyPath;
	if (!key || key.includes(".")) {
		return null;
	}

	switch (key as BuiltInKey) {
		case "filename":
			return file.name;
		case "basename":
			return file.basename;
		case "extension":
			return file.extension;
		case "path":
			return file.path;
		case "folder":
			return file.parent?.path ?? "";
		case "link":
			return `[[${file.path}|${file.basename}]]`;
		case "ctime":
			return formatBuiltInDate(file.stat.ctime);
		case "mtime":
			return formatBuiltInDate(file.stat.mtime);
		default:
			return null;
	}
}

function formatBuiltInDate(timestamp: number): string {
	return new Date(timestamp).toLocaleString();
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
