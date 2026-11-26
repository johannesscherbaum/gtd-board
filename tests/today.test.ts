import { DEFAULT_LANES, DEFAULT_SETTINGS, GtdBoardSettings, GtdTask } from "../src/types";
import {
	bounceRecurringInlineLine,
	buildTodayFocus,
	formatLocalDate,
	parseInlineLine,
	rewriteInlineLineForLane,
	setInlineTodayMarker,
} from "../src/util";
import { makeStore } from "./helpers/fakeVault";

function task(partial: Partial<GtdTask>): GtdTask {
	return {
		id: partial.id ?? partial.title ?? "t",
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

describe("Heute-Marker (Inline 🎯 YYYY-MM-DD)", () => {
	it("wird geparst und aus dem Titel entfernt", () => {
		const parsed = parseInlineLine("- [ ] Angebot schreiben #gtd/next 🎯 2026-11-26", DEFAULT_LANES);
		expect(parsed?.today).toBe("2026-11-26");
		expect(parsed?.title).toBe("Angebot schreiben");
	});

	it("bleibt beim Lane-Wechsel und beim Abhaken erhalten", () => {
		const line = "- [ ] Angebot #gtd/inbox 📅 2026-11-30 🎯 2026-11-26";
		const moved = rewriteInlineLineForLane(line, DEFAULT_LANES, "waiting-for");
		expect(parseInlineLine(moved, DEFAULT_LANES)?.today).toBe("2026-11-26");
		expect(parseInlineLine(moved, DEFAULT_LANES)?.title).toBe("Angebot");
		const done = rewriteInlineLineForLane(line, DEFAULT_LANES, "done");
		expect(parseInlineLine(done, DEFAULT_LANES)?.today).toBe("2026-11-26");
	});

	it("entfaellt, wenn eine wiederkehrende Aufgabe auf den naechsten Termin springt", () => {
		const line = "- [ ] Bericht #gtd/next 🔁 wöchentlich 📅 2026-11-26 🎯 2026-11-26";
		const bounced = rewriteInlineLineForLane(line, DEFAULT_LANES, "done");
		expect(bounced).not.toContain("🎯");
		const ticked = bounceRecurringInlineLine(line.replace("[ ]", "[x]"), DEFAULT_LANES);
		expect(ticked).not.toContain("🎯");
		expect(ticked).toContain("📅 2026-12-03");
	});

	it("setInlineTodayMarker setzt, ersetzt und entfernt den Marker, ohne den Rest anzufassen", () => {
		const line = "  - [ ] Anrufen @Telefon +Garten #gtd/next 📅 2026-12-01";
		const marked = setInlineTodayMarker(line, "2026-11-26");
		expect(marked).toBe(`${line} 🎯 2026-11-26`);
		const replaced = setInlineTodayMarker(marked, "2026-11-27");
		expect(replaced).toBe(`${line} 🎯 2026-11-27`);
		expect(setInlineTodayMarker(replaced, undefined)).toBe(line);
	});

	it("setInlineTodayMarker laesst eine Block-ID am Zeilenende", () => {
		expect(setInlineTodayMarker("- [ ] Mit Block ^abc-1", "2026-11-26")).toBe("- [ ] Mit Block 🎯 2026-11-26 ^abc-1");
	});

	it("setInlineTodayMarker aendert Nicht-Checkbox-Zeilen nicht", () => {
		expect(setInlineTodayMarker("Nur Text", "2026-11-26")).toBe("Nur Text");
	});
});

describe("buildTodayFocus", () => {
	const now = new Date(2026, 10, 26, 10, 0);

	it("trennt ueberfaellige von heute faelligen und heute markierten Aufgaben", () => {
		const tasks = [
			task({ title: "alt", due: "2026-11-20" }),
			task({ title: "heute", due: "2026-11-26" }),
			task({ title: "markiert", today: "2026-11-26" }),
			task({ title: "gestern markiert", today: "2026-11-25" }),
			task({ title: "morgen", due: "2026-11-27" }),
			task({ title: "erledigt", due: "2026-11-20", done: true }),
			task({ title: "alt und markiert", due: "2026-11-24", today: "2026-11-26" }),
		];
		const focus = buildTodayFocus(tasks, now);
		expect(focus.overdue.map((t) => t.title)).toEqual(["alt", "alt und markiert"]);
		expect(focus.today.map((t) => t.title).sort()).toEqual(["heute", "markiert"]);
	});

	it("sortiert heute zuerst nach Uhrzeit, dann nach Prioritaet", () => {
		const tasks = [
			task({ title: "niedrig", today: "2026-11-26", priority: "low" }),
			task({ title: "spaet", due: "2026-11-26T15:00" }),
			task({ title: "hoch", today: "2026-11-26", priority: "high" }),
			task({ title: "frueh", due: "2026-11-26T08:30" }),
		];
		expect(buildTodayFocus(tasks, now).today.map((t) => t.title)).toEqual(["frueh", "spaet", "hoch", "niedrig"]);
	});
});

describe("GtdStore.setTodayMark", () => {
	const settings: GtdBoardSettings = { ...DEFAULT_SETTINGS, lanes: DEFAULT_LANES, watchFolder: "GTD", taskFilesFolder: "GTD/Aufgaben" };
	const todayStr = formatLocalDate(new Date());

	it("setzt und entfernt today: im Frontmatter einer Datei-Aufgabe und erhaelt unbekannte Felder", async () => {
		const { store, vault } = makeStore(settings);
		vault.addTaskFile("GTD/Aufgaben/a.md", ["lane: next-actions", "sourceLabel: Meeting", "plannerId: abc"]);
		let [a] = await store.getAllTasks();
		await store.setTodayMark(a, todayStr);
		expect(vault.content("GTD/Aufgaben/a.md")).toContain(`today: ${todayStr}`);
		expect(vault.content("GTD/Aufgaben/a.md")).toContain("plannerId: abc");
		[a] = await store.getAllTasks();
		expect(a.today).toBe(todayStr);

		await store.setTodayMark(a, undefined);
		expect(vault.content("GTD/Aufgaben/a.md")).not.toContain("today:");
		expect(vault.content("GTD/Aufgaben/a.md")).toContain("sourceLabel: Meeting");
	});

	it("bleibt beim Bearbeiten der Aufgabe erhalten", async () => {
		const { store, vault } = makeStore(settings);
		vault.addTaskFile("GTD/Aufgaben/a.md", ["lane: next-actions", `today: ${todayStr}`]);
		const [a] = await store.getAllTasks();
		await store.updateTaskFile(a, { title: "a", description: "neu", contexts: [], tags: [] });
		expect(vault.content("GTD/Aufgaben/a.md")).toContain(`today: ${todayStr}`);
	});

	it("setzt und entfernt den Inline-Marker in der Quellzeile", async () => {
		const { store, vault } = makeStore(settings);
		vault.addFile("GTD/Notiz.md", "# Notiz\n- [ ] Anrufen #gtd/next\nText");
		let [a] = await store.getAllTasks();
		await store.setTodayMark(a, todayStr);
		expect(vault.content("GTD/Notiz.md")).toBe(`# Notiz\n- [ ] Anrufen #gtd/next 🎯 ${todayStr}\nText`);
		[a] = await store.getAllTasks();
		expect(a.today).toBe(todayStr);
		expect(a.title).toBe("Anrufen");
		await store.setTodayMark(a, undefined);
		expect(vault.content("GTD/Notiz.md")).toBe("# Notiz\n- [ ] Anrufen #gtd/next\nText");
	});

	it("entfernt today:, wenn eine wiederkehrende Datei-Aufgabe beim Erledigen weiterspringt", async () => {
		const { store, vault } = makeStore(settings);
		vault.addTaskFile("GTD/Aufgaben/r.md", ["lane: next-actions", "due: 2026-11-26", "recurrence: weekly", `today: ${todayStr}`]);
		const [r] = await store.getAllTasks();
		await store.moveFileTask(r, "done");
		expect(vault.content("GTD/Aufgaben/r.md")).not.toContain("today:");
		expect(vault.content("GTD/Aufgaben/r.md")).toContain("due: 2026-12-03");
	});
});
