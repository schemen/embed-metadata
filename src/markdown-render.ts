// Inline markdown renderer for metadata values (links, embeds, etc.)
import {App, Component, MarkdownRenderer} from "obsidian";

// Values without any of these hints skip MarkdownRenderer and render as plain
// text. Inline HTML (`<br>`, `<span …>`, `</b>`) needs the renderer too; a bare
// `<` (e.g. `a < b`) does not look like a tag and stays on the fast path.
const markdownHintRegex = /(\[\[|!\[\[|`|\*|_|~|\[[^\]]+\]\([^)]+\)|#|https?:\/\/|\n|<\/?[a-zA-Z][^>]*>)/;

type ActiveRender = {
	parent: Component;
	component: Component;
};

type ObsidianDomWindow = Window & {
	createSpan: () => HTMLSpanElement;
};

const activeRenders = new WeakMap<HTMLElement, ActiveRender>();

// Obsidian exposes detached DOM factories on each enhanced Window. Calling
// createSpan() on a Document instead would try to append a second document root.
export function createDetachedSpan(doc: Document): HTMLSpanElement {
	return (doc.win as ObsidianDomWindow).createSpan();
}

function clearActiveRender(el: HTMLElement): void {
	const active = activeRenders.get(el);
	if (!active) {
		return;
	}
	active.parent.removeChild(active.component);
	activeRenders.delete(el);
}

export function clearRenderedMarkdown(el: HTMLElement): void {
	clearActiveRender(el);
}

function createRenderComponent(el: HTMLElement, parent: Component): Component {
	clearActiveRender(el);
	const component = parent.addChild(new Component());
	activeRenders.set(el, {parent, component});
	component.register(() => {
		if (activeRenders.get(el)?.component === component) {
			activeRenders.delete(el);
		}
	});
	return component;
}

function renderIsActive(el: HTMLElement, component: Component): boolean {
	return activeRenders.get(el)?.component === component;
}

// Render a value as inline markdown.
export function renderInlineMarkdown(
	app: App,
	sourcePath: string,
	el: HTMLElement,
	value: string,
	component: Component
): void {
	if (!value || !markdownHintRegex.test(value)) {
		clearActiveRender(el);
		el.textContent = value;
		return;
	}

	el.textContent = "";
	const temp = el.createSpan();
	const renderComponent = createRenderComponent(el, component);

	void MarkdownRenderer.render(app, value, temp, sourcePath, renderComponent).then(() => {
		if (!renderIsActive(el, renderComponent) || !temp.parentElement) {
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
	}).catch(() => {
		if (!renderIsActive(el, renderComponent) || !temp.parentElement) {
			return;
		}
		clearActiveRender(el);
		el.textContent = value;
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
		clearActiveRender(el);
		el.textContent = value;
		onRendered?.(value);
		return;
	}

	el.textContent = "";
	const temp = el.createSpan();
	const renderComponent = createRenderComponent(el, component);

	void MarkdownRenderer.render(app, value, temp, sourcePath, renderComponent).then(() => {
		if (!renderIsActive(el, renderComponent) || !temp.parentElement) {
			return;
		}

		// `<br>` has no text content; keep the words on either side apart.
		for (const br of Array.from(temp.querySelectorAll("br"))) {
			br.replaceWith(" ");
		}
		const text = temp.textContent ?? "";
		clearActiveRender(el);
		el.textContent = text;
		onRendered?.(text);
	}).catch(() => {
		if (!renderIsActive(el, renderComponent) || !temp.parentElement) {
			return;
		}
		clearActiveRender(el);
		el.textContent = value;
		onRendered?.(value);
	});
}
