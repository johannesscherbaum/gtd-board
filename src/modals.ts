import { App, ButtonComponent, Component, ConfirmationModal, MarkdownRenderer, Modal, Notice, Setting, TFolder, normalizePath } from "obsidian";
import type GtdBoardPlugin from "./main";
import { GtdTask, LaneConfig, RecurrenceRule, TaskPriority } from "./types";
import {
	addDays,
	daysSince,
	formatLocalDate,
	hasTimeComponent,
	parseLocalDateTime,
	parseQuickCapture,
	shouldPromoteFromInbox,
} from "./util";
import { priorityLabel, recurrenceLabel, t } from "./i18n";

export interface TaskModalResult {
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

export interface TaskModalOptions {
	mode: "create" | "edit";
	laneId: string;
	task?: GtdTask;
	/** Person-Feld anzeigen (fuer Agenda-Eintraege). */
	showPersonField?: boolean;
	/** Ueberschreibt den Standard-Fenstertitel des Dialogs. */
	titleOverride?: string;
	/** Vorausgefuelltes Projekt (z. B. beim Anlegen aus der Projekteansicht). */
	initialProject?: string;
	onSubmit: (result: TaskModalResult) => Promise<void>;
}

/** Dialog zum Anlegen bzw. Bearbeiten einer Aufgabe: Titel, Markdown-Beschreibung, Faelligkeit, Erinnerung, Tags. */
export class TaskModal extends Modal {
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

	constructor(app: App, private plugin: GtdBoardPlugin, private options: TaskModalOptions) {
		super(app);
		const task = options.task;
		this.title = task?.title ?? "";
		this.description = task?.description ?? "";
		[this.dueDate, this.dueTime] = this.splitInputValue(task?.due);
		[this.reminderDate, this.reminderTime] = this.splitInputValue(task?.reminderAt);
		this.priority = task?.priority ?? "medium";
		this.recurrence = task?.recurrence;
		this.contexts = task?.contexts.join(", ") ?? "";
		this.tags = task?.tags.join(", ") ?? "";
		this.delegatedTo = task?.delegatedTo ?? "";
		this.project = task?.project ?? options.initialProject ?? "";
		this.person = task?.person ?? "";
		this.visibleFrom = task?.visibleFrom ?? "";
		this.revisitOn = task?.revisitOn ?? "";
	}

	/** Zerlegt einen gespeicherten Datums(-zeit)-Wert in Datums- und Uhrzeit-Teil fuer die getrennten Inputs. */
	private splitInputValue(value: string | undefined): [string, string] {
		if (!value) return ["", ""];
		if (hasTimeComponent(value)) {
			const [datePart, timePart] = value.split("T");
			return [datePart, timePart ?? ""];
		}
		return [value, ""];
	}

	/** Fuegt Datums- und Uhrzeit-Teil wieder zu einem Wert im Speicherformat zusammen (oder undefined, wenn kein Datum gesetzt ist). */
	private combineInputValue(datePart: string, timePart: string): string | undefined {
		if (!datePart) return undefined;
		return timePart ? `${datePart}T${timePart}` : datePart;
	}

	/**
	 * Rundet eine "HH:mm"-Eingabe auf den naechsten 15-Minuten-Schritt. Der
	 * `step`-Attribut auf <input type="time"> wirkt nur auf die Spinner-Pfeile,
	 * nicht auf manuell eingetippte Werte - deshalb wird hier zusaetzlich
	 * hart gerundet, sobald das Feld verlassen wird.
	 */
	private roundToQuarterHour(time: string): string {
		if (!time) return time;
		const m = /^(\d{2}):(\d{2})$/.exec(time);
		if (!m) return time;
		const hour = Number(m[1]);
		const minute = Number(m[2]);
		const totalMinutes = hour * 60 + minute;
		const rounded = Math.round(totalMinutes / 15) * 15;
		const clamped = ((rounded % (24 * 60)) + 24 * 60) % (24 * 60);
		const roundedHour = Math.floor(clamped / 60);
		const roundedMinute = clamped % 60;
		return `${String(roundedHour).padStart(2, "0")}:${String(roundedMinute).padStart(2, "0")}`;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("gtd-task-modal");
		this.setTitle(
			this.options.titleOverride ??
			(this.options.mode === "create" ? t("taskModal.titleCreate") : t("taskModal.titleEdit"))
		);

		new Setting(contentEl).setName(t("taskModal.title")).addText((text) => {
			text.setValue(this.title).onChange((v) => (this.title = v));
			text.inputEl.addClass("gtd-modal-title-input");
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		let descToggleButton: ButtonComponent;
		new Setting(contentEl)
			.setName(t("taskModal.description"))
			.setClass("gtd-modal-description-setting")
			.addButton((btn) => {
				descToggleButton = btn;
				btn.onClick(() => {
					this.descriptionShowingPreview = !this.descriptionShowingPreview;
					updateDescriptionView();
				});
			});

		const editorWrap = contentEl.createDiv({ cls: "gtd-description-editor" });
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
				"",
				this.previewComponent
			);
			const checkboxEls = Array.from(preview.querySelectorAll<HTMLInputElement>("input[type=checkbox]"));
			checkboxEls.forEach((cb, idx) => {
				const clone = cb.cloneNode(true) as HTMLInputElement;
				cb.replaceWith(clone);
				clone.addEventListener("change", () => {
					let count = 0;
					this.description = this.description.split(/\r?\n/).map((line) => {
						if (/^\s*[-*+]\s*\[[ xX]\]/.test(line)) {
							if (count++ === idx) {
								return line.replace(/\[[ xX]\]/, clone.checked ? "[x]" : "[ ]");
							}
						}
						return line;
					}).join("\n");
					textarea.value = this.description;
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

		new Setting(contentEl)
			.setName(t("taskModal.dueDate"))
			.setDesc(t("taskModal.dueDateDesc"))
			.addText((text) => {
				text.inputEl.type = "date";
				text.setValue(this.dueDate).onChange((v) => (this.dueDate = v));
			})
			.addText((text) => {
				text.inputEl.type = "time";
				text.inputEl.step = "900";
				text.inputEl.title = t("taskModal.timeTooltip");
				text.setValue(this.dueTime).onChange((v) => (this.dueTime = v));
				text.inputEl.addEventListener("blur", () => {
					this.dueTime = this.roundToQuarterHour(this.dueTime);
					text.setValue(this.dueTime);
				});
			});

		new Setting(contentEl)
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

		new Setting(contentEl)
			.setName(t("taskModal.reminder"))
			.setDesc(
				t("taskModal.reminderDesc", { minutes: this.plugin.settings.defaultReminderOffsetMinutes })
			)
			.addText((text) => {
				text.inputEl.type = "date";
				text.setValue(this.reminderDate).onChange((v) => (this.reminderDate = v));
			})
			.addText((text) => {
				text.inputEl.type = "time";
				text.inputEl.step = "900";
				text.inputEl.title = t("taskModal.timeTooltip");
				text.setValue(this.reminderTime).onChange((v) => (this.reminderTime = v));
				text.inputEl.addEventListener("blur", () => {
					this.reminderTime = this.roundToQuarterHour(this.reminderTime);
					text.setValue(this.reminderTime);
				});
			});

		new Setting(contentEl)
			.setName(t("taskModal.priority"))
			.setDesc(t("taskModal.priorityDesc"))
			.addDropdown((dropdown) => {
				(["high", "medium", "low"] as TaskPriority[]).forEach((p) => {
					dropdown.addOption(p, priorityLabel(p));
				});
				dropdown.setValue(this.priority).onChange((v) => (this.priority = v as TaskPriority));
			});

		const projectSetting = new Setting(contentEl).setName(t("taskModal.project"));
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

		if (this.options.showPersonField) {
			new Setting(contentEl)
				.setName(t("taskModal.person"))
				.setDesc(t("taskModal.personDesc"))
				.addText((text) => {
					text.setPlaceholder(t("taskModal.personPlaceholder")).setValue(this.person).onChange((v) => (this.person = v));
					text.inputEl.addClass("gtd-modal-person-input");
				});
		}

		new Setting(contentEl)
			.setName(t("taskModal.delegatedTo"))
			.setDesc(t("taskModal.delegatedToDesc"))
			.addText((text) => {
				text.setPlaceholder(t("taskModal.delegatedToPlaceholder")).setValue(this.delegatedTo).onChange((v) => (this.delegatedTo = v));
			});

		new Setting(contentEl)
			.setName(t("taskModal.contexts"))
			.setDesc(t("taskModal.contextsDesc"))
			.addText((text) => {
				text.setValue(this.contexts).onChange((v) => (this.contexts = v));
			});

		new Setting(contentEl).setName(t("taskModal.tags")).setDesc(t("taskModal.tagsDesc")).addText((text) => {
			text.setValue(this.tags).onChange((v) => (this.tags = v));
		});

		new Setting(contentEl)
			.setName(t("taskModal.visibleFrom"))
			.setDesc(t("taskModal.visibleFromDesc"))
			.addText((text) => {
				text.inputEl.type = "date";
				text.setValue(this.visibleFrom).onChange((v) => (this.visibleFrom = v));
			});

		const isSomedayLane = this.plugin.settings.lanes.find((l) => l.id === this.options.laneId)?.isSomeday;
		if (isSomedayLane) {
			new Setting(contentEl)
				.setName(t("taskModal.revisitOn"))
				.setDesc(t("taskModal.revisitOnDesc"))
				.addText((text) => {
					text.inputEl.type = "date";
					text.setValue(this.revisitOn).onChange((v) => (this.revisitOn = v));
				});
		}

		const buttonRow = new Setting(contentEl);
		buttonRow.addButton((btn) =>
			btn
				.setButtonText(t("taskModal.save"))
				.setCta()
				.onClick(() => void this.submit())
		);
		buttonRow.addButton((btn) => btn.setButtonText(t("taskModal.cancel")).onClick(() => this.close()));
	}

	private async submit(): Promise<void> {
		const title = this.title.trim();
		if (title.length === 0) {
			new Notice(t("taskModal.titleRequired"));
			return;
		}
		const due = this.combineInputValue(this.dueDate, this.dueTime);
		const reminderAt = this.combineInputValue(this.reminderDate, this.reminderTime);
		const tags = this.tags
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t.length > 0);
		const contexts = this.contexts
			.split(",")
			.map((c) => c.trim().replace(/^@/, ""))
			.filter((c) => c.length > 0);

		await this.options.onSubmit({
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
		});
		this.close();
	}

	private getProjectFolders(rootPath: string): string[] {
		const folder = this.app.vault.getAbstractFileByPath(normalizePath(rootPath));
		if (!(folder instanceof TFolder)) return [];
		return folder.children
			.filter((child): child is TFolder => child instanceof TFolder)
			.map((child) => child.name)
			.sort((a, b) => a.localeCompare(b));
	}

	onClose(): void {
		this.previewComponent.unload();
		this.contentEl.empty();
	}
}

/**
 * Schnellerfassung (klassisches GTD-Capture): ein einzeiliges Eingabefeld, das sofort
 * eine neue Aufgaben-Datei anlegt, ohne dass das Board geoeffnet werden muss. Per Command
 * von ueberall im Vault aufrufbar. Versteht dieselbe kompakte Syntax wie Inline-Checkboxen
 * (📅 Faelligkeit, @Kontext, +Projekt, #tag/Lane, 👤 Delegation, 🔺/🔽 Prioritaet,
 * 🔁 Wiederholung) direkt beim Tippen - "natural language capture", ohne dass danach noch
 * im Board nachgepflegt werden muss.
 */
export class QuickCaptureModal extends Modal {
	private title = "";

	constructor(app: App, private plugin: GtdBoardPlugin, private laneId: string) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("gtd-quick-capture-modal");
		this.setTitle(t("quickCapture.title"));

		const input = contentEl.createEl("input", {
			cls: "gtd-quick-capture-input",
			attr: {
				type: "text",
				placeholder: t("quickCapture.placeholder"),
			},
		});
		const hint = contentEl.createDiv({ cls: "gtd-quick-capture-hint" });
		const defaultHint = t("quickCapture.hint");
		hint.setText(defaultHint);

		const updatePreview = () => {
			const raw = input.value.trim();
			if (raw.length === 0) {
				hint.setText(defaultHint);
				return;
			}
			const parsed = parseQuickCapture(raw, this.plugin.settings.lanes);
			if (!parsed || parsed.title.length === 0) {
				hint.setText(defaultHint);
				return;
			}
			hint.setText(this.describeParsed(parsed, this.plugin.settings.lanes));
		};

		input.addEventListener("input", () => {
			this.title = input.value;
			updatePreview();
		});
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				void this.submit();
			}
		});
		window.setTimeout(() => input.focus(), 0);
	}

	/** Baut eine kurze Vorschauzeile, was aus der getippten Syntax erkannt wurde. */
	private describeParsed(parsed: ReturnType<typeof parseQuickCapture>, lanes: LaneConfig[]): string {
		if (!parsed) return "";
		const parts: string[] = [`"${parsed.title}"`];
		const lane = parsed.laneId ? lanes.find((l) => l.id === parsed.laneId) : undefined;
		if (lane) parts.push(`→ ${lane.name}`);
		if (parsed.due) parts.push(`📅 ${parsed.due}`);
		if (parsed.contexts.length > 0) parts.push(`@${parsed.contexts.join(", @")}`);
		if (parsed.project) parts.push(`+${parsed.project}`);
		if (parsed.delegatedTo) parts.push(`👤 ${parsed.delegatedTo}`);
		if (parsed.priority === "high") parts.push("🔺");
		if (parsed.priority === "low") parts.push("🔽");
		if (parsed.recurrence) parts.push(`🔁 ${recurrenceLabel(parsed.recurrence)}`);
		return parts.join(" · ");
	}

	private async submit(): Promise<void> {
		const raw = this.title.trim();
		if (raw.length === 0) {
			this.close();
			return;
		}
		const parsed = parseQuickCapture(raw, this.plugin.settings.lanes);
		const title = parsed && parsed.title.length > 0 ? parsed.title : raw;
		const laneId = parsed?.laneId ?? this.laneId;
		// Landet die Schnellerfassung mit Faelligkeit in der Eingang-Lane, gleich direkt in
		// "Naechste Aktionen" anlegen, statt sie erst dorthin verschieben zu muessen.
		const targetLaneId =
			shouldPromoteFromInbox(
				laneId,
				parsed?.due,
				this.plugin.settings.lanes,
				this.plugin.settings.autoPromoteInboxOnDueDate
			) ?? laneId;
		let targetFolder: string | undefined;
		const projectRoot = this.plugin.settings.projectRootFolder?.trim();
		if (projectRoot && parsed?.project) {
			const folderPath = normalizePath(`${projectRoot}/${parsed.project}`);
			if (this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder) {
				targetFolder = folderPath;
			}
		}
		await this.plugin.store.createTaskFile({
			laneId: targetLaneId,
			title,
			description: "",
			priority: parsed?.priority,
			contexts: parsed?.contexts,
			recurrence: parsed?.recurrence,
			delegatedTo: parsed?.delegatedTo,
			project: parsed?.project,
			due: parsed?.due,
			targetFolder,
		});
		await this.plugin.refreshBoardViews();
		new Notice(t("quickCapture.captured", { title }));
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Wochenrueckblick (GTD Weekly Review): fuehrt Lane fuer Lane durch alle offenen Aufgaben,
 * beginnend mit den am laengsten nicht angefassten. Pro Aufgabe drei Aktionen: bestaetigen
 * (bleibt wie sie ist, Auffrischungs-Zeitpunkt wird zurueckgesetzt), bearbeiten (oeffnet den
 * normalen Bearbeiten-Dialog und beendet den Review fuer diese Aufgabe) oder erledigt
 * (verschiebt sofort in "Erledigt"). Rein eine gefuehrte Reihenfolge durch bestehende
 * Aktionen - keine neue Datenquelle.
 */
export class ReviewModal extends Modal {
	private queue: GtdTask[] = [];
	private index = 0;
	private reviewedCount = 0;
	/** Fuer MarkdownRenderer.render() der Aufgaben-Beschreibung - in einer Variable gehalten,
	 * damit unload() beim Schliessen aufgeraeumt werden kann statt bei jedem render() eine
	 * neue, nie freigegebene Component zu erzeugen. */
	private previewComponent = new Component();

	constructor(app: App, private plugin: GtdBoardPlugin, tasks: GtdTask[]) {
		super(app);
		// Lane-Reihenfolge wie im Board, innerhalb einer Lane am laengsten nicht angefasst zuerst.
		const laneOrder = new Map(this.plugin.settings.lanes.map((l, i) => [l.id, i]));
		this.queue = [...tasks].sort((a, b) => {
			const laneDiff = (laneOrder.get(a.laneId) ?? 0) - (laneOrder.get(b.laneId) ?? 0);
			if (laneDiff !== 0) return laneDiff;
			return a.lastTouched - b.lastTouched;
		});
	}

	onOpen(): void {
		this.contentEl.addClass("gtd-review-modal");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		if (this.index >= this.queue.length) {
			this.setTitle(t("reviewModal.doneTitle"));
			contentEl.createEl("p", {
				text:
					this.queue.length === 0
						? t("reviewModal.emptyState")
						: t("reviewModal.summary", { reviewed: this.reviewedCount, total: this.queue.length }),
			});
			new Setting(contentEl).addButton((btn) =>
				btn
					.setButtonText(t("reviewModal.close"))
					.setCta()
					.onClick(() => this.close())
			);
			return;
		}

		const task = this.queue[this.index];
		const lane = this.plugin.settings.lanes.find((l) => l.id === task.laneId);
		this.setTitle(t("reviewModal.title", { index: this.index + 1, total: this.queue.length }));

		contentEl.createDiv({ cls: "gtd-review-progress" }).setText(
			t("reviewModal.laneMeta", { lane: lane?.name ?? task.laneId, days: daysSince(task.lastTouched) })
		);

		contentEl.createEl("h3", { text: task.title });

		const metaParts: string[] = [];
		if (task.due) metaParts.push(t("reviewModal.due", { due: task.due }));
		if (task.project) metaParts.push(t("reviewModal.project", { project: task.project }));
		if (task.delegatedTo) metaParts.push(t("reviewModal.delegatedTo", { name: task.delegatedTo }));
		if (task.contexts.length > 0) metaParts.push(t("reviewModal.context", { contexts: task.contexts.join(", ") }));
		if (metaParts.length > 0) {
			contentEl.createDiv({ cls: "gtd-review-meta" }).setText(metaParts.join(" · "));
		}
		if (task.description.trim().length > 0) {
			const desc = contentEl.createDiv({ cls: "gtd-review-description" });
			void MarkdownRenderer.render(this.app, task.description, desc, task.filePath, this.previewComponent);
		}

		const buttonRow = new Setting(contentEl).setClass("gtd-review-actions");
		buttonRow.addButton((btn) =>
			btn
				.setButtonText(t("reviewModal.confirm"))
				.setCta()
				.setTooltip(t("reviewModal.confirmTooltip"))
				.onClick(() => void this.confirmAndNext(task))
		);
		buttonRow.addButton((btn) =>
			btn
				.setButtonText(t("reviewModal.edit"))
				.setTooltip(t("reviewModal.editTooltip"))
				.onClick(() => this.editAndClose(task))
		);
		buttonRow.addButton((btn) =>
			btn
				.setButtonText(t("reviewModal.complete"))
				.setTooltip(t("reviewModal.completeTooltip"))
				.onClick(() => void this.completeAndNext(task))
		);
		buttonRow.addButton((btn) => btn.setButtonText(t("reviewModal.endReview")).onClick(() => this.close()));
	}

	private async confirmAndNext(task: GtdTask): Promise<void> {
		await this.plugin.markTaskReviewed(task.id);
		this.reviewedCount++;
		this.index++;
		this.render();
	}

	private async completeAndNext(task: GtdTask): Promise<void> {
		const doneLane = this.plugin.settings.lanes.find((l) => l.isDone);
		if (doneLane) {
			if (task.source === "file") {
				await this.plugin.store.moveFileTask(task, doneLane.id);
			} else {
				await this.plugin.store.moveInlineTask(task, doneLane.id);
			}
			await this.plugin.refreshBoardViews();
		}
		this.reviewedCount++;
		this.index++;
		this.render();
	}

	private editAndClose(task: GtdTask): void {
		this.close();
		new TaskModal(this.app, this.plugin, {
			mode: "edit",
			laneId: task.laneId,
			task,
			onSubmit: async (result) => {
				if (task.source === "file") {
					await this.plugin.store.updateTaskFile(task, result);
				} else {
					await this.plugin.store.convertInlineToFile(task, result);
				}
				await this.plugin.markTaskReviewed(task.id);
				await this.plugin.refreshBoardViews();
			},
		}).open();
	}

	onClose(): void {
		this.previewComponent.unload();
		this.contentEl.empty();
	}
}

/**
 * Tagesueberblick (GTD-inspiriert): zeigt auf einen Blick, was heute/ueberfaellig ist,
 * was in den naechsten 3 Tagen faellig wird, und welche delegierten Aufgaben lange keine
 * Regung hatten. Rein lesend - zum Bearbeiten wird der normale TaskModal geoeffnet.
 */
export class DailyReviewModal extends Modal {
	constructor(app: App, private plugin: GtdBoardPlugin, private tasks: GtdTask[]) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("gtd-daily-review-modal");
		this.setTitle(t("dailyReview.title"));

		const todayStr = formatLocalDate(new Date());
		const in3Days = formatLocalDate(addDays(new Date(), 3));

		const openTasks = this.tasks.filter((t) => !t.done);

		const todayOverdue = openTasks.filter(
			(t) => t.due && t.due.slice(0, 10) <= todayStr
		).sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));

		const soon = openTasks.filter(
			(t) => t.due && t.due.slice(0, 10) > todayStr && t.due.slice(0, 10) <= in3Days
		).sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));

		const staleWaiting = openTasks.filter(
			(t) => t.delegatedTo && daysSince(t.lastTouched) >= this.plugin.settings.delegateFollowUpDays
		).sort((a, b) => a.lastTouched - b.lastTouched);

		const hasContent = todayOverdue.length > 0 || soon.length > 0 || staleWaiting.length > 0;
		if (!hasContent) {
			contentEl.createEl("p", { cls: "gtd-daily-review-empty", text: t("dailyReview.empty") });
		} else {
			if (todayOverdue.length > 0) {
				contentEl.createEl("h3", { cls: "gtd-daily-review-section", text: t("dailyReview.sectionToday") });
				for (const task of todayOverdue) this.renderRow(contentEl, task);
			}
			if (soon.length > 0) {
				contentEl.createEl("h3", { cls: "gtd-daily-review-section", text: t("dailyReview.sectionSoon") });
				for (const task of soon) this.renderRow(contentEl, task);
			}
			if (staleWaiting.length > 0) {
				contentEl.createEl("h3", { cls: "gtd-daily-review-section", text: t("dailyReview.sectionWaiting") });
				for (const task of staleWaiting) this.renderRow(contentEl, task);
			}
		}

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(t("dailyReview.close")).setCta().onClick(() => this.close())
		);
	}

	private renderRow(container: HTMLElement, task: GtdTask): void {
		const row = container.createDiv({ cls: "gtd-daily-review-row" });
		const lane = this.plugin.settings.lanes.find((l) => l.id === task.laneId);
		const meta: string[] = [];
		if (lane) meta.push(lane.name);
		if (task.due) meta.push(`📅 ${task.due.slice(0, 10)}`);
		if (task.delegatedTo) meta.push(`👤 ${task.delegatedTo}`);

		const title = row.createSpan({ cls: "gtd-daily-review-title", text: task.title });
		title.addEventListener("click", () => {
			this.close();
			new TaskModal(this.app, this.plugin, {
				mode: "edit",
				laneId: task.laneId,
				task,
				onSubmit: async (result) => {
					if (task.source === "file") {
						await this.plugin.store.updateTaskFile(task, result);
					} else {
						await this.plugin.store.convertInlineToFile(task, result);
					}
					await this.plugin.refreshBoardViews();
				},
			}).open();
		});

		if (meta.length > 0) {
			row.createSpan({ cls: "gtd-daily-review-meta", text: meta.join(" · ") });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Gefuehrter Verarbeitungs-Dialog (GTD Clarify): fuehrt Schritt fuer Schritt durch die
 * GTD-Verarbeitungslogik - handlungsrelevant? 2-Minuten-Regel? Delegieren oder selbst
 * erledigen? Nicht handlungsrelevant? - und nimmt die jeweilige Aktion direkt vor.
 */
export class ProcessModal extends Modal {
	constructor(
		app: App,
		private plugin: GtdBoardPlugin,
		private task: GtdTask,
		private onDone: () => Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("gtd-process-modal");
		this.setTitle(t("processModal.title"));
		this.renderStepActionable();
	}

	private clear(): void {
		this.contentEl.empty();
		this.contentEl.addClass("gtd-process-modal");
		this.setTitle(t("processModal.title"));
	}

	private renderStepActionable(): void {
		this.clear();
		this.contentEl.createEl("p", { cls: "gtd-process-question", text: `"${this.task.title}"` });
		this.contentEl.createEl("p", { cls: "gtd-process-question", text: t("processModal.isActionable") });
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText(t("processModal.yes")).setCta().onClick(() => this.renderStepTwoMinutes()))
			.addButton((btn) => btn.setButtonText(t("processModal.no")).onClick(() => this.renderStepNotActionable()));
	}

	private renderStepTwoMinutes(): void {
		this.clear();
		this.contentEl.createEl("p", { cls: "gtd-process-question", text: `"${this.task.title}"` });
		this.contentEl.createEl("p", { cls: "gtd-process-question", text: t("processModal.twoMinutes") });
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText(t("processModal.doNow")).setCta().onClick(() => void this.doNow()))
			.addButton((btn) => btn.setButtonText(t("processModal.notTwoMinutes")).onClick(() => this.renderStepDelegate()));
	}

	private renderStepDelegate(): void {
		this.clear();
		this.contentEl.createEl("p", { cls: "gtd-process-question", text: `"${this.task.title}"` });
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText(t("processModal.delegate")).onClick(() => this.renderStepDelegateForm()))
			.addButton((btn) => btn.setButtonText(t("processModal.doSelf")).setCta().onClick(() => this.renderStepChooseLane()));
	}

	private renderStepDelegateForm(): void {
		this.clear();
		let delegateName = "";
		new Setting(this.contentEl)
			.setName(t("processModal.delegateTo"))
			.addText((text) => text.onChange((v) => (delegateName = v)));
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText(t("processModal.delegateBtn")).setCta().onClick(() => void this.delegate(delegateName)))
			.addButton((btn) => btn.setButtonText(t("taskModal.cancel")).onClick(() => this.renderStepDelegate()));
	}

	private renderStepChooseLane(): void {
		this.clear();
		const lanes = this.plugin.settings.lanes.filter((l) => !l.isDone && !l.isPlanned && !l.isInbox);
		let selectedLaneId = lanes[0]?.id ?? this.plugin.store.defaultLaneId();
		new Setting(this.contentEl)
			.setName(t("processModal.chooseLane"))
			.addDropdown((dd) => {
				for (const lane of lanes) dd.addOption(lane.id, lane.name);
				dd.setValue(selectedLaneId).onChange((v) => (selectedLaneId = v));
			});
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText(t("processModal.save")).setCta().onClick(() => void this.moveTo(selectedLaneId)))
			.addButton((btn) => btn.setButtonText(t("taskModal.cancel")).onClick(() => this.renderStepDelegate()));
	}

	private renderStepNotActionable(): void {
		this.clear();
		this.contentEl.createEl("p", { cls: "gtd-process-question", text: `"${this.task.title}"` });
		this.contentEl.createEl("p", { cls: "gtd-process-question", text: t("processModal.notActionable") });
		const somedayLane = this.plugin.settings.lanes.find((l) => l.isSomeday);
		new Setting(this.contentEl)
			.addButton((btn) => {
				btn.setButtonText(t("processModal.someday"));
				if (somedayLane) btn.onClick(() => void this.moveTo(somedayLane.id));
				else btn.setDisabled(true);
			})
			.addButton((btn) => btn.setButtonText(t("processModal.tickler")).onClick(() => this.renderStepTickler()))
			.addButton((btn) => btn.setButtonText(t("processModal.delete")).setWarning().onClick(() => void this.deleteTask()));
	}

	private renderStepTickler(): void {
		this.clear();
		let visibleFrom = "";
		new Setting(this.contentEl)
			.setName(t("processModal.ticklerDate"))
			.addText((text) => {
				text.inputEl.type = "date";
				text.onChange((v) => (visibleFrom = v));
			});
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText(t("processModal.ticklerSave")).setCta().onClick(() => void this.setTickler(visibleFrom)))
			.addButton((btn) => btn.setButtonText(t("taskModal.cancel")).onClick(() => this.renderStepNotActionable()));
	}

	private async doNow(): Promise<void> {
		const doneLane = this.plugin.settings.lanes.find((l) => l.isDone);
		if (!doneLane) { new Notice(t("notice.noDoneLane")); return; }
		if (this.task.source === "file") {
			await this.plugin.store.moveFileTask(this.task, doneLane.id);
		} else {
			await this.plugin.store.moveInlineTask(this.task, doneLane.id);
		}
		this.close();
		await this.onDone();
	}

	private async delegate(name: string): Promise<void> {
		const waitingLane = this.plugin.settings.lanes.find((l) => !l.isDone && !l.isPlanned && !l.isInbox && !l.isNextActions);
		const targetLaneId = waitingLane?.id ?? this.plugin.store.defaultLaneId();
		if (this.task.source === "file") {
			await this.plugin.store.updateTaskFile(this.task, {
				title: this.task.title,
				description: this.task.description,
				due: this.task.due,
				reminderAt: this.task.reminderAt,
				priority: this.task.priority,
				recurrence: this.task.recurrence,
				contexts: this.task.contexts,
				tags: this.task.tags,
				delegatedTo: name.trim() || undefined,
				project: this.task.project,
				person: this.task.person,
			});
			await this.plugin.store.moveFileTask(this.task, targetLaneId);
		} else {
			await this.plugin.store.convertInlineToFile(this.task, {
				title: this.task.title,
				description: this.task.description,
				due: this.task.due,
				priority: this.task.priority,
				recurrence: this.task.recurrence,
				contexts: this.task.contexts,
				tags: this.task.tags,
				delegatedTo: name.trim() || undefined,
				project: this.task.project,
			}, targetLaneId);
		}
		this.close();
		await this.onDone();
	}

	private async moveTo(laneId: string): Promise<void> {
		if (this.task.source === "file") {
			await this.plugin.store.moveFileTask(this.task, laneId);
		} else {
			await this.plugin.store.moveInlineTask(this.task, laneId);
		}
		this.close();
		await this.onDone();
	}

	private async setTickler(visibleFrom: string): Promise<void> {
		if (!visibleFrom) return;
		if (this.task.source === "file") {
			await this.plugin.store.updateTaskFile(this.task, {
				title: this.task.title,
				description: this.task.description,
				due: this.task.due,
				reminderAt: this.task.reminderAt,
				priority: this.task.priority,
				recurrence: this.task.recurrence,
				contexts: this.task.contexts,
				tags: this.task.tags,
				delegatedTo: this.task.delegatedTo,
				project: this.task.project,
				person: this.task.person,
				visibleFrom,
			});
		} else {
			await this.plugin.store.convertInlineToFile(this.task, {
				title: this.task.title,
				description: this.task.description,
				due: this.task.due,
				priority: this.task.priority,
				recurrence: this.task.recurrence,
				contexts: this.task.contexts,
				tags: this.task.tags,
				delegatedTo: this.task.delegatedTo,
				project: this.task.project,
				visibleFrom,
			});
		}
		this.close();
		await this.onDone();
	}

	private async deleteTask(): Promise<void> {
		await this.plugin.store.deleteTask(this.task);
		this.close();
		await this.onDone();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Einfacher Bestaetigungsdialog auf Basis der eingebauten ConfirmationModal-Klasse
 * (seit Obsidian 1.13.0, unsere minAppVersion). ConfirmationButton.onClick() schliesst den
 * Dialog nach dem Klick automatisch, deshalb reicht ein einziges Modal.onClose() fuer alle
 * Wege, den Dialog zu verlassen (Bestaetigen, Abbrechen, Escape) - finish() ist idempotent.
 */
export function confirmDialog(app: App, message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new ConfirmationModal(app);
		let resolved = false;
		const finish = (result: boolean) => {
			if (resolved) return;
			resolved = true;
			resolve(result);
		};

		modal.contentEl.createEl("p", { text: message });
		modal.addButton((btn) => btn.setButtonText(t("view.bulk.delete")).setDestructive().onClick(() => finish(true)));
		modal.addCancelButton(t("taskModal.cancel"));

		modal.onClose = () => finish(false);
		modal.open();
	});
}
