import { App, ButtonComponent, Component, MarkdownRenderer, Notice, Setting, TextComponent, TFolder, normalizePath } from "obsidian";
import type GtdBoardPlugin from "./main";
import { GtdTask, RecurrenceRule, TaskPriority } from "./types";
import {
	DueChip,
	ReminderChip,
	combineDateTimeValue,
	dueChipDate,
	parseLocalDateTime,
	reminderChipValue,
	roundToQuarterHour,
	splitDateTimeValue,
} from "./util";
import { priorityLabel, recurrenceLabel, t } from "./i18n";

/** Ergebnis des Aufgaben-Formulars (immer das vollstaendige Formular, nie nur geaenderte Felder). */
export interface TaskFormResult {
	title: string;
	description: string;
	due?: string;
	reminderAt?: string;
	priority: TaskPriority;
	recurrence?: RecurrenceRule;
	contexts: string[];
	tags: string[];
	delegatedTo?: string;
	project?: string;
	/** Vault path of the target project folder (set when projectRootFolder is configured and a folder-project was chosen). */
	projectFolder?: string;
	person?: string;
	visibleFrom?: string;
	revisitOn?: string;
}

export interface TaskFormOptions {
	mode: "create" | "edit";
	laneId: string;
	task?: GtdTask;
	/** Person-Feld anzeigen (fuer Agenda-Eintraege). */
	showPersonField?: boolean;
	/** Vorausgefuelltes Projekt (z. B. beim Anlegen aus der Projekteansicht). */
	initialProject?: string;
	/** Titelfeld beim Anzeigen fokussieren. */
	autofocusTitle?: boolean;
}

/**
 * Aufgaben-Formular des Dialogs (TaskModal): Titel, Markdown-Beschreibung (Vorschau mit
 * klickbaren Checkboxen), Faelligkeit und Erinnerung mit Schnellwahl-Chips, Wiederholung, Prioritaet, Projekt, Person, Delegation,
 * Kontexte, Tags, Tickler und Wiedervorlage. Haelt nur den Formularzustand; gespeichert wird
 * ueber den Aufrufer (getResult()).
 */
export class TaskForm {
	private title: string;
	private description: string;
	/** Datumsteil (YYYY-MM-DD) der Faelligkeit, leer = keine Faelligkeit. */
	private dueDate: string;
	/** Uhrzeitteil (HH:mm) der Faelligkeit, leer = ganztaegig (keine Uhrzeit). */
	private dueTime: string;
	private reminderDate: string;
	private reminderTime: string;
	private priority: TaskPriority;
	private recurrence: RecurrenceRule | undefined;
	private contexts: string;
	private tags: string;
	private delegatedTo: string;
	private project: string;
	private projectFolder: string | undefined = undefined;
	private person: string;
	private visibleFrom: string;
	private revisitOn: string;
	private previewComponent = new Component();
	private descriptionShowingPreview = true;

	constructor(private app: App, private plugin: GtdBoardPlugin, private options: TaskFormOptions) {
		const task = options.task;
		this.title = task?.title ?? "";
		this.description = task?.description ?? "";
		[this.dueDate, this.dueTime] = splitDateTimeValue(task?.due);
		[this.reminderDate, this.reminderTime] = splitDateTimeValue(task?.reminderAt);
		this.priority = task?.priority ?? "medium";
		this.recurrence = task?.recurrence;
		this.contexts = task?.contexts.join(", ") ?? "";
		this.tags = task?.tags.join(", ") ?? "";
		this.delegatedTo = task?.delegatedTo ?? "";
		this.project = task?.project ?? options.initialProject ?? "";
		this.person = task?.person ?? "";
		this.visibleFrom = task?.visibleFrom ?? "";
		this.revisitOn = task?.revisitOn ?? "";
		this.previewComponent.load();
	}

	/** Baut alle Formularfelder in den uebergebenen Container. */
	render(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("taskModal.title")).addText((text) => {
			text.setValue(this.title).onChange((v) => (this.title = v));
			text.inputEl.addClass("gtd-modal-title-input");
			if (this.options.autofocusTitle) window.setTimeout(() => text.inputEl.focus(), 0);
		});

		this.renderDescription(containerEl);
		this.renderDue(containerEl);

		new Setting(containerEl)
			.setName(t("taskModal.recurrence"))
			.setDesc(t("taskModal.recurrenceDesc"))
			.addDropdown((dropdown) => {
				dropdown.addOption("", t("taskModal.recurrenceNone"));
				(["daily", "weekly", "monthly", "yearly"] as RecurrenceRule[]).forEach((r) => {
					dropdown.addOption(r, recurrenceLabel(r));
				});
				dropdown.setValue(this.recurrence ?? "").onChange((v) => {
					this.recurrence = (v || undefined) as RecurrenceRule | undefined;
				});
			});

		this.renderReminder(containerEl);

		new Setting(containerEl)
			.setName(t("taskModal.priority"))
			.setDesc(t("taskModal.priorityDesc"))
			.addDropdown((dropdown) => {
				(["high", "medium", "low"] as TaskPriority[]).forEach((p) => {
					dropdown.addOption(p, priorityLabel(p));
				});
				dropdown.setValue(this.priority).onChange((v) => (this.priority = v as TaskPriority));
			});

		this.renderProject(containerEl);

		if (this.options.showPersonField) {
			new Setting(containerEl)
				.setName(t("taskModal.person"))
				.setDesc(t("taskModal.personDesc"))
				.addText((text) => {
					text.setPlaceholder(t("taskModal.personPlaceholder")).setValue(this.person).onChange((v) => (this.person = v));
					text.inputEl.addClass("gtd-modal-person-input");
				});
		}

		new Setting(containerEl)
			.setName(t("taskModal.delegatedTo"))
			.setDesc(t("taskModal.delegatedToDesc"))
			.addText((text) => {
				text.setPlaceholder(t("taskModal.delegatedToPlaceholder")).setValue(this.delegatedTo).onChange((v) => (this.delegatedTo = v));
			});

		new Setting(containerEl)
			.setName(t("taskModal.contexts"))
			.setDesc(t("taskModal.contextsDesc"))
			.addText((text) => {
				text.setValue(this.contexts).onChange((v) => (this.contexts = v));
			});

		new Setting(containerEl).setName(t("taskModal.tags")).setDesc(t("taskModal.tagsDesc")).addText((text) => {
			text.setValue(this.tags).onChange((v) => (this.tags = v));
		});

		new Setting(containerEl)
			.setName(t("taskModal.visibleFrom"))
			.setDesc(t("taskModal.visibleFromDesc"))
			.addText((text) => {
				text.inputEl.type = "date";
				text.setValue(this.visibleFrom).onChange((v) => (this.visibleFrom = v));
			});

		const isSomedayLane = this.plugin.settings.lanes.find((l) => l.id === this.options.laneId)?.isSomeday;
		if (isSomedayLane) {
			new Setting(containerEl)
				.setName(t("taskModal.revisitOn"))
				.setDesc(t("taskModal.revisitOnDesc"))
				.addText((text) => {
					text.inputEl.type = "date";
					text.setValue(this.revisitOn).onChange((v) => (this.revisitOn = v));
				});
		}
	}

	/**
	 * Liefert das vollstaendige Formular oder undefined (mit Hinweis), wenn der Titel fehlt.
	 * Ungueltige Datumswerte werden verworfen.
	 */
	getResult(): TaskFormResult | undefined {
		const title = this.title.trim();
		if (title.length === 0) {
			new Notice(t("taskModal.titleRequired"));
			return undefined;
		}
		const due = combineDateTimeValue(this.dueDate, this.dueTime);
		const reminderAt = combineDateTimeValue(this.reminderDate, this.reminderTime);
		const tags = this.tags
			.split(",")
			.map((tag) => tag.trim())
			.filter((tag) => tag.length > 0);
		const contexts = this.contexts
			.split(",")
			.map((c) => c.trim().replace(/^@/, ""))
			.filter((c) => c.length > 0);

		return {
			title,
			description: this.description,
			due: due && parseLocalDateTime(due) ? due : undefined,
			reminderAt: reminderAt && parseLocalDateTime(reminderAt) ? reminderAt : undefined,
			priority: this.priority,
			recurrence: this.recurrence,
			contexts,
			tags,
			delegatedTo: this.delegatedTo.trim() || undefined,
			project: this.project.trim() || undefined,
			projectFolder: this.projectFolder,
			person: this.options.showPersonField ? (this.person.trim() || undefined) : undefined,
			visibleFrom: this.visibleFrom.trim() || undefined,
			revisitOn: this.revisitOn.trim() || undefined,
		};
	}

	/** Gibt die Markdown-Vorschau frei; danach ist das Formular nicht mehr verwendbar. */
	dispose(): void {
		this.previewComponent.unload();
	}

	private renderDescription(containerEl: HTMLElement): void {
		let descToggleButton: ButtonComponent;
		new Setting(containerEl)
			.setName(t("taskModal.description"))
			.setClass("gtd-modal-description-setting")
			.addButton((btn) => {
				descToggleButton = btn;
				btn.onClick(() => {
					this.descriptionShowingPreview = !this.descriptionShowingPreview;
					updateDescriptionView();
				});
			});

		const editorWrap = containerEl.createDiv({ cls: "gtd-description-editor" });
		const toolbar = editorWrap.createDiv({ cls: "gtd-wysiwyg-toolbar" });
		const textarea = editorWrap.createEl("textarea", { cls: "gtd-description-textarea" });
		textarea.value = this.description;
		textarea.rows = 8;
		const preview = editorWrap.createDiv({ cls: "gtd-description-preview" });

		const renderPreview = async () => {
			preview.empty();
			await MarkdownRenderer.render(
				this.app,
				this.description || t("taskModal.noDescription"),
				preview,
				this.options.task?.filePath ?? "",
				this.previewComponent
			);
			const checkboxEls = Array.from(preview.querySelectorAll<HTMLInputElement>("input[type=checkbox]"));
			checkboxEls.forEach((cb, idx) => {
				const clone = cb.cloneNode(true) as HTMLInputElement;
				clone.disabled = false;
				cb.replaceWith(clone);
				clone.addEventListener("change", () => {
					const checked = clone.checked;
					let count = 0;
					this.description = this.description.split(/\r?\n/).map((line) => {
						if (/^\s*[-*+]\s*\[[ xX]\]/.test(line)) {
							if (count++ === idx) {
								return line.replace(/\[[ xX]\]/, checked ? "[x]" : "[ ]");
							}
						}
						return line;
					}).join("\n");
					textarea.value = this.description;
					void renderPreview();
					if (this.options.mode === "edit" && this.options.task?.source === "file") {
						void this.plugin.store.patchFileTaskBody(this.options.task, this.description)
							.then(() => void this.plugin.refreshBoardViews());
					}
				});
			});
		};

		textarea.addEventListener("input", () => {
			this.description = textarea.value;
		});

		const wrapSelection = (before: string, after: string) => {
			const start = textarea.selectionStart;
			const end = textarea.selectionEnd;
			const selected = textarea.value.slice(start, end);
			textarea.setRangeText(before + selected + after, start, end, "select");
			this.description = textarea.value;
			textarea.focus();
		};

		const prependLines = (prefix: string) => {
			const val = textarea.value;
			const start = textarea.selectionStart;
			const end = textarea.selectionEnd;
			const lineStart = val.lastIndexOf("\n", start - 1) + 1;
			const lineEndIdx = val.indexOf("\n", end);
			const blockEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
			const block = val.slice(lineStart, blockEnd);
			const prefixed = block.split("\n").map((l) => prefix + l).join("\n");
			textarea.setRangeText(prefixed, lineStart, blockEnd, "end");
			this.description = textarea.value;
			textarea.focus();
		};

		const addToolbarBtn = (label: string, title: string, action: () => void) => {
			const btn = toolbar.createEl("button", { cls: "gtd-wysiwyg-btn", text: label });
			btn.title = title;
			btn.type = "button";
			btn.addEventListener("mousedown", (e) => {
				e.preventDefault();
				action();
			});
		};

		addToolbarBtn("B", t("taskModal.toolbarBold"), () => wrapSelection("**", "**"));
		addToolbarBtn("I", t("taskModal.toolbarItalic"), () => wrapSelection("*", "*"));
		addToolbarBtn("S", t("taskModal.toolbarStrike"), () => wrapSelection("~~", "~~"));
		addToolbarBtn("`", t("taskModal.toolbarCode"), () => wrapSelection("`", "`"));
		addToolbarBtn("—", t("taskModal.toolbarBullet"), () => prependLines("- "));
		addToolbarBtn("☐", t("taskModal.toolbarTask"), () => prependLines("- [ ] "));

		const updateDescriptionView = () => {
			if (this.descriptionShowingPreview) {
				void renderPreview();
				textarea.setCssStyles({ display: "none" });
				toolbar.setCssStyles({ display: "none" });
				preview.setCssStyles({ display: "" });
				descToggleButton.setButtonText(t("taskModal.editButton"));
			} else {
				textarea.setCssStyles({ display: "" });
				toolbar.setCssStyles({ display: "" });
				preview.setCssStyles({ display: "none" });
				descToggleButton.setButtonText(t("taskModal.previewButton"));
				window.setTimeout(() => textarea.focus(), 0);
			}
		};
		updateDescriptionView();
	}

	/** Faelligkeit: Datum + optionale Uhrzeit, darunter Chips Heute / Morgen / Naechste Woche / Keine. */
	private renderDue(containerEl: HTMLElement): void {
		let dateInput: TextComponent | undefined;
		let timeInput: TextComponent | undefined;
		const setting = new Setting(containerEl)
			.setName(t("taskModal.dueDate"))
			.setDesc(t("taskModal.dueDateDesc"))
			.addText((text) => {
				dateInput = text;
				text.inputEl.type = "date";
				text.setValue(this.dueDate).onChange((v) => (this.dueDate = v));
			})
			.addText((text) => {
				timeInput = text;
				this.setupTimeInput(text, this.dueTime, (v) => (this.dueTime = v));
			});

		const apply = (date: string, time: string) => {
			this.dueDate = date;
			this.dueTime = time;
			dateInput?.setValue(date);
			timeInput?.setValue(time);
		};
		const chips: { chip: DueChip; label: string }[] = [
			{ chip: "today", label: t("taskModal.chipToday") },
			{ chip: "tomorrow", label: t("taskModal.chipTomorrow") },
			{ chip: "nextWeek", label: t("taskModal.chipNextWeek") },
		];
		const row = this.createChipRow(setting);
		for (const { chip, label } of chips) {
			this.addChip(row, label, () => apply(dueChipDate(chip), this.dueTime));
		}
		this.addChip(row, t("taskModal.chipNone"), () => apply("", ""));
	}

	/** Erinnerung: Datum + optionale Uhrzeit, darunter Chips In 1 Std. / Morgen 9:00 / Naechste Woche / Keine. */
	private renderReminder(containerEl: HTMLElement): void {
		let dateInput: TextComponent | undefined;
		let timeInput: TextComponent | undefined;
		const setting = new Setting(containerEl)
			.setName(t("taskModal.reminder"))
			.setDesc(t("taskModal.reminderDesc", { minutes: this.plugin.settings.defaultReminderOffsetMinutes }))
			.addText((text) => {
				dateInput = text;
				text.inputEl.type = "date";
				text.setValue(this.reminderDate).onChange((v) => (this.reminderDate = v));
			})
			.addText((text) => {
				timeInput = text;
				this.setupTimeInput(text, this.reminderTime, (v) => (this.reminderTime = v));
			});

		const apply = ([date, time]: [string, string]) => {
			this.reminderDate = date;
			this.reminderTime = time;
			dateInput?.setValue(date);
			timeInput?.setValue(time);
		};
		const chips: { chip: ReminderChip; label: string }[] = [
			{ chip: "in1h", label: t("taskModal.chipIn1h") },
			{ chip: "tomorrowMorning", label: t("taskModal.chipTomorrowMorning") },
			{ chip: "nextWeek", label: t("taskModal.chipNextWeek") },
		];
		const row = this.createChipRow(setting);
		for (const { chip, label } of chips) {
			this.addChip(row, label, () => apply(reminderChipValue(chip)));
		}
		this.addChip(row, t("taskModal.chipNone"), () => apply(["", ""]));
	}

	private setupTimeInput(text: TextComponent, value: string, onChange: (v: string) => void): void {
		text.inputEl.type = "time";
		text.inputEl.step = "900";
		text.inputEl.title = t("taskModal.timeTooltip");
		text.setValue(value).onChange(onChange);
		text.inputEl.addEventListener("blur", () => {
			const rounded = roundToQuarterHour(text.getValue());
			onChange(rounded);
			text.setValue(rounded);
		});
	}

	private createChipRow(setting: Setting): HTMLElement {
		return setting.descEl.createDiv({ cls: "gtd-chip-row" });
	}

	private addChip(row: HTMLElement, label: string, onClick: () => void): void {
		const chip = row.createEl("button", { cls: "gtd-chip", text: label, attr: { type: "button" } });
		chip.addEventListener("click", (evt) => {
			evt.preventDefault();
			onClick();
		});
	}

	private renderProject(containerEl: HTMLElement): void {
		const projectSetting = new Setting(containerEl).setName(t("taskModal.project"));
		const projectRootFolder = this.plugin.settings.projectRootFolder?.trim();
		const projectFolders = projectRootFolder ? this.getProjectFolders(projectRootFolder) : [];
		if (projectRootFolder && projectFolders.length > 0) {
			projectSetting.setDesc(t("taskModal.projectDescFromFolder", { folder: projectRootFolder }));
			projectSetting.addDropdown((dropdown) => {
				dropdown.addOption("", t("taskModal.projectNone"));
				for (const name of projectFolders) {
					dropdown.addOption(name, name);
				}
				if (this.project && !projectFolders.includes(this.project)) {
					dropdown.addOption(this.project, this.project);
				}
				dropdown.setValue(this.project);
				if (this.project && projectFolders.includes(this.project)) {
					this.projectFolder = normalizePath(`${projectRootFolder}/${this.project}`);
				}
				dropdown.onChange((v) => {
					this.project = v;
					this.projectFolder = v && projectFolders.includes(v)
						? normalizePath(`${projectRootFolder}/${v}`)
						: undefined;
				});
			});
		} else {
			projectSetting.setDesc(t("taskModal.projectDesc"));
			projectSetting.addText((text) => {
				text.setPlaceholder(t("taskModal.projectPlaceholder")).setValue(this.project).onChange((v) => (this.project = v));
			});
		}
	}

	private getProjectFolders(rootPath: string): string[] {
		const folder = this.app.vault.getAbstractFileByPath(normalizePath(rootPath));
		if (!(folder instanceof TFolder)) return [];
		return folder.children
			.filter((child): child is TFolder => child instanceof TFolder)
			.map((child) => child.name)
			.sort((a, b) => a.localeCompare(b));
	}
}
