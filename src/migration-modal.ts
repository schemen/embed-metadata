// UI to review and run syntax migrations across the vault
import {App, Modal, Notice, TFile} from "obsidian";
import {getSyntaxClose, getSyntaxOpen, getSyntaxRegex, SyntaxStyle} from "./metadata-utils";
import {EmbedMetadataPlugin} from "./settings";

type MigrationMode = "dataview" | "otherSyntax";

// THe default dataview embedding syntax
const DATAVIEW_REGEX = /`=this\.([A-Za-z0-9_.-]+)`/g;

interface MigrationEntry {
	file: TFile;
	count: number;
	selected: boolean;
}

export class MigrationModal extends Modal {
	private plugin: EmbedMetadataPlugin;
	private mode: MigrationMode;
	private entries: MigrationEntry[] = [];
	private listEl: HTMLElement;
	private migrateButton: HTMLButtonElement | null = null;

	constructor(app: App, plugin: EmbedMetadataPlugin, mode: MigrationMode) {
		super(app);
		this.plugin = plugin;
		this.mode = mode;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl("h2", {
			text: this.mode === "dataview" ? "Migrate from Dataview" : "Migrate to current syntax",
		});

		contentEl.createEl("p", {
			text: this.mode === "dataview"
				? "Finds backticked `=this.key` and converts to the selected syntax format."
				: "Finds other syntax formats and converts them to the selected syntax format.",
		});

		this.listEl = contentEl.createDiv({cls: "embed-metadata-migration-list"});
		this.listEl.setText("Scanning files...");

		const actions = contentEl.createDiv({cls: "embed-metadata-migration-actions"});
		const cancel = actions.createEl("button", {text: "Cancel"});
		cancel.addEventListener("click", () => this.close());

		this.migrateButton = actions.createEl("button", {text: "Migrate"});
		this.migrateButton.classList.add("mod-warning");
		this.migrateButton.setAttr("aria-label", "This will edit your files!");
		this.migrateButton.setAttr("data-tooltip-position", "top");
		this.migrateButton.addEventListener("click", () => {
			new ConfirmMigrationModal(this.app, () => void this.runMigration()).open();
		});

		void this.loadEntries();
	}

	private async loadEntries() {
		const files = this.app.vault.getMarkdownFiles();
		const entries: MigrationEntry[] = [];

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const count = this.countMatches(content);
			if (count > 0) {
				entries.push({file, count, selected: true});
			}
		}

		this.entries = entries;
		this.renderEntries();
	}

	private renderEntries() {
		this.listEl.empty();

		if (this.entries.length === 0) {
			this.listEl.createEl("p", {text: "No matches found."});
			if (this.migrateButton) {
				this.migrateButton.disabled = true;
			}
			return;
		}

		if (this.migrateButton) {
			this.migrateButton.disabled = false;
		}

		for (const entry of this.entries) {
			const row = this.listEl.createDiv({cls: "embed-metadata-migration-item"});
			const checkbox = row.createEl("input", {type: "checkbox"});
			checkbox.checked = entry.selected;
			checkbox.addEventListener("change", () => {
				entry.selected = checkbox.checked;
			});

			row.createEl("span", {
				text: `${entry.file.path} (${entry.count})`,
			});
		}
	}

	private countMatches(content: string): number {
		if (this.mode === "dataview") {
			return countRegexMatches(DATAVIEW_REGEX, content);
		}

		const current = this.plugin.settings.syntaxStyle;
		let total = 0;
		for (const style of ["brackets", "doubleBraces"] as SyntaxStyle[]) {
			if (style === current) {
				continue;
			}
			total += countRegexMatches(getSyntaxRegex(style), content);
		}
		return total;
	}

	private async runMigration() {
		const selected = this.entries.filter((entry) => entry.selected);
		if (selected.length === 0) {
			new Notice("No files selected.");
			return;
		}

		const style = this.plugin.settings.syntaxStyle;
		const open = getSyntaxOpen(style);
		const close = getSyntaxClose(style);
		let updatedFiles = 0;

		for (const entry of selected) {
			const content = await this.app.vault.read(entry.file);
			const updated = this.mode === "dataview"
				? content.replace(DATAVIEW_REGEX, (_, key: string) => `${open}${key}${close}`)
				: replaceOtherSyntax(content, style, open, close);

			if (updated !== content) {
				await this.app.vault.modify(entry.file, updated);
				updatedFiles += 1;
			}
		}

		new Notice(`Migrated ${updatedFiles} file${updatedFiles === 1 ? "" : "s"}.`);
		this.close();
	}
}

class ConfirmMigrationModal extends Modal {
	private onConfirm: () => void;

	constructor(app: App, onConfirm: () => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl("h2", {text: "Confirm migration"});
		contentEl.createEl("p", {text: "This will edit your files."});

		const actions = contentEl.createDiv({cls: "embed-metadata-migration-actions"});
		const cancel = actions.createEl("button", {text: "Cancel"});
		cancel.addEventListener("click", () => this.close());

		const confirm = actions.createEl("button", {text: "Yes, migrate"});
		confirm.classList.add("mod-warning");
		confirm.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
	}
}

function replaceOtherSyntax(
	content: string,
	currentStyle: SyntaxStyle,
	open: string,
	close: string
): string {
	let updated = content;
	for (const style of ["brackets", "doubleBraces"] as SyntaxStyle[]) {
		if (style === currentStyle) {
			continue;
		}
		updated = updated.replace(getSyntaxRegex(style), (_, key: string) => `${open}${key}${close}`);
	}
	return updated;
}

function countRegexMatches(regex: RegExp, content: string): number {
	let count = 0;
	regex.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(content)) !== null) {
		count += 1;
	}
	return count;
}
