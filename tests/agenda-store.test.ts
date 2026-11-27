import { makeStore } from "./helpers/fakeVault";
import { AGENDA_LANE_ID, DEFAULT_SETTINGS, GtdBoardSettings } from "../src/types";

function settings(): GtdBoardSettings {
	return {
		...DEFAULT_SETTINGS,
		watchFolder: "Notizen",
		taskFilesFolder: "GTD/Aufgaben",
		agendaEnabled: true,
		agendaFolder: "GTD/Agendas",
		scanInlineTasks: true,
	};
}

describe("Agendas im Store", () => {
	it("liest Personennotizen, Einzeldateien und #gtd/agenda-Zeilen als Agendapunkte", async () => {
		const { store, vault } = makeStore(settings());
		vault.addFile(
			"GTD/Agendas/Günther.md",
			"---\nperson: Günther\n---\n\n# Günther\n\n- [ ] Budget\n\t- schon vorbesprochen\n\t- [ ] keine eigene Aufgabe\n- [x] Urlaub ✅ 2026-11-20\n"
		);
		vault.addTaskFile("GTD/Agendas/Altes Thema.md", ["lane: __agenda__", "person: Anna"], "Beschreibung");
		vault.addFile("Notizen/Termin.md", "- [ ] Rollout klären #gtd/agenda 👤 Regine\n- [ ] normale Aufgabe\n");

		const tasks = await store.getAllTasks();
		const agenda = tasks.filter((t) => t.laneId === AGENDA_LANE_ID);
		expect(agenda.map((t) => [t.title, t.person, t.done, t.source])).toEqual([
			["Budget", "Günther", false, "inline"],
			["Urlaub", "Günther", true, "inline"],
			["Altes Thema", "Anna", false, "file"],
			["Rollout klären", "Regine", false, "inline"],
		]);
		expect(agenda[0].description).toBe("schon vorbesprochen\n[ ] keine eigene Aufgabe");
		expect(agenda[1].doneDate).toBe("2026-11-20");
		const regine = agenda[3];
		expect(regine.delegatedTo).toBeUndefined();
		expect(tasks.find((t) => t.title === "normale Aufgabe")?.laneId).not.toBe(AGENDA_LANE_ID);
	});

	it("legt Themen in der Personennotiz an und hakt sie mit Datum ab", async () => {
		const { store, vault } = makeStore(settings());
		await store.addAgendaTopic("Günther", "Budget 2027");
		await store.addAgendaTopic("günther", "Urlaub");
		const path = "GTD/Agendas/Günther.md";
		expect(vault.content(path)).toMatch(/^---\nperson: "?Günther"?\n---\n\n# Günther\n\n- \[ \] Budget 2027\n- \[ \] Urlaub\n$/);

		let tasks = await store.getAllTasks();
		const budget = tasks.find((t) => t.title === "Budget 2027")!;
		await store.addAgendaNote(budget, "Zahlen von Regine abwarten");
		tasks = await store.getAllTasks();
		const doneLane = settings().lanes.find((l) => l.isDone)!.id;
		await store.moveInlineTask(tasks.find((t) => t.title === "Budget 2027")!, doneLane);

		const content = vault.content(path);
		expect(content).toMatch(/- \[x\] Budget 2027 ✅ \d{4}-\d{2}-\d{2}\n\t- Zahlen von Regine abwarten\n- \[ \] Urlaub\n/);

		tasks = await store.getAllTasks();
		const done = tasks.find((t) => t.title === "Budget 2027")!;
		expect(done.done).toBe(true);
		await store.moveInlineTask(done, "next-actions");
		expect(vault.content(path)).toContain("- [ ] Budget 2027\n\t- Zahlen von Regine abwarten\n");
	});
});

describe("convertAgendaToTask", () => {
	it("legt eine Aufgabe an, verlinkt sie und hakt das Thema ab", async () => {
		const { store, vault } = makeStore({
			...DEFAULT_SETTINGS,
			watchFolder: "Notizen",
			taskFilesFolder: "GTD/Aufgaben",
			agendaEnabled: true,
			agendaFolder: "GTD/Agendas",
			scanInlineTasks: true,
		});
		await store.addAgendaTopic("Anna", "Angebot prüfen");
		const topic = (await store.getAllTasks()).find((t) => t.title === "Angebot prüfen")!;
		const file = await store.convertAgendaToTask(topic, true);

		expect(vault.content(file.path)).toMatch(/lane: "?next-actions"?/);
		expect(vault.content(file.path)).toMatch(/delegatedTo: "?Anna"?/);
		expect(vault.content("GTD/Agendas/Anna.md")).toMatch(
			/- \[x\] Angebot prüfen ✅ \d{4}-\d{2}-\d{2}\n\t- → \[\[GTD\/Aufgaben\/Angebot prüfen\|Angebot prüfen\]\]/
		);
	});
});
