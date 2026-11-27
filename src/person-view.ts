import { App, Notice, setIcon } from "obsidian";
import type GtdBoardPlugin from "./main";
import { AGENDA_LANE_ID, GtdTask } from "./types";
import { formatShortDue } from "./util";
import { getLocale, t } from "./i18n";

/**
 * Detailansicht einer Person fuer Gespraeche (im Modal "Besprechen mit"): Eingabefeld fuer
 * neue Themen, offene Themen mit Anmerkungen und Aktionen, an die Person delegierte Aufgaben
 * und besprochene Themen als Verlauf. Alles bleibt im Modal; nichts springt in eine Notiz.
 */
export interface PersonDetailDeps {
	app: App;
	plugin: GtdBoardPlugin;
	person: string;
	tasks: GtdTask[];
	/** Nach einer Aenderung: Aufgaben neu laden und die Ansicht neu zeichnen. */
	reload: () => Promise<void>;
	/** Oeffnet eine delegierte Aufgabe (z. B. im Aufgaben-Dialog); ohne Callback nicht klickbar. */
	onOpenTask?: (task: GtdTask) => void;
	/** Fokus nach dem Zeichnen ins Themenfeld setzen. */
	focusInput?: boolean;
}

function samePerson(a: string | undefined, b: string): boolean {
	return (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
}

function shortDue(due: string): string {
	return formatShortDue(due, getLocale() === "de" ? "de-DE" : "en-US", {
		today: t("quick.note.today"),
		tomorrow: t("quick.note.tomorrow"),
		yesterday: t("quick.note.yesterday"),
	});
}

export function renderPersonDetail(el: HTMLElement, deps: PersonDetailDeps): void {
	const { plugin, person } = deps;
	const container = el.createDiv({ cls: "gtd-person-view" });
	const topics = deps.tasks.filter((t) => t.laneId === AGENDA_LANE_ID && samePerson(t.person, person));
	const open = topics.filter((t) => !t.done);
	const done = topics.filter((t) => t.done).sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""));
	const delegated = deps.tasks.filter((t) => !t.done && t.laneId !== AGENDA_LANE_ID && samePerson(t.delegatedTo, person));

	const input = container.createEl("input", {
		cls: "gtd-person-input",
		attr: { type: "text", placeholder: t("view.person.newTopic", { name: person }) },
	});
	input.addEventListener("keydown", (evt) => {
		if (evt.key !== "Enter" || evt.isComposing) return;
		evt.preventDefault();
		const topic = input.value.trim();
		if (!topic) return;
		void (async () => {
			await plugin.store.addAgendaTopic(person, topic);
			new Notice(t("quick.talk.captured", { name: person }));
			await deps.reload();
		})();
	});
	if (deps.focusInput) window.setTimeout(() => input.focus(), 0);

	const openSection = container.createDiv({ cls: "gtd-person-section" });
	openSection.createDiv({ cls: "gtd-person-section-title", text: t("view.person.openTopics", { count: open.length }) });
	if (open.length === 0) {
		const isKnown = topics.length > 0 || !!plugin.store.findPersonNote(person);
		openSection.createDiv({
			cls: "gtd-person-empty",
			text: isKnown ? t("view.person.noOpenTopics") : t("view.person.newPersonHint", { name: person }),
		});
	}
	for (const topic of open) renderTopic(openSection, topic, deps);

	if (delegated.length > 0) {
		const section = container.createDiv({ cls: "gtd-person-section" });
		section.createDiv({ cls: "gtd-person-section-title", text: t("view.person.delegated", { name: person }) });
		for (const task of delegated) {
			const row = section.createDiv({ cls: "gtd-person-delegated" });
			row.createSpan({ cls: "gtd-person-topic-title", text: task.title });
			if (task.due) row.createSpan({ cls: "gtd-person-topic-date", text: shortDue(task.due) });
			if (deps.onOpenTask) {
				const openTask = deps.onOpenTask;
				row.addClass("is-clickable");
				row.setAttribute("role", "button");
				row.setAttribute("tabindex", "0");
				row.addEventListener("click", () => openTask(task));
			}
		}
	}

	if (done.length > 0) {
		const details = container.createEl("details", { cls: "gtd-person-section gtd-person-done" });
		details.createEl("summary", { cls: "gtd-person-section-title", text: t("view.person.discussed", { count: done.length }) });
		for (const topic of done) renderTopic(details, topic, deps);
	}
}

/** Ein Thema: Haken (besprochen), Titel, Anmerkungen und Aktionen. */
function renderTopic(parent: HTMLElement, topic: GtdTask, deps: PersonDetailDeps): void {
	const { plugin } = deps;
	const row = parent.createDiv({ cls: "gtd-person-topic" });
	if (topic.done) row.addClass("is-done");
	const main = row.createDiv({ cls: "gtd-person-topic-main" });
	const checkbox = main.createEl("input", { cls: "task-list-item-checkbox", attr: { type: "checkbox" } });
	checkbox.checked = topic.done;
	checkbox.setAttribute("aria-label", topic.done ? t("view.person.reopen") : t("view.person.markDiscussed"));
	checkbox.addEventListener("change", () => {
		void (async () => {
			const doneLaneId = plugin.settings.lanes.find((l) => l.isDone)?.id;
			if (!doneLaneId) {
				new Notice(t("notice.noDoneLane"));
				return;
			}
			const target = topic.done ? topic.laneId : doneLaneId;
			if (topic.source === "inline") await plugin.store.moveInlineTask(topic, target);
			else await plugin.store.moveFileTask(topic, target);
			await deps.reload();
		})();
	});
	main.createSpan({ cls: "gtd-person-topic-title", text: topic.title });
	if (topic.doneDate) main.createSpan({ cls: "gtd-person-topic-date", text: topic.doneDate });

	const notes = topic.description
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	if (notes.length > 0) {
		const list = row.createEl("ul", { cls: "gtd-person-topic-notes" });
		for (const n of notes) list.createEl("li", { text: n });
	}

	const actions = row.createDiv({ cls: "gtd-person-topic-actions" });
	const action = (icon: string, label: string, run: () => void) => {
		const btn = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
		setIcon(btn, icon);
		btn.addEventListener("click", run);
	};
	action("message-square-plus", t("view.person.addNote"), () => {
		if (row.querySelector(".gtd-person-note-input")) return;
		const noteInput = row.createEl("input", {
			cls: "gtd-person-note-input",
			attr: { type: "text", placeholder: t("view.person.notePlaceholder") },
		});
		noteInput.focus();
		noteInput.addEventListener("keydown", (evt) => {
			if (evt.key === "Escape") {
				// Nur das Anmerkungsfeld schliessen, nicht das ganze Modal.
				evt.preventDefault();
				evt.stopPropagation();
				noteInput.remove();
				return;
			}
			if (evt.key !== "Enter" || evt.isComposing) return;
			evt.preventDefault();
			const text = noteInput.value.trim();
			if (!text) return;
			void (async () => {
				if (topic.source === "inline") {
					await plugin.store.addAgendaNote(topic, text);
				} else {
					const body = topic.description.trim();
					await plugin.store.patchFileTaskBody(topic, `${body}${body ? "\n" : ""}- ${text}`);
				}
				await deps.reload();
			})();
		});
	});
	if (!topic.done) {
		const convert = (delegate: boolean) =>
			void (async () => {
				const file = await plugin.store.convertAgendaToTask(topic, delegate);
				new Notice(t(delegate ? "view.person.delegatedNotice" : "view.person.convertedNotice", { title: file.basename }));
				await deps.reload();
			})();
		action("square-check", t("view.person.toTask"), () => convert(false));
		action("user-check", t("view.person.delegate", { name: topic.person ?? "" }), () => convert(true));
	}
}
