import { LaneConfig } from "./types";
import { isCheckboxLine, parseInlineLine } from "./util";

/**
 * Agendas (Gespraechsthemen mit Personen) als Checkbox-Zeilen. Zwei Quellen:
 * - Personennotiz im Agendas-Ordner (z. B. "GTD/Agendas/Guenther.md"): jede Checkbox ist ein
 *   Thema, die Person ist `person:` aus dem Frontmatter bzw. der Dateiname.
 * - beliebige Notiz im ueberwachten Ordner: Zeile mit `#gtd/agenda` und `👤 Name`.
 * Besprochen = abgehakt, mit Datum "✅ YYYY-MM-DD" (als Verlauf). Anmerkungen sind die
 * eingerueckten Zeilen direkt unter dem Thema. Alles hier ist rein textuell und verlustfrei:
 * es wird nur der Haken, das ✅-Datum bzw. eine neue Zeile geaendert.
 */

/** Inline-Tag, das eine Checkbox ausserhalb einer Personennotiz zum Agendapunkt macht. */
export const AGENDA_TAG = "gtd/agenda";

const DONE_DATE_RE = /[ \t]*✅\s*(\d{4}-\d{2}-\d{2})/u;
const BLOCK_ID_RE = /(\s\^[A-Za-z0-9-]+)\s*$/;

export interface ParsedAgendaLine {
	done: boolean;
	title: string;
	/** Datum aus "✅ YYYY-MM-DD", falls vorhanden. */
	doneDate?: string;
	/** Person aus "👤 Name" (nur bei Inline-Agendapunkten ausserhalb einer Personennotiz relevant). */
	person?: string;
	tags: string[];
}

/** Parst eine Checkbox-Zeile als Agendapunkt (Titel ohne Marker und ohne ✅-Datum). */
export function parseAgendaLine(line: string, lanes: LaneConfig[]): ParsedAgendaLine | null {
	const parsed = parseInlineLine(line, lanes);
	if (!parsed) return null;
	const dateMatch = DONE_DATE_RE.exec(line);
	const title = parsed.title.replace(/✅\s*\d{4}-\d{2}-\d{2}/gu, "").replace(/\s+/g, " ").trim();
	return { done: parsed.done, title, doneDate: dateMatch?.[1], person: parsed.delegatedTo, tags: parsed.tags };
}

/** Hat die Zeile das Agenda-Tag (gross/klein egal)? */
export function hasAgendaTag(tags: string[]): boolean {
	return tags.some((tag) => tag.toLowerCase() === AGENDA_TAG);
}

/**
 * Setzt bzw. entfernt den Haken. Beim Abhaken kommt "✅ date" ans Zeilenende (vor eine
 * Block-ID), beim Wiederoeffnen verschwindet es. Sonst bleibt die Zeile zeichengenau gleich.
 */
export function setAgendaLineDone(line: string, done: boolean, date: string): string {
	const m = /^(\s*[-*+]\s*)\[( |x|X)\]/.exec(line);
	if (!m) return line;
	let result = `${m[1]}[${done ? "x" : " "}]${line.slice(m[0].length)}`;
	result = result.replace(DONE_DATE_RE, "");
	if (!done) return result;
	const blockId = BLOCK_ID_RE.exec(result);
	if (blockId) {
		const head = result.slice(0, blockId.index).replace(/\s+$/, "");
		return `${head} ✅ ${date}${blockId[1]}`;
	}
	return `${result.replace(/\s+$/, "")} ✅ ${date}`;
}

function leadingWhitespace(line: string): string {
	return /^\s*/.exec(line)?.[0] ?? "";
}

function indentWidth(line: string): number {
	return leadingWhitespace(line).replace(/\t/g, "    ").length;
}

/** Index der letzten Zeile, die (eingerueckt) zum Eintrag in Zeile `index` gehoert. */
export function lastChildLine(lines: string[], index: number): number {
	const base = indentWidth(lines[index]);
	let last = index;
	for (let i = index + 1; i < lines.length; i++) {
		if (lines[i].trim() === "" || indentWidth(lines[i]) <= base) break;
		last = i;
	}
	return last;
}

/** Anmerkungen eines Agendapunkts: eingerueckte Zeilen darunter, ohne Listenzeichen. */
export function agendaNotes(lines: string[], index: number): string[] {
	const notes: string[] = [];
	const end = lastChildLine(lines, index);
	for (let i = index + 1; i <= end; i++) {
		notes.push(lines[i].trim().replace(/^[-*+]\s+/, ""));
	}
	return notes;
}

/** Fuegt eine Anmerkung als eingerueckten Listenpunkt unter dem Agendapunkt an. */
export function insertAgendaNote(lines: string[], index: number, text: string): string[] {
	const note = text.replace(/\s+/g, " ").trim();
	if (!note) return lines;
	const end = lastChildLine(lines, index);
	const result = [...lines];
	result.splice(end + 1, 0, `${leadingWhitespace(lines[index])}\t- ${note}`);
	return result;
}

/**
 * Fuegt ein neues Thema in eine Personennotiz ein: hinter das letzte offene Thema (samt
 * Anmerkungen), sonst vor das erste besprochene, sonst ans Ende. Zeilen vor `bodyStart`
 * (Frontmatter) werden nie angefasst.
 */
export function insertAgendaTopic(lines: string[], topic: string, bodyStart: number): string[] {
	const text = topic.replace(/\s+/g, " ").trim();
	if (!text) return lines;
	const newLine = `- [ ] ${text}`;
	let lastOpenEnd = -1;
	let firstDone = -1;
	for (let i = bodyStart; i < lines.length; i++) {
		if (!isCheckboxLine(lines[i]) || indentWidth(lines[i]) > 0) continue;
		const checked = /^\s*[-*+]\s*\[(x|X)\]/.test(lines[i]);
		if (checked) {
			if (firstDone === -1) firstDone = i;
		} else {
			lastOpenEnd = lastChildLine(lines, i);
		}
	}
	const result = [...lines];
	if (lastOpenEnd !== -1) {
		result.splice(lastOpenEnd + 1, 0, newLine);
	} else if (firstDone !== -1) {
		result.splice(firstDone, 0, newLine);
	} else {
		while (result.length > bodyStart && result[result.length - 1].trim() === "") result.pop();
		// Leerzeile zwischen vorhandenem Text (z. B. Ueberschrift) und der neuen Liste.
		if (result.length > bodyStart) result.push("");
		result.push(newLine, "");
	}
	return result;
}

/**
 * Personen mit offenen Themen, die an einem Termin teilnehmen. Eine Person passt, wenn alle
 * Woerter ihres Namens im Teilnehmer vorkommen ("Guenther" passt zu "Meier, Guenther").
 */
export function matchAttendeePeople(attendees: string[], people: string[]): string[] {
	const words = (value: string) =>
		value
			.toLowerCase()
			.split(/[\s,;()<>"']+/)
			.filter((w) => w.length > 0);
	const attendeeWords = attendees.map(words);
	return people.filter((person) => {
		const personWords = words(person);
		if (personWords.length === 0) return false;
		return attendeeWords.some((aw) => personWords.every((pw) => aw.includes(pw)));
	});
}
