// Inline markdown renderer for metadata values (links, embeds, etc.)
import {App, Component, MarkdownRenderer} from "obsidian";

const markdownHintRegex = /(\[\[|!\[\[|`|\*|_|~|\[[^\]]+\]\([^)]+\)|#|\n)/;

// Render a value as inline markdown 
export function renderInlineMarkdown(
	app: App,
	sourcePath: string,
	el: HTMLElement,
	value: string,
	component: Component
): void {
	if (!value || !markdownHintRegex.test(value)) {
		el.textContent = value;
		return;
	}

	el.textContent = "";

	const temp = document.createElement("span");
	el.appendChild(temp);

	void MarkdownRenderer.render(app, value, temp, sourcePath, component).then(() => {
		if (!temp.parentElement) {
			return;
		}

		const onlyChild = temp.children.length === 1 ? temp.firstElementChild : null;
		if (onlyChild && onlyChild.tagName === "P") {
			while (onlyChild.firstChild) {
				el.appendChild(onlyChild.firstChild);
			}
		} else {
			while (temp.firstChild) {
				el.appendChild(temp.firstChild);
			}
		}

		temp.remove();
	});
}

// Render markdown but keep only the plain text content.
export function renderInlineMarkdownText(
	app: App,
	sourcePath: string,
	el: HTMLElement,
	value: string,
	component: Component,
	onRendered?: (text: string) => void
): void {
	if (!value || !markdownHintRegex.test(value)) {
		el.textContent = value;
		onRendered?.(value);
		return;
	}

	el.textContent = "";
	const temp = document.createElement("span");
	el.appendChild(temp);

	void MarkdownRenderer.render(app, value, temp, sourcePath, component).then(() => {
		if (!temp.parentElement) {
			return;
		}

		const text = temp.textContent ?? "";
		el.textContent = text;
		temp.remove();
		onRendered?.(text);
	});
}
