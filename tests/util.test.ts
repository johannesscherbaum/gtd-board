import { DEFAULT_LANES } from "../src/types";
import { GtdTask } from "../src/types";
import { t } from "../src/i18n";
import {
	addDays,
	bounceRecurringInlineLine,
	buildIcsContent,
	buildTaskFileContent,
	computeEffectiveReminder,
	countSubtasks,
	daysSince,
	dueUrgency,
	inlineTaskId,
	isPathInFolder,
	nextOccurrence,
	parseInlineLine,
	parseLocalDateTime,
	parseQuickCapture,
	parseTaskFile,
	priorityRank,
	rewriteInlineLineForLane,
	sanitizeFileName,
	startOfWeek,
	toTaskPriority,
} from "../src/util";

describe("parseTaskFile / buildTaskFileContent", () => {
	it("parst Frontmatter und Body und baut sie identisch wieder auf", () => {
		const content = `---\nlane: next-actions\ndue: 2026-09-20T14:00\ntags: [kunde-x, wichtig]\norder: 3\n---\n\nBeschreibung mit **Markdown**.\n`;
		const { frontmatter, body } = parseTaskFile(content);
		expect(frontmatter.lane).toBe("next-actions");
		expect(frontmatter.due).toBe("2026-09-20T14:00");
		expect(frontmatter.tags).toEqual(["kunde-x", "wichtig"]);
		expect(frontmatter.order).toBe(3);
		expect(body.trim()).toBe("Beschreibung mit **Markdown**.");

		const rebuilt = buildTaskFileContent(frontmatter, body);
		const reparsed = parseTaskFile(rebuilt);
		expect(reparsed.frontmatter.lane).toBe("next-actions");
		expect(reparsed.body.trim()).toBe("Beschreibung mit **Markdown**.");
	});

	it("liefert leeres Frontmatter fuer Dateien ohne Frontmatter-Block", () => {
		const { frontmatter, body } = parseTaskFile("Nur Text, kein Frontmatter.");
		expect(frontmatter).toEqual({});
		expect(body).toBe("Nur Text, kein Frontmatter.");
	});

	it("laesst leere/undefined Felder beim Bauen weg", () => {
		const out = buildTaskFileContent({ lane: "inbox", due: "", reminder: undefined, tags: [] }, "Text");
		expect(out).not.toMatch(/due:/);
		expect(out).not.toMatch(/reminder:/);
		expect(out).not.toMatch(/tags:/);
		expect(out).toMatch(/lane: inbox/);
	});
});

describe("sanitizeFileName", () => {
	it("entfernt dateisystemkritische Zeichen", () => {
		expect(sanitizeFileName('Rechnung: "Kunde X" / Review?')).toBe("Rechnung Kunde X Review");
	});

	it("faellt bei leerem Titel auf 'Aufgabe' zurueck", () => {
		expect(sanitizeFileName("   ###   ")).toBe(t("file.fallbackName"));
	});
});

describe("parseLocalDateTime / computeEffectiveReminder", () => {
	it("parst Datum ohne Zeit mit Fallback-Uhrzeit", () => {
		const d = parseLocalDateTime("2026-09-20");
		expect(d?.getHours()).toBe(9);
		expect(d?.getMinutes()).toBe(0);
		expect(d?.getFullYear()).toBe(2026);
		expect(d?.getMonth()).toBe(8);
		expect(d?.getDate()).toBe(20);
	});

	it("parst Datum mit Zeit exakt", () => {
		const d = parseLocalDateTime("2026-09-20T14:30");
		expect(d?.getHours()).toBe(14);
		expect(d?.getMinutes()).toBe(30);
	});

	it("gibt undefined fuer ungueltige Werte zurueck", () => {
		expect(parseLocalDateTime("nicht-valide")).toBeUndefined();
		expect(parseLocalDateTime(undefined)).toBeUndefined();
	});

	it("nutzt explizite reminderAt vor faelligkeitsbasierter Berechnung", () => {
		const r = computeEffectiveReminder(
			{ due: "2026-09-20T14:00", reminderAt: "2026-09-20T10:00" },
			{ defaultReminderOffsetMinutes: 30 }
		);
		expect(r?.getHours()).toBe(10);
	});

	it("berechnet Erinnerung aus Faelligkeit minus Standard-Offset", () => {
		const r = computeEffectiveReminder(
			{ due: "2026-09-20T14:00" },
			{ defaultReminderOffsetMinutes: 30 }
		);
		expect(r?.getHours()).toBe(13);
		expect(r?.getMinutes()).toBe(30);
	});

	it("gibt undefined zurueck, wenn weder due noch reminderAt gesetzt sind", () => {
		expect(computeEffectiveReminder({}, { defaultReminderOffsetMinutes: 30 })).toBeUndefined();
	});
});

describe("parseInlineLine", () => {
	it("erkennt eine einfache offene Checkbox ohne Lane-Tag", () => {
		const parsed = parseInlineLine("- [ ] Etwas erledigen", DEFAULT_LANES);
		expect(parsed).not.toBeNull();
		expect(parsed?.done).toBe(false);
		expect(parsed?.title).toBe("Etwas erledigen");
		expect(parsed?.laneId).toBeUndefined();
	});

	it("ordnet einer Zeile die passende Lane per Tag zu", () => {
		const parsed = parseInlineLine("- [ ] Angebot pruefen #gtd/waiting #kunde-x", DEFAULT_LANES);
		expect(parsed?.laneId).toBe("waiting-for");
		expect(parsed?.title).toBe("Angebot pruefen");
		expect(parsed?.tags).toEqual(["gtd/waiting", "kunde-x"]);
	});

	it("erkennt erledigte Aufgaben (Grossbuchstabe X eingeschlossen)", () => {
		expect(parseInlineLine("- [x] Erledigt", DEFAULT_LANES)?.done).toBe(true);
		expect(parseInlineLine("- [X] Erledigt", DEFAULT_LANES)?.done).toBe(true);
	});

	it("ordnet das Tag der Erledigt-Lane (isDone) nicht als Lane zu", () => {
		const parsed = parseInlineLine("- [ ] Alt getaggt #gtd/done", DEFAULT_LANES);
		expect(parsed?.laneId).toBeUndefined();
	});

	it("extrahiert Faelligkeitsdatum mit und ohne Uhrzeit", () => {
		expect(parseInlineLine("- [ ] Mit Datum 📅 2026-09-20", DEFAULT_LANES)?.due).toBe("2026-09-20");
		expect(parseInlineLine("- [ ] Mit Zeit 📅 2026-09-20 ⏰14:30", DEFAULT_LANES)?.due).toBe(
			"2026-09-20T14:30"
		);
	});

	it("gibt null fuer Nicht-Checkbox-Zeilen zurueck", () => {
		expect(parseInlineLine("Das ist nur ein Absatz.", DEFAULT_LANES)).toBeNull();
		expect(parseInlineLine("# Ueberschrift", DEFAULT_LANES)).toBeNull();
	});

	it("erhaelt Einrueckung fuer verschachtelte Checkboxen", () => {
		const parsed = parseInlineLine("  - [ ] Unterpunkt", DEFAULT_LANES);
		expect(parsed?.indent).toBe("  - ");
	});

	it("extrahiert die Prioritaet aus dem Marker und entfernt ihn aus dem Titel", () => {
		expect(parseInlineLine("- [ ] Wichtig 🔺 #gtd/inbox", DEFAULT_LANES)?.priority).toBe("high");
		expect(parseInlineLine("- [ ] Wichtig 🔺 #gtd/inbox", DEFAULT_LANES)?.title).toBe("Wichtig");
		expect(parseInlineLine("- [ ] Kann warten 🔽", DEFAULT_LANES)?.priority).toBe("low");
		expect(parseInlineLine("- [ ] Kann warten 🔽", DEFAULT_LANES)?.title).toBe("Kann warten");
	});

	it("hat ohne Marker keine Prioritaet (wird spaeter als medium behandelt)", () => {
		expect(parseInlineLine("- [ ] Normal", DEFAULT_LANES)?.priority).toBeUndefined();
	});
});

describe("rewriteInlineLineForLane", () => {
	it("tauscht das Lane-Tag aus und behaelt Titel, weitere Tags und Datum", () => {
		const line = "- [ ] Angebot pruefen #gtd/inbox #kunde-x 📅 2026-09-20";
		const out = rewriteInlineLineForLane(line, DEFAULT_LANES, "waiting-for");
		expect(out).toContain("#gtd/waiting");
		expect(out).not.toContain("#gtd/inbox");
		expect(out).toContain("#kunde-x");
		expect(out).toContain("📅 2026-09-20");
		expect(out).toContain("Angebot pruefen");
	});

	it("fuegt ein Lane-Tag hinzu, wenn zuvor keines vorhanden war", () => {
		const out = rewriteInlineLineForLane("- [ ] Neu #kunde-x", DEFAULT_LANES, "next-actions");
		expect(out).toContain("#gtd/next");
		expect(out).toContain("#kunde-x");
	});

	it("setzt beim Verschieben in die Erledigt-Lane nur den Haken, das Lane-Tag bleibt erhalten", () => {
		const out = rewriteInlineLineForLane("- [ ] Fertig machen #gtd/inbox", DEFAULT_LANES, "done");
		expect(out).toMatch(/^\s*-\s*\[x\]/);
		expect(out).toContain("#gtd/inbox");
	});

	it("fuegt der Erledigt-Lane kein eigenes Tag hinzu", () => {
		const out = rewriteInlineLineForLane("- [ ] Ohne Lane-Tag", DEFAULT_LANES, "done");
		expect(out).toMatch(/^\s*-\s*\[x\]/);
		expect(out).not.toContain("#gtd/done");
	});

	it("entfernt den Haken und setzt das Ziel-Tag, wenn aus Erledigt heraus verschoben wird", () => {
		const out = rewriteInlineLineForLane("- [x] Fertig #gtd/inbox", DEFAULT_LANES, "waiting-for");
		expect(out).toMatch(/^\s*-\s*\[ \]/);
		expect(out).toContain("#gtd/waiting");
		expect(out).not.toContain("#gtd/inbox");
	});

	it("entfernt ein veraltetes Erledigt-Tag beim Verschieben in eine normale Lane", () => {
		const out = rewriteInlineLineForLane("- [x] Fertig #gtd/done", DEFAULT_LANES, "inbox");
		expect(out).toMatch(/^\s*-\s*\[ \]/);
		expect(out).not.toContain("#gtd/done");
		expect(out).toContain("#gtd/inbox");
	});

	it("gibt die Zeile unveraendert zurueck, wenn sie keine Checkbox ist", () => {
		const line = "Kein Task hier";
		expect(rewriteInlineLineForLane(line, DEFAULT_LANES, "inbox")).toBe(line);
	});

	it("behaelt den Prioritaets-Marker beim Wechsel der Lane", () => {
		const out = rewriteInlineLineForLane("- [ ] Wichtig 🔺 #gtd/inbox", DEFAULT_LANES, "waiting-for");
		expect(out).toContain("🔺");
		expect(out).toContain("#gtd/waiting");
	});

	it("behaelt den Prioritaets-Marker auch beim Verschieben in Erledigt", () => {
		const out = rewriteInlineLineForLane("- [ ] Kann warten 🔽 #gtd/inbox", DEFAULT_LANES, "done");
		expect(out).toMatch(/^\s*-\s*\[x\]/);
		expect(out).toContain("🔽");
	});
});

describe("priorityRank / toTaskPriority", () => {
	it("ordnet hoch < mittel < niedrig, fehlende Angabe wie mittel", () => {
		expect(priorityRank("high")).toBeLessThan(priorityRank("medium"));
		expect(priorityRank("medium")).toBeLessThan(priorityRank("low"));
		expect(priorityRank(undefined)).toBe(priorityRank("medium"));
	});

	it("validiert nur die drei bekannten Werte, sonst undefined", () => {
		expect(toTaskPriority("high")).toBe("high");
		expect(toTaskPriority("low")).toBe("low");
		expect(toTaskPriority("dringend")).toBeUndefined();
		expect(toTaskPriority(undefined)).toBeUndefined();
		expect(toTaskPriority(3)).toBeUndefined();
	});
});

describe("inlineTaskId", () => {
	it("ist stabil fuer denselben Pfad+Titel und unterscheidet verschiedene Titel", () => {
		const a = inlineTaskId("GTD/Notizen.md", "Etwas tun");
		const b = inlineTaskId("GTD/Notizen.md", "Etwas tun");
		const c = inlineTaskId("GTD/Notizen.md", "Anderes tun");
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});
});

describe("isPathInFolder", () => {
	it("erkennt Dateien in Unterordnern", () => {
		expect(isPathInFolder("GTD/Projekt A/notiz.md", "GTD")).toBe(true);
		expect(isPathInFolder("GTD/notiz.md", "GTD")).toBe(true);
		expect(isPathInFolder("Anderes/notiz.md", "GTD")).toBe(false);
	});

	it("lehnt Praefix-Kollisionen ohne Trennzeichen ab", () => {
		expect(isPathInFolder("GTD-Archiv/notiz.md", "GTD")).toBe(false);
	});

	it("behandelt leeren Ordner als Vault-Root (alles passt)", () => {
		expect(isPathInFolder("irgendwas/notiz.md", "")).toBe(true);
	});
});

describe("dueUrgency", () => {
	const referenceNow = new Date(2026, 8, 20, 10, 0, 0); // 20.09.2026, 10:00 Uhr (lokal)

	it("gibt undefined zurueck, wenn kein gueltiges Datum vorliegt", () => {
		expect(dueUrgency(undefined, referenceNow)).toBeUndefined();
		expect(dueUrgency("keine-datum", referenceNow)).toBeUndefined();
	});

	it("erkennt ueberfaellige Termine (vor heute)", () => {
		expect(dueUrgency("2026-09-19", referenceNow)).toBe("overdue");
		expect(dueUrgency("2026-01-01", referenceNow)).toBe("overdue");
	});

	it("erkennt heutige Termine unabhaengig von der Uhrzeit", () => {
		expect(dueUrgency("2026-09-20", referenceNow)).toBe("today");
		expect(dueUrgency("2026-09-20T23:59", referenceNow)).toBe("today");
	});

	it("erkennt Termine innerhalb der naechsten 7 Tage als 'week'", () => {
		expect(dueUrgency("2026-09-21", referenceNow)).toBe("week");
		expect(dueUrgency("2026-09-27", referenceNow)).toBe("week");
	});

	it("erkennt Termine spaeter als 7 Tage als 'later'", () => {
		expect(dueUrgency("2026-09-28", referenceNow)).toBe("later");
		expect(dueUrgency("2027-01-01", referenceNow)).toBe("later");
	});
});

describe("Kontext-Tags (@wort)", () => {
	it("extrahiert Kontexte aus einer Inline-Zeile und entfernt sie aus dem Titel", () => {
		const parsed = parseInlineLine("- [ ] Anrufen @Buero @Telefon #gtd/next", DEFAULT_LANES);
		expect(parsed).not.toBeNull();
		expect(parsed?.contexts).toEqual(["Buero", "Telefon"]);
		expect(parsed?.title).toBe("Anrufen");
	});

	it("unterstuetzt Umlaute in Kontext-Namen", () => {
		const parsed = parseInlineLine("- [ ] Termin @Büro", DEFAULT_LANES);
		expect(parsed?.contexts).toEqual(["Büro"]);
	});

	it("liefert eine leere Liste, wenn keine Kontexte vorhanden sind", () => {
		const parsed = parseInlineLine("- [ ] Ohne Kontext #gtd/inbox", DEFAULT_LANES);
		expect(parsed?.contexts).toEqual([]);
	});

	it("behaelt Kontexte beim Verschieben in eine andere Lane", () => {
		const out = rewriteInlineLineForLane("- [ ] Anrufen @Buero #gtd/inbox", DEFAULT_LANES, "next-actions");
		expect(out).toContain("@Buero");
		expect(out).toContain("#gtd/next");
	});

	it("behaelt Kontexte auch beim Verschieben nach Erledigt", () => {
		const out = rewriteInlineLineForLane("- [ ] Anrufen @Buero #gtd/inbox", DEFAULT_LANES, "done");
		expect(out).toMatch(/^\s*-\s*\[x\]/);
		expect(out).toContain("@Buero");
	});
});

describe("countSubtasks", () => {
	it("gibt undefined zurueck, wenn keine Beschreibung oder keine Checkboxen vorhanden sind", () => {
		expect(countSubtasks(undefined)).toBeUndefined();
		expect(countSubtasks("")).toBeUndefined();
		expect(countSubtasks("Nur Text ohne Checkboxen.")).toBeUndefined();
	});

	it("zaehlt erledigte und offene Checkbox-Zeilen", () => {
		const description = "- [x] Erstes\n- [ ] Zweites\n- [X] Drittes\n- [ ] Viertes\n- [ ] Fuenftes";
		expect(countSubtasks(description)).toEqual({ done: 2, total: 5 });
	});

	it("ignoriert normale Textzeilen zwischen Checkboxen", () => {
		const description = "Einleitung\n- [x] Erstes\nZwischentext\n- [ ] Zweites";
		expect(countSubtasks(description)).toEqual({ done: 1, total: 2 });
	});
});

describe("buildIcsContent", () => {
	const baseTask: GtdTask = {
		id: "file::GTD/Aufgaben/Test.md",
		source: "file",
		title: "Angebot pruefen",
		description: "",
		laneId: "next-actions",
		done: false,
		tags: [],
		contexts: [],
		filePath: "GTD/Aufgaben/Test.md",
		order: 0,
	};
	const now = new Date(2026, 8, 20, 9, 0, 0);

	it("erzeugt ein gueltiges VCALENDAR-Geruest", () => {
		const ics = buildIcsContent([], now);
		expect(ics).toContain("BEGIN:VCALENDAR");
		expect(ics).toContain("VERSION:2.0");
		expect(ics).toContain("END:VCALENDAR");
	});

	it("ueberspringt erledigte Aufgaben und Aufgaben ohne Faelligkeit", () => {
		const ics = buildIcsContent(
			[
				{ ...baseTask, id: "a", done: true, due: "2026-09-25" },
				{ ...baseTask, id: "b", due: undefined },
			],
			now
		);
		expect(ics).not.toContain("BEGIN:VEVENT");
	});

	it("verwendet VALUE=DATE fuer Faelligkeiten ohne Uhrzeit", () => {
		const ics = buildIcsContent([{ ...baseTask, due: "2026-09-25" }], now);
		expect(ics).toContain("DTSTART;VALUE=DATE:20260925");
		expect(ics).toContain("SUMMARY:Angebot pruefen");
	});

	it("verwendet DTSTART mit Uhrzeit fuer Faelligkeiten mit Zeitangabe", () => {
		const ics = buildIcsContent([{ ...baseTask, due: "2026-09-25T14:30" }], now);
		expect(ics).toContain("DTSTART:20260925T143000");
		expect(ics).not.toContain("VALUE=DATE");
	});

	it("escaped Kommas, Semikolons und Zeilenumbrueche in Titel und Beschreibung", () => {
		const ics = buildIcsContent(
			[{ ...baseTask, due: "2026-09-25", title: "A, B; C", description: "Zeile 1\nZeile 2" }],
			now
		);
		expect(ics).toContain("SUMMARY:A\\, B\\; C");
		expect(ics).toContain("DESCRIPTION:Zeile 1\\nZeile 2");
	});
});

describe("nextOccurrence", () => {
	it("verschiebt ein Datum ohne Uhrzeit um die passende Einheit weiter", () => {
		expect(nextOccurrence("2026-09-21", "daily")).toBe("2026-09-22");
		expect(nextOccurrence("2026-09-21", "weekly")).toBe("2026-09-28");
		expect(nextOccurrence("2026-09-21", "monthly")).toBe("2026-10-21");
		expect(nextOccurrence("2026-09-21", "yearly")).toBe("2027-09-21");
	});

	it("behaelt eine vorhandene Uhrzeit bei", () => {
		expect(nextOccurrence("2026-09-21T09:00", "weekly")).toBe("2026-09-28T09:00");
	});

	it("wechselt bei monatlicher Wiederholung korrekt den Monat/Jahr am Jahresende", () => {
		expect(nextOccurrence("2026-12-15", "monthly")).toBe("2027-01-15");
	});

	it("gibt undefined zurueck, wenn das Ausgangsdatum ungueltig ist", () => {
		expect(nextOccurrence("kein-datum", "weekly")).toBeUndefined();
	});
});

describe("Wiederkehrende Aufgaben (Inline)", () => {
	it("extrahiert die Wiederholungsregel und entfernt sie aus dem Titel", () => {
		const parsed = parseInlineLine("- [ ] Muell rausbringen 🔁 woechentlich #gtd/next 📅 2026-09-21", DEFAULT_LANES);
		expect(parsed?.recurrence).toBe("weekly");
		expect(parsed?.title).toBe("Muell rausbringen");
	});

	it("erkennt auch die Umlaut-Schreibweise", () => {
		const parsed = parseInlineLine("- [ ] Termin 🔁 wöchentlich 📅 2026-09-21", DEFAULT_LANES);
		expect(parsed?.recurrence).toBe("weekly");
	});

	it("behaelt die Wiederholungsregel beim Verschieben in eine andere (nicht-Erledigt) Lane", () => {
		const out = rewriteInlineLineForLane(
			"- [ ] Muell rausbringen 🔁 woechentlich #gtd/inbox 📅 2026-09-21",
			DEFAULT_LANES,
			"next-actions"
		);
		expect(out).toContain("🔁");
		expect(out).toContain("#gtd/next");
	});

	it("springt beim Verschieben nach Erledigt auf den naechsten Termin, statt abzuhaken", () => {
		const out = rewriteInlineLineForLane(
			"- [ ] Muell rausbringen 🔁 woechentlich #gtd/inbox 📅 2026-09-21",
			DEFAULT_LANES,
			"done"
		);
		expect(out).toMatch(/^\s*-\s*\[ \]/);
		expect(out).toContain("📅 2026-09-28");
		expect(out).toContain("🔁");
	});

	it("hakt eine Aufgabe ohne Wiederholungsregel wie bisher beim Verschieben nach Erledigt ab", () => {
		const out = rewriteInlineLineForLane("- [ ] Einmalig #gtd/inbox 📅 2026-09-21", DEFAULT_LANES, "done");
		expect(out).toMatch(/^\s*-\s*\[x\]/);
	});

	it("springt auch ohne Faelligkeit nicht (keine Regel greift ohne Anker), hakt normal ab", () => {
		const out = rewriteInlineLineForLane("- [ ] Ohne Termin 🔁 taeglich #gtd/inbox", DEFAULT_LANES, "done");
		expect(out).toMatch(/^\s*-\s*\[x\]/);
	});
});

describe("bounceRecurringInlineLine", () => {
	it("baut eine direkt abgehakte wiederkehrende Zeile neu auf: offen, naechster Termin", () => {
		const out = bounceRecurringInlineLine("- [x] Muell rausbringen 🔁 woechentlich #gtd/next 📅 2026-09-21", DEFAULT_LANES);
		expect(out).not.toBeNull();
		expect(out).toMatch(/^\s*-\s*\[ \]/);
		expect(out).toContain("#gtd/next");
		expect(out).toContain("📅 2026-09-28");
		expect(out).toContain("🔁");
	});

	it("gibt null zurueck fuer nicht abgehakte Zeilen", () => {
		expect(bounceRecurringInlineLine("- [ ] Offen 🔁 taeglich 📅 2026-09-21", DEFAULT_LANES)).toBeNull();
	});

	it("gibt null zurueck fuer abgehakte Zeilen ohne Wiederholungsregel", () => {
		expect(bounceRecurringInlineLine("- [x] Einmalig 📅 2026-09-21", DEFAULT_LANES)).toBeNull();
	});

	it("gibt null zurueck fuer abgehakte, wiederkehrende Zeilen ohne Faelligkeit", () => {
		expect(bounceRecurringInlineLine("- [x] Ohne Termin 🔁 taeglich", DEFAULT_LANES)).toBeNull();
	});
});

describe("startOfWeek / addDays", () => {
	it("liefert fuer einen Mittwoch den Montag derselben Woche", () => {
		const wed = new Date(2026, 8, 23); // Mittwoch, 23.09.2026
		const monday = startOfWeek(wed);
		expect(monday.getFullYear()).toBe(2026);
		expect(monday.getMonth()).toBe(8);
		expect(monday.getDate()).toBe(21);
		expect(monday.getDay()).toBe(1);
	});

	it("liefert fuer einen Sonntag den Montag derselben (vorherigen) Woche", () => {
		const sun = new Date(2026, 8, 27); // Sonntag, 27.09.2026
		const monday = startOfWeek(sun);
		expect(monday.getDate()).toBe(21);
		expect(monday.getDay()).toBe(1);
	});

	it("liefert fuer einen Montag denselben Tag", () => {
		const mon = new Date(2026, 8, 21);
		const monday = startOfWeek(mon);
		expect(monday.getDate()).toBe(21);
	});

	it("addDays verschiebt kalendertagbasiert, auch ueber Monatsgrenzen hinweg", () => {
		const d = addDays(new Date(2026, 8, 28), 5);
		expect(d.getMonth()).toBe(9);
		expect(d.getDate()).toBe(3);
	});

	it("addDays mit negativer Zahl geht zurueck", () => {
		const d = addDays(new Date(2026, 8, 21), -7);
		expect(d.getMonth()).toBe(8);
		expect(d.getDate()).toBe(14);
	});
});

describe("parseInlineLine / rewriteInlineLineForLane: Delegation (👤)", () => {
	it("erkennt den Delegations-Marker und entfernt ihn aus dem Titel", () => {
		const parsed = parseInlineLine("- [ ] Angebot pruefen 👤 Christian #gtd/waiting", DEFAULT_LANES);
		expect(parsed?.delegatedTo).toBe("Christian");
		expect(parsed?.title).toBe("Angebot pruefen");
	});

	it("hat ohne Marker kein delegatedTo", () => {
		expect(parseInlineLine("- [ ] Ohne Delegation", DEFAULT_LANES)?.delegatedTo).toBeUndefined();
	});

	it("behaelt die Delegation beim Verschieben in eine andere Lane", () => {
		const out = rewriteInlineLineForLane(
			"- [ ] Angebot pruefen 👤 Christian #gtd/inbox",
			DEFAULT_LANES,
			"waiting-for"
		);
		expect(out).toContain("👤 Christian");
		expect(out).toContain("#gtd/waiting");
	});

	it("behaelt die Delegation auch beim Verschieben nach Erledigt", () => {
		const out = rewriteInlineLineForLane("- [ ] Fertig machen 👤 Anna #gtd/inbox", DEFAULT_LANES, "done");
		expect(out).toMatch(/^\s*-\s*\[x\]/);
		expect(out).toContain("👤 Anna");
	});
});

describe("parseInlineLine / rewriteInlineLineForLane: Projekt (+wort)", () => {
	it("erkennt den Projekt-Marker und entfernt ihn aus dem Titel", () => {
		const parsed = parseInlineLine("- [ ] Angebot pruefen +SAP-Transformation #gtd/inbox", DEFAULT_LANES);
		expect(parsed?.project).toBe("SAP-Transformation");
		expect(parsed?.title).toBe("Angebot pruefen");
	});

	it("hat ohne Marker kein project", () => {
		expect(parseInlineLine("- [ ] Ohne Projekt", DEFAULT_LANES)?.project).toBeUndefined();
	});

	it("behaelt das Projekt beim Verschieben in eine andere Lane", () => {
		const out = rewriteInlineLineForLane(
			"- [ ] Angebot pruefen +SAP-Transformation #gtd/inbox",
			DEFAULT_LANES,
			"waiting-for"
		);
		expect(out).toContain("+SAP-Transformation");
		expect(out).toContain("#gtd/waiting");
	});

	it("behaelt das Projekt auch beim Verschieben nach Erledigt", () => {
		const out = rewriteInlineLineForLane("- [ ] Fertig machen +Umzug #gtd/inbox", DEFAULT_LANES, "done");
		expect(out).toMatch(/^\s*-\s*\[x\]/);
		expect(out).toContain("+Umzug");
	});
});

describe("parseQuickCapture", () => {
	it("erkennt Lane-Tag, Kontext, Projekt, Delegation, Prioritaet, Faelligkeit und Wiederholung", () => {
		const parsed = parseQuickCapture(
			"Angebot pruefen @Buero +SAP-Transformation 👤 Christian 🔺 📅 2026-09-25 🔁 woechentlich #gtd/waiting",
			DEFAULT_LANES
		);
		expect(parsed?.title).toBe("Angebot pruefen");
		expect(parsed?.contexts).toEqual(["Buero"]);
		expect(parsed?.project).toBe("SAP-Transformation");
		expect(parsed?.delegatedTo).toBe("Christian");
		expect(parsed?.priority).toBe("high");
		expect(parsed?.due).toBe("2026-09-25");
		expect(parsed?.recurrence).toBe("weekly");
		expect(parsed?.laneId).toBe("waiting-for");
	});

	it("liefert einfachen Text unveraendert als Titel, ohne Marker", () => {
		const parsed = parseQuickCapture("Nur ein einfacher Text", DEFAULT_LANES);
		expect(parsed?.title).toBe("Nur ein einfacher Text");
		expect(parsed?.due).toBeUndefined();
		expect(parsed?.project).toBeUndefined();
		expect(parsed?.laneId).toBeUndefined();
	});

	it("liefert null bei leerer Eingabe", () => {
		expect(parseQuickCapture("", DEFAULT_LANES)?.title).toBe("");
	});

	it("loest 'heute'/'morgen'/'uebermorgen' relativ zum uebergebenen Zeitpunkt auf", () => {
		const reference = new Date(2026, 8, 20); // Sonntag, 2026-09-20
		expect(parseQuickCapture("Sache 📅 heute", DEFAULT_LANES, reference)?.due).toBe("2026-09-20");
		expect(parseQuickCapture("Sache 📅 morgen", DEFAULT_LANES, reference)?.due).toBe("2026-09-21");
		expect(parseQuickCapture("Sache 📅 uebermorgen", DEFAULT_LANES, reference)?.due).toBe("2026-09-22");
	});
});

describe("daysSince", () => {
	it("berechnet ganze Tage seit einem Zeitpunkt", () => {
		const reference = new Date(2026, 8, 20, 12, 0, 0);
		const fiveDaysAgo = reference.getTime() - 5 * 86_400_000;
		expect(daysSince(fiveDaysAgo, reference)).toBe(5);
	});

	it("ist 0 fuer den aktuellen Zeitpunkt", () => {
		const reference = new Date(2026, 8, 20, 12, 0, 0);
		expect(daysSince(reference.getTime(), reference)).toBe(0);
	});

	it("rundet ab, auch bei Teiltagen", () => {
		const reference = new Date(2026, 8, 20, 12, 0, 0);
		const almostTwoDaysAgo = reference.getTime() - 1.5 * 86_400_000;
		expect(daysSince(almostTwoDaysAgo, reference)).toBe(1);
	});
});
