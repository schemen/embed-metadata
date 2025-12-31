// Utils for all other modules

// Syntax parsing and frontmatter resolution utilities.
export type SyntaxStyle = "brackets" | "doubleBraces";

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

// Resolve a dot-path in frontmatter and stringify the result.
// We'll keep it in for proper frontmatter BUT Obsidian Properties do not
// support nested values (yet?).
export function resolveFrontmatterString(
	frontmatter: Record<string, unknown>,
	keyPath: string
): string | null {
	const value = resolveFrontmatterValue(frontmatter, keyPath);
	if (value === undefined || value === null) {
		return null;
	}
	return formatFrontmatterValue(value);
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
	keyPath: string
): unknown {
	const parts = keyPath
		.split(".")
		.map((part) => part.trim())
		.filter(Boolean);
	let current: unknown = frontmatter;

	for (const part of parts) {
		if (current && typeof current === "object" && part in current) {
			current = (current as Record<string, unknown>)[part];
		} else {
			return undefined;
		}
	}

	return current;
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
