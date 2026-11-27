import { App, Modal, Notice, setIcon } from "obsidian";
import type GtdBoardPlugin from "./main";
import { AGENDA_LANE_ID, GtdTask } from "./types";
import { MeetingEvent } from "./meeting-ics";
import { renderPersonDetail } from "./person-view";
import { captureQuickTask, describeQuickCapture } from "./modals";
import { addDays, collectTalkPeople, dueChipDate, DueChip, parseQuickCapture, relativeDayKey } from "./util";
import { getLocale, t } from "./i18n";

/**
 * Schnellknoepfe im Board ("+ Aufgabe", "+ Notiz", "+ Besprechen") und gleichnamige Befehle:
 * jeweils ein Modal ueber dem Board, damit das Board der zentrale Bildschirm bleibt. Nutzt nur
 * vorhandene Logik (Schnellerfassung, Meeting-Notizen, Agendas).
 */
export interface QuickContext {
	app: App;
	plugin: GtdBoardPlugin;
	/** Setzt den Titel des Modals. */
	setTitle: (text: string) => void;
	/** Schliesst das Modal. */
	close: () => void;
}

function section(el: HTMLElement, text: string): void {
	el.createDiv({ cls: "gtd-quick-section", text });
}

function onEnter(input: HTMLInputElement, run: () => void): void {
	input.addEventListener("keydown", (evt) => {
		if (evt.key === "Enter" && !evt.isComposing) {
			evt.preventDefault();
			run();
		}
	});
}

function focusLater(input: HTMLInputElement): void {
	window.setTimeout(() => input.focus(), 0);
}

/** "+ Aufgabe": Titel mit Schnellerfassungs-Syntax, Faelligkeit per Chip, Ziel-Liste. */
export function renderTaskPanel(el: HTMLElement, ctx: QuickContext): void {
	const { plugin } = ctx;
	ctx.setTitle(t("quick.task.title"));

	const input = el.createEl("input", {
		cls: "gtd-quick-input",
		attr: { type: "text", placeholder: t("quick.task.placeholder") },
	});
	const hint = el.createDiv({ cls: "gtd-quick-hint", text: t("quick.task.hint") });

	section(el, t("quick.task.due"));
	const chipRow = el.createDiv({ cls: "gtd-quick-chips" });
	let dueChip: DueChip | undefined;
	const chips: { chip: DueChip | undefined; label: string }[] = [
		{ chip: undefined, label: t("quick.task.noDue") },
		{ chip: "today", label: t("quick.task.today") },
		{ chip: "tomorrow", label: t("quick.task.tomorrow") },
		{ chip: "nextWeek", label: t("quick.task.nextWeek") },
	];
	const chipEls: HTMLElement[] = [];
	chips.forEach(({ chip, label }) => {
		const chipEl = chipRow.createEl("button", { cls: "gtd-quick-chip", text: label });
		chipEl.toggleClass("is-active", chip === dueChip);
		chipEl.addEventListener("click", () => {
			dueChip = chip;
			chipEls.forEach((c, i) => c.toggleClass("is-active", chips[i].chip === dueChip));
			input.focus();
		});
		chipEls.push(chipEl);
	});

	section(el, t("quick.task.list"));
	const lanes = plugin.settings.lanes.filter((l) => !l.isPlanned && !l.isDone);
	const laneSelect = el.createEl("select", { cls: "dropdown gtd-quick-select" });
	for (const lane of lanes) laneSelect.createEl("option", { text: lane.name, value: lane.id });
	const inbox = lanes.find((l) => l.isInbox) ?? lanes[0];
	if (inbox) laneSelect.value = inbox.id;

	const updateHint = () => {
		const raw = input.value.trim();
		const parsed = raw ? parseQuickCapture(raw, plugin.settings.lanes) : null;
		hint.setText(parsed && parsed.title ? describeQuickCapture(parsed, plugin.settings.lanes) : t("quick.task.hint"));
	};
	input.addEventListener("input", updateHint);

	const submit = async () => {
		if (!laneSelect.value) return;
		const due = dueChip ? dueChipDate(dueChip) : undefined;
		const title = await captureQuickTask(ctx.app, plugin, input.value, laneSelect.value, due);
		if (!title) return;
		new Notice(t("quickCapture.captured", { title }));
		// Panel bleibt offen, damit mehrere Aufgaben hintereinander erfasst werden koennen.
		input.value = "";
		updateHint();
		input.focus();
	};
	onEnter(input, () => void submit());

	const actions = el.createDiv({ cls: "gtd-quick-actions" });
	const createBtn = actions.createEl("button", { cls: "mod-cta", text: t("quick.create") });
	createBtn.addEventListener("click", () => void submit());
	focusLater(input);
}

/**
 * "+ Notiz": Termin eines Tages aus dem ICS-Kalender waehlen (Tag per Pfeilen oder Datum
 * wechseln) oder eine Notiz ohne Termin anlegen. Vorhandene Notizen zu einem Termin werden
 * geoeffnet statt doppelt angelegt.
 */
export function renderNotePanel(el: HTMLElement, ctx: QuickContext): void {
	const { plugin } = ctx;
	const service = plugin.meetings;
	ctx.setTitle(t("quick.note.title"));

	section(el, t("quick.note.withEvent"));
	const nav = el.createDiv({ cls: "gtd-quick-daynav" });
	const prevBtn = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("quick.note.prevDay") } });
	setIcon(prevBtn, "chevron-left");
	const dayLabel = nav.createEl("button", { cls: "gtd-quick-daylabel", attr: { title: t("quick.note.backToToday") } });
	const nextBtn = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("quick.note.nextDay") } });
	setIcon(nextBtn, "chevron-right");
	const dateInput = nav.createEl("input", {
		cls: "gtd-quick-date",
		attr: { type: "date", "aria-label": t("quick.note.pickDate"), title: t("quick.note.pickDate") },
	});
	const list = el.createDiv({ cls: "gtd-quick-events" });

	const locale = getLocale() === "de" ? "de-DE" : "en-US";
	const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
	const dateFmt = new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "2-digit" });
	let day = new Date();
	let loadToken = 0;

	const renderEvents = (events: MeetingEvent[]) => {
		list.empty();
		if (events.length === 0) {
			list.createDiv({ cls: "gtd-quick-empty", text: t("quick.note.noEvents") });
			return;
		}
		for (const event of events) {
			const row = list.createEl("button", { cls: "gtd-quick-event" });
			const time = event.allDay ? t("meetings.allDay") : `${timeFmt.format(event.start)}–${timeFmt.format(event.end)}`;
			row.createSpan({ cls: "gtd-quick-event-time", text: time });
			row.createSpan({ cls: "gtd-quick-event-title", text: event.title || t("meetings.defaultTitle") });
			if (service.findNote(event)) {
				const mark = row.createSpan({ cls: "gtd-quick-event-note", attr: { title: t("meetings.hasNote") } });
				setIcon(mark, "file-text");
			}
			row.addEventListener("click", () => {
				ctx.close();
				service.openOrCreate(event, undefined, true).catch((err: unknown) => {
					console.error("GTD Board: Meeting-Notiz konnte nicht angelegt werden", err);
					new Notice(t("meetings.createFailed"));
				});
			});
		}
	};

	const load = async () => {
		const key = relativeDayKey(day);
		dayLabel.setText(key ? t(`quick.note.${key}`) : dateFmt.format(day));
		dateInput.value = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
		const token = ++loadToken;
		list.empty();
		list.createDiv({ cls: "gtd-quick-empty", text: t("quick.note.loading") });
		const result = await service.loadEvents(day);
		if (token !== loadToken) return; // inzwischen anderer Tag gewaehlt
		if ("events" in result) {
			renderEvents(result.events);
			return;
		}
		list.empty();
		const msg =
			result.error === "no-calendar"
				? t("quick.note.noCalendar")
				: result.error === "fetch-failed"
					? t("meetings.fetchFailed")
					: t("meetings.parseFailed");
		list.createDiv({ cls: "gtd-quick-empty", text: msg });
	};

	prevBtn.addEventListener("click", () => {
		day = addDays(day, -1);
		void load();
	});
	nextBtn.addEventListener("click", () => {
		day = addDays(day, 1);
		void load();
	});
	dayLabel.addEventListener("click", () => {
		day = new Date();
		void load();
	});
	dateInput.addEventListener("change", () => {
		const [y, m, d] = dateInput.value.split("-").map(Number);
		if (!y || !m || !d) return;
		day = new Date(y, m - 1, d);
		void load();
	});

	section(el, t("quick.note.withoutEvent"));
	const input = el.createEl("input", {
		cls: "gtd-quick-input",
		attr: { type: "text", placeholder: t("quick.note.placeholder") },
	});
	onEnter(input, () => {
		const title = input.value.trim();
		ctx.close();
		service.openOrCreate(undefined, title, true).catch((err: unknown) => {
			console.error("GTD Board: Meeting-Notiz konnte nicht angelegt werden", err);
			new Notice(t("meetings.createFailed"));
		});
	});
	el.createDiv({
		cls: "gtd-quick-hint",
		text: t("quick.note.savedIn", { folder: plugin.settings.meetingFolder.trim() || "Meetings" }),
	});

	void load();
	focusLater(input);
}

/**
 * Generisches Modal fuer die Schnellerfassung ("+ Aufgabe", "+ Notiz"): dieselben Inhalte wie
 * vorher im Ausklapp-Panel, aber als Dialog ueber dem Board.
 */
export class QuickModal extends Modal {
	constructor(
		app: App,
		private plugin: GtdBoardPlugin,
		private render: (el: HTMLElement, ctx: QuickContext) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("gtd-quick-modal");
		this.render(this.contentEl, {
			app: this.app,
			plugin: this.plugin,
			setTitle: (text) => this.setTitle(text),
			close: () => this.close(),
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * "Besprechen mit" (Knopf, Befehl, Seitenleiste "Gespraeche", Agendas-Lane): oben die Person
 * waehlen (bekannte Personen mit Zahl offener Themen) oder einen neuen Namen eintippen; darunter
 * erscheint fuer diese Person alles Vorhandene (Themen, Anmerkungen, Delegiertes, Verlauf) samt
 * Eingabefeld fuer neue Themen. Neue Themen landen in der vorhandenen Personennotiz bzw. legen
 * sie an. Alles bleibt im Modal.
 */
export class TalkModal extends Modal {
	private person = "";
	private tasks: GtdTask[] = [];
	private detailEl!: HTMLElement;
	private peopleEl!: HTMLElement;
	private personInput!: HTMLInputElement;

	constructor(
		app: App,
		private plugin: GtdBoardPlugin,
		presetPerson?: string,
		private onOpenTask?: (task: GtdTask) => void
	) {
		super(app);
		this.person = presetPerson?.trim() ?? "";
	}

	async onOpen(): Promise<void> {
		this.modalEl.addClass("gtd-quick-modal", "gtd-talk-modal");
		this.setTitle(t("quick.talk.title"));
		const { contentEl } = this;

		if (!this.plugin.settings.agendaEnabled) {
			contentEl.createDiv({ cls: "gtd-quick-empty", text: t("quick.talk.disabled") });
			return;
		}

		this.personInput = contentEl.createEl("input", {
			cls: "gtd-quick-input",
			attr: { type: "text", placeholder: t("quick.talk.personPlaceholder") },
		});
		this.personInput.value = this.person;
		this.peopleEl = contentEl.createDiv({ cls: "gtd-quick-people" });
		this.detailEl = contentEl.createDiv({ cls: "gtd-talk-detail" });

		this.personInput.addEventListener("input", () => this.renderPeople());
		this.personInput.addEventListener("keydown", (evt) => {
			if (evt.key !== "Enter" || evt.isComposing) return;
			evt.preventDefault();
			const name = this.personInput.value.trim();
			if (!name) return;
			// Bekannte Person in ihrer gespeicherten Schreibweise uebernehmen.
			const known = this.people().find((p) => p.name.toLowerCase() === name.toLowerCase());
			this.selectPerson(known?.name ?? name);
		});

		await this.reloadTasks();
		this.renderPeople();
		if (this.person) this.renderDetail(true);
		else window.setTimeout(() => this.personInput.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private people() {
		return collectTalkPeople(this.tasks, AGENDA_LANE_ID);
	}

	private async reloadTasks(): Promise<void> {
		this.tasks = await this.plugin.store.getAllTasks();
	}

	private selectPerson(name: string): void {
		this.person = name;
		this.personInput.value = name;
		this.renderPeople();
		this.renderDetail(true);
	}

	private renderPeople(): void {
		this.peopleEl.empty();
		const q = this.personInput.value.trim().toLowerCase();
		const people = this.people();
		const matches = people.filter((p) => !q || p.name.toLowerCase().includes(q));
		for (const person of matches.slice(0, 10)) {
			const chip = this.peopleEl.createEl("button", { cls: "gtd-quick-chip" });
			chip.toggleClass("is-active", person.name.toLowerCase() === this.person.toLowerCase());
			chip.createSpan({ text: person.name });
			if (person.openTopics > 0) chip.createSpan({ cls: "gtd-quick-chip-count", text: String(person.openTopics) });
			chip.addEventListener("click", () => this.selectPerson(person.name));
		}
		const typed = this.personInput.value.trim();
		if (typed && !people.some((p) => p.name.toLowerCase() === typed.toLowerCase())) {
			const chip = this.peopleEl.createEl("button", { cls: "gtd-quick-chip gtd-quick-chip-new" });
			chip.setText(t("quick.talk.newPerson", { name: typed }));
			chip.toggleClass("is-active", typed.toLowerCase() === this.person.toLowerCase());
			chip.addEventListener("click", () => this.selectPerson(typed));
		}
	}

	private renderDetail(focusInput: boolean): void {
		this.detailEl.empty();
		if (!this.person) return;
		renderPersonDetail(this.detailEl, {
			app: this.app,
			plugin: this.plugin,
			person: this.person,
			tasks: this.tasks,
			focusInput,
			onOpenTask: this.onOpenTask,
			reload: async () => {
				await this.reloadTasks();
				await this.plugin.refreshBoardViews();
				this.renderPeople();
				this.renderDetail(true);
			},
		});
	}
}

/** Oeffnet "Besprechen mit", optional gleich fuer eine Person. */
export function openTalkModal(
	app: App,
	plugin: GtdBoardPlugin,
	presetPerson?: string,
	onOpenTask?: (task: GtdTask) => void
): void {
	new TalkModal(app, plugin, presetPerson, onOpenTask).open();
}
