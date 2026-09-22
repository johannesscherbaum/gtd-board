import { TFile } from "obsidian";
import { GtdStore } from "../src/store";
import { DEFAULT_LANES, DEFAULT_SETTINGS, GtdBoardSettings } from "../src/types";

/**
 * Minimaler In-Memory-Vault, der genau die Vault-Methoden bereitstellt, die GtdStore nutzt:
 * getAbstractFileByPath, read, modify, create, getMarkdownFiles. Reproduziert den echten
 * Ablauf eines Drag&Drop-Umsortierens (reorderFileTask) end-to-end, ohne eine echte
 * Obsidian-Instanz zu brauchen.
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

describe("reorderFileTask (Drag & Drop-Reihenfolge innerhalb einer Lane)", () => {
	it("weist der Ziel-Lane einen neuen order zu, der bei getAllTasks korrekt zurueckkommt", async () => {
		const settings: GtdBoardSettings = {
			...DEFAULT_SETTINGS,
			lanes: DEFAULT_LANES,
			taskFilesFolder: "GTD/Aufgaben",
			watchFolder: "GTD",
		};
		const { store, vault } = makeStore(settings);

		// Drei Datei-Aufgaben in "Naechste Aktionen", urspruengliche Reihenfolge A, B, C.
		vault.addTaskFile("GTD/Aufgaben/A.md", ["lane: next-actions", "order: 0"], "A");
		vault.addTaskFile("GTD/Aufgaben/B.md", ["lane: next-actions", "order: 1"], "B");
		vault.addTaskFile("GTD/Aufgaben/C.md", ["lane: next-actions", "order: 2"], "C");

		const before = await store.getAllTasks();
		const beforeOrder = before
			.filter((t) => t.laneId === "next-actions")
			.sort((a, b) => a.order - b.order)
			.map((t) => t.title);
		expect(beforeOrder).toEqual(["A", "B", "C"]);

		// Simuliert: C wird vor A gezogen -> neue Reihenfolge C, A, B.
		const taskC = before.find((t) => t.title === "C")!;
		const newOrderedIds = ["file::GTD/Aufgaben/C.md", "file::GTD/Aufgaben/A.md", "file::GTD/Aufgaben/B.md"];
		await store.reorderFileTask(taskC, "next-actions", newOrderedIds);

		const after = await store.getAllTasks();
		const afterOrder = after
			.filter((t) => t.laneId === "next-actions")
			.sort((a, b) => a.order - b.order)
			.map((t) => t.title);
		expect(afterOrder).toEqual(["C", "A", "B"]);
	});
});
