import { Notice, Plugin, TFile, WorkspaceLeaf, debounce, moment, normalizePath } from "obsidian";
import { GtdBoardSettingTab } from "./settings";
import { GtdStore } from "./store";
import { DEFAULT_SETTINGS, GtdBoardSettings } from "./types";
import { GTD_BOARD_VIEW_TYPE, GtdBoardView } from "./view";
import { ReminderScheduler } from "./reminders";
import { buildIcsContent, isPathInFolder, nowISO } from "./util";
import { QuickCaptureModal, ReviewModal } from "./modals";
import { detectAndSetLocale, t } from "./i18n";

/** Wie oft (Millisekunden) im Hintergrund auf faellige Archivierung/Wiederholungen geprueft wird. */
const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export default class GtdBoardPlugin extends Plugin {
	settings: GtdBoardSettings = DEFAULT_SETTINGS;
	store!: GtdStore;
	private reminderScheduler!: ReminderScheduler;
	// Wiederkehrende Aufgaben, die direkt in der Notiz (nicht per Drag & Drop) abgehakt wurden,
	// sollen zeitnah auf ihren naechsten Termin springen - deshalb bei jeder relevanten
	// Vault-Aenderung mitpruefen, nicht nur periodisch.
	private debouncedRefresh = debounce(() => void this.handleVaultChange(), 400, true);

	async onload(): Promise<void> {
		// Obsidian's UI language, detected once at startup (moment.locale() reflects the
		// app's own language setting) and normalized to one of our supported locales.
		detectAndSetLocale(moment.locale());

		await this.loadSettings();

		this.store = new GtdStore(this.app, () => this.settings);

		this.registerView(GTD_BOARD_VIEW_TYPE, (leaf) => new GtdBoardView(leaf, this));

		this.addRibbonIcon("layout-grid", t("ribbon.openBoard"), () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-gtd-board",
			name: t("commands.openBoard"),
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "gtd-quick-capture",
			name: t("commands.quickCapture"),
			callback: () => {
				new QuickCaptureModal(this.app, this, this.store.defaultLaneId()).open();
			},
		});

		this.addCommand({
			id: "gtd-export-ics",
			name: t("commands.exportIcs"),
			callback: () => void this.exportIcs(true),
		});

		this.addCommand({
			id: "gtd-weekly-review",
			name: t("commands.weeklyReview"),
			callback: () => void this.openWeeklyReview(),
		});

		this.addSettingTab(new GtdBoardSettingTab(this.app, this));

		this.reminderScheduler = new ReminderScheduler({
			getSettings: () => this.settings,
			getAllTasks: () => this.store.getAllTasks(),
			saveFiredReminders: async (fired) => {
				this.settings.firedReminders = fired;
				await this.saveData(this.settings);
			},
			saveSnoozedUntil: async (snoozed) => {
				this.settings.snoozedUntil = snoozed;
				await this.saveData(this.settings);
			},
		});
		this.reminderScheduler.start();

		// Wiederkehrende Aufgaben + Archivierung: einmal kurz nach dem Laden pruefen, danach
		// periodisch im Hintergrund (zusaetzlich zur sofortigen Pruefung bei Vault-Aenderungen).
		window.setTimeout(() => void this.runMaintenance(), 5_000);
		this.registerInterval(
			window.setInterval(() => void this.runMaintenance(), MAINTENANCE_INTERVAL_MS)
		);

		// ICS-Export: einmal beim Laden aktualisieren, danach bei jeder Board-Aktualisierung mit.
		window.setTimeout(() => void this.exportIcs(false), 5_000);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && isPathInFolder(file.path, this.settings.watchFolder)) {
					this.debouncedRefresh();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && isPathInFolder(file.path, this.settings.watchFolder)) {
					this.debouncedRefresh();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (isPathInFolder(file.path, this.settings.watchFolder)) {
					this.debouncedRefresh();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (
					isPathInFolder(file.path, this.settings.watchFolder) ||
					isPathInFolder(oldPath, this.settings.watchFolder)
				) {
					this.debouncedRefresh();
				}
			})
		);
	}

	onunload(): void {
		this.reminderScheduler?.stop();
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<GtdBoardSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		if (!this.settings.lanes || this.settings.lanes.length === 0) {
			this.settings.lanes = DEFAULT_SETTINGS.lanes;
		}
		if (!Array.isArray(this.settings.collapsedLanes)) {
			this.settings.collapsedLanes = [];
		}
		if (!this.settings.snoozedUntil || typeof this.settings.snoozedUntil !== "object") {
			this.settings.snoozedUntil = {};
		}
		const validSortModes = ["manual", "priority", "due", "title"];
		if (!validSortModes.includes(this.settings.sortMode)) {
			this.settings.sortMode = DEFAULT_SETTINGS.sortMode;
		}
		if (typeof this.settings.archiveAfterDays !== "number" || this.settings.archiveAfterDays < 0) {
			this.settings.archiveAfterDays = DEFAULT_SETTINGS.archiveAfterDays;
		}
		if (typeof this.settings.archiveFolder !== "string") {
			this.settings.archiveFolder = DEFAULT_SETTINGS.archiveFolder;
		}
		if (typeof this.settings.icsExportEnabled !== "boolean") {
			this.settings.icsExportEnabled = DEFAULT_SETTINGS.icsExportEnabled;
		}
		if (typeof this.settings.icsExportPath !== "string" || this.settings.icsExportPath.trim().length === 0) {
			this.settings.icsExportPath = DEFAULT_SETTINGS.icsExportPath;
		}
		if (!this.settings.reviewedAt || typeof this.settings.reviewedAt !== "object") {
			this.settings.reviewedAt = {};
		}
		if (typeof this.settings.delegateFollowUpDays !== "number" || this.settings.delegateFollowUpDays < 0) {
			this.settings.delegateFollowUpDays = DEFAULT_SETTINGS.delegateFollowUpDays;
		}
		if (typeof this.settings.somedayRefreshDays !== "number" || this.settings.somedayRefreshDays < 0) {
			this.settings.somedayRefreshDays = DEFAULT_SETTINGS.somedayRefreshDays;
		}
		if (typeof this.settings.autoPromoteInboxOnDueDate !== "boolean") {
			this.settings.autoPromoteInboxOnDueDate = DEFAULT_SETTINGS.autoPromoteInboxOnDueDate;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Bestaetigt eine Aufgabe als im Wochenrueckblick gesichtet, ohne die Datei selbst
	 * anzufassen (z. B. wenn inhaltlich alles noch passt). Setzt den "Beruehrungs"-Zeitpunkt
	 * neu, damit die Auffrischungs-Markierungen ("Wartet auf" / "Irgendwann/Vielleicht")
	 * zurueckgesetzt werden.
	 */
	async markTaskReviewed(taskId: string): Promise<void> {
		this.settings.reviewedAt[taskId] = nowISO();
		await this.saveSettings();
	}

	/** Startet den gefuehrten Wochenrueckblick, auch ohne dass das Board bereits geoeffnet ist. */
	async openWeeklyReview(): Promise<void> {
		const tasks = await this.store.getAllTasks();
		const doneLaneIds = new Set(this.settings.lanes.filter((l) => l.isDone).map((l) => l.id));
		const openTasks = tasks.filter((t) => !t.done && !doneLaneIds.has(t.laneId));
		new ReviewModal(this.app, this, openTasks).open();
	}

	restartReminderScheduler(): void {
		this.reminderScheduler?.start();
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(GTD_BOARD_VIEW_TYPE);
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: GTD_BOARD_VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	async refreshBoardViews(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(GTD_BOARD_VIEW_TYPE)) {
			if (leaf.view instanceof GtdBoardView) {
				await leaf.view.refresh();
			}
		}
		void this.exportIcs(false);
	}

	/**
	 * Wird bei jeder relevanten Vault-Aenderung (debounced) aufgerufen: springt zuerst direkt
	 * abgehakte wiederkehrende Aufgaben auf ihren naechsten Termin, aktualisiert dann die
	 * Board-Ansichten (Archivierung laeuft bewusst nur periodisch, nicht bei jeder Aenderung).
	 */
	private async handleVaultChange(): Promise<void> {
		try {
			await this.store.advanceRecurringTasks();
		} catch (err) {
			console.error("GTD Board: Wiederholung fehlgeschlagen", err);
		}
		await this.refreshBoardViews();
	}

	/** Prueft periodisch wiederkehrende Aufgaben und faellige Archivierung, aktualisiert danach die Board-Ansichten. */
	private async runMaintenance(): Promise<void> {
		try {
			const advanced = await this.store.advanceRecurringTasks();
			const archived = await this.store.archiveEligibleDoneTasks();
			if (advanced > 0 || archived > 0) {
				await this.refreshBoardViews();
			}
			if (archived > 0) new Notice(t("notice.archived", { count: archived }));
		} catch (err) {
			console.error("GTD Board: Wartung fehlgeschlagen", err);
		}
	}

	/**
	 * Schreibt die ICS-Kalenderdatei mit allen offenen Faelligkeiten ins Vault, sofern der
	 * Export aktiviert ist. Bei manuellem Aufruf (`manual = true`) wird auch ohne aktivierten
	 * Export einmalig geschrieben und eine Bestaetigung angezeigt.
	 */
	async exportIcs(manual: boolean): Promise<void> {
		if (!manual && !this.settings.icsExportEnabled) return;
		try {
			const tasks = await this.store.getAllTasks();
			const content = buildIcsContent(tasks);
			const path = normalizePath(this.settings.icsExportPath || DEFAULT_SETTINGS.icsExportPath);
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
			} else {
				const folder = path.split("/").slice(0, -1).join("/");
				if (folder) await this.ensureFolderExists(folder);
				await this.app.vault.create(path, content);
			}
			if (manual) new Notice(t("notice.icsExportUpdated", { path }));
		} catch (err) {
			console.error("GTD Board: ICS-Export fehlgeschlagen", err);
			if (manual) new Notice(t("notice.icsExportFailed"));
		}
	}

	private async ensureFolderExists(path: string): Promise<void> {
		const normalized = normalizePath(path);
		if (this.app.vault.getAbstractFileByPath(normalized)) return;
		const parts = normalized.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}
}
