import { App, ButtonComponent, setIcon } from "obsidian";
import type GtdBoardPlugin from "./main";
import { TaskForm, TaskFormOptions, TaskFormResult } from "./task-form";
import { t } from "./i18n";

export interface DetailPanelOptions extends TaskFormOptions {
	/** Ueberschrift des Panels (z. B. "Aufgabe bearbeiten"). */
	heading: string;
	onSubmit: (result: TaskFormResult) => Promise<void>;
	/** Optional: Aktion "Datei oeffnen" (nur fuer Datei-Aufgaben sinnvoll). */
	onOpenFile?: () => void;
	/** Wird nach jedem Schliessen aufgerufen (Speichern, Abbrechen, Escape, neue Aufgabe). */
	onClose?: () => void;
}

/**
 * Detailpanel rechts neben dem Board: zeigt dasselbe Formular wie der Aufgaben-Dialog
 * (TaskForm), ohne das Board zu verdecken. Speichern uebernimmt das Formular ueber onSubmit,
 * Escape oder "Abbrechen" verwerfen die Aenderungen. Es ist immer hoechstens eine Aufgabe offen.
 */
export class TaskDetailPanel {
	private form: TaskForm | undefined;
	private options: DetailPanelOptions | undefined;
	private saving = false;

	constructor(private el: HTMLElement, private app: App, private plugin: GtdBoardPlugin) {
		this.el.hide();
		this.el.addEventListener("keydown", (evt) => {
			if (!this.options) return;
			if (evt.key === "Escape") {
				evt.preventDefault();
				this.close();
			} else if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey)) {
				evt.preventDefault();
				void this.save();
			}
		});
	}

	/** ID der aktuell bearbeiteten Aufgabe (undefined bei geschlossenem Panel oder neuer Aufgabe). */
	get taskId(): string | undefined {
		return this.options?.task?.id;
	}

	isOpen(): boolean {
		return this.options !== undefined;
	}

	open(options: DetailPanelOptions): void {
		if (this.options) this.close();
		this.options = options;
		this.form = new TaskForm(this.app, this.plugin, options);

		this.el.empty();
		this.el.show();

		const header = this.el.createDiv({ cls: "gtd-detail-header" });
		header.createSpan({ cls: "gtd-detail-title", text: options.heading });
		const closeBtn = header.createEl("button", {
			cls: "gtd-detail-close clickable-icon",
			attr: { "aria-label": t("detailPanel.close"), title: t("detailPanel.close") },
		});
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("click", () => this.close());

		const body = this.el.createDiv({ cls: "gtd-detail-body" });
		this.form.render(body);

		const footer = this.el.createDiv({ cls: "gtd-detail-footer" });
		new ButtonComponent(footer)
			.setButtonText(t("taskModal.save"))
			.setCta()
			.onClick(() => void this.save());
		new ButtonComponent(footer).setButtonText(t("taskModal.cancel")).onClick(() => this.close());
		if (options.onOpenFile) {
			const openFile = options.onOpenFile;
			new ButtonComponent(footer).setButtonText(t("view.contextMenu.openFile")).onClick(() => openFile());
		}
	}

	/** Speichert das Formular (falls gueltig) und schliesst das Panel. */
	async save(): Promise<void> {
		if (!this.form || !this.options || this.saving) return;
		const result = this.form.getResult();
		if (!result) return;
		this.saving = true;
		try {
			await this.options.onSubmit(result);
		} finally {
			this.saving = false;
		}
		this.close();
	}

	close(): void {
		if (!this.options) return;
		const onClose = this.options.onClose;
		this.form?.dispose();
		this.form = undefined;
		this.options = undefined;
		this.el.empty();
		this.el.hide();
		onClose?.();
	}
}
