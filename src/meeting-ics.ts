import ICAL from "ical.js";

/** Ein einzelner Termin (bei Serien: eine Instanz) aus einem ICS-Kalender. */
export interface MeetingEvent {
	uid: string;
	/** Nur bei Serienterminen: urspruenglicher Start dieser Instanz (RECURRENCE-ID, ICAL-Format). */
	recurrenceId?: string;
	title: string;
	start: Date;
	end: Date;
	allDay: boolean;
	location?: string;
	/** Namen (CN) bzw. Adressen der Teilnehmer. */
	attendees: string[];
}

/** Obergrenze fuer die Serien-Expansion, damit kaputte oder minuetliche Regeln nicht haengen. */
const MAX_OCCURRENCES_PER_SERIES = 20_000;
/** Puffer nach dem Bereichsende, damit nach vorn verschobene Ausnahmen einer Serie gefunden werden. */
const EXCEPTION_LOOKAHEAD_MS = 14 * 86_400_000;

function isCancelled(component: ICAL.Component): boolean {
	const status = component.getFirstPropertyValue("status");
	return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}

function attendeeNames(event: ICAL.Event): string[] {
	const names: string[] = [];
	for (const prop of event.attendees) {
		const cn = prop.getParameter("cn");
		const value = prop.getFirstValue();
		const name = typeof cn === "string" && cn.trim() ? cn.trim() : typeof value === "string" ? value.replace(/^mailto:/i, "") : "";
		if (name) names.push(name);
	}
	return names;
}

function toMeetingEvent(event: ICAL.Event, start: ICAL.Time, end: ICAL.Time, recurrenceId?: ICAL.Time): MeetingEvent {
	const startDate = start.toJSDate();
	const endDate = end ? end.toJSDate() : startDate;
	return {
		uid: event.uid,
		recurrenceId: recurrenceId ? recurrenceId.toString() : undefined,
		title: (event.summary ?? "").trim(),
		start: startDate,
		end: endDate,
		allDay: start.isDate,
		location: event.location?.trim() || undefined,
		attendees: attendeeNames(event),
	};
}

function overlaps(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): boolean {
	// Termine ohne Dauer (Ende = Start) zaehlen, wenn ihr Start im Bereich liegt.
	const effectiveEnd = end.getTime() > start.getTime() ? end : new Date(start.getTime() + 1);
	return start < rangeEnd && effectiveEnd > rangeStart;
}

/**
 * Liest alle Termine aus einem ICS-Text, die den Bereich [rangeStart, rangeEnd) beruehren.
 * Serien werden expandiert (RRULE/RDATE/EXDATE), geaenderte Einzeltermine (RECURRENCE-ID)
 * ersetzen ihre Instanz, abgesagte Termine (STATUS:CANCELLED) entfallen. Zeitzonen aus den
 * VTIMEZONE-Bloecken der Datei werden beruecksichtigt; unbekannte TZIDs gelten als lokale Zeit.
 * Ergebnis nach Start sortiert. Wirft bei nicht lesbarem ICS-Text.
 */
export function parseIcsEvents(icsText: string, rangeStart: Date, rangeEnd: Date): MeetingEvent[] {
	const root = new ICAL.Component(ICAL.parse(icsText));

	for (const tzComponent of root.getAllSubcomponents("vtimezone")) {
		const timezone = new ICAL.Timezone(tzComponent);
		if (timezone.tzid && !ICAL.TimezoneService.has(timezone.tzid)) {
			ICAL.TimezoneService.register(timezone);
		}
	}

	const masters = new Map<string, ICAL.Event>();
	const exceptions: ICAL.Event[] = [];
	for (const component of root.getAllSubcomponents("vevent")) {
		const event = new ICAL.Event(component);
		if (!event.uid) continue;
		if (event.isRecurrenceException()) exceptions.push(event);
		else masters.set(event.uid, event);
	}

	const result: MeetingEvent[] = [];
	for (const exception of exceptions) {
		const master = masters.get(exception.uid);
		if (master) {
			master.relateException(exception);
		} else if (!isCancelled(exception.component)) {
			// Ausnahme ohne zugehoerige Serie (z. B. gefilterter Export): als Einzeltermin behandeln.
			const single = toMeetingEvent(exception, exception.startDate, exception.endDate, exception.recurrenceId);
			if (overlaps(single.start, single.end, rangeStart, rangeEnd)) result.push(single);
		}
	}

	for (const event of masters.values()) {
		if (!event.isRecurring()) {
			if (isCancelled(event.component)) continue;
			const single = toMeetingEvent(event, event.startDate, event.endDate);
			if (overlaps(single.start, single.end, rangeStart, rangeEnd)) result.push(single);
			continue;
		}

		const iterator = event.iterator();
		const stopAt = rangeEnd.getTime() + EXCEPTION_LOOKAHEAD_MS;
		let next: ICAL.Time | null;
		let count = 0;
		while ((next = iterator.next()) && count < MAX_OCCURRENCES_PER_SERIES) {
			count++;
			if (next.toJSDate().getTime() >= stopAt) break;
			const details = event.getOccurrenceDetails(next);
			if (isCancelled(details.item.component)) continue;
			const occurrence = toMeetingEvent(details.item, details.startDate, details.endDate, details.recurrenceId);
			if (overlaps(occurrence.start, occurrence.end, rangeStart, rangeEnd)) result.push(occurrence);
		}
	}

	return result.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Kalendertag (YYYY-MM-DD, lokale Zeit) eines Datums. */
function localDay(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Prueft, ob eine vorhandene Notiz (Frontmatter) zu einem Termin gehoert:
 * - eigene Notizen ueber `meeting_uid` (bei Serien zusaetzlich `meeting_recurrence_id`),
 * - Notizen des Plugins "Meetings Plus" ueber `meeting_dedup_key`: der Schluessel muss die UID
 *   enthalten, bei Serienterminen zusaetzlich den Tag der Instanz (YYYY-MM-DD oder YYYYMMDD).
 */
export function noteMatchesMeeting(frontmatter: Record<string, unknown> | undefined, event: Pick<MeetingEvent, "uid" | "recurrenceId" | "start">): boolean {
	if (!frontmatter) return false;
	const uid = frontmatter.meeting_uid;
	if (typeof uid === "string" && uid === event.uid) {
		if (!event.recurrenceId) return true;
		return frontmatter.meeting_recurrence_id === event.recurrenceId;
	}
	const dedupKey = frontmatter.meeting_dedup_key;
	if (typeof dedupKey === "string" && event.uid && dedupKey.includes(event.uid)) {
		if (!event.recurrenceId) return true;
		const day = localDay(event.start);
		return dedupKey.includes(day) || dedupKey.includes(day.replace(/-/g, ""));
	}
	return false;
}

/** Ersetzt {{name}}-Platzhalter einer Vorlage; unbekannte Platzhalter bleiben stehen. */
export function renderMeetingTemplate(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, name: string) =>
		Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match
	);
}
