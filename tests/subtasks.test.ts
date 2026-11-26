import { GtdTask } from "../src/types";
import { buildTodayFocus, buildSidebarCounts, countSubtasks, earliestOpenSubtaskDay, focusDay, parseSubtaskItems } from "../src/util";

function task(partial: Partial<GtdTask>): GtdTask {
	return {
		id: partial.title ?? "t",
		source: "file",
		title: "t",
		description: "",
		laneId: "next-actions",
		done: false,
		tags: [],
		contexts: [],
		filePath: "x.md",
		order: 0,
		lastTouched: 0,
		...partial,
	};
}

const description = [
	"Einleitung",
	"- [ ] Angebot einholen 📅 2026-11-28",
	"- [x] Termin vereinbaren 📅 2026-11-20",
	"- [ ] Anrufen 📅 2026-11-27 ⏰14:00",
	"- [ ] Ohne Datum",
].join("\n");

describe("parseSubtaskItems mit eigenem Datum", () => {
	it("liest Datum und Uhrzeit und entfernt sie aus dem Anzeigetext", () => {
		expect(parseSubtaskItems(description)).toEqual([
			{ done: false, text: "Angebot einholen", due: "2026-11-28" },
			{ done: true, text: "Termin vereinbaren", due: "2026-11-20" },
			{ done: false, text: "Anrufen", due: "2026-11-27T14:00" },
			{ done: false, text: "Ohne Datum", due: undefined },
		]);
	});

	it("zaehlt weiterhin alle Checkboxen", () => {
		expect(countSubtasks(description)).toEqual({ done: 1, total: 4 });
	});

	it("earliestOpenSubtaskDay ignoriert erledigte Unteraufgaben", () => {
		expect(earliestOpenSubtaskDay(description)).toBe("2026-11-27");
		expect(earliestOpenSubtaskDay("- [x] fertig 📅 2026-01-01")).toBeUndefined();
		expect(earliestOpenSubtaskDay(undefined)).toBeUndefined();
	});
});

describe("Unteraufgaben im Heute-Fokus", () => {
	const now = new Date(2026, 10, 27, 9, 0);

	it("focusDay nimmt das fruehere Datum aus Aufgabe und offenen Unteraufgaben", () => {
		expect(focusDay(task({ due: "2026-12-10", description }))).toBe("2026-11-27");
		expect(focusDay(task({ due: "2026-11-25", description }))).toBe("2026-11-25");
		expect(focusDay(task({ description }))).toBe("2026-11-27");
		expect(focusDay(task({}))).toBeUndefined();
	});

	it("bringt eine Aufgabe mit heute faelliger Unteraufgabe in die Liste Heute", () => {
		const focus = buildTodayFocus([task({ title: "Projekt", due: "2026-12-10", description })], now);
		expect(focus.today.map((t) => t.title)).toEqual(["Projekt"]);
		expect(focus.overdue).toEqual([]);
	});

	it("eine ueberfaellige offene Unteraufgabe macht die Aufgabe ueberfaellig", () => {
		const focus = buildTodayFocus([task({ title: "P", description: "- [ ] alt 📅 2026-11-01" })], now);
		expect(focus.overdue.map((t) => t.title)).toEqual(["P"]);
		const counts = buildSidebarCounts([task({ title: "P", description: "- [ ] alt 📅 2026-11-01" })], "__agenda__", now);
		expect(counts.overdue).toBe(1);
	});

	it("erledigte Unteraufgaben und erledigte Aufgaben zaehlen nicht", () => {
		expect(buildTodayFocus([task({ description: "- [x] alt 📅 2026-11-01" })], now).overdue).toEqual([]);
		expect(buildTodayFocus([task({ done: true, description: "- [ ] alt 📅 2026-11-01" })], now).overdue).toEqual([]);
	});
});
