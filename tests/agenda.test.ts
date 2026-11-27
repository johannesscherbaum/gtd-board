import {
	agendaNotes,
	insertAgendaNote,
	insertAgendaTopic,
	matchAttendeePeople,
	parseAgendaLine,
	setAgendaLineDone,
} from "../src/agenda";

describe("parseAgendaLine", () => {
	it("liest Titel ohne Marker und das Besprochen-Datum", () => {
		expect(parseAgendaLine("- [x] Budget 2027 klären ✅ 2026-11-27", [])).toEqual({
			done: true,
			title: "Budget 2027 klären",
			doneDate: "2026-11-27",
			person: undefined,
			tags: [],
		});
	});

	it("erkennt Person und Agenda-Tag bei Inline-Agendapunkten", () => {
		const parsed = parseAgendaLine("- [ ] Urlaub abstimmen #gtd/agenda 👤 Günther", []);
		expect(parsed?.title).toBe("Urlaub abstimmen");
		expect(parsed?.person).toBe("Günther");
		expect(parsed?.tags).toEqual(["gtd/agenda"]);
	});

	it("ignoriert Zeilen ohne Checkbox", () => {
		expect(parseAgendaLine("- nur ein Punkt", [])).toBeNull();
	});
});

describe("setAgendaLineDone", () => {
	it("hakt ab und haengt das Datum an, Rest bleibt gleich", () => {
		expect(setAgendaLineDone("\t- [ ] Thema #gtd/agenda 👤 Anna", true, "2026-11-27")).toBe(
			"\t- [x] Thema #gtd/agenda 👤 Anna ✅ 2026-11-27"
		);
	});

	it("setzt das Datum vor eine Block-ID", () => {
		expect(setAgendaLineDone("- [ ] Thema ^abc1", true, "2026-11-27")).toBe("- [x] Thema ✅ 2026-11-27 ^abc1");
	});

	it("entfernt beim Wiederoeffnen Haken und Datum (Round-Trip)", () => {
		const original = "- [ ] Thema ^abc1";
		const done = setAgendaLineDone(original, true, "2026-11-27");
		expect(setAgendaLineDone(done, false, "2026-11-28")).toBe(original);
	});
});

describe("Anmerkungen", () => {
	const lines = ["- [ ] Budget", "\t- erste Anmerkung", "\t- zweite", "- [ ] Urlaub", ""];

	it("liest die eingerueckten Zeilen unter dem Thema", () => {
		expect(agendaNotes(lines, 0)).toEqual(["erste Anmerkung", "zweite"]);
		expect(agendaNotes(lines, 3)).toEqual([]);
	});

	it("haengt eine Anmerkung hinter die vorhandenen an", () => {
		expect(insertAgendaNote(lines, 0, "  dritte  ")).toEqual([
			"- [ ] Budget",
			"\t- erste Anmerkung",
			"\t- zweite",
			"\t- dritte",
			"- [ ] Urlaub",
			"",
		]);
	});

	it("rueckt unter eingerueckten Themen eine Ebene tiefer ein", () => {
		expect(insertAgendaNote(["\t- [ ] Thema"], 0, "x")).toEqual(["\t- [ ] Thema", "\t\t- x"]);
	});
});

describe("insertAgendaTopic", () => {
	const fm = ["---", "person: Günther", "---", "", "# Günther", ""];

	it("haengt hinter das letzte offene Thema samt Anmerkungen", () => {
		const lines = [...fm, "- [ ] A", "\t- Notiz", "- [x] B ✅ 2026-11-20", ""];
		expect(insertAgendaTopic(lines, "Neu", 3)).toEqual([
			...fm,
			"- [ ] A",
			"\t- Notiz",
			"- [ ] Neu",
			"- [x] B ✅ 2026-11-20",
			"",
		]);
	});

	it("setzt vor das erste besprochene Thema, wenn keins offen ist", () => {
		const lines = [...fm, "- [x] B ✅ 2026-11-20"];
		expect(insertAgendaTopic(lines, "Neu", 3)).toEqual([...fm, "- [ ] Neu", "- [x] B ✅ 2026-11-20"]);
	});

	it("haengt in einer leeren Notiz ans Ende", () => {
		expect(insertAgendaTopic([...fm], "Neu", 3)).toEqual([...fm, "- [ ] Neu", ""]);
		expect(insertAgendaTopic(["---", "a: 1", "---"], "Neu", 3)).toEqual(["---", "a: 1", "---", "- [ ] Neu", ""]);
	});
});

describe("matchAttendeePeople", () => {
	it("findet Personen in Teilnehmernamen", () => {
		expect(
			matchAttendeePeople(["Meier, Günther", "Regine Huber", "lukas@example.org"], ["Günther", "Regine Huber", "Anna", "Lukas"])
		).toEqual(["Günther", "Regine Huber"]);
	});
});
