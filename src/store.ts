import { App, TFile, TFolder, normalizePath } from "obsidian";
import { AGENDA_LANE_ID, GtdBoardSettings, GtdTask, LaneConfig, RecurrenceRule, TaskPriority } from "./types";
import {
	assignSequentialOrder,
	bounceRecurringInlineLine,
	buildTaskFileContent,
	deriveProjectFromPath,
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
	private fileCache = new Map<string, { mtime: number; task: GtdTask | null }>();
	private inlineCache = new Map<string, { mtime: number; tasks: GtdTask[] }>();

	constructor(private app: App, private getSettings: () => GtdBoardSettings) {}

	private get settings(): GtdBoardSettings {
		return this.getSettings();
	}

	/** Leert den Datei-Cache vollstaendig, z. B. nach Aenderung der Einstellungen. */
	invalidateCache(): void {
		this.fileCache.clear();
		this.inlineCache.clear();
	}

	/** Entfernt einzelne Pfade aus dem Cache (nach einer Mutation, damit das naechste Read frisch parst). */
	private invalidateCacheFor(...paths: string[]): void {
		for (const path of paths) {
			this.fileCache.delete(path);
			this.fileCache.delete(`${path}:agenda`);
			this.inlineCache.delete(path);
		}
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
		const agendaEnabled = this.settings.agendaEnabled;
		const agendaFolder = agendaEnabled && this.settings.agendaFolder
			? normalizePath(this.settings.agendaFolder)
			: "";
		const projectRootFolder = this.settings.projectRootFolder?.trim()
			? normalizePath(this.settings.projectRootFolder.trim())
			: "";

		for (const file of files) {
			// Archivierte Aufgaben sind bewusst kein Teil des Boards mehr.
			if (isPathInFolder(file.path, archiveFolder)) continue;

			const inTaskFolder = isPathInFolder(file.path, taskFolder);
			if (inTaskFolder) {
				const task = await this.readFileTask(file);
				if (task) tasks.push(task);
				continue;
			}

			// Aufgaben-Dateien in Projekt-Unterordnern: Dateien mit lane:-Frontmatter
			// werden als Datei-Aufgaben gelesen; Dateien ohne lane: fallen durch und
			// koennen ggf. noch als Inline-Aufgaben-Quelle gescannt werden.
			if (projectRootFolder && isPathInFolder(file.path, projectRootFolder)) {
				const task = await this.readFileTask(file);
				if (task) {
					tasks.push(task);
					continue;
				}
			}

			if (agendaFolder && isPathInFolder(file.path, agendaFolder)) {
				const task = await this.readFileTask(file, true);
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

	/**
	 * Liest eine Markdown-Datei als Aufgabe. Bei Agenda-Dateien (isAgendaFile = true) wird die
	 * Lane immer auf AGENDA_LANE_ID gesetzt und das `person`-Feld aus dem Frontmatter gelesen;
	 * auf ein vorhandenes `lane`-Frontmatter-Feld wird dabei verzichtet.
	 */
	private async readFileTask(file: TFile, isAgendaFile = false): Promise<GtdTask | null> {
		const cacheKey = isAgendaFile ? `${file.path}:agenda` : file.path;
		const cached = this.fileCache.get(cacheKey);
		if (cached !== undefined && cached.mtime === file.stat.mtime) {
			return cached.task;
		}
		const content = await this.app.vault.read(file);
		const { frontmatter, body } = parseTaskFile(content);
		if (!isAgendaFile && !frontmatter.lane) {
			this.fileCache.set(cacheKey, { mtime: file.stat.mtime, task: null });
			return null;
		}
		let laneId: string;
		if (isAgendaFile) {
			laneId = AGENDA_LANE_ID;
		} else {
			const laneExists = this.settings.lanes.some((l) => l.id === frontmatter.lane);
			laneId = laneExists ? frontmatter.lane! : this.defaultLaneId();
		}
		const done = frontmatter.done === true || frontmatter.done === "true";
		const id = fileTaskId(file.path);
		// Explizit gesetztes Projekt hat immer Vorrang; nur wenn kein Projekt vorhanden ist,
		// wird es aus dem Ordnerpfad abgeleitet. projectRootFolder (wenn gesetzt) ueberschreibt
		// den Standard-Ableitungs-Root (taskFilesFolder).
		const explicitProject =
			typeof frontmatter.project === "string" && frontmatter.project.trim().length > 0
				? frontmatter.project.trim()
				: undefined;
		const projectRoot = this.settings.projectRootFolder?.trim() || this.settings.taskFilesFolder;
		const project = explicitProject
			?? (!isAgendaFile ? deriveProjectFromPath(file.path, projectRoot) : undefined);
		const task: GtdTask = {
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
			project,
			person: typeof frontmatter.person === "string" ? frontmatter.person : undefined,
			filePath: file.path,
			order: typeof frontmatter.order === "number" ? frontmatter.order : 0,
			lastTouched: this.touchedAt(id, file.stat.mtime),
		};
		this.fileCache.set(cacheKey, { mtime: file.stat.mtime, task });
		return task;
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
		const cached = this.inlineCache.get(file.path);
		if (cached !== undefined && cached.mtime === file.stat.mtime) {
			return cached.tasks;
		}
		const content = await this.app.vault.read(file);
		const lines = content.split(/\r?\n/);
		const tasks: GtdTask[] = [];
		// Ableitbares Projekt einmalig pro Datei berechnen (alle Inline-Aufgaben teilen denselben Pfad).
		// projectRootFolder (wenn gesetzt) ueberschreibt den Standard-Root watchFolder.
		const inlineProjectRoot = this.settings.projectRootFolder?.trim() || this.settings.watchFolder;
		const derivedProject = deriveProjectFromPath(file.path, inlineProjectRoot);
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
				// Explizit gesetztes Projekt (+Marker) gewinnt; sonst Ordner-Ableitung.
				project: parsed.project ?? derivedProject,
				filePath: file.path,
				line: index,
				order: index,
				// Datei-Mtime ist fuer Inline-Aufgaben nur eine Annaeherung (pro Datei, nicht pro
				// Zeile), aber ausreichend als Signal fuer "laengere Zeit nicht angefasst".
				lastTouched: this.touchedAt(id, file.stat.mtime),
			});
		});
		this.inlineCache.set(file.path, { mtime: file.stat.mtime, tasks });
		return tasks;
	}

	/** Legt eine neue Aufgaben-Datei in der konfigurierten Lane an. */
	async createTaskFile(options: {
		laneId: string;
		title: string;
		description: string;
		priority?: TaskPriority;
		contexts?: string[];
		tags?: string[];
		recurrence?: RecurrenceRule;
		delegatedTo?: string;
		project?: string;
		due?: string;
		reminderAt?: string;
		/** Optionaler Zielordner; ueberschreibt taskFilesFolder (z. B. fuer Projekt-Unterordner). */
		targetFolder?: string;
	}): Promise<TFile> {
		const { laneId, title, description, priority, contexts, tags, recurrence, delegatedTo, project, due, reminderAt, targetFolder } =
			options;
		const destFolder = normalizePath(targetFolder ?? this.settings.taskFilesFolder);
		await this.ensureFolder(destFolder);
		const baseName = sanitizeFileName(title);
		let fileName = `${baseName}.md`;
		let counter = 2;
		while (this.app.vault.getAbstractFileByPath(joinPath(destFolder, fileName))) {
			fileName = `${baseName} ${counter}.md`;
			counter++;
		}
		const path = joinPath(destFolder, fileName);
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
				reminder: reminderAt && reminderAt.trim().length > 0 ? reminderAt.trim() : undefined,
				priority: priority && priority !== "medium" ? priority : undefined,
				contexts: contexts && contexts.length > 0 ? contexts : undefined,
				tags: tags && tags.length > 0 ? tags : undefined,
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

	/** Legt einen neuen Agenda-Eintrag im konfigurierten Agendas-Ordner an. */
	async createAgendaFile(options: {
		title: string;
		person?: string;
		description?: string;
		priority?: TaskPriority;
		contexts?: string[];
		tags?: string[];
		recurrence?: RecurrenceRule;
		project?: string;
		due?: string;
		reminderAt?: string;
	}): Promise<TFile> {
		const { title, person, description, priority, contexts, tags, recurrence, project, due, reminderAt } = options;
		await this.ensureFolder(this.settings.agendaFolder);
		const baseName = sanitizeFileName(title);
		let fileName = `${baseName}.md`;
		let counter = 2;
		while (this.app.vault.getAbstractFileByPath(joinPath(this.settings.agendaFolder, fileName))) {
			fileName = `${baseName} ${counter}.md`;
			counter++;
		}
		const path = joinPath(this.settings.agendaFolder, fileName);
		const content = buildTaskFileContent(
			{
				lane: AGENDA_LANE_ID,
				person: person?.trim() || undefined,
				due: due?.trim() || undefined,
				reminder: reminderAt?.trim() || undefined,
				priority: priority && priority !== "medium" ? priority : undefined,
				contexts: contexts && contexts.length > 0 ? contexts : undefined,
				tags: tags && tags.length > 0 ? tags : undefined,
				recurrence,
				project: project?.trim() || undefined,
				created: nowISO(),
				order: Date.now(),
			},
			description ?? ""
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
			person?: string;
		}
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (!(file instanceof TFile)) return;
		const content = await this.app.vault.read(file);
		const { frontmatter, body } = parseTaskFile(content);

		// Wichtig: TaskModal.submit() liefert bei jedem Speichern IMMER das vollstaendige
		// Formular, nie nur geaenderte Felder - ein geleertes Feld (Faelligkeit, Erinnerung,
		// Wiederholung, Delegation, Projekt) kommt hier als `undefined` an, genau wie ein nie
		// gesetztes Feld. Ein "nur setzen, wenn !== undefined"-Guard wuerde das Leeren daher
		// stillschweigend ignorieren und den alten Frontmatter-Wert stehen lassen - deshalb
		// werden diese Felder hier direkt und bedingungslos aus `fields` uebernommen.
		frontmatter.due = fields.due || undefined;
		frontmatter.reminder = fields.reminderAt || undefined;
		frontmatter.priority = fields.priority && fields.priority !== "medium" ? fields.priority : undefined;
		frontmatter.recurrence = fields.recurrence;
		frontmatter.contexts = fields.contexts && fields.contexts.length > 0 ? fields.contexts : undefined;
		frontmatter.tags = fields.tags && fields.tags.length > 0 ? fields.tags : undefined;
		frontmatter.delegatedTo = fields.delegatedTo?.trim() ? fields.delegatedTo.trim() : undefined;
		frontmatter.project = fields.project?.trim() ? fields.project.trim() : undefined;
		frontmatter.person = fields.person?.trim() ? fields.person.trim() : undefined;

		const newBody = fields.description !== undefined ? fields.description : body;
		const newContent = buildTaskFileContent(frontmatter, newBody);
		await this.app.vault.modify(file, newContent);
		this.invalidateCacheFor(file.path);

		if (fields.title !== undefined && fields.title.trim() !== file.basename) {
			const newBase = sanitizeFileName(fields.title);
			const newPath = joinPath(file.parent?.path ?? this.settings.taskFilesFolder, `${newBase}.md`);
			if (newPath !== file.path) {
				await this.app.fileManager.renameFile(file, newPath);
				this.invalidateCacheFor(newPath);
			}
		}
	}

	/** Aendert nur das Faelligkeitsdatum einer Datei-Aufgabe (atomic, ohne andere Felder anzufassen). */
	async patchFileTaskDue(task: GtdTask, due: string | undefined): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (!(file instanceof TFile)) return;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm.due = due?.trim() || undefined;
		});
		this.invalidateCacheFor(file.path);
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
		const newLane = this.settings.lanes.find((l) => l.id === newLaneId);
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			const recurrence = toRecurrenceRule(fm.recurrence as string | undefined);
			if (newLane?.isDone && recurrence && fm.due) {
				fm.due = nextOccurrence(fm.due as string, recurrence) ?? fm.due;
				fm.done = false;
				delete fm.doneAt;
			} else if (newLane?.isDone) {
				fm.done = true;
				fm.doneAt = nowISO();
				if (!fm.lane) fm.lane = task.laneId;
			} else {
				fm.lane = newLaneId;
				fm.done = false;
				delete fm.doneAt;
			}
		});
		this.invalidateCacheFor(file.path);
	}

	/**
	 * Reiht eine Datei-Aufgabe per Drag & Drop an eine neue Position innerhalb einer Lane ein
	 * (ggf. inkl. Lane-Wechsel, wenn auf eine Karte in einer anderen Lane gedroppt wurde).
	 * `orderedTaskIdsInLane` ist die vollstaendige neue visuelle Reihenfolge der Ziel-Lane
	 * (inklusive der gezogenen Aufgabe an ihrer neuen Position); allen darin enthaltenen
	 * Datei-Aufgaben wird ein fortlaufender order-Wert zugewiesen, damit die manuelle
	 * Reihenfolge auch nach einem Refresh erhalten bleibt. Inline-Aufgaben in derselben Liste
	 * werden uebersprungen (kein persistierbarer order-Wert) - sie behalten ihre aus der
	 * Zeilenposition abgeleitete Reihenfolge.
	 */
	async reorderFileTask(task: GtdTask, targetLaneId: string, orderedTaskIdsInLane: string[]): Promise<void> {
		const orderMap = assignSequentialOrder(orderedTaskIdsInLane);
		const targetLane = this.settings.lanes.find((l) => l.id === targetLaneId);
		for (const id of orderedTaskIdsInLane) {
			if (!id.startsWith("file::")) continue;
			const filePath = id.slice("file::".length);
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) continue;
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				fm.order = orderMap[id];
				if (id === task.id && fm.lane !== targetLaneId) {
					const recurrence = toRecurrenceRule(fm.recurrence as string | undefined);
					if (targetLane?.isDone && recurrence && fm.due) {
						fm.due = nextOccurrence(fm.due as string, recurrence) ?? fm.due;
						fm.done = false;
						delete fm.doneAt;
						fm.lane = task.laneId;
					} else if (targetLane?.isDone) {
						fm.done = true;
						fm.doneAt = nowISO();
						if (!fm.lane) fm.lane = task.laneId;
					} else {
						fm.lane = targetLaneId;
						fm.done = false;
						delete fm.doneAt;
					}
				}
			});
			this.invalidateCacheFor(filePath);
		}
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
		this.invalidateCacheFor(file.path);
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
		},
		targetLaneId?: string
	): Promise<TFile> {
		const sourceFile = this.app.vault.getAbstractFileByPath(task.filePath);
		if (sourceFile instanceof TFile && task.line !== undefined) {
			const content = await this.app.vault.read(sourceFile);
			const lines = content.split(/\r?\n/);
			const line = this.findInlineLine(lines, task);
			if (line !== -1) {
				lines.splice(line, 1);
				await this.app.vault.modify(sourceFile, lines.join("\n"));
				this.invalidateCacheFor(sourceFile.path);
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
				lane: targetLaneId ?? task.laneId,
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
		this.invalidateCacheFor(task.filePath);
		if (task.source === "file") {
			// FileManager.trashFile() statt Vault.trash(), damit die Loeschung/System-Papierkorb-
			// Einstellung des Nutzers ("Systemeinstellungen" vs. ".trash"-Ordner) respektiert wird.
			await this.app.fileManager.trashFile(file);
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
