import { noteMatchesMeeting, parseIcsEvents, renderMeetingTemplate } from "../src/meeting-ics";

const VTIMEZONE_BERLIN = [
	"BEGIN:VTIMEZONE",
	"TZID:W. Europe Standard Time",
	"BEGIN:STANDARD",
	"DTSTART:16010101T030000",
	"TZOFFSETFROM:+0200",
	"TZOFFSETTO:+0100",
	"RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10",
	"END:STANDARD",
	"BEGIN:DAYLIGHT",
	"DTSTART:16010101T020000",
	"TZOFFSETFROM:+0100",
	"TZOFFSETTO:+0200",
	"RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3",
	"END:DAYLIGHT",
	"END:VTIMEZONE",
];

function calendar(...events: string[][]): string {
	return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//DE", ...VTIMEZONE_BERLIN, ...events.flat(), "END:VCALENDAR"].join("\r\n");
}

const single = [
	"BEGIN:VEVENT",
	"UID:single-1",
	"SUMMARY:Jour fixe Vertrieb",
	"DTSTART;TZID=W. Europe Standard Time:20261126T090000",
	"DTEND;TZID=W. Europe Standard Time:20261126T100000",
	"LOCATION:Raum 2",
	"ATTENDEE;CN=Max Muster:mailto:max@example.org",
	"ATTENDEE:mailto:anna@example.org",
	"END:VEVENT",
];

const weekly = [
	"BEGIN:VEVENT",
	"UID:series-1",
	"SUMMARY:Teamrunde",
	"DTSTART;TZID=W. Europe Standard Time:20261102T140000",
	"DTEND;TZID=W. Europe Standard Time:20261102T150000",
	"RRULE:FREQ=WEEKLY;BYDAY=MO,TH",
	"EXDATE;TZID=W. Europe Standard Time:20261123T140000",
	"END:VEVENT",
	// Instanz vom Do 26.11. auf 16:00 verschoben
	"BEGIN:VEVENT",
	"UID:series-1",
	"SUMMARY:Teamrunde (verschoben)",
	"RECURRENCE-ID;TZID=W. Europe Standard Time:20261126T140000",
	"DTSTART;TZID=W. Europe Standard Time:20261126T160000",
	"DTEND;TZID=W. Europe Standard Time:20261126T170000",
	"END:VEVENT",
];

const cancelled = [
	"BEGIN:VEVENT",
	"UID:cancel-1",
	"SUMMARY:Abgesagt",
	"STATUS:CANCELLED",
	"DTSTART:20261126T120000Z",
	"DTEND:20261126T130000Z",
	"END:VEVENT",
];

const allDay = [
	"BEGIN:VEVENT",
	"UID:allday-1",
	"SUMMARY:Messe",
	"DTSTART;VALUE=DATE:20261126",
	"DTEND;VALUE=DATE:20261127",
	"END:VEVENT",
];

const summerSeries = [
	"BEGIN:VEVENT",
	"UID:summer-1",
	"SUMMARY:Monatsreview",
	"DTSTART;TZID=W. Europe Standard Time:20260601T090000",
	"DTEND;TZID=W. Europe Standard Time:20260601T093000",
	"RRULE:FREQ=MONTHLY;COUNT=12",
	"END:VEVENT",
];

describe("parseIcsEvents", () => {
	it("liest einen Einzeltermin mit Windows-Zeitzone, Ort und Teilnehmern", () => {
		const events = parseIcsEvents(calendar(single), new Date("2026-11-26T00:00:00Z"), new Date("2026-11-27T00:00:00Z"));
		expect(events).toHaveLength(1);
		const [e] = events;
		expect(e.uid).toBe("single-1");
		expect(e.recurrenceId).toBeUndefined();
		expect(e.title).toBe("Jour fixe Vertrieb");
		expect(e.start.toISOString()).toBe("2026-11-26T08:00:00.000Z");
		expect(e.end.toISOString()).toBe("2026-11-26T09:00:00.000Z");
		expect(e.location).toBe("Raum 2");
		expect(e.attendees).toEqual(["Max Muster", "anna@example.org"]);
		expect(e.allDay).toBe(false);
	});

	it("expandiert Serien, beachtet EXDATE und verschobene Instanzen", () => {
		const events = parseIcsEvents(calendar(weekly), new Date("2026-11-23T00:00:00Z"), new Date("2026-11-30T23:00:00Z"));
		expect(events.map((e) => [e.title, e.start.toISOString()])).toEqual([
			// Mo 23.11. per EXDATE entfallen
			["Teamrunde (verschoben)", "2026-11-26T15:00:00.000Z"],
			["Teamrunde", "2026-11-30T13:00:00.000Z"],
		]);
		expect(events[0].recurrenceId).toContain("2026-11-26");
		expect(events[1].uid).toBe("series-1");
	});

	it("rechnet Serien ueber die Sommerzeit-Umstellung richtig", () => {
		const july = parseIcsEvents(calendar(summerSeries), new Date("2026-07-01T00:00:00Z"), new Date("2026-07-02T00:00:00Z"));
		expect(july[0].start.toISOString()).toBe("2026-07-01T07:00:00.000Z");
		const dec = parseIcsEvents(calendar(summerSeries), new Date("2026-12-01T00:00:00Z"), new Date("2026-12-02T00:00:00Z"));
		expect(dec[0].start.toISOString()).toBe("2026-12-01T08:00:00.000Z");
	});

	it("laesst abgesagte Termine weg und erkennt ganztaegige Termine", () => {
		const events = parseIcsEvents(calendar(cancelled, allDay), new Date(2026, 10, 26), new Date(2026, 10, 27));
		expect(events.map((e) => e.title)).toEqual(["Messe"]);
		expect(events[0].allDay).toBe(true);
	});

	it("wirft bei nicht lesbarem Text", () => {
		expect(() => parseIcsEvents("kein kalender", new Date(), new Date())).toThrow();
	});
});

describe("noteMatchesMeeting", () => {
	const event = { uid: "abc-123", start: new Date(2026, 10, 26, 9, 0) };
	const occurrence = { uid: "series-1", recurrenceId: "2026-11-26T14:00:00", start: new Date(2026, 10, 26, 14, 0) };

	it("findet eigene Notizen ueber meeting_uid", () => {
		expect(noteMatchesMeeting({ meeting_uid: "abc-123" }, event)).toBe(true);
		expect(noteMatchesMeeting({ meeting_uid: "anders" }, event)).toBe(false);
		expect(noteMatchesMeeting(undefined, event)).toBe(false);
	});

	it("unterscheidet Instanzen einer Serie ueber meeting_recurrence_id", () => {
		expect(noteMatchesMeeting({ meeting_uid: "series-1", meeting_recurrence_id: "2026-11-26T14:00:00" }, occurrence)).toBe(true);
		expect(noteMatchesMeeting({ meeting_uid: "series-1", meeting_recurrence_id: "2026-11-19T14:00:00" }, occurrence)).toBe(false);
	});

	it("erkennt Notizen von Meetings Plus ueber meeting_dedup_key", () => {
		expect(noteMatchesMeeting({ meeting_dedup_key: "abc-123" }, event)).toBe(true);
		expect(noteMatchesMeeting({ meeting_dedup_key: "series-1_2026-11-26" }, occurrence)).toBe(true);
		expect(noteMatchesMeeting({ meeting_dedup_key: "series-1|20261126T140000" }, occurrence)).toBe(true);
		expect(noteMatchesMeeting({ meeting_dedup_key: "series-1_2026-11-19" }, occurrence)).toBe(false);
		expect(noteMatchesMeeting({ meeting_dedup_key: "xyz" }, event)).toBe(false);
	});
});

describe("renderMeetingTemplate", () => {
	it("ersetzt bekannte Platzhalter und laesst unbekannte stehen", () => {
		expect(renderMeetingTemplate("# {{title}} am {{ date }} {{unbekannt}}", { title: "Runde", date: "2026-11-26" })).toBe(
			"# Runde am 2026-11-26 {{unbekannt}}"
		);
	});
});

describe("Meeting-Notizen im Board (Meetings Plus)", () => {
	it("liest Frontmatter-Listen wie open_tasks nie als Aufgaben, Checkboxen im Text aber schon", async () => {
		const { makeStore } = await import("./helpers/fakeVault");
		const { DEFAULT_LANES, DEFAULT_SETTINGS } = await import("../src/types");
		const { store, vault } = makeStore({ ...DEFAULT_SETTINGS, lanes: DEFAULT_LANES, watchFolder: "GTD" });
		vault.addFile(
			"GTD/Meetings/2026-11-26 Runde.md",
			[
				"---",
				"meeting_dedup_key: abc-123",
				"open_tasks:",
				"  - [ ] Angebot schicken",
				"  - [x] Raum buchen",
				"open_questions:",
				"  - [ ] Budget?",
				"open_tasks_count: 2",
				"---",
				"# Runde",
				"- [ ] Protokoll verteilen #gtd/next",
			].join("\n")
		);
		const tasks = await store.getAllTasks();
		expect(tasks.map((t) => t.title)).toEqual(["Protokoll verteilen"]);
		expect(tasks[0].line).toBe(10);
	});
});
