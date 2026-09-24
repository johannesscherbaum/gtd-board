import { TFile } from "obsidian";
import { GtdStore } from "../src/store";
import { DEFAULT_LANES, DEFAULT_SETTINGS, GtdBoardSettings } from "../src/types";

/**
 * Minimaler In-Memory-Vault (siehe store-reorder.test.ts) fuer updateTaskFile-Tests:
 * geleerte Formularfelder (Faelligkeit, Erinnerung, Wiederholung, Delegation, Projekt)
 * muessen aus der Frontmatter entfernt werden, nicht auf dem alten Wert stehen bleiben.
 */
class FakeVault {
	files = new Map<string, { file: TFile; content: string }>();

	getAbstractFileByPath(path: string): TFile | null {
		return this.files.get(path)?.file ?? null;
	}

	async read(file: TFile): Promise<string> {
		const entry = this.files.get(file.path);
		if (!entry) throw new Error(`not found: ${file.path}`);
		return entry.content;
	}

	async modify(file: TFile, content: string): Promise<void> {
		const entry = this.files.get(file.path);
		if (!entry) throw new Error(`not found: ${file.path}`);
		entry.content = content;
	}

	async create(path: string, content: string): Promise<TFile> {
		const file = new TFile(path);
		this.files.set(path, { file, content });
		return file;
	}

	getMarkdownFiles(): TFile[] {
		return Array.from(this.files.values()).map((e) => e.file);
	}

	addTaskFile(path: string, frontmatterLines: string[], body = ""): TFile {
		const content = `---\n${frontmatterLines.join("\n")}\n---\n\n${body}\n`;
		const file = new TFile(path);
		this.files.set(path, { file, content });
		return file;
	}
}

function makeStore(settings: GtdBoardSettings): { store: GtdStore; vault: FakeVault } {
	const vault = new FakeVault();
	const fakeApp: any = {
		vault,
		fileManager: { renameFile: async () => {} },
	};
	const store = new GtdStore(fakeApp, () => settings);
	return { store, vault };
}

describe("updateTaskFile (Formularfelder in der Bearbeiten-Ansicht leeren)", () => {
	it("entfernt Delegation, Faelligkeit, Erinnerung, Wiederholung und Projekt aus der Frontmatter, wenn sie im Formular geleert werden", async () => {
		const settings: GtdBoardSettings = {
			...DEFAULT_SETTINGS,
			lanes: DEFAULT_LANES,
			taskFilesFolder: "GTD/Aufgaben",
			watchFolder: "GTD",
		};
		const { store, vault } = makeStore(settings);

		vault.addTaskFile("GTD/Aufgaben/A.md", [
			"lane: next-actions",
			"order: 0",
			"due: 2026-01-01",
			"reminder: 2026-01-01T08:00",
			"recurrence: weekly",
			"delegatedTo: Max",
			"project: Testprojekt",
		]);

		const before = await store.getAllTasks();
		const taskA = before.find((t) => t.title === "A")!;
		expect(taskA.delegatedTo).toBe("Max");

		// Simuliert TaskModal.submit(): das komplette (jetzt geleerte) Formular wird uebergeben,
		// geleerte Felder kommen als undefined bzw. leerer String an - genau wie ein Feld, das
		// nie gesetzt war. Trotzdem muessen sie hier tatsaechlich entfernt werden.
		await store.updateTaskFile(taskA, {
			title: "A",
			description: "",
			due: undefined,
			reminderAt: undefined,
			priority: "medium",
			recurrence: undefined,
			contexts: [],
			tags: [],
			delegatedTo: undefined,
			project: undefined,
		});

		const after = await store.getAllTasks();
		const taskAAfter = after.find((t) => t.title === "A")!;
		expect(taskAAfter.delegatedTo).toBeUndefined();
		expect(taskAAfter.due).toBeUndefined();
		expect(taskAAfter.reminderAt).toBeUndefined();
		expect(taskAAfter.recurrence).toBeUndefined();
		expect(taskAAfter.project).toBeUndefined();
	});
});
