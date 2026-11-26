import { TFile } from "obsidian";
import { GtdStore } from "../../src/store";
import { GtdBoardSettings } from "../../src/types";
import { buildTaskFileContent, parseTaskFile } from "../../src/util";

/**
 * Gemeinsamer In-Memory-Vault fuer Store-Tests: stellt genau die Vault- und FileManager-
 * Methoden bereit, die GtdStore nutzt (inkl. processFrontMatter ueber parseTaskFile/
 * buildTaskFileContent wie im echten Ablauf).
 */
export class FakeVault {
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
		file.stat = { ...file.stat, mtime: file.stat.mtime + 1 };
	}

	async create(path: string, content: string): Promise<TFile> {
		const file = new TFile(path);
		this.files.set(path, { file, content });
		return file;
	}

	async createFolder(_path: string): Promise<void> {}

	getMarkdownFiles(): TFile[] {
		return Array.from(this.files.values()).map((e) => e.file);
	}

	addFile(path: string, content: string): TFile {
		const file = new TFile(path);
		this.files.set(path, { file, content });
		return file;
	}

	addTaskFile(path: string, frontmatterLines: string[], body = ""): TFile {
		return this.addFile(path, `---\n${frontmatterLines.join("\n")}\n---\n\n${body}\n`);
	}

	content(path: string): string {
		return this.files.get(path)?.content ?? "";
	}
}

export function makeStore(settings: GtdBoardSettings): { store: GtdStore; vault: FakeVault } {
	const vault = new FakeVault();
	const fakeApp: any = {
		vault,
		fileManager: {
			renameFile: async () => {},
			processFrontMatter: async (file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> => {
				const entry = vault.files.get(file.path);
				if (!entry) throw new Error(`processFrontMatter: not found: ${file.path}`);
				const { frontmatter, body } = parseTaskFile(entry.content);
				fn(frontmatter as Record<string, unknown>);
				entry.content = buildTaskFileContent(frontmatter, body);
				file.stat = { ...file.stat, mtime: file.stat.mtime + 1 };
			},
		},
	};
	const store = new GtdStore(fakeApp, () => settings);
	return { store, vault };
}
