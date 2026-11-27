import { App, Notice, setIcon } from "obsidian";
import type GtdBoardPlugin from "./main";
import { AGENDA_LANE_ID, GtdTask } from "./types";
import { MeetingEvent } from "./meeting-ics";
import { captureQuickTask, describeQuickCapture } from "./modals";
import { addDays, collectTalkPeople, dueChipDate, DueChip, parseQuickCapture, relativeDayKey } from "./util";
import { getLocale, t } from "./i18n";

/**
 * Schnellknoepfe im Board ("+ Aufgabe", "+ Notiz", "+ Besprechen"): jeweils ein kleines
 * Ausklapp-Panel unter dem Knopf, damit das Board der zentrale Bildschirm sein kann. Die
 * Panels nutzen nur vorhandene Logik (Schnellerfassung, Meeting-Notizen, Agenda-Dateien).
 */
export interface QuickContext {
	app: App;
	plugin: GtdBoardPlugin;
	/** Aktuelle Aufgaben des Boards (fuer die Personenliste). */
	tasks: () => GtdTask[];
	/** Schliesst das Panel. */
	close: () => void;
}

function header(el: HTMLElement, text: string): void {
	el.createDiv({ cls: "gtd-quick-title", text });
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
	header(el, t("quick.task.title"));

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
	header(el, t("quick.note.title"));

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
 * "+ Besprechen": Thema fuer ein Gespraech mit einer Person notieren. Person aus der Liste
 * waehlen (mit Zahl offener Themen) oder neu eintippen; angelegt wird ein Agendapunkt.
 */
export function renderTalkPanel(el: HTMLElement, ctx: QuickContext): void {
	const { plugin } = ctx;
	header(el, t("quick.talk.title"));

	if (!plugin.settings.agendaEnabled) {
		el.createDiv({ cls: "gtd-quick-empty", text: t("quick.talk.disabled") });
		return;
	}

	section(el, t("quick.talk.person"));
	const personInput = el.createEl("input", {
		cls: "gtd-quick-input",
		attr: { type: "text", placeholder: t("quick.talk.personPlaceholder") },
	});
	const peopleList = el.createDiv({ cls: "gtd-quick-people" });
	const people = collectTalkPeople(ctx.tasks(), AGENDA_LANE_ID);

	section(el, t("quick.talk.topic"));
	const topicInput = el.createEl("input", {
		cls: "gtd-quick-input",
		attr: { type: "text", placeholder: t("quick.talk.topicPlaceholder") },
	});

	const renderPeople = () => {
		peopleList.empty();
		const q = personInput.value.trim().toLowerCase();
		const matches = people.filter((p) => !q || p.name.toLowerCase().includes(q));
		for (const person of matches.slice(0, 8)) {
			const chip = peopleList.createEl("button", { cls: "gtd-quick-chip" });
			chip.toggleClass("is-active", person.name.toLowerCase() === q);
			chip.createSpan({ text: person.name });
			if (person.openTopics > 0) chip.createSpan({ cls: "gtd-quick-chip-count", text: String(person.openTopics) });
			chip.addEventListener("click", () => {
				personInput.value = person.name;
				renderPeople();
				topicInput.focus();
			});
		}
		if (q && !people.some((p) => p.name.toLowerCase() === q)) {
			peopleList.createDiv({ cls: "gtd-quick-hint", text: t("quick.talk.newPerson", { name: personInput.value.trim() }) });
		}
	};
	personInput.addEventListener("input", renderPeople);
	onEnter(personInput, () => topicInput.focus());

	const submit = async () => {
		const person = personInput.value.trim();
		const topic = topicInput.value.trim();
		if (!person) {
			personInput.focus();
			return;
		}
		if (!topic) {
			topicInput.focus();
			return;
		}
		await plugin.store.createAgendaFile({ title: topic, person });
		const known = people.find((p) => p.name.toLowerCase() === person.toLowerCase());
		if (known) known.openTopics++;
		else people.unshift({ name: person, openTopics: 1 });
		renderPeople();
		await plugin.refreshBoardViews();
		new Notice(t("quick.talk.captured", { name: person }));
		// Person bleibt stehen, damit gleich weitere Themen fuer sie folgen koennen.
		topicInput.value = "";
		topicInput.focus();
	};
	onEnter(topicInput, () => void submit());

	const actions = el.createDiv({ cls: "gtd-quick-actions" });
	const createBtn = actions.createEl("button", { cls: "mod-cta", text: t("quick.create") });
	createBtn.addEventListener("click", () => void submit());

	renderPeople();
	focusLater(personInput);
}
