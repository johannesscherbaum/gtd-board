import { App, TFile, TFolder, normalizePath } from "obsidian";
import { GtdBoardSettings, GtdTask, LaneConfig, RecurrenceRule, TaskPriority } from "./types";
import {
	bounceRecurringInlineLine,
	buildTaskFileContent,
	fileTaskId,
	inlineTaskId,
	isCheckboxLine,
	isPathInFolder,
	joinPath,
	nextOccurrence,
	nowISO,
	parseInlineLine,
	parseLocalDateTime,
	parseTaskFile,
	rewriteInlineLineForLane,
	sanitizeFileName,
	toRecurrenceRule,
	toTaskPriority,
} from "./util";

/**
 * Liest Aufgaben-Dateien und Inline-Checkboxen aus dem Vault und bietet
 * Mutationsmethoden, die immer direkt auf den zugrunde liegenden Markdown-Dateien
 * arbeiten. Es gibt keinen eigenen persistenten Zustand ausser dem, was im Vault steht.
 */
export class GtdStore {
	constructor(private app: App, private getSettings: () => GtdBoardSettings) {}

	private get settings(): GtdBoardSettings {
		return this.getSettings();
	}

	/**
	 * Sammelt alle Aufgaben: Datei-Aufgaben werden immer aus dem konfigurierten
	 * Aufgaben-Unterordner gelesen, unabhaengig davon, ob dieser innerhalb des
	 * ueberwachten Ordners liegt (er kann z. B. bewusst ausserhalb liegen, um
	 * Aufgaben-Dateien von den eigentlichen Notizen zu trennen). Inline-Checkboxen
	 * werden nur innerhalb des ueberwachten Ordners gesucht.
	 */
	async getAllTasks(): Promise<GtdTask[]> {
		const files = this.app.vault.getMarkdownFiles();
		const tasks: GtdTask[] = [];
		const taskFolder = normalizePath(this.settings.taskFilesFolder);
		const archiveFolder = this.effectiveArchiveFolder();

		for (const file of files) {
			// Archivierte Aufgaben sind bewusst kein Teil des Boards mehr.
			if (isPathInFolder(file.path, archiveFolder)) continue;

			const inTaskFolder = isPathInFolder(file.path, taskFolder);
			if (inTaskFolder) {
				const task = await this.readFileTask(file);
				if (task) tasks.push(task);
				continue;
			}

			if (!isPathInFolder(file.path, this.settings.watchFolder)) continue;
			if (this.settings.scanInlineTasks) {
				const inline = await this.readInlineTasks(file);
				tasks.push(...inline);
			}
		}
		return tasks;
	}

	/** Liefert die Standard-Lane fuer neue/nicht zuordenbare Aufgaben (erste normale, nicht-virtuelle Lane). */
	defaultLaneId(): string {
		return (
			this.settings.lanes.find((l) => !l.isDone && !l.isPlanned)?.id ??
			this.settings.lanes[0]?.id ??
			"inbox"
		);
	}

	/** Zielordner fuer archivierte Aufgaben: explizite Einstellung oder "<Aufgaben-Ordner>/Archiv". */
	private effectiveArchiveFolder(): string {
		const configured = this.settings.archiveFolder?.trim();
		return normalizePath(configured || joinPath(this.settings.taskFilesFolder, "Archiv"));
	}

	private async readFileTask(file: TFile): Promise<GtdTask | null> {
		const content = await this.app.vault.read(file);
		const { frontmatter, body } = parseTaskFile(content);
		if (!frontmatter.lane) return null;
		const laneExists = this.settings.lanes.some((l) => l.id === frontmatter.lane);
		// laneId ist immer die "Herkunfts-Lane" (Frontmatter), unabhaengig vom Erledigt-Status -
		// so weiss das Plugin, wohin die Aufgabe beim Wiederaufklappen aus "Erledigt" zurueckfaellt.
		const laneId = laneExists ? frontmatter.lane : this.defaultLaneId();
		const done = frontmatter.done === true || frontmatter.done === "true";
		const id = fileTaskId(file.path);
		return {
			id,
			source: "file",
			title: frontmatter.title || file.basename,
			description: body.trim(),
			laneId,
			done,
			due: frontmatter.due || undefined,
			reminderAt: frontmatter.reminder || undefined,
			priority: toTaskPriority(frontmatter.priority),
			recurrence: toRecurrenceRule(frontmatter.recurrence),
			tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
			contexts: Array.isArray(frontmatter.contexts) ? frontmatter.contexts : [],
			delegatedTo: typeof frontmatter.delegatedTo === "string" ? frontmatter.delegatedTo : undefined,
			project: typeof frontmatter.project === "string" ? frontmatter.project : undefined,
			filePath: file.path,
			order: typeof frontmatter.order === "number" ? frontmatter.order : 0,
			lastTouched: this.touchedAt(id, file.stat.mtime),
		};
	}

	/**
	 * Juengerer Zeitpunkt aus Datei-Aenderungszeit und einem expliziten Review im Wochenrueckblick -
	 * Grundlage der Auffrischungs-Markierungen ("Wartet auf" / "Irgendwann/Vielleicht"), da ein
	 * reiner Review (ohne inhaltliche Aenderung) die Datei nicht anfasst.
	 */
	private touchedAt(taskId: string, fileMtime: number): number {
		const reviewedIso = this.settings.reviewedAt[taskId];
		const reviewedMs = reviewedIso ? parseLocalDateTime(reviewedIso)?.getTime() ?? 0 : 0;
		return Math.max(fileMtime, reviewedMs);
	}

	private async readInlineTasks(file: TFile): Promise<GtdTask[]> {
		const content = await this.app.vault.read(file);
		const lines = content.split(/\r?\n/);
		const tasks: GtdTask[] = [];
		lines.forEach((line, index) => {
			const parsed = parseInlineLine(line, this.settings.lanes);
			if (!parsed || parsed.title.length === 0) return;
			// laneId ist die per Tag erkannte "Herkunfts-Lane"; ob die Aufgabe in "Erledigt"
			// angezeigt wird, entscheidet allein der Haken (done), nicht ein Tag.
			const laneId = parsed.laneId ?? this.defaultLaneId();
			const id = inlineTaskId(file.path, parsed.title);
			tasks.push({
				id,
				source: "inline",
				title: parsed.title,
				description: "",
				laneId,
				done: parsed.done,
				due: parsed.due,
				reminderAt: undefined,
				priority: parsed.priority,
				recurrence: parsed.recurrence,
				tags: parsed.tags,
				contexts: parsed.contexts,
				delegatedTo: parsed.delegatedTo,
				project: parsed.project,
				filePath: file.path,
				line: index,
				order: index,
				// Datei-Mtime ist fuer Inline-Aufgaben nur eine Annaeherung (pro Datei, nicht pro
				// Zeile), aber ausreichend als Signal fuer "laengere Zeit nicht angefasst".
				lastTouched: this.touchedAt(id, file.stat.mtime),
			});
		});
		return tasks;
	}

	/** Legt eine neue Aufgaben-Datei in der konfigurierten Lane an. */
	async createTaskFile(
		laneId: string,
		title: string,
		description: string,
		priority?: TaskPriority,
		contexts?: string[],
		recurrence?: RecurrenceRule,
		delegatedTo?: string,
		project?: string,
		due?: string
	): Promise<TFile> {
		await this.ensureFolder(this.settings.taskFilesFolder);
		const baseName = sanitizeFileName(title);
		let fileName = `${baseName}.md`;
		let counter = 2;
		while (this.app.vault.getAbstractFileByPath(joinPath(this.settings.taskFilesFolder, fileName))) {
			fileName = `${baseName} ${counter}.md`;
			counter++;
		}
		const path = joinPath(this.settings.taskFilesFolder, fileName);
		const targetLane = this.settings.lanes.find((l) => l.id === laneId);
		// Wird direkt in "Erledigt" angelegt, braucht die Datei trotzdem eine normale
		// Herkunfts-Lane im Frontmatter; done:true sorgt fuer die Anzeige in Erledigt.
		const homeLaneId = targetLane?.isDone ? this.defaultLaneId() : laneId;
		const content = buildTaskFileContent(
			{
				lane: homeLaneId,
				done: targetLane?.isDone ? true : undefined,
				doneAt: targetLane?.isDone ? nowISO() : undefined,
				due: due && due.trim().length > 0 ? due.trim() : undefined,
				priority: priority && priority !== "medium" ? priority : undefined,
				contexts: contexts && contexts.length > 0 ? contexts : undefined,
				recurrence: recurrence,
				delegatedTo: delegatedTo && delegatedTo.trim().length > 0 ? delegatedTo.trim() : undefined,
				project: project && project.trim().length > 0 ? project.trim() : undefined,
				created: nowISO(),
				order: Date.now(),
			},
			description
		);
		return this.app.vault.create(path, content);
	}

	/** Aktualisiert Titel, Beschreibung, Faelligkeit, Erinnerung, Prioritaet, Wiederholung, Kontexte und Tags einer Datei-Aufgabe. */
	async updateTaskFile(
		task: GtdTask,
		fields: {
			title?: string;
			description?: string;
			due?: string;
			reminderAt?: string;
			priority?: TaskPriority;
			recurrence?: RecurrenceRule;
			contexts?: string[];
			tags?: string[];
			delegatedTo?: string;
			project?: string;
		}
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (!(file instanceof TFile)) return;
		const content = await this.app.vault.read(file);
		const { frontmatter, body } = parseTaskFile(content);

		if (fields.due !== undefined) frontmatter.due = fields.due || undefined;
		if (fields.reminderAt !== undefined) frontmatter.reminder = fields.reminderAt || undefined;
		if (fields.priority !== undefined) {
			frontmatter.priority = fields.priority !== "medium" ? fields.priority : undefined;
		}
		if (fields.recurrence !== undefined) frontmatter.recurrence = fields.recurrence;
		if (fields.contexts !== undefined) frontmatter.contexts = fields.contexts;
		if (fields.tags !== undefined) frontmatter.tags = fields.tags;
		if (fields.delegatedTo !== undefined) {
			frontmatter.delegatedTo = fields.delegatedTo.trim() ? fields.delegatedTo.trim() : undefined;
		}
		if (fields.project !== undefined) {
			frontmatter.project = fields.project.trim() ? fields.project.trim() : undefined;
		}

		const newBody = fields.description !== undefined ? fields.description : body;
		const newContent = buildTaskFileContent(frontmatter, newBody);
		await this.app.vault.modify(file, newContent);

		if (fields.title !== undefined && fields.title.trim() !== file.basename) {
			const newBase = sanitizeFileName(fields.title);
			const newPath = joinPath(file.parent?.path ?? this.settings.taskFilesFolder, `${newBase}.md`);
			if (newPath !== file.path) {
				await this.app.fileManager.renameFile(file, newPath);
			}
		}
	}

	/**
	 * Setzt die Lane einer Datei-Aufgabe neu, z.B. bei Drag & Drop.
	 * Ziel "Erledigt": nur done:true setzen, die Herkunfts-Lane bleibt im Frontmatter erhalten
	 * (kein Tag/Sonderwert), damit die Aufgabe beim Wiederaufklappen dorthin zurueckfaellt.
	 * Jedes andere Ziel: done:false setzen und die Lane auf das Ziel aendern.
	 */
	async moveFileTask(task: GtdTask, newLaneId: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (!(file instanceof TFile)) return;
		const content = await this.app.vault.read(file);
		const { frontmatter, body } = parseTaskFile(content);
		const newLane = this.settings.lanes.find((l) => l.id === newLaneId);
		const recurrence = toRecurrenceRule(frontmatter.recurrence);
		if (newLane?.isDone && recurrence && frontmatter.due) {
			// Wiederkehrende Aufgabe: statt abzuschliessen, naechsten Termin setzen und
			// in ihrer Herkunfts-Lane offen lassen ("beim Erledigen neu erzeugen").
			frontmatter.due = nextOccurrence(frontmatter.due, recurrence) ?? frontmatter.due;
			frontmatter.done = false;
			frontmatter.doneAt = undefined;
		} else if (newLane?.isDone) {
			frontmatter.done = true;
			// Zeitpunkt der Erledigung merken, damit die automatische Archivierung weiss,
			// wie lange eine Aufgabe schon erledigt ist.
			frontmatter.doneAt = nowISO();
			if (!frontmatter.lane) frontmatter.lane = task.laneId;
		} else {
			frontmatter.lane = newLaneId;
			frontmatter.done = false;
			frontmatter.doneAt = undefined;
		}
		await this.app.vault.modify(file, buildTaskFileContent(frontmatter, body));
	}

	/**
	 * Verschiebt eine Inline-Aufgabe in eine andere Lane, indem die Quellzeile direkt
	 * angepasst wird (Lane-Tag getauscht, Haken ggf. gesetzt/entfernt). Es wird keine
	 * Datei angelegt, solange nur die Lane geaendert wird.
	 */
	async moveInlineTask(task: GtdTask, newLaneId: string): Promise<void> {
		if (task.line === undefined) return;
		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (!(file instanceof TFile)) return;
		const content = await this.app.vault.read(file);
		const lines = content.split(/\r?\n/);
		const line = this.findInlineLine(lines, task);
		if (line === -1) return;
		lines[line] = rewriteInlineLineForLane(lines[line], this.settings.lanes, newLaneId);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	/**
	 * Wandelt eine Inline-Aufgabe in eine Datei-Aufgabe um: legt die neue Datei mit den
	 * angepassten Feldern an und entfernt die urspruengliche Checkbox-Zeile aus der Notiz.
	 */
	async convertInlineToFile(
		task: GtdTask,
		fields: {
			title: string;
			description: string;
			due?: string;
			reminderAt?: string;
			priority?: TaskPriority;
			recurrence?: RecurrenceRule;
			contexts?: string[];
			tags?: string[];
			delegatedTo?: string;
			project?: string;
		}
	): Promise<TFile> {
		const sourceFile = this.app.vault.getAbstractFileByPath(task.filePath);
		if (sourceFile instanceof TFile && task.line !== undefined) {
			const content = await this.app.vault.read(sourceFile);
			const lines = content.split(/\r?\n/);
			const line = this.findInlineLine(lines, task);
			if (line !== -1) {
				lines.splice(line, 1);
				await this.app.vault.modify(sourceFile, lines.join("\n"));
			}
		}

		await this.ensureFolder(this.settings.taskFilesFolder);
		const baseName = sanitizeFileName(fields.title);
		let fileName = `${baseName}.md`;
		let counter = 2;
		while (this.app.vault.getAbstractFileByPath(joinPath(this.settings.taskFilesFolder, fileName))) {
			fileName = `${baseName} ${counter}.md`;
			counter++;
		}
		const path = joinPath(this.settings.taskFilesFolder, fileName);
		const content = buildTaskFileContent(
			{
				lane: task.laneId,
				done: task.done ? true : undefined,
				doneAt: task.done ? nowISO() : undefined,
				due: fields.due,
				reminder: fields.reminderAt,
				priority: fields.priority && fields.priority !== "medium" ? fields.priority : undefined,
				recurrence: fields.recurrence ?? task.recurrence,
				contexts: (fields.contexts ?? task.contexts) && (fields.contexts ?? task.contexts).length > 0
					? fields.contexts ?? task.contexts
					: undefined,
				tags: fields.tags ?? task.tags,
				delegatedTo: (fields.delegatedTo ?? task.delegatedTo)?.trim() || undefined,
				project: (fields.project ?? task.project)?.trim() || undefined,
				created: nowISO(),
				order: Date.now(),
			},
			fields.description
		);
		return this.app.vault.create(path, content);
	}

	/** Loescht eine Aufgabe: bei Datei-Aufgaben die Datei, bei Inline-Aufgaben nur die Zeile. */
	async deleteTask(task: GtdTask): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (!(file instanceof TFile)) return;
		if (task.source === "file") {
			await this.app.vault.trash(file, true);
			return;
		}
		const content = await this.app.vault.read(file);
		const lines = content.split(/\r?\n/);
		const line = this.findInlineLine(lines, task);
		if (line === -1) return;
		lines.splice(line, 1);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	private findInlineLine(lines: string[], task: GtdTask): number {
		if (task.line !== undefined && task.line < lines.length) {
			const parsed = parseInlineLine(lines[task.line], this.settings.lanes);
			if (parsed && parsed.title === task.title) return task.line;
		}
		for (let i = 0; i < lines.length; i++) {
			if (!isCheckboxLine(lines[i])) continue;
			const parsed = parseInlineLine(lines[i], this.settings.lanes);
			if (parsed && parsed.title === task.title) return i;
		}
		return -1;
	}

	/**
	 * Verschiebt erledigte Datei-Aufgaben, deren Erledigungs-Zeitpunkt laenger als
	 * "archiveAfterDays" zurueckliegt, in den Archiv-Ordner. Aufgaben ohne bekannten
	 * Erledigungs-Zeitpunkt (z. B. vor Einfuehrung dieses Features erledigt) werden
	 * nicht automatisch archiviert, um nichts unerwartet zu verschieben. Gibt die
	 * Anzahl der archivierten Aufgaben zurueck.
	 */
	async archiveEligibleDoneTasks(): Promise<number> {
		const days = this.settings.archiveAfterDays;
		if (!days || days <= 0) return 0;

		const taskFolder = normalizePath(this.settings.taskFilesFolder);
		const archiveFolder = this.effectiveArchiveFolder();
		const cutoff = Date.now() - days * 86_400_000;
		let archived = 0;

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!isPathInFolder(file.path, taskFolder)) continue;
			if (isPathInFolder(file.path, archiveFolder)) continue;

			const content = await this.app.vault.read(file);
			const { frontmatter } = parseTaskFile(content);
			const done = frontmatter.done === true || frontmatter.done === "true";
			if (!done || !frontmatter.doneAt) continue;

			const doneDate = parseLocalDateTime(frontmatter.doneAt);
			if (!doneDate || doneDate.getTime() > cutoff) continue;

			await this.ensureFolder(archiveFolder);
			const target = joinPath(archiveFolder, file.name);
			if (this.app.vault.getAbstractFileByPath(target)) continue; // Namenskonflikt: lieber ueberspringen als ueberschreiben
			await this.app.fileManager.renameFile(file, target);
			archived++;
		}
		return archived;
	}

	/**
	 * Sucht erledigte, wiederkehrende Aufgaben (Datei und Inline) und springt sie auf ihren
	 * naechsten Termin, statt sie erledigt zu lassen. Deckt den Fall ab, dass eine Aufgabe
	 * nicht per Drag & Drop im Board, sondern direkt in der Notiz abgehakt wurde (dort greift
	 * die Bounce-Logik aus moveFileTask/moveInlineTask nicht). Gibt die Anzahl der
	 * vorgesprungenen Aufgaben zurueck.
	 */
	async advanceRecurringTasks(): Promise<number> {
		const fileCount = await this.advanceRecurringFileTasks();
		const inlineCount = await this.advanceRecurringInlineTasks();
		return fileCount + inlineCount;
	}

	private async advanceRecurringFileTasks(): Promise<number> {
		const taskFolder = normalizePath(this.settings.taskFilesFolder);
		const archiveFolder = this.effectiveArchiveFolder();
		let advanced = 0;

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!isPathInFolder(file.path, taskFolder)) continue;
			if (isPathInFolder(file.path, archiveFolder)) continue;

			const content = await this.app.vault.read(file);
			const { frontmatter, body } = parseTaskFile(content);
			const done = frontmatter.done === true || frontmatter.done === "true";
			const recurrence = toRecurrenceRule(frontmatter.recurrence);
			if (!done || !recurrence || !frontmatter.due) continue;

			const nextDue = nextOccurrence(frontmatter.due, recurrence);
			if (!nextDue) continue;

			frontmatter.due = nextDue;
			frontmatter.done = false;
			frontmatter.doneAt = undefined;
			await this.app.vault.modify(file, buildTaskFileContent(frontmatter, body));
			advanced++;
		}
		return advanced;
	}

	private async advanceRecurringInlineTasks(): Promise<number> {
		let advanced = 0;

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!isPathInFolder(file.path, this.settings.watchFolder)) continue;

			const content = await this.app.vault.read(file);
			const lines = content.split(/\r?\n/);
			let changed = false;
			for (let i = 0; i < lines.length; i++) {
				const rewritten = bounceRecurringInlineLine(lines[i], this.settings.lanes);
				if (rewritten === null) continue;
				lines[i] = rewritten;
				changed = true;
				advanced++;
			}
			if (changed) await this.app.vault.modify(file, lines.join("\n"));
		}
		return advanced;
	}

	private async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFolder) return;
		const parts = normalized.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const abstract = this.app.vault.getAbstractFileByPath(current);
			if (!abstract) {
				await this.app.vault.createFolder(current);
			}
		}
	}
}

export function laneById(lanes: LaneConfig[], id: string): LaneConfig | undefined {
	return lanes.find((l) => l.id === id);
}
