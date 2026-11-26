import { AGENDA_LANE_ID, GtdTask } from "../src/types";
import { buildSidebarCounts } from "../src/util";

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

describe("buildSidebarCounts", () => {
	// Donnerstag, 26.11.2026 - Woche Mo 23.11. bis So 29.11.
	const now = new Date(2026, 10, 26, 10, 0);

	const tasks: GtdTask[] = [
		task({ title: "ueberfaellig", due: "2026-11-20", project: "Garten" }),
		task({ title: "heute", due: "2026-11-26", delegatedTo: "Max" }),
		task({ title: "markiert", today: "2026-11-26", delegatedTo: "Max", origin: { kind: "Planner" } }),
		task({ title: "sonntag", due: "2026-11-29", project: "Garten", origin: { kind: "meeting" } }),
		task({ title: "naechste woche", due: "2026-11-30", delegatedTo: " Anna ", origin: { kind: "planner", plannerId: "1" } }),
		task({ title: "erledigt", done: true, due: "2026-11-26", project: "Garten", delegatedTo: "Max" }),
		task({ title: "agenda", laneId: AGENDA_LANE_ID, project: "Garten", due: "2026-11-26" }),
	];

	const counts = buildSidebarCounts(tasks, AGENDA_LANE_ID, now);

	it("zaehlt die Listen ueber alle offenen Aufgaben", () => {
		expect(counts.open).toBe(6);
		expect(counts.overdue).toBe(1);
		// heute + markiert + Agenda-Eintrag (faellig heute)
		expect(counts.today).toBe(3);
		// Mo 23.11. bis So 29.11.: heute, sonntag, agenda (der ueberfaellige liegt davor)
		expect(counts.week).toBe(3);
	});

	it("gruppiert Personen, Projekte und Herkunft ohne Erledigte und Agenda-Eintraege", () => {
		expect(counts.people).toEqual([
			{ key: "Anna", count: 1 },
			{ key: "Max", count: 2 },
		]);
		expect(counts.projects).toEqual([{ key: "Garten", count: 2 }]);
		expect(counts.origins).toEqual([
			{ key: "meeting", count: 1 },
			{ key: "planner", count: 2 },
		]);
	});

	it("liefert leere Gruppen ohne passende Felder", () => {
		const empty = buildSidebarCounts([task({ title: "x" })], AGENDA_LANE_ID, now);
		expect(empty.people).toEqual([]);
		expect(empty.projects).toEqual([]);
		expect(empty.origins).toEqual([]);
		expect(empty.open).toBe(1);
	});
});
