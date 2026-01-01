// Shared styling helper for rendered metadata values.
import {EmbedMetadataSettings} from "./settings";

// Build a stable key for style settings so widgets can be reused safely.
export function getStyleKey(settings: EmbedMetadataSettings): string {
	return [
		settings.bold ? "1" : "0",
		settings.italic ? "1" : "0",
		settings.underline ? "1" : "0",
		settings.underlineColorEnabled ? "1" : "0",
		settings.underlineColor,
		settings.highlight ? "1" : "0",
		settings.highlightColorEnabled ? "1" : "0",
		settings.highlightColor,
		settings.hoverEmphasis ? "1" : "0",
	].join("|");
}

// Apply visual styling classes to a rendered value element.
export function applyValueStyles(el: HTMLElement, settings: EmbedMetadataSettings): void {
	el.classList.add("embed-metadata-value");

	if (settings.bold) {
		el.classList.add("embed-metadata-bold");
	}

	if (settings.italic) {
		el.classList.add("embed-metadata-italic");
	}

	if (settings.underline) {
		el.classList.add("embed-metadata-underline");
		if (settings.underlineColorEnabled) {
			el.style.setProperty("--embed-metadata-underline-color", settings.underlineColor);
		}
	}

	if (settings.highlight) {
		el.classList.add("embed-metadata-highlight");
		if (settings.highlightColorEnabled) {
			el.style.setProperty("--embed-metadata-highlight-color", settings.highlightColor);
		}
	}

	if (settings.hoverEmphasis) {
		el.classList.add("embed-metadata-hoverable");
	}
}
