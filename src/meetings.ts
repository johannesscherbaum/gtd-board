import { App, Notice, SuggestModal, TFile, TFolder, normalizePath, requestUrl } from "obsidian";
import type GtdBoardPlugin from "./main";
import { MeetingEvent, noteMatchesMeeting, parseIcsEvents, renderMeetingTemplate } from "./meeting-ics";
import { addDays, formatLocalDate, joinPath, sanitizeFileName } from "./util";
import { getLocale, t } from "./i18n";

/** Abgerufener Kalender bleibt so lange im Speicher, um nicht bei jedem Aufruf neu zu laden. */
const CACHE_MS = 5 * 60_000;

export type LoadResult = { events: MeetingEvent[] } | { error: "no-calendar" | "fetch-failed" | "parse-failed" };

/**
 * Meeting-Notizen: liest die Termine des Tages aus einem ICS-Kalender (URL liegt im Obsidian-
 * Secret-Speicher, in den Einstellungen steht nur deren Name), legt dazu eine Notiz aus einer
 * Vorlage an oder oeffnet eine vorhandene (eigene ueber meeting_uid, Meetings Plus ueber
 * meeting_dedup_key). Die Notiz oeffnet sich im normalen Editor. Die Kalender-URL wird nie
 * geloggt oder angezeigt.
 */
export class MeetingService {
	private cache: { fetchedAt: number; text: string } | undefined;

	constructor(private app: App, private plugin: GtdBoardPlugin) {}

	/** Verwirft den zwischengespeicherten Kalender (z. B. nach Aenderung der Einstellung). */
	clearCache(): void {
		this.cache = undefined;
	}

	/** Termine von heute (lokale Zeit, 00:00 bis 24:00), nach Beginn sortiert. */
	async loadTodayEvents(now: Date = new Date()): Promise<LoadResult> {
		return this.loadEvents(now);
	}

	/** Termine eines beliebigen Tages (lokale Zeit, 00:00 bis 24:00), nach Beginn sortiert. */
	async loadEvents(day: Date): Promise<LoadResult> {
		const secretId = this.plugin.settings.meetingIcsSecret.trim();
		const url = secretId ? this.app.secretStorage.getSecret(secretId) : null;
		if (!url) return { error: "no-calendar" };

		let text: string;
		if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_MS) {
			text = this.cache.text;
		} else {
			try {
				const response = await requestUrl({ url: url.trim().replace(/^webcal:\/\//i, "https://"), throw: false });
				if (response.status < 200 || response.status >= 300) {
					// Bewusst nur der Statuscode: die URL enthaelt oft einen geheimen Token.
					console.error(`GTD Board: Kalender konnte nicht geladen werden (HTTP ${response.status})`);
					return { error: "fetch-failed" };
				}
				text = response.text;
			} catch {
				console.error("GTD Board: Kalender konnte nicht geladen werden (Netzwerkfehler)");
				return { error: "fetch-failed" };
			}
			this.cache = { fetchedAt: Date.now(), text };
		}

		const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
		try {
			return { events: parseIcsEvents(text, dayStart, addDays(dayStart, 1)) };
		} catch {
			console.error("GTD Board: Kalender konnte nicht gelesen werden (kein gueltiges ICS)");
			return { error: "parse-failed" };
		}
	}

	/** Sucht eine vorhandene Notiz zum Termin im ganzen Vault (eigene und Meetings-Plus-Notizen). */
	findNote(event: MeetingEvent): TFile | undefined {
		for (const file of this.app.vault.getMarkdownFiles()) {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (noteMatchesMeeting(frontmatter, event)) return file;
		}
		return undefined;
	}

	/**
	 * Oeffnet die Notiz zu einem Termin bzw. legt sie aus der Vorlage an. Ohne Termin (event
	 * undefined) entsteht eine freie Meeting-Notiz mit dem uebergebenen Titel. Mit inNewTab
	 * (Aufruf aus dem Board) oeffnet sie in einem neuen Tab, damit das Board stehen bleibt.
	 */
	async openOrCreate(event: MeetingEvent | undefined, freeTitle?: string, inNewTab = false): Promise<void> {
		const leaf = () => this.app.workspace.getLeaf(inNewTab ? "tab" : false);
		if (event) {
			const existing = this.findNote(event);
			if (existing) {
				await leaf().openFile(existing);
				return;
			}
		}

		const now = new Date();
		const start = event?.start ?? now;
		const title = (event?.title || freeTitle?.trim() || t("meetings.defaultTitle")).trim();
		const content = await this.buildContent(event, title, start);

		const folder = normalizePath(this.plugin.settings.meetingFolder.trim() || "Meetings");
		await this.ensureFolder(folder);
		const baseName = sanitizeFileName(`${formatLocalDate(start)} ${title}`);
		let path = joinPath(folder, `${baseName}.md`);
		let counter = 2;
		while (this.app.vault.getAbstractFileByPath(path)) {
			path = joinPath(folder, `${baseName} ${counter}.md`);
			counter++;
		}

		const file = await this.app.vault.create(path, content);
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm.meeting_title = title;
			fm.meeting_start = formatTime(start, event?.allDay ?? false);
			if (event) {
				fm.meeting_end = formatTime(event.end, event.allDay);
				fm.meeting_uid = event.uid;
				if (event.recurrenceId) fm.meeting_recurrence_id = event.recurrenceId;
			}
		});
		await leaf().openFile(file);
	}

	private async buildContent(event: MeetingEvent | undefined, title: string, start: Date): Promise<string> {
		const timeFmt = new Intl.DateTimeFormat(getLocale() === "de" ? "de-DE" : "en-US", { hour: "2-digit", minute: "2-digit" });
		const time = event?.allDay ? t("meetings.allDay") : event ? `${timeFmt.format(event.start)}–${timeFmt.format(event.end)}` : timeFmt.format(start);
		const vars: Record<string, string> = {
			title,
			date: formatLocalDate(start),
			time,
			location: event?.location ?? "",
			attendees: event ? event.attendees.join(", ") : "",
		};

		const templatePath = this.plugin.settings.meetingTemplatePath.trim();
		if (templatePath) {
			const withExt = templatePath.endsWith(".md") ? templatePath : `${templatePath}.md`;
			const template = this.app.vault.getAbstractFileByPath(normalizePath(withExt));
			if (template instanceof TFile) {
				return renderMeetingTemplate(await this.app.vault.read(template), vars);
			}
			new Notice(t("meetings.templateMissing", { path: withExt }));
		}

		const lines = [`# ${title}`, "", `${vars.date} · ${time}`];
		if (vars.location) lines.push(`${t("meetings.location")}: ${vars.location}`);
		if (vars.attendees) lines.push(`${t("meetings.attendees")}: ${vars.attendees}`);
		lines.push(
			"",
			`## ${t("meetings.agendaHeading")}`,
			"",
			"",
			`## ${t("meetings.notesHeading")}`,
			"",
			"",
			`## ${t("meetings.tasksHeading")}`,
			""
		);
		return lines.join("\n");
	}

	private async ensureFolder(path: string): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(path) instanceof TFolder) return;
		let current = "";
		for (const part of path.split("/")) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
		}
	}
}

/** Lokale Zeit als "YYYY-MM-DDTHH:mm" (ganztaegig nur "YYYY-MM-DD"), wie bei den Aufgaben. */
function formatTime(date: Date, allDay: boolean): string {
	if (allDay) return formatLocalDate(date);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type MeetingChoice = { kind: "free"; title: string } | { kind: "event"; event: MeetingEvent; hasNote: boolean };

/**
 * Auswahl fuer "Neue Meeting-Notiz": oben "Ohne Termin" (der eingetippte Text wird zum Titel),
 * darunter die Termine von heute. Termine mit vorhandener Notiz sind gekennzeichnet und oeffnen
 * diese, statt eine zweite anzulegen.
 */
export class MeetingSuggestModal extends SuggestModal<MeetingChoice> {
	constructor(app: App, private service: MeetingService, private events: MeetingEvent[]) {
		super(app);
		this.setPlaceholder(t("meetings.placeholder"));
	}

	getSuggestions(query: string): MeetingChoice[] {
		const q = query.trim().toLowerCase();
		const free: MeetingChoice = { kind: "free", title: query.trim() };
		const events = this.events
			.filter((e) => !q || e.title.toLowerCase().includes(q) || (e.location ?? "").toLowerCase().includes(q))
			.map((event): MeetingChoice => ({ kind: "event", event, hasNote: !!this.service.findNote(event) }));
		return [free, ...events];
	}

	renderSuggestion(choice: MeetingChoice, el: HTMLElement): void {
		el.addClass("gtd-meeting-suggestion");
		if (choice.kind === "free") {
			el.createDiv({
				cls: "gtd-meeting-suggestion-title",
				text: choice.title ? t("meetings.freeWithTitle", { title: choice.title }) : t("meetings.free"),
			});
			el.createDiv({ cls: "gtd-meeting-suggestion-meta", text: t("meetings.freeHint") });
			return;
		}
		const { event } = choice;
		const timeFmt = new Intl.DateTimeFormat(getLocale() === "de" ? "de-DE" : "en-US", { hour: "2-digit", minute: "2-digit" });
		const time = event.allDay ? t("meetings.allDay") : `${timeFmt.format(event.start)}–${timeFmt.format(event.end)}`;
		el.createDiv({ cls: "gtd-meeting-suggestion-title", text: event.title || t("meetings.defaultTitle") });
		const meta = [time, event.location, choice.hasNote ? t("meetings.hasNote") : undefined].filter(Boolean).join(" · ");
		el.createDiv({ cls: "gtd-meeting-suggestion-meta", text: meta });
	}

	onChooseSuggestion(choice: MeetingChoice): void {
		const run = choice.kind === "free" ? this.service.openOrCreate(undefined, choice.title) : this.service.openOrCreate(choice.event);
		run.catch((err: unknown) => {
			console.error("GTD Board: Meeting-Notiz konnte nicht angelegt werden", err);
			new Notice(t("meetings.createFailed"));
		});
	}
}

/** Befehl "Neue Meeting-Notiz": laedt die Termine von heute und zeigt die Auswahl. */
export async function openNewMeetingNote(app: App, service: MeetingService): Promise<void> {
	const result = await service.loadTodayEvents();
	let events: MeetingEvent[] = [];
	if ("events" in result) {
		events = result.events;
	} else if (result.error === "fetch-failed") {
		new Notice(t("meetings.fetchFailed"));
	} else if (result.error === "parse-failed") {
		new Notice(t("meetings.parseFailed"));
	}
	// Ohne Kalender (oder bei Fehlern) bleibt die Auswahl "Ohne Termin" moeglich.
	new MeetingSuggestModal(app, service, events).open();
}
