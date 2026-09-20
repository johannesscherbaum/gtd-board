import { parseYaml, stringifyYaml } from "obsidian";
import { GtdBoardSettings, GtdTask, LaneConfig, RecurrenceRule, TaskPriority } from "./types";
import { t } from "./i18n";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface ParsedTaskFile {
	frontmatter: Record<string, any>;
	body: string;
}

/** Zerlegt den Inhalt einer Aufgaben-Datei in Frontmatter und Markdown-Body. */
export function parseTaskFile(content: string): ParsedTaskFile {
	const match = FRONTMATTER_RE.exec(content);
	if (!match) {
		return { frontmatter: {}, body: content };
	}
	const raw = parseYaml(match[1]);
	const frontmatter = raw && typeof raw === "object" ? raw : {};
	return { frontmatter, body: match[2].replace(/^\r?\n/, "") };
}

/** Baut den vollstaendigen Dateiinhalt (Frontmatter + Body) einer Aufgaben-Datei. */
export function buildTaskFileContent(frontmatter: Record<string, any>, body: string): string {
	const cleaned: Record<string, any> = {};
	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined || value === null || value === "") continue;
		if (Array.isArray(value) && value.length === 0) continue;
		cleaned[key] = value;
	}
	const yaml = stringifyYaml(cleaned);
	const bodyTrimmed = body ?? "";
	return `---\n${yaml}---\n\n${bodyTrimmed}`.replace(/\n+$/, "\n");
}

/** Macht aus einem Titel einen dateisystem-vertraeglichen Dateinamen (ohne Endung). */
export function sanitizeFileName(title: string): string {
	const cleaned = title
		.replace(/[\\/:*?"<>|#^[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned.length > 0 ? cleaned.slice(0, 100) : t("file.fallbackName");
}

export function nowISO(): string {
	return formatLocalDateTime(new Date());
}

/** Formatiert ein Date als lokales "YYYY-MM-DDTHH:mm" (fuer datetime-local Inputs und Speicherung). */
export function formatLocalDateTime(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
		date.getHours()
	)}:${pad(date.getMinutes())}`;
}

/** Formatiert ein Date als lokales "YYYY-MM-DD" (Datum ohne Uhrzeit). */
export function formatLocalDate(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Montag 00:00 Uhr der Woche, die `date` enthaelt (fuer die Wochenansicht). */
export function startOfWeek(date: Date): Date {
	const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const day = d.getDay(); // 0 = Sonntag, 1 = Montag, ...
	const diffToMonday = day === 0 ? -6 : 1 - day;
	d.setDate(d.getDate() + diffToMonday);
	return d;
}

/** Neues Date, `days` Tage nach `date` (lokal, kalendertagbasiert statt in Millisekunden). */
export function addDays(date: Date, days: number): Date {
	const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	d.setDate(d.getDate() + days);
	return d;
}

/** Parst "YYYY-MM-DD" oder "YYYY-MM-DDTHH:mm" als lokale Zeit in ein Date. Gibt undefined bei ungueltiger Eingabe zurueck. */
export function parseLocalDateTime(value: string | undefined, fallbackTime = "09:00"): Date | undefined {
	if (!value) return undefined;
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(value.trim());
	if (!m) return undefined;
	const [, y, mo, d, h, mi] = m;
	const [fh, fmi] = fallbackTime.split(":");
	const hour = h ?? fh;
	const minute = mi ?? fmi;
	const date = new Date(
		Number(y),
		Number(mo) - 1,
		Number(d),
		Number(hour),
		Number(minute),
		0,
		0
	);
	if (isNaN(date.getTime())) return undefined;
	return date;
}

export function hasTimeComponent(value: string | undefined): boolean {
	if (!value) return false;
	return /T\d{2}:\d{2}/.test(value);
}

/** Ermittelt den effektiven Erinnerungszeitpunkt einer Aufgabe (explizit gesetzt oder aus Faelligkeit + Standard-Offset). */
export function computeEffectiveReminder(
	task: Pick<GtdTask, "due" | "reminderAt">,
	settings: Pick<GtdBoardSettings, "defaultReminderOffsetMinutes">
): Date | undefined {
	if (task.reminderAt) {
		return parseLocalDateTime(task.reminderAt);
	}
	if (!task.due) return undefined;
	const dueDate = parseLocalDateTime(task.due);
	if (!dueDate) return undefined;
	const offset = settings.defaultReminderOffsetMinutes ?? 0;
	return new Date(dueDate.getTime() - offset * 60_000);
}

export type DueUrgency = "overdue" | "today" | "week" | "later";

/**
 * Dringlichkeit einer Faelligkeit rein auf Tagesbasis (Uhrzeit wird ignoriert):
 * "overdue" = Faelligkeitstag liegt vor heute, "today" = heute, "week" = in den
 * naechsten 7 Tagen, "later" = danach. Ohne gueltiges Datum: undefined.
 */
export function dueUrgency(due: string | undefined, referenceNow: Date = new Date()): DueUrgency | undefined {
	const dueDate = parseLocalDateTime(due);
	if (!dueDate) return undefined;
	const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
	const today = startOfDay(referenceNow);
	const dueDay = startOfDay(dueDate);
	const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
	if (diffDays < 0) return "overdue";
	if (diffDays === 0) return "today";
	if (diffDays <= 7) return "week";
	return "later";
}

const CHECKBOX_RE = /^(\s*(?:[-*+])\s*)\[( |x|X)\]\s*(.*)$/;
const TAG_RE = /#([A-Za-z0-9_\-/]+)/g;
const CONTEXT_RE = /@([\p{L}0-9_-]+)/gu;
const DATE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const TIME_RE = /⏰\s*(\d{2}:\d{2})/;
const PRIORITY_MARKER_HIGH = "🔺";
const PRIORITY_MARKER_LOW = "🔽";
const PRIORITY_RE = /🔺|🔽/;
const RECURRENCE_MARKER = "🔁";
const RECURRENCE_RE = /🔁\s*(täglich|taeglich|wöchentlich|woechentlich|monatlich|jährlich|jaehrlich)/iu;
const DELEGATE_MARKER = "👤";
// Name als ein Token (wie bei @Kontext) - fuer mehrteilige Namen Bindestrich statt Leerzeichen nutzen.
const DELEGATE_RE = /👤\s*([\p{L}0-9_-]+)/u;
// Projekt (todo.txt-Konvention: "+Projekt" neben "@Kontext"). Ein Projekt pro Aufgabe.
const PROJECT_RE = /\+([\p{L}0-9_-]+)/u;
// Relative Datumswoerter fuer die Natural-Language-Schnellerfassung (📅 heute/morgen/uebermorgen
// statt eines festen YYYY-MM-DD) - Tage-Offset relativ zu "heute".
const RELATIVE_DATE_OFFSETS: Record<string, number> = {
	heute: 0,
	morgen: 1,
	übermorgen: 2,
	uebermorgen: 2,
};
const RELATIVE_DATE_RE = /📅\s*(heute|morgen|übermorgen|uebermorgen)/iu;

/** Deutsche Anzeige-Woerter je Wiederholungsregel, u. a. fuer die Inline-Syntax ("🔁 woechentlich"). */
export const RECURRENCE_WORDS: Record<RecurrenceRule, string> = {
	daily: "täglich",
	weekly: "wöchentlich",
	monthly: "monatlich",
	yearly: "jährlich",
};

/** Validiert einen beliebigen Wert (z. B. aus Frontmatter) als RecurrenceRule, sonst undefined. */
export function toRecurrenceRule(value: unknown): RecurrenceRule | undefined {
	return value === "daily" || value === "weekly" || value === "monthly" || value === "yearly"
		? value
		: undefined;
}

function wordToRecurrenceRule(word: string): RecurrenceRule | undefined {
	const w = word.toLowerCase();
	if (w.startsWith("tä") || w.startsWith("tae")) return "daily";
	if (w.startsWith("wö") || w.startsWith("woe")) return "weekly";
	if (w.startsWith("mon")) return "monthly";
	if (w.startsWith("jä") || w.startsWith("jae")) return "yearly";
	return undefined;
}

/**
 * Berechnet den naechsten Faelligkeitstermin fuer eine Wiederholungsregel, ausgehend vom
 * aktuellen Termin. Erhaelt die Uhrzeit (falls im urspruenglichen Termin vorhanden).
 */
export function nextOccurrence(due: string, rule: RecurrenceRule): string | undefined {
	const date = parseLocalDateTime(due);
	if (!date) return undefined;
	const next = new Date(date);
	switch (rule) {
		case "daily":
			next.setDate(next.getDate() + 1);
			break;
		case "weekly":
			next.setDate(next.getDate() + 7);
			break;
		case "monthly":
			next.setMonth(next.getMonth() + 1);
			break;
		case "yearly":
			next.setFullYear(next.getFullYear() + 1);
			break;
	}
	return hasTimeComponent(due) ? formatLocalDateTime(next) : formatLocalDate(next);
}

/** Sortier-Rang (kleiner = wichtiger) je Prioritaet; keine Angabe wird wie "medium" behandelt. */
export const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

/** Sortier-Rang einer (ggf. fehlenden) Prioritaet; fehlende Angabe zaehlt wie "medium". */
export function priorityRank(priority: TaskPriority | undefined): number {
	return PRIORITY_ORDER[priority ?? "medium"];
}

/** Validiert einen beliebigen Wert (z. B. aus Frontmatter) als TaskPriority, sonst undefined. */
export function toTaskPriority(value: unknown): TaskPriority | undefined {
	return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

export interface ParsedInlineTask {
	indent: string;
	done: boolean;
	title: string;
	laneId?: string;
	laneTag?: string;
	due?: string;
	priority?: TaskPriority;
	recurrence?: RecurrenceRule;
	tags: string[];
	/** Kontext-Marker (ohne @), z. B. "Buero", "Telefon" - zweite Filterdimension zusaetzlich zur Lane. */
	contexts: string[];
	/** Person, an die delegiert wurde (ohne 👤-Marker), falls vorhanden. */
	delegatedTo?: string;
	/** Projekt (ohne +Marker), falls vorhanden. */
	project?: string;
}

/** Parst eine einzelne Zeile als Inline-Checkbox-Aufgabe, falls es sich um eine solche handelt. */
export function parseInlineLine(line: string, lanes: LaneConfig[]): ParsedInlineTask | null {
	const m = CHECKBOX_RE.exec(line);
	if (!m) return null;
	const [, indent, mark, rest] = m;
	const done = mark.toLowerCase() === "x";

	const tags: string[] = [];
	let tagMatch: RegExpExecArray | null;
	TAG_RE.lastIndex = 0;
	while ((tagMatch = TAG_RE.exec(rest))) {
		tags.push(tagMatch[1]);
	}

	const contexts: string[] = [];
	let contextMatch: RegExpExecArray | null;
	CONTEXT_RE.lastIndex = 0;
	while ((contextMatch = CONTEXT_RE.exec(rest))) {
		contexts.push(contextMatch[1]);
	}

	// Die "Erledigt"-Lane (isDone) hat bewusst kein eigenes Tag: ob eine Aufgabe erledigt ist,
	// wird ausschliesslich am Haken der Checkbox erkannt, nicht an einem Tag.
	let laneId: string | undefined;
	let laneTag: string | undefined;
	for (const lane of lanes) {
		if (lane.isDone) continue;
		if (tags.some((t) => t.toLowerCase() === lane.tag.toLowerCase())) {
			laneId = lane.id;
			laneTag = lane.tag;
			break;
		}
	}

	const dateMatch = DATE_RE.exec(rest);
	const timeMatch = TIME_RE.exec(rest);
	let due: string | undefined;
	if (dateMatch) {
		due = timeMatch ? `${dateMatch[1]}T${timeMatch[1]}` : dateMatch[1];
	}

	let priority: TaskPriority | undefined;
	if (rest.includes(PRIORITY_MARKER_HIGH)) priority = "high";
	else if (rest.includes(PRIORITY_MARKER_LOW)) priority = "low";

	const recurrenceMatch = RECURRENCE_RE.exec(rest);
	const recurrence = recurrenceMatch ? wordToRecurrenceRule(recurrenceMatch[1]) : undefined;

	const delegateMatch = DELEGATE_RE.exec(rest);
	const delegatedTo = delegateMatch ? delegateMatch[1] : undefined;

	const projectMatch = PROJECT_RE.exec(rest);
	const project = projectMatch ? projectMatch[1] : undefined;

	let title = rest
		.replace(TAG_RE, "")
		.replace(CONTEXT_RE, "")
		.replace(DATE_RE, "")
		.replace(TIME_RE, "")
		.replace(PRIORITY_RE, "")
		.replace(RECURRENCE_RE, "")
		.replace(DELEGATE_RE, "")
		.replace(PROJECT_RE, "")
		.replace(/\s+/g, " ")
		.trim();

	return { indent, done, title, laneId, laneTag, due, priority, recurrence, tags, contexts, delegatedTo, project };
}

/** Prueft, ob eine Zeile ueberhaupt eine Checkbox-Zeile ist (auch ohne Lane-Zuordnung). */
export function isCheckboxLine(line: string): boolean {
	return CHECKBOX_RE.test(line);
}

/**
 * Parst einen frei getippten Schnellerfassungs-Text mit derselben Syntax wie Inline-Checkboxen
 * (📅 Faelligkeit, @Kontext, +Projekt, #tag/Lane, 👤 Delegation, 🔺/🔽 Prioritaet, 🔁 Wiederholung),
 * ohne dass eine echte Checkbox-Zeile noetig ist - macht die Schnellerfassung "natural language"-faehig.
 * Zusaetzlich zum festen "📅 YYYY-MM-DD" werden die relativen Woerter "heute"/"morgen"/
 * "uebermorgen" verstanden und vor dem eigentlichen Parsen in ein konkretes Datum aufgeloest.
 */
export function parseQuickCapture(input: string, lanes: LaneConfig[], now: Date = new Date()): ParsedInlineTask | null {
	const withResolvedDate = input.replace(RELATIVE_DATE_RE, (_match, word: string) => {
		const offset = RELATIVE_DATE_OFFSETS[word.toLowerCase()];
		const target = offset !== undefined ? addDays(now, offset) : now;
		return `📅 ${formatLocalDate(target)}`;
	});
	return parseInlineLine(`- [ ] ${withResolvedDate}`, lanes);
}

/** Anzahl ganzer Tage seit einem Zeitpunkt (ms seit Epoch), fuer die Auffrischungs-Markierungen. */
export function daysSince(timestampMs: number, referenceNow: Date = new Date()): number {
	return Math.floor((referenceNow.getTime() - timestampMs) / 86_400_000);
}

/**
 * Baut eine Inline-Checkbox-Zeile fuer eine neue Lane neu auf.
 *
 * Ziel ist die "Erledigt"-Lane (isDone): es wird nur der Haken gesetzt, alle Tags (also
 * auch das bisherige Lane-Tag) bleiben unveraendert erhalten. So "merkt" sich die Zeile,
 * zu welcher Lane sie gehoert, und faellt beim Wiederaufklappen automatisch dorthin zurueck.
 *
 * Ziel ist eine normale Lane: der Haken wird entfernt und das Lane-Tag auf die Ziel-Lane
 * gesetzt; dabei werden auch veraltete Lane-Tags (inkl. eines fruehmeren Erledigt-Tags)
 * entfernt, da "Erledigt" kein eigenes Tag mehr traegt.
 */
export function rewriteInlineLineForLane(line: string, lanes: LaneConfig[], newLaneId: string): string {
	const parsed = parseInlineLine(line, lanes);
	if (!parsed) return line;
	const newLane = lanes.find((l) => l.id === newLaneId);
	if (!newLane) return line;

	// Wiederkehrende Aufgabe, die in eine Erledigt-Lane verschoben wird: nicht abhaken, sondern
	// auf den naechsten Termin springen lassen ("beim Erledigen neu erzeugen" statt abschliessen).
	const isRecurringBounce = !!newLane.isDone && !!parsed.recurrence && !!parsed.due;
	const effectiveDue = isRecurringBounce
		? nextOccurrence(parsed.due as string, parsed.recurrence as RecurrenceRule) ?? parsed.due
		: parsed.due;
	const checkedMark = newLane.isDone && !isRecurringBounce ? "x" : " ";

	const datePart = effectiveDue
		? effectiveDue.length > 10
			? `📅 ${effectiveDue.slice(0, 10)} ⏰${effectiveDue.slice(11)}`
			: `📅 ${effectiveDue}`
		: "";
	const priorityPart =
		parsed.priority === "high" ? PRIORITY_MARKER_HIGH : parsed.priority === "low" ? PRIORITY_MARKER_LOW : "";
	const contextPart = parsed.contexts.map((c) => `@${c}`).join(" ");
	const recurrencePart = parsed.recurrence ? `${RECURRENCE_MARKER} ${RECURRENCE_WORDS[parsed.recurrence]}` : "";
	const delegatePart = parsed.delegatedTo ? `${DELEGATE_MARKER} ${parsed.delegatedTo}` : "";
	const projectPart = parsed.project ? `+${parsed.project}` : "";

	if (newLane.isDone) {
		const tagPart = parsed.tags.map((t) => `#${t}`).join(" ");
		const pieces = [
			priorityPart,
			parsed.title,
			projectPart,
			contextPart,
			delegatePart,
			recurrencePart,
			tagPart,
			datePart,
		].filter((p) => p.length > 0);
		return `${parsed.indent}[${checkedMark}] ${pieces.join(" ")}`;
	}

	const allLaneTags = new Set(lanes.map((l) => l.tag.toLowerCase()));
	const otherTags = parsed.tags.filter((t) => !allLaneTags.has(t.toLowerCase()));
	const tagPart = [newLane.tag, ...otherTags].map((t) => `#${t}`).join(" ");
	const pieces = [
		priorityPart,
		parsed.title,
		projectPart,
		contextPart,
		delegatePart,
		recurrencePart,
		tagPart,
		datePart,
	].filter((p) => p.length > 0);
	return `${parsed.indent}[ ] ${pieces.join(" ")}`;
}

/**
 * Baut die Zeile einer erledigten, wiederkehrenden Inline-Aufgabe neu auf: Haken entfernen,
 * Faelligkeit auf den naechsten Termin setzen. Lane-Tag und alle anderen Bestandteile bleiben
 * unveraendert. Wird verwendet, wenn eine wiederkehrende Aufgabe direkt in der Notiz (nicht
 * ueber das Board) abgehakt wurde. Gibt null zurueck, wenn die Zeile nicht (mehr) bounce-faehig ist.
 */
export function bounceRecurringInlineLine(line: string, lanes: LaneConfig[]): string | null {
	const parsed = parseInlineLine(line, lanes);
	if (!parsed || !parsed.done || !parsed.recurrence || !parsed.due) return null;
	const nextDue = nextOccurrence(parsed.due, parsed.recurrence);
	if (!nextDue) return null;

	const datePart = nextDue.length > 10 ? `📅 ${nextDue.slice(0, 10)} ⏰${nextDue.slice(11)}` : `📅 ${nextDue}`;
	const priorityPart =
		parsed.priority === "high" ? PRIORITY_MARKER_HIGH : parsed.priority === "low" ? PRIORITY_MARKER_LOW : "";
	const contextPart = parsed.contexts.map((c) => `@${c}`).join(" ");
	const recurrencePart = `${RECURRENCE_MARKER} ${RECURRENCE_WORDS[parsed.recurrence]}`;
	const delegatePart = parsed.delegatedTo ? `${DELEGATE_MARKER} ${parsed.delegatedTo}` : "";
	const projectPart = parsed.project ? `+${parsed.project}` : "";
	const tagPart = parsed.tags.map((t) => `#${t}`).join(" ");
	const pieces = [
		priorityPart,
		parsed.title,
		projectPart,
		contextPart,
		delegatePart,
		recurrencePart,
		tagPart,
		datePart,
	].filter((p) => p.length > 0);
	return `${parsed.indent}[ ] ${pieces.join(" ")}`;
}

/** Stabile ID fuer eine Inline-Aufgabe, robust gegen kleine Zeilenverschiebungen (kein Zeilenindex enthalten). */
export function inlineTaskId(filePath: string, title: string): string {
	return `inline::${filePath}::${hashString(title)}`;
}

export function fileTaskId(filePath: string): string {
	return `file::${filePath}`;
}

export function hashString(input: string): string {
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = (hash * 31 + input.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(36);
}

/** Prueft, ob ein Vault-Pfad innerhalb (oder gleich) eines Ordnerpfads liegt. */
export function isPathInFolder(path: string, folder: string): boolean {
	const normFolder = folder.replace(/\/+$/, "");
	if (normFolder === "" || normFolder === "/") return true;
	return path === normFolder || path.startsWith(normFolder + "/");
}

export function joinPath(...parts: string[]): string {
	return parts
		.map((p) => p.replace(/^\/+|\/+$/g, ""))
		.filter((p) => p.length > 0)
		.join("/");
}

export interface SubtaskProgress {
	done: number;
	total: number;
}

/** Zaehlt Checkbox-Zeilen ("- [ ]"/"- [x]") in einer Markdown-Beschreibung als Subtasks. */
export function countSubtasks(description: string | undefined): SubtaskProgress | undefined {
	if (!description) return undefined;
	let done = 0;
	let total = 0;
	for (const line of description.split(/\r?\n/)) {
		const m = CHECKBOX_RE.exec(line);
		if (!m) continue;
		total++;
		if (m[2].toLowerCase() === "x") done++;
	}
	return total > 0 ? { done, total } : undefined;
}

/** Baut den Inhalt einer .ics-Kalenderdatei aus allen offenen (nicht erledigten) Aufgaben mit Faelligkeit. */
export function buildIcsContent(tasks: GtdTask[], now: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const icsDateTime = (d: Date) =>
		`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(
			d.getMinutes()
		)}${pad(d.getSeconds())}`;
	const icsDate = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
	const icsEscape = (s: string) =>
		s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

	const lines: string[] = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//GTD Board//Obsidian Plugin//DE",
		"CALSCALE:GREGORIAN",
	];
	const dtstamp = icsDateTime(now);

	for (const task of tasks) {
		if (task.done || !task.due) continue;
		const dueDate = parseLocalDateTime(task.due);
		if (!dueDate) continue;
		lines.push("BEGIN:VEVENT");
		lines.push(`UID:${icsEscape(task.id)}@gtd-board`);
		lines.push(`DTSTAMP:${dtstamp}`);
		if (hasTimeComponent(task.due)) {
			lines.push(`DTSTART:${icsDateTime(dueDate)}`);
		} else {
			lines.push(`DTSTART;VALUE=DATE:${icsDate(dueDate)}`);
		}
		lines.push(`SUMMARY:${icsEscape(task.title)}`);
		if (task.description) lines.push(`DESCRIPTION:${icsEscape(task.description)}`);
		lines.push("END:VEVENT");
	}

	lines.push("END:VCALENDAR");
	return lines.join("\r\n") + "\r\n";
}
