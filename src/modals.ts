import { App, ButtonComponent, Component, MarkdownRenderer, Modal, Notice, Setting } from "obsidian";
import type GtdBoardPlugin from "./main";
import { GtdTask, LaneConfig, RecurrenceRule, TaskPriority } from "./types";
import {
	daysSince,
	formatLocalDateTime,
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
}

export interface TaskModalOptions {
	mode: "create" | "edit";
	laneId: string;
	task?: GtdTask;
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
	private previewComponent = new Component();
	/** Steuert, ob im Beschreibungs-Editor Markdown-Quelltext oder die gerenderte Vorschau angezeigt wird. */
	private descriptionShowingPreview = false;

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
		this.project = task?.project ?? "";
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
		this.setTitle(this.options.mode === "create" ? t("taskModal.titleCreate") : t("taskModal.titleEdit"));

		new Setting(contentEl).setName(t("taskModal.title")).addText((text) => {
			text.setValue(this.title).onChange((v) => (this.title = v));
			text.inputEl.addClass("gtd-modal-title-input");
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		let descToggleButton: ButtonComponent;
		new Setting(contentEl)
			.setName(t("taskModal.description"))
			.setDesc(t("taskModal.descriptionDesc"))
			.setClass("gtd-modal-description-setting")
			.addButton((btn) => {
				descToggleButton = btn;
				btn.onClick(() => {
					this.descriptionShowingPreview = !this.descriptionShowingPreview;
					updateDescriptionView();
				});
			});

		const editorWrap = contentEl.createDiv({ cls: "gtd-description-editor" });
		const textarea = editorWrap.createEl("textarea", { cls: "gtd-description-textarea" });
		textarea.value = this.description;
		textarea.rows = 8;
		const preview = editorWrap.createDiv({ cls: "gtd-description-preview" });

		const renderPreview = () => {
			preview.empty();
			void MarkdownRenderer.render(
				this.app,
				this.description || t("taskModal.noDescription"),
				preview,
				this.options.task?.filePath ?? "",
				this.previewComponent
			);
		};
		textarea.addEventListener("input", () => {
			this.description = textarea.value;
		});

		// Umschalten statt Nebeneinander: entweder Markdown-Quelltext bearbeiten oder die
		// gerenderte Vorschau ansehen (wird beim Umschalten dorthin jeweils neu aufgebaut).
		const updateDescriptionView = () => {
			if (this.descriptionShowingPreview) {
				renderPreview();
				textarea.style.display = "none";
				preview.style.display = "";
				descToggleButton.setButtonText(t("taskModal.editButton"));
			} else {
				textarea.style.display = "";
				preview.style.display = "none";
				descToggleButton.setButtonText(t("taskModal.previewButton"));
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

		new Setting(contentEl)
			.setName(t("taskModal.project"))
			.setDesc(t("taskModal.projectDesc"))
			.addText((text) => {
				text.setPlaceholder(t("taskModal.projectPlaceholder")).setValue(this.project).onChange((v) => (this.project = v));
			});

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
		});
		this.close();
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
			void MarkdownRenderer.render(this.app, task.description, desc, task.filePath, new Component());
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
		this.contentEl.empty();
	}
}
