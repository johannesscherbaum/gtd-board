import { DEFAULT_LANES, DEFAULT_SETTINGS, GtdBoardSettings } from "../src/types";
import { isSafeOriginUrl, readTaskOrigin } from "../src/util";
import { makeStore } from "./helpers/fakeVault";

describe("readTaskOrigin", () => {
	it("liest alle vier Herkunftsfelder", () => {
		expect(
			readTaskOrigin({
				source: "planner",
				sourceLabel: "Team-Plan",
				sourceUrl: "https://tasks.office.com/x",
				plannerId: "AbC123",
			})
		).toEqual({ kind: "planner", label: "Team-Plan", url: "https://tasks.office.com/x", plannerId: "AbC123" });
	});

	it("leitet Planner aus plannerId ab, wenn source fehlt", () => {
		expect(readTaskOrigin({ plannerId: "x1" })?.kind).toBe("planner");
	});

	it("gibt undefined ohne Herkunftsfelder zurueck", () => {
		expect(readTaskOrigin({ lane: "inbox", title: "x" })).toBeUndefined();
		expect(readTaskOrigin({ source: "  " })).toBeUndefined();
	});

	it("zeigt unsichere Links nicht an", () => {
		expect(readTaskOrigin({ source: "meeting", sourceUrl: "javascript:alert(1)" })?.url).toBeUndefined();
		expect(isSafeOriginUrl("obsidian://open?vault=x")).toBe(true);
		expect(isSafeOriginUrl("file:///etc/passwd")).toBe(false);
	});

	it("wandelt numerische plannerId in einen String", () => {
		expect(readTaskOrigin({ plannerId: 42 })?.plannerId).toBe("42");
	});
});

describe("Herkunftsfelder bleiben beim Bearbeiten und Verschieben erhalten", () => {
	const settings: GtdBoardSettings = { ...DEFAULT_SETTINGS, lanes: DEFAULT_LANES, taskFilesFolder: "GTD/Aufgaben" };
	const originLines = ["source: planner", "sourceLabel: Team-Plan", "sourceUrl: https://tasks.office.com/x", "plannerId: AbC123"];

	function expectOrigin(content: string): void {
		for (const line of originLines) expect(content).toContain(line);
	}

	it("liest die Herkunft in die Aufgabe ein", async () => {
		const { store, vault } = makeStore(settings);
		vault.addTaskFile("GTD/Aufgaben/p.md", ["lane: inbox", ...originLines]);
		const [p] = await store.getAllTasks();
		expect(p.origin).toEqual({ kind: "planner", label: "Team-Plan", url: "https://tasks.office.com/x", plannerId: "AbC123" });
		expect(p.source).toBe("file");
	});

	it("nach Bearbeiten, Verschieben, Faelligkeit setzen und Erledigen", async () => {
		const { store, vault } = makeStore(settings);
		vault.addTaskFile("GTD/Aufgaben/p.md", ["lane: inbox", ...originLines]);
		const path = "GTD/Aufgaben/p.md";

		let [p] = await store.getAllTasks();
		await store.updateTaskFile(p, { title: "p", description: "Notiz", due: "2026-12-01", contexts: ["Buero"], tags: [] });
		expectOrigin(vault.content(path));

		[p] = await store.getAllTasks();
		await store.moveFileTask(p, "waiting-for");
		expectOrigin(vault.content(path));

		[p] = await store.getAllTasks();
		await store.patchFileTaskDue(p, "2026-12-05");
		expectOrigin(vault.content(path));

		[p] = await store.getAllTasks();
		await store.patchFileTaskBody(p, "- [ ] Unterpunkt");
		expectOrigin(vault.content(path));

		[p] = await store.getAllTasks();
		await store.moveFileTask(p, "done");
		expectOrigin(vault.content(path));
		expect(vault.content(path)).toContain("done: true");
	});
});
