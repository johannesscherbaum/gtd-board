import { ItemView, Menu, MarkdownRenderer, Notice, Platform, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type GtdBoardPlugin from "./main";
import { AGENDA_LANE_ID, GtdTask, LaneConfig, SortMode } from "./types";
import {
	addDays,
	buildSidebarCounts,
	buildTodayFocus,
	collectTalkPeople,
	countSubtasks,
	daysSince,
	earliestOpenSubtaskDay,
	parseSubtaskItems,
	dueUrgency,
	fileTaskId,
	formatLocalDate,
	formatShortDue,
	parseLocalDateTime,
	priorityRank,
	reorderTaskIds,
	shouldPromoteFromInbox,
	startOfWeek,
} from "./util";
import { getLocale, originKindLabel, priorityLabel, recurrenceLabel, t } from "./i18n";

/** Intl locale tag for date formatting, derived from our active i18n locale (used for the week view). */
/** Schluessel in collapsedLanes fuer den eingeklappten Ueberfaellig-Block der Heute-Ansicht. */
const OVERDUE_COLLAPSE_KEY = "__today-overdue__";

function intlLocale(): string {
	return getLocale() === "de" ? "de-DE" : "en-US";
}
import { ProcessModal, TaskModal, TaskModalOptions, confirmDialog } from "./modals";
import { QuickModal, openTalkModal, renderNotePanel, renderTaskPanel } from "./quick-buttons";

export const GTD_BOARD_VIEW_TYPE = "gtd-board-view";

type ViewMode = "board" | "today" | "agenda" | "week" | "projects" | "contexts" | "lane";

function sortLabel(mode: SortMode): string {
	switch (mode) {
		case "priority":
			return t("view.sort.priority");
		case "due":
			return t("view.sort.due");
		case "title":
			return t("view.sort.taskTitle");
		case "project":
			return t("view.sort.project");
		default:
			return t("view.sort.manual");
	}
}

export class GtdBoardView extends ItemView {
	private tasks: GtdTask[] = [];
	private draggedTaskId: string | null = null;
	private filterText = "";
	/** Ausgewaehlter Kontext-Filter (ohne @), leer = kein Filter. Zweite, mit der Suche UND-verknuepfte Filterdimension. */
	private contextFilter = "";
	/** Ausgewaehlter Projekt-Filter (ohne +), leer = kein Filter. Dritte, unabhaengige Filterdimension. */
	private projectFilter = "";
	/** Personen-Filter aus der Seitenleiste (delegatedTo), leer = kein Filter. */
	private personFilter = "";
	/** Herkunfts-Filter aus der Seitenleiste (origin.kind, klein geschrieben), leer = kein Filter. */
	private originFilter = "";
	/** Seitenleiste sichtbar (Desktop: aus den Einstellungen, Mobile: anfangs ausgeblendet). */
	private sidebarVisible = true;
	private sidebarEl!: HTMLElement;
	private sidebarToggleEl!: HTMLElement;
	private viewModeSelectEl!: HTMLSelectElement;
	/** Lane der Listenansicht einer einzelnen Lane (viewMode "lane", aus der Seitenleiste). */
	private sidebarLaneId = "";
	/** Herkunfts-Quelle (origin.label) als zusaetzlicher Filter zu originFilter, leer = alle. */
	private originLabelFilter = "";
	/** Kanban (Lanes nebeneinander), Agenda (flache Liste) oder Woche (Kalender-Raster). */
	private viewMode: ViewMode = "board";
	/** Montag der aktuell angezeigten Woche (nur fuer die Wochenansicht relevant). */
	private weekStart: Date = startOfWeek(new Date());
	/** Mehrfachauswahl-Modus: Klick auf eine Karte waehlt sie aus statt den Bearbeiten-Dialog zu oeffnen. */
	private selectionMode = false;
	private selectedTaskIds = new Set<string>();
	private expandedSubtasks = new Set<string>();
	private boardEl!: HTMLElement;
	private searchInputEl!: HTMLInputElement;
	private contextSelectEl!: HTMLSelectElement;
	private projectSelectEl!: HTMLSelectElement;
	private sortSelectEl!: HTMLSelectElement;
	private bulkBarEl!: HTMLElement;
	/** undefined = nicht in Detailansicht; null = "Kein Projekt"-Gruppe; string = Projektname. */
	private detailProject: string | null | undefined = undefined;

	constructor(leaf: WorkspaceLeaf, private plugin: GtdBoardPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return GTD_BOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t("view.displayText");
	}

	getIcon(): string {
		return "layout-grid";
	}

	async onOpen(): Promise<void> {
		const s = this.plugin.settings;
		const validModes: ViewMode[] = ["board", "today", "agenda", "week", "projects", "contexts"];
		if (validModes.includes(s.lastViewMode as ViewMode)) {
			this.viewMode = s.lastViewMode as ViewMode;
		}
		this.contextFilter = s.lastContextFilter ?? "";
		this.projectFilter = s.lastProjectFilter ?? "";
		this.sidebarVisible = Platform.isMobile ? false : s.sidebarVisible;
		this.renderShell();
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** Laedt Aufgaben aus dem Store neu und zeichnet nur das Board (nicht die Toolbar) neu. */
	async refresh(): Promise<void> {
		this.tasks = await this.plugin.store.getAllTasks();
		this.renderContextFilterOptions();
		this.renderProjectFilterOptions();
		this.renderBoard();
	}

	/** Baut die Optionsliste des Kontext-Filters aus allen aktuell vorkommenden Kontexten neu auf. */
	private renderContextFilterOptions(): void {
		if (!this.contextSelectEl) return;
		const contexts = Array.from(new Set(this.tasks.flatMap((t) => t.contexts))).sort((a, b) =>
			a.localeCompare(b, intlLocale())
		);
		// Auswahl nur behalten, wenn der Kontext noch existiert - sonst faellt der Filter zurueck auf "alle".
		if (this.contextFilter && !contexts.includes(this.contextFilter)) {
			this.contextFilter = "";
		}
		this.contextSelectEl.empty();
		const allOpt = this.contextSelectEl.createEl("option", { text: t("view.context.all"), value: "" });
		allOpt.selected = this.contextFilter === "";
		for (const ctx of contexts) {
			const opt = this.contextSelectEl.createEl("option", { text: `@${ctx}`, value: ctx });
			opt.selected = ctx === this.contextFilter;
		}
	}

	/** Baut die Optionsliste des Projekt-Filters aus allen aktuell vorkommenden Projekten neu auf. */
	private renderProjectFilterOptions(): void {
		if (!this.projectSelectEl) return;
		const projects = Array.from(
			new Set(this.tasks.map((t) => t.project).filter((p): p is string => !!p))
		).sort((a, b) => a.localeCompare(b, intlLocale()));
		if (this.projectFilter && !projects.includes(this.projectFilter)) {
			this.projectFilter = "";
		}
		this.projectSelectEl.empty();
		const allOpt = this.projectSelectEl.createEl("option", { text: t("view.project.all"), value: "" });
		allOpt.selected = this.projectFilter === "";
		for (const project of projects) {
			const opt = this.projectSelectEl.createEl("option", { text: `+${project}`, value: project });
			opt.selected = project === this.projectFilter;
		}
	}

	/** Fuegt ein kleines Icon vor einem Kontrollelement ein (Suchfeld, Dropdown), zur schnelleren Orientierung. */
	private createToolbarIcon(container: HTMLElement, iconId: string): HTMLElement {
		const icon = container.createSpan({ cls: "gtd-toolbar-icon" });
		setIcon(icon, iconId);
		return icon;
	}

	/** Baut einen Button mit vorangestelltem Icon und Textlabel (statt reinem Text). */
	private createIconButton(
		container: HTMLElement,
		iconId: string,
		text: string,
		cls?: string
	): HTMLButtonElement {
		const btn = container.createEl("button", { cls });
		const icon = btn.createSpan({ cls: "gtd-toolbar-btn-icon" });
		setIcon(icon, iconId);
		btn.createSpan({ text });
		return btn;
	}

	/** Baut Toolbar (Suche, Filter, Ansicht, Sortierung, Mehrfachauswahl, Aktualisieren) und den leeren Board-Container einmalig auf. */
	private renderShell(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("gtd-board-container");

		const toolbar = container.createDiv({ cls: "gtd-board-toolbar" });

		this.sidebarToggleEl = this.createIconButton(toolbar, "panel-left", "", "gtd-board-sidebar-toggle");
		this.sidebarToggleEl.setAttribute("aria-label", t("view.sidebar.toggle"));
		this.sidebarToggleEl.setAttribute("title", t("view.sidebar.toggle"));
		this.sidebarToggleEl.toggleClass("is-active", this.sidebarVisible);
		this.sidebarToggleEl.addEventListener("click", () => this.setSidebarVisible(!this.sidebarVisible));

		this.renderQuickButtons(toolbar);

		const searchGroup = toolbar.createDiv({
			cls: "gtd-toolbar-group gtd-toolbar-inline-icon gtd-toolbar-search-group",
		});
		this.createToolbarIcon(searchGroup, "search");
		this.searchInputEl = searchGroup.createEl("input", {
			cls: "gtd-board-search",
			attr: { type: "text", placeholder: t("view.search.placeholder") },
		});
		this.searchInputEl.setAttribute("title", t("view.search.title"));
		this.searchInputEl.addEventListener("input", () => {
			this.filterText = this.searchInputEl.value.trim().toLowerCase();
			this.renderBoard();
		});

		// Auf Mobile bleibt neben dem Suchfeld nur ein Burger-Icon in der Toolbar sichtbar;
		// alle uebrigen Bedienelemente (Filter, Ansicht, Sortierung, Mehrfachauswahl,
		// Wochenrueckblick, Aktualisieren) wandern in ein Dropdown-Menu darunter, damit die
		// Lanes moeglichst weit oben beginnen. Auf dem Desktop bleiben sie unveraendert als
		// eigene sichtbare Gruppen direkt in der Toolbar.
		let menuBtn: HTMLButtonElement | undefined;
		let mobileMenuEl: HTMLElement | undefined;
		let controlsParent: HTMLElement = toolbar;
		let closeMobileMenu: () => void = () => {};
		if (Platform.isMobile) {
			menuBtn = this.createIconButton(toolbar, "menu", "", "gtd-board-menu-btn");
			menuBtn.setAttribute("aria-label", t("view.overflow.title"));
			menuBtn.setAttribute("title", t("view.overflow.title"));
			mobileMenuEl = container.createDiv({ cls: "gtd-board-mobile-menu" });
			mobileMenuEl.hide();
			controlsParent = mobileMenuEl;

			const btn = menuBtn;
			const panel = mobileMenuEl;
			closeMobileMenu = () => {
				panel.hide();
				btn.toggleClass("is-active", false);
			};
			btn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				const isOpen = panel.isShown();
				panel.toggle(!isOpen);
				btn.toggleClass("is-active", !isOpen);
			});
			// Klick ausserhalb schliesst das Dropdown wieder.
			this.registerDomEvent(document, "click", (evt) => {
				if (!panel.isShown()) return;
				if (panel.contains(evt.target as Node) || btn.contains(evt.target as Node)) return;
				closeMobileMenu();
			});
		}

		const contextGroup = controlsParent.createDiv({ cls: "gtd-toolbar-group gtd-toolbar-inline-icon" });
		this.createToolbarIcon(contextGroup, "at-sign");
		this.contextSelectEl = contextGroup.createEl("select", { cls: "gtd-board-context-filter" });
		this.contextSelectEl.setAttribute("title", t("view.context.title"));
		this.contextSelectEl.addEventListener("change", () => {
			this.contextFilter = this.contextSelectEl.value;
			void this.plugin.saveUiState({ lastContextFilter: this.contextFilter });
			this.renderBoard();
		});

		const projectGroup = controlsParent.createDiv({ cls: "gtd-toolbar-group gtd-toolbar-inline-icon" });
		this.createToolbarIcon(projectGroup, "folder");
		this.projectSelectEl = projectGroup.createEl("select", { cls: "gtd-board-project-filter" });
		this.projectSelectEl.setAttribute("title", t("view.project.title"));
		this.projectSelectEl.addEventListener("change", () => {
			this.projectFilter = this.projectSelectEl.value;
			void this.plugin.saveUiState({ lastProjectFilter: this.projectFilter });
			this.renderBoard();
		});

		const viewModeGroup = controlsParent.createDiv({ cls: "gtd-toolbar-group gtd-toolbar-inline-icon" });
		this.createToolbarIcon(viewModeGroup, "layout-grid");
		const viewModeSelect = viewModeGroup.createEl("select", { cls: "gtd-board-viewmode" });
		this.viewModeSelectEl = viewModeSelect;
		viewModeSelect.setAttribute("title", t("view.viewMode.title"));
		viewModeSelect.createEl("option", { text: t("view.viewMode.board"), value: "board" });
		viewModeSelect.createEl("option", { text: t("view.viewMode.today"), value: "today" });
		viewModeSelect.createEl("option", { text: t("view.viewMode.agenda"), value: "agenda" });
		viewModeSelect.createEl("option", { text: t("view.viewMode.week"), value: "week" });
		viewModeSelect.createEl("option", { text: t("view.viewMode.projects"), value: "projects" });
		viewModeSelect.createEl("option", { text: t("view.viewMode.contexts"), value: "contexts" });
		viewModeSelect.value = this.viewMode;
		viewModeSelect.addEventListener("change", () => this.setViewMode(viewModeSelect.value as ViewMode));

		const sortGroup = controlsParent.createDiv({ cls: "gtd-toolbar-group gtd-toolbar-inline-icon" });
		this.createToolbarIcon(sortGroup, "arrow-up-down");
		this.sortSelectEl = sortGroup.createEl("select", { cls: "gtd-board-sort" });
		this.sortSelectEl.setAttribute("title", t("view.sort.title"));
		(["manual", "priority", "due", "title", "project"] as SortMode[]).forEach((mode) => {
			const opt = this.sortSelectEl.createEl("option", { text: sortLabel(mode), value: mode });
			if (mode === this.plugin.settings.sortMode) opt.selected = true;
		});
		this.sortSelectEl.addEventListener("change", () => {
			void this.setSortMode(this.sortSelectEl.value as SortMode);
		});

		const toggleSelection = () => {
			this.selectionMode = !this.selectionMode;
			if (!this.selectionMode) this.selectedTaskIds.clear();
			this.renderBoard();
		};

		if (Platform.isMobile) {
			// Mobile: wie bisher als Eintraege im Burger-Menue.
			const selectionToggleBtn = this.createIconButton(
				controlsParent,
				"list-checks",
				t("view.selection.button"),
				"gtd-board-selection-toggle"
			);
			selectionToggleBtn.setAttribute("title", t("view.selection.title"));
			selectionToggleBtn.addEventListener("click", () => {
				toggleSelection();
				selectionToggleBtn.toggleClass("is-active", this.selectionMode);
				closeMobileMenu();
			});

			const reviewBtn = this.createIconButton(controlsParent, "clipboard-check", t("view.review.button"));
			reviewBtn.setAttribute("title", t("view.review.title"));
			reviewBtn.addEventListener("click", () => {
				void this.plugin.openWeeklyReview();
				closeMobileMenu();
			});

			const refreshBtn = this.createIconButton(controlsParent, "refresh-cw", t("view.refresh.button"));
			refreshBtn.setAttribute("title", t("view.refresh.title"));
			refreshBtn.addEventListener("click", () => {
				void this.refresh();
				closeMobileMenu();
			});
		} else {
			// Desktop: selten genutzte Aktionen in einem "..."-Menue statt drei grosser Knoepfe.
			const moreBtn = this.createIconButton(controlsParent, "more-horizontal", "", "gtd-board-more-btn");
			moreBtn.setAttribute("aria-label", t("view.overflow.title"));
			moreBtn.setAttribute("title", t("view.overflow.title"));
			moreBtn.addEventListener("click", (evt) => {
				const menu = new Menu();
				menu.addItem((item) =>
					item
						.setTitle(this.selectionMode ? t("view.selection.end") : t("view.selection.button"))
						.setIcon("list-checks")
						.onClick(() => {
							toggleSelection();
							moreBtn.toggleClass("is-active", this.selectionMode);
						})
				);
				menu.addItem((item) =>
					item.setTitle(t("view.review.button")).setIcon("clipboard-check").onClick(() => void this.plugin.openWeeklyReview())
				);
				menu.addItem((item) =>
					item.setTitle(t("view.refresh.button")).setIcon("refresh-cw").onClick(() => void this.refresh())
				);
				menu.showAtMouseEvent(evt);
			});
		}

		this.bulkBarEl = container.createDiv({ cls: "gtd-bulk-bar" });
		this.bulkBarEl.hide();

		const mainEl = container.createDiv({ cls: "gtd-board-main" });
		this.sidebarEl = mainEl.createDiv({ cls: "gtd-board-sidebar" });
		this.boardEl = mainEl.createDiv({ cls: "gtd-board" });
	}

	/**
	 * Oeffnet das Aufgaben-Formular immer als Modal ueber dem Board (Anlegen, Bearbeiten,
	 * Detailansicht), auf Desktop und Mobile gleich.
	 */
	private openTaskEditor(options: TaskModalOptions): void {
		new TaskModal(this.app, this.plugin, options).open();
	}

	private openTaskFile(task: GtdTask): void {
		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (file instanceof TFile) {
			// Inline-Aufgaben: direkt an ihre Zeile springen.
			const eState = task.source === "inline" && task.line !== undefined ? { line: task.line } : undefined;
			void this.app.workspace.getLeaf(true).openFile(file, eState ? { eState } : undefined);
		}
	}

	/** Wechselt die Ansicht (Toolbar-Auswahl oder Seitenleiste) und merkt sie sich. */
	private setViewMode(mode: ViewMode): void {
		const prev = this.viewMode;
		this.viewMode = mode;
		if (prev === "projects" && mode !== "projects") {
			this.detailProject = undefined;
		}
		// Die Lane-Ansicht hat keinen Eintrag in der Auswahl und wird nicht gemerkt.
		const transient = mode === "lane";
		this.viewModeSelectEl.value = transient ? "" : mode;
		this.sortSelectEl.toggle(mode === "board" || mode === "projects" || mode === "contexts" || mode === "lane");
		if (!transient) void this.plugin.saveUiState({ lastViewMode: mode });
		this.renderBoard();
	}

	/** Schnellknoepfe links in der Toolbar; jeder oeffnet ein Modal ueber dem Board. Auf Mobile nur Icons. */
	private renderQuickButtons(toolbar: HTMLElement): void {
		const group = toolbar.createDiv({ cls: "gtd-toolbar-group gtd-quick-buttons" });
		const buttons: { icon: string; label: string; open: () => void }[] = [
			{ icon: "plus", label: t("quick.taskButton"), open: () => new QuickModal(this.app, this.plugin, renderTaskPanel).open() },
			{ icon: "file-plus", label: t("quick.noteButton"), open: () => new QuickModal(this.app, this.plugin, renderNotePanel).open() },
			{ icon: "messages-square", label: t("quick.talkButton"), open: () => this.openTalk() },
		];
		for (const { icon, label, open } of buttons) {
			const btn = this.createIconButton(group, icon, Platform.isMobile ? "" : label, "gtd-quick-btn");
			btn.setAttribute("aria-label", label);
			btn.setAttribute("title", label);
			btn.addEventListener("click", open);
		}
	}

	/** "Besprechen mit" als Modal, optional gleich fuer eine Person; delegierte Aufgaben oeffnen den Aufgaben-Dialog. */
	private openTalk(person?: string): void {
		openTalkModal(this.app, this.plugin, person, (task) => this.openEditModal(task));
	}

	/** Blendet die Seitenleiste ein/aus; auf dem Desktop wird der Zustand gespeichert. */
	private setSidebarVisible(visible: boolean): void {
		this.sidebarVisible = visible;
		this.sidebarToggleEl.toggleClass("is-active", visible);
		if (!Platform.isMobile) void this.plugin.saveUiState({ sidebarVisible: visible });
		this.renderSidebar();
	}

	/**
	 * Seitenleiste mit Zaehlern: Listen (Ansichten), Personen (delegatedTo), Projekte und
	 * Herkunft. Die Zaehler gelten immer fuer alle offenen Aufgaben; ein Klick auf eine Person,
	 * ein Projekt oder eine Herkunft filtert das Board, ein zweiter Klick hebt den Filter auf.
	 */
	private renderSidebar(): void {
		if (!this.sidebarEl) return;
		this.sidebarEl.empty();
		this.sidebarEl.toggle(this.sidebarVisible);
		if (!this.sidebarVisible) return;

		const lanes = this.plugin.settings.lanes;
		const counts = buildSidebarCounts(this.tasks, AGENDA_LANE_ID, new Date(), lanes);
		const afterClick = () => {
			if (Platform.isMobile) this.setSidebarVisible(false);
		};

		// Listen: Heute und jede Lane einzeln (wie auf dem Board gezaehlt).
		const lists = this.createSidebarGroup(t("view.sidebar.lists"));
		const todayItem = this.addSidebarItem(lists, "sun", t("view.viewMode.today"), counts.today, this.viewMode === "today", () => {
			this.setViewMode("today");
			afterClick();
		});
		if (counts.overdue > 0) {
			todayItem.createSpan({
				cls: "gtd-sidebar-count gtd-sidebar-count-overdue",
				text: String(counts.overdue),
				attr: { title: t("view.sidebar.overdueTitle", { count: counts.overdue }) },
			});
		}
		for (const lane of lanes) {
			const active = this.viewMode === "lane" && this.sidebarLaneId === lane.id;
			const item = this.addSidebarItem(lists, "", lane.name, counts.lanes[lane.id] ?? 0, active, () => {
				this.sidebarLaneId = lane.id;
				this.setViewMode("lane");
				afterClick();
			});
			const dot = item.querySelector<HTMLElement>(".gtd-sidebar-item-icon");
			dot?.addClass("gtd-sidebar-lane-dot");
			dot?.setCssProps({ "--lane-color": lane.color });
		}

		// Ansichten ueber alle Lanes hinweg.
		const views = this.createSidebarGroup(t("view.sidebar.views"));
		const listModes: { mode: ViewMode; icon: string; count: number }[] = [
			{ mode: "board", icon: "layout-grid", count: counts.open },
			{ mode: "agenda", icon: "list", count: counts.open },
			{ mode: "week", icon: "calendar-days", count: counts.week },
		];
		for (const entry of listModes) {
			this.addSidebarItem(views, entry.icon, t(`view.viewMode.${entry.mode}` as "view.viewMode.board"), entry.count, this.viewMode === entry.mode, () => {
				this.setViewMode(entry.mode);
				afterClick();
			});
		}

		// Gespraeche: Personen mit offenen Themen; Klick oeffnet die Personenansicht.
		const talkPeople = this.plugin.settings.agendaEnabled
			? collectTalkPeople(this.tasks, AGENDA_LANE_ID).filter((p) => p.openTopics > 0)
			: [];
		if (talkPeople.length > 0) {
			const group = this.createSidebarGroup(t("view.sidebar.talks"));
			for (const person of talkPeople) {
				this.addSidebarItem(group, "messages-square", person.name, person.openTopics, false, () => {
					this.openTalk(person.name);
					afterClick();
				});
			}
		}

		if (counts.people.length > 0) {
			const group = this.createSidebarGroup(t("view.sidebar.people"));
			for (const person of counts.people) {
				this.addSidebarItem(group, "user", `@${person.key}`, person.count, this.personFilter === person.key, () => {
					this.personFilter = this.personFilter === person.key ? "" : person.key;
					this.renderBoard();
					afterClick();
				});
			}
		}

		if (counts.projects.length > 0) {
			const group = this.createSidebarGroup(t("view.sidebar.projects"));
			for (const project of counts.projects) {
				this.addSidebarItem(group, "folder", `+${project.key}`, project.count, this.projectFilter === project.key, () => {
					this.projectFilter = this.projectFilter === project.key ? "" : project.key;
					this.projectSelectEl.value = this.projectFilter;
					void this.plugin.saveUiState({ lastProjectFilter: this.projectFilter });
					this.renderBoard();
					afterClick();
				});
			}
		}

		// Herkunft: je Art eine Gruppe ("Planner", "Aus Meetings") mit "Alle" und den einzelnen
		// Quellen (Plan- bzw. Meetingname). Klick filtert, zweiter Klick hebt den Filter auf.
		for (const origin of counts.origins) {
			const kind = origin.key;
			const icon = kind === "planner" ? "clipboard-list" : kind === "meeting" ? "calendar-clock" : "link";
			const group = this.createSidebarGroup(this.originGroupTitle(kind));
			const allActive = this.originFilter === kind && !this.originLabelFilter;
			this.addSidebarItem(group, icon, t("view.sidebar.originAll", { kind: originKindLabel(kind) }), origin.count, allActive, () => {
				const same = allActive;
				this.originFilter = same ? "" : kind;
				this.originLabelFilter = "";
				this.renderBoard();
				afterClick();
			});
			for (const label of counts.originLabels[kind] ?? []) {
				const active = this.originFilter === kind && this.originLabelFilter === label.key;
				this.addSidebarItem(group, "", label.key, label.count, active, () => {
					this.originFilter = active ? "" : kind;
					this.originLabelFilter = active ? "" : label.key;
					this.renderBoard();
					afterClick();
				});
			}
		}

		if (this.personFilter || this.projectFilter || this.originFilter) {
			const reset = this.sidebarEl.createEl("button", { cls: "gtd-sidebar-reset", text: t("view.sidebar.clearFilters") });
			reset.addEventListener("click", () => {
				this.personFilter = "";
				this.originFilter = "";
				this.originLabelFilter = "";
				this.projectFilter = "";
				this.projectSelectEl.value = "";
				void this.plugin.saveUiState({ lastProjectFilter: "" });
				this.renderBoard();
			});
		}
	}

	private createSidebarGroup(title: string): HTMLElement {
		const group = this.sidebarEl.createDiv({ cls: "gtd-sidebar-group" });
		group.createDiv({ cls: "gtd-sidebar-group-title", text: title });
		return group;
	}

	private addSidebarItem(
		group: HTMLElement,
		icon: string,
		label: string,
		count: number,
		active: boolean,
		onClick: () => void
	): HTMLElement {
		const item = group.createDiv({ cls: "gtd-sidebar-item", attr: { role: "button", tabindex: "0" } });
		if (active) item.addClass("is-active");
		const iconEl = item.createSpan({ cls: "gtd-sidebar-item-icon" });
		if (icon) setIcon(iconEl, icon);
		item.createSpan({ cls: "gtd-sidebar-item-label", text: label, attr: { title: label } });
		item.createSpan({ cls: "gtd-sidebar-count", text: String(count) });
		item.addEventListener("click", onClick);
		item.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				onClick();
			}
		});
		return item;
	}

	private async setSortMode(mode: SortMode): Promise<void> {
		this.plugin.settings.sortMode = mode;
		await this.plugin.saveSettings();
		this.renderBoard();
	}

	private renderBoard(): void {
		this.boardEl.empty();
		this.boardEl.removeClass("gtd-board-agenda-mode");
		this.boardEl.removeClass("gtd-board-week-mode");
		this.boardEl.removeClass("gtd-board-projects-mode");
		this.boardEl.removeClass("gtd-board-contexts-mode");
		this.boardEl.removeClass("gtd-board-today-mode");
		this.boardEl.removeClass("gtd-board-lane-mode");
		const sidebarLane = this.plugin.settings.lanes.find((l) => l.id === this.sidebarLaneId);
		if (this.viewMode === "lane" && sidebarLane) {
			this.boardEl.addClass("gtd-board-lane-mode");
			this.boardEl.appendChild(this.renderLaneList(sidebarLane));
		} else if (this.viewMode === "today") {
			this.boardEl.addClass("gtd-board-today-mode");
			this.boardEl.appendChild(this.renderToday());
		} else if (this.viewMode === "agenda") {
			this.boardEl.addClass("gtd-board-agenda-mode");
			this.boardEl.appendChild(this.renderAgenda());
		} else if (this.viewMode === "week") {
			this.boardEl.addClass("gtd-board-week-mode");
			this.boardEl.appendChild(this.renderWeek());
		} else if (this.viewMode === "projects") {
			this.boardEl.addClass("gtd-board-projects-mode");
			this.boardEl.appendChild(this.renderProjects());
		} else if (this.viewMode === "contexts") {
			this.boardEl.addClass("gtd-board-contexts-mode");
			this.boardEl.appendChild(this.renderContexts());
		} else {
			if (this.plugin.settings.agendaEnabled) {
				this.boardEl.appendChild(this.renderAgendaLane());
			}
			for (const lane of this.plugin.settings.lanes) {
				this.boardEl.appendChild(this.renderLane(lane));
			}
		}
		this.updateBulkBar();
		this.renderSidebar();
	}

	/** Gruppentitel der Herkunft in der Seitenleiste, z. B. "Planner" oder "Aus Meetings". */
	private originGroupTitle(kind: string): string {
		if (kind === "meeting") return t("view.sidebar.fromMeetings");
		return originKindLabel(kind);
	}

	/**
	 * Eine einzelne Lane als Liste (aus der Seitenleiste): dieselben Aufgaben wie die Spalte auf
	 * dem Board, in voller Breite und in der gewaehlten Sortierung.
	 */
	private renderLaneList(lane: LaneConfig): HTMLElement {
		const container = createDiv({ cls: "gtd-agenda gtd-lane-list" });
		const header = container.createDiv({ cls: "gtd-lane-list-header" });
		header.setCssProps({ "--lane-color": lane.color });
		header.createSpan({ cls: "gtd-lane-dot" });
		header.createSpan({ cls: "gtd-lane-list-title", text: lane.name });
		const all = lane.isPlanned
			? this.tasks.filter((t) => !t.done && !!t.due)
			: this.tasks.filter((t) => t.laneId !== AGENDA_LANE_ID && this.displayLaneId(t) === lane.id);
		const visible = all.filter((t) => this.matchesFilter(t));
		header.createSpan({ cls: "gtd-lane-count", text: String(all.length) });
		if (visible.length === 0) {
			container.createDiv({ cls: "gtd-agenda-empty", text: t("view.sidebar.laneEmpty") });
			return container;
		}
		const sorted = lane.isPlanned ? this.sortByDueAscending(visible) : this.sortTasks(visible);
		for (const task of sorted) container.appendChild(this.renderCard(task, {}));
		return container;
	}

	/**
	 * Smart-Liste "Heute": oben ein eigener Block mit allen ueberfaelligen Aufgaben, darunter
	 * alles, was heute faellig ist oder manuell fuer heute markiert wurde (siehe buildTodayFocus).
	 */
	private renderToday(): HTMLElement {
		const container = createDiv({ cls: "gtd-today" });
		const focus = buildTodayFocus(this.tasks.filter((t) => this.matchesFilter(t)));
		if (focus.overdue.length === 0 && focus.today.length === 0) {
			container.createDiv({ cls: "gtd-today-empty", text: t("view.today.empty") });
			return container;
		}
		if (focus.overdue.length > 0) {
			// Lange Ueberfaellig-Listen sollen Heute nicht verdraengen: Block ist einklappbar,
			// der Zustand wird wie bei den Lanes gemerkt.
			this.renderTodaySection(container, t("view.today.overdue"), focus.overdue, "gtd-today-section-overdue", OVERDUE_COLLAPSE_KEY);
		}
		this.renderTodaySection(container, t("view.today.today"), focus.today, "gtd-today-section-today");
		return container;
	}

	private renderTodaySection(container: HTMLElement, title: string, tasks: GtdTask[], cls: string, collapseKey?: string): void {
		const section = container.createDiv({ cls: ["gtd-today-section", cls] });
		const header = section.createDiv({ cls: "gtd-today-section-header" });
		const collapsed = !!collapseKey && this.plugin.settings.collapsedLanes.includes(collapseKey);
		if (collapseKey) {
			header.addClass("is-collapsible");
			header.setAttribute("role", "button");
			header.setAttribute("tabindex", "0");
			header.setAttribute("aria-expanded", String(!collapsed));
			header.setAttribute("title", collapsed ? t("view.lane.expand") : t("view.lane.collapse"));
			const chevron = header.createSpan({ cls: "gtd-today-section-chevron" });
			setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
			const toggle = () => void this.toggleLaneCollapsed(collapseKey);
			header.addEventListener("click", toggle);
			header.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter" || evt.key === " ") {
					evt.preventDefault();
					toggle();
				}
			});
		}
		header.createSpan({ cls: "gtd-today-section-title", text: title });
		header.createSpan({ cls: "gtd-today-section-count", text: String(tasks.length) });
		if (collapsed) return;
		const body = section.createDiv({ cls: "gtd-today-section-body" });
		if (tasks.length === 0) {
			body.createDiv({ cls: "gtd-today-empty", text: t("view.today.emptyToday") });
			return;
		}
		for (const task of tasks) {
			body.appendChild(this.renderCard(task, { showHomeLaneBadge: true }));
		}
	}

	/** Agenda-Ansicht: alle offenen Aufgaben ueber alle Lanes hinweg, flach und nach Faelligkeit sortiert. */
	private renderAgenda(): HTMLElement {
		const container = createDiv({ cls: "gtd-agenda" });

		const tasksAll = this.tasks.filter((t) => !t.done);
		const tasksFiltered = tasksAll.filter((t) => this.matchesFilter(t));
		const tasksSorted = this.sortByDueAscending(tasksFiltered);

		if (tasksSorted.length === 0) {
			container.createDiv({ cls: "gtd-agenda-empty", text: t("view.agenda.empty") });
			return container;
		}

		for (const task of tasksSorted) {
			container.appendChild(this.renderCard(task, { showHomeLaneBadge: true }));
		}
		return container;
	}

	/**
	 * Wochenansicht: 7 Tagesspalten (Montag-Sonntag) mit den an dem Tag faelligen offenen
	 * Aufgaben ueber alle Lanes hinweg, echter Kalender-Blick statt Liste. Mit Navigation
	 * zur vorherigen/naechsten Woche sowie einem Sprung zurueck zur aktuellen Woche.
	 */
	private renderWeek(): HTMLElement {
		const container = createDiv({ cls: "gtd-week" });

		const nav = container.createDiv({ cls: "gtd-week-nav" });
		const prevBtn = nav.createEl("button", {
			cls: "gtd-week-nav-btn",
			attr: { "aria-label": t("view.week.prevWeek"), title: t("view.week.prevWeek") },
		});
		setIcon(prevBtn, "chevron-left");
		prevBtn.addEventListener("click", () => {
			this.weekStart = addDays(this.weekStart, -7);
			this.renderBoard();
		});

		const weekEnd = addDays(this.weekStart, 6);
		const rangeFmt = new Intl.DateTimeFormat(intlLocale(), { day: "2-digit", month: "2-digit", year: "numeric" });
		nav.createSpan({
			cls: "gtd-week-range",
			text: `${rangeFmt.format(this.weekStart)} – ${rangeFmt.format(weekEnd)}`,
		});

		const todayBtn = this.createIconButton(nav, "calendar-days", t("view.week.today"), "gtd-week-today-btn");
		todayBtn.setAttribute("title", t("view.week.todayTitle"));
		todayBtn.addEventListener("click", () => {
			this.weekStart = startOfWeek(new Date());
			this.renderBoard();
		});

		const nextBtn = nav.createEl("button", {
			cls: "gtd-week-nav-btn",
			attr: { "aria-label": t("view.week.nextWeek"), title: t("view.week.nextWeek") },
		});
		setIcon(nextBtn, "chevron-right");
		nextBtn.addEventListener("click", () => {
			this.weekStart = addDays(this.weekStart, 7);
			this.renderBoard();
		});

		const grid = container.createDiv({ cls: "gtd-week-grid" });

		// Wie die "Geplant"-Lane: nur offene Aufgaben mit Faelligkeit sind kalenderfaehig.
		const openTasksWithDue = this.tasks.filter((t) => !t.done && !!t.due).filter((t) => this.matchesFilter(t));
		const todayKey = formatLocalDate(new Date());

		for (let i = 0; i < 7; i++) {
			const day = addDays(this.weekStart, i);
			const dayKey = formatLocalDate(day);
			const dayTasks = openTasksWithDue
				.filter((t) => (t.due as string).slice(0, 10) === dayKey)
				.sort((a, b) => this.compareByDueAscending(a, b));

			const dayEl = grid.createDiv({ cls: "gtd-week-day" });
			if (dayKey === todayKey) dayEl.addClass("gtd-week-day-today");

			const header = dayEl.createDiv({ cls: "gtd-week-day-header" });
			header.createSpan({
				cls: "gtd-week-day-weekday",
				text: day.toLocaleDateString(intlLocale(), { weekday: "short" }),
			});
			header.createSpan({
				cls: "gtd-week-day-date",
				text: day.toLocaleDateString(intlLocale(), { day: "2-digit", month: "2-digit" }),
			});

			const body = dayEl.createDiv({ cls: "gtd-week-day-body" });
			if (dayTasks.length === 0) {
				body.createDiv({ cls: "gtd-week-day-empty", text: t("view.week.emptyDay") });
			} else {
				for (const task of dayTasks) {
					body.appendChild(this.renderCard(task, { showHomeLaneBadge: true }));
				}
			}
		}

		return container;
	}

	/**
	 * Projekteansicht: alle offenen Aufgaben (ohne Agenda-Eintraege) gruppiert nach Projekt.
	 * Jede Gruppe ist ein- und ausklappbar; Aufgaben ohne Projekt landen unter "Kein Projekt".
	 */
	private renderProjects(): HTMLElement {
		if (this.detailProject !== undefined) {
			return this.renderProjectDetail(this.detailProject);
		}

		const container = createDiv({ cls: "gtd-projects" });

		const openTasks = this.tasks.filter((t) => !t.done && t.laneId !== AGENDA_LANE_ID);
		const filtered = openTasks.filter((t) => this.matchesFilter(t));

		const byProject = new Map<string, GtdTask[]>();
		const noProject: GtdTask[] = [];
		for (const task of filtered) {
			if (task.project) {
				if (!byProject.has(task.project)) byProject.set(task.project, []);
				byProject.get(task.project)!.push(task);
			} else {
				noProject.push(task);
			}
		}

		// Gesamtzahl (offen + erledigt) je Projekt als Fortschrittsanzeige im Header.
		const totalByProject = new Map<string, number>();
		for (const task of this.tasks.filter((t) => t.laneId !== AGENDA_LANE_ID)) {
			const key = task.project ?? "__no_project__";
			totalByProject.set(key, (totalByProject.get(key) ?? 0) + 1);
		}

		const nextActionsLaneId = this.plugin.settings.lanes.find((l) => l.isNextActions)?.id;
		const projectsWithNextAction = new Set<string | null>();
		if (nextActionsLaneId) {
			for (const task of filtered) {
				if (task.laneId === nextActionsLaneId) {
					projectsWithNextAction.add(task.project ?? null);
				}
			}
		}

		const projectNames = Array.from(byProject.keys()).sort((a, b) => a.localeCompare(b, intlLocale()));

		if (projectNames.length === 0 && noProject.length === 0) {
			container.createDiv({ cls: "gtd-projects-empty", text: t("view.projects.empty") });
			return container;
		}

		for (const name of projectNames) {
			container.appendChild(
				this.renderProjectSection(name, this.sortTasks(byProject.get(name)!), totalByProject.get(name), !projectsWithNextAction.has(name))
			);
		}
		if (noProject.length > 0) {
			container.appendChild(
				this.renderProjectSection(null, this.sortTasks(noProject), totalByProject.get("__no_project__"), !projectsWithNextAction.has(null))
			);
		}

		return container;
	}

	private renderProjectSection(project: string | null, tasks: GtdTask[], totalCount?: number, missingNextAction = false): HTMLElement {
		const sectionKey = project ?? "__no_project__";
		const collapsed = this.plugin.settings.collapsedProjects.includes(sectionKey);

		const sectionEl = createDiv({ cls: "gtd-project-section" });
		if (collapsed) sectionEl.addClass("gtd-project-section-collapsed");

		const header = sectionEl.createDiv({ cls: "gtd-project-section-header" });

		const toggleBtn = header.createEl("button", { cls: "gtd-project-section-toggle" });
		toggleBtn.setText(collapsed ? "▸" : "▾");
		toggleBtn.setAttribute("aria-label", collapsed ? t("view.lane.expand") : t("view.lane.collapse"));
		toggleBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			void this.toggleProjectCollapsed(sectionKey);
		});

		const titleEl = header.createSpan({
			cls: "gtd-project-section-title",
			text: project ? `+${project}` : t("view.projects.noProject"),
		});
		if (project !== null) {
			titleEl.addClass("gtd-project-section-title-clickable");
			titleEl.addEventListener("click", (evt) => {
				evt.stopPropagation();
				this.detailProject = project;
				this.renderBoard();
			});
		}

		const openCount = tasks.length;
		const countText =
			totalCount !== undefined && totalCount > openCount
				? `${openCount}/${totalCount}`
				: String(openCount);
		header.createSpan({ cls: "gtd-project-section-count", text: countText });

		if (missingNextAction && project !== null) {
			const warningEl = header.createSpan({ cls: "gtd-project-no-next-action" });
			setIcon(warningEl, "alert-triangle");
			warningEl.setAttribute("title", t("view.projects.noNextAction"));
			warningEl.setAttribute("aria-label", t("view.projects.noNextAction"));
		}

		if (!collapsed) {
			const addBtn = header.createEl("button", { cls: "gtd-project-section-add", text: "+" });
			addBtn.setAttribute("aria-label", t("view.lane.add"));
			addBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				this.openCreateModalForProject(project);
			});

			const closeBtn = header.createEl("button", { cls: "gtd-project-section-close" });
			setIcon(closeBtn, "check-circle");
			closeBtn.setAttribute("aria-label", t("view.projects.close"));
			closeBtn.setAttribute("title", t("view.projects.close"));
			closeBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				void this.closeProject(project);
			});
		}

		if (!collapsed) {
			const body = sectionEl.createDiv({ cls: "gtd-project-section-body" });
			for (const task of tasks) {
				body.appendChild(this.renderCard(task, { showHomeLaneBadge: true }));
			}
		}

		return sectionEl;
	}

	/** Merkt sich den Eingeklappt-Status eines Projekts persistent und zeichnet das Board neu. */
	private async toggleProjectCollapsed(projectKey: string): Promise<void> {
		const collapsed = new Set(this.plugin.settings.collapsedProjects);
		if (collapsed.has(projectKey)) {
			collapsed.delete(projectKey);
		} else {
			collapsed.add(projectKey);
		}
		this.plugin.settings.collapsedProjects = Array.from(collapsed);
		await this.plugin.saveSettings();
		this.renderBoard();
	}

	/** Verschiebt alle offenen Aufgaben eines Projekts nach einer Bestaetigung in die Erledigt-Lane. */
	private async closeProject(project: string | null): Promise<void> {
		const doneLane = this.plugin.settings.lanes.find((l) => l.isDone);
		if (!doneLane) {
			new Notice(t("notice.noDoneLane"));
			return;
		}
		const openTasks = this.tasks.filter(
			(task) =>
				!task.done &&
				task.laneId !== AGENDA_LANE_ID &&
				(project !== null ? task.project === project : !task.project)
		);
		if (openTasks.length === 0) return;
		const projectLabel = project ?? t("view.projects.noProject");
		const confirmed = await confirmDialog(
			this.app,
			t("view.projects.confirmClose", { count: openTasks.length, project: projectLabel })
		);
		if (!confirmed) return;
		for (const task of openTasks) {
			if (task.source === "file") {
				await this.plugin.store.moveFileTask(task, doneLane.id);
			} else {
				await this.plugin.store.moveInlineTask(task, doneLane.id);
			}
		}
		if (this.detailProject !== undefined) {
			this.detailProject = undefined;
		}
		await this.refresh();
	}

	/** Oeffnet einen Erstellen-Dialog mit vorausgefuelltem Projekt (fuer "+" in der Projekteansicht). */
	private openCreateModalForProject(project: string | null): void {
		const defaultLaneId = this.plugin.store.defaultLaneId();
		this.openTaskEditor({
			mode: "create",
			laneId: defaultLaneId,
			initialProject: project ?? undefined,
			onSubmit: async (result) => {
				const targetLaneId =
					shouldPromoteFromInbox(
						defaultLaneId,
						result.due,
						this.plugin.settings.lanes,
						this.plugin.settings.autoPromoteInboxOnDueDate
					) ?? defaultLaneId;
				await this.plugin.store.createTaskFile({
					laneId: targetLaneId,
					title: result.title,
					description: result.description,
					priority: result.priority,
					contexts: result.contexts,
					tags: result.tags,
					recurrence: result.recurrence,
					delegatedTo: result.delegatedTo,
					project: result.project,
					due: result.due,
					reminderAt: result.reminderAt,
					visibleFrom: result.visibleFrom,
					revisitOn: result.revisitOn,
					targetFolder: result.projectFolder,
				});
				await this.refresh();
			},
		});
	}

	/** Detailansicht eines einzelnen Projekts: alle Aufgaben (offen + erledigt) mit Zurueck-Button. */
	private renderProjectDetail(project: string | null): HTMLElement {
		const container = createDiv({ cls: "gtd-project-detail" });

		const header = container.createDiv({ cls: "gtd-project-detail-header" });
		const backBtn = header.createEl("button", { cls: "gtd-project-detail-back" });
		setIcon(backBtn, "arrow-left");
		backBtn.createSpan({ text: t("view.projects.back") });
		backBtn.addEventListener("click", () => {
			this.detailProject = undefined;
			this.renderBoard();
		});
		header.createSpan({
			cls: "gtd-project-detail-title",
			text: project ? `+${project}` : t("view.projects.noProject"),
		});

		const closeBtn = header.createEl("button", { cls: "gtd-project-detail-close" });
		setIcon(closeBtn, "check-circle");
		closeBtn.setAttribute("aria-label", t("view.projects.close"));
		closeBtn.setAttribute("title", t("view.projects.close"));
		closeBtn.addEventListener("click", () => void this.closeProject(project));

		const tasks = this.tasks
			.filter((t) => t.laneId !== AGENDA_LANE_ID)
			.filter((t) => (project ? t.project === project : !t.project))
			.filter((t) => this.matchesFilter(t));
		const sorted = this.sortTasks(tasks);

		if (sorted.length === 0) {
			container.createDiv({ cls: "gtd-project-detail-empty", text: t("view.projects.empty") });
		} else {
			const body = container.createDiv({ cls: "gtd-project-detail-body" });
			for (const task of sorted) {
				body.appendChild(this.renderCard(task, { showHomeLaneBadge: true }));
			}
		}

		return container;
	}

	/** Kontexteansicht: alle offenen Aufgaben (ohne Agenda) gruppiert nach @Kontext. */
	private renderContexts(): HTMLElement {
		const container = createDiv({ cls: "gtd-contexts" });

		const openTasks = this.tasks.filter((t) => !t.done && t.laneId !== AGENDA_LANE_ID);
		const filtered = openTasks.filter((t) => this.matchesFilter(t));

		const byContext = new Map<string, GtdTask[]>();
		const noContext: GtdTask[] = [];
		for (const task of filtered) {
			if (task.contexts.length > 0) {
				for (const ctx of task.contexts) {
					if (!byContext.has(ctx)) byContext.set(ctx, []);
					byContext.get(ctx)!.push(task);
				}
			} else {
				noContext.push(task);
			}
		}

		const contextNames = Array.from(byContext.keys()).sort((a, b) => a.localeCompare(b, intlLocale()));

		if (contextNames.length === 0 && noContext.length === 0) {
			container.createDiv({ cls: "gtd-contexts-empty", text: t("view.contexts.empty") });
			return container;
		}

		for (const name of contextNames) {
			container.appendChild(this.renderContextSection(name, this.sortTasks(byContext.get(name)!)));
		}
		if (noContext.length > 0) {
			container.appendChild(this.renderContextSection(null, this.sortTasks(noContext)));
		}

		return container;
	}

	private renderContextSection(context: string | null, tasks: GtdTask[]): HTMLElement {
		const sectionKey = context ?? "__no_context__";
		const collapsed = this.plugin.settings.collapsedContexts.includes(sectionKey);

		const sectionEl = createDiv({ cls: "gtd-context-section" });
		if (collapsed) sectionEl.addClass("gtd-context-section-collapsed");

		const header = sectionEl.createDiv({ cls: "gtd-context-section-header" });

		const toggleBtn = header.createEl("button", { cls: "gtd-context-section-toggle" });
		toggleBtn.setText(collapsed ? "▸" : "▾");
		toggleBtn.setAttribute("aria-label", collapsed ? t("view.lane.expand") : t("view.lane.collapse"));
		toggleBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			void this.toggleContextCollapsed(sectionKey);
		});

		header.createSpan({
			cls: "gtd-context-section-title",
			text: context ? `@${context}` : t("view.contexts.noContext"),
		});
		header.createSpan({ cls: "gtd-context-section-count", text: String(tasks.length) });

		if (!collapsed) {
			const body = sectionEl.createDiv({ cls: "gtd-context-section-body" });
			for (const task of tasks) {
				body.appendChild(this.renderCard(task, { showHomeLaneBadge: true }));
			}
		}

		return sectionEl;
	}

	private async toggleContextCollapsed(contextKey: string): Promise<void> {
		const collapsed = new Set(this.plugin.settings.collapsedContexts);
		if (collapsed.has(contextKey)) {
			collapsed.delete(contextKey);
		} else {
			collapsed.add(contextKey);
		}
		this.plugin.settings.collapsedContexts = Array.from(collapsed);
		await this.plugin.saveSettings();
		this.renderBoard();
	}

	private matchesFilter(task: GtdTask): boolean {
		if (this.contextFilter && !task.contexts.includes(this.contextFilter)) return false;
		if (this.projectFilter && task.project !== this.projectFilter) return false;
		if (this.personFilter && task.delegatedTo?.trim() !== this.personFilter) return false;
		if (this.originFilter && task.origin?.kind.toLowerCase() !== this.originFilter) return false;
		if (this.originLabelFilter && task.origin?.label?.trim() !== this.originLabelFilter) return false;
		if (!this.filterText) return true;
		if (task.title.toLowerCase().includes(this.filterText)) return true;
		return task.tags.some((t) => t.toLowerCase().includes(this.filterText));
	}

	private sortTasks(tasks: GtdTask[]): GtdTask[] {
		const mode = this.plugin.settings.sortMode;
		const copy = [...tasks];
		if (mode === "priority") {
			copy.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.order - b.order);
		} else if (mode === "due") {
			copy.sort((a, b) => this.compareByDueAscending(a, b));
		} else if (mode === "title") {
			copy.sort((a, b) => a.title.localeCompare(b.title, intlLocale()));
		} else if (mode === "project") {
			// Aufgaben ohne Projekt sortieren ans Ende; innerhalb desselben Projekts nach order.
			copy.sort((a, b) => {
				const ap = a.project ?? "￿";
				const bp = b.project ?? "￿";
				return ap.localeCompare(bp, intlLocale()) || a.order - b.order;
			});
			return copy;
		} else {
			copy.sort((a, b) => a.order - b.order);
		}
		// In jeder Lane sollen geplante (mit Faelligkeit) vor ungeplanten Aufgaben stehen -
		// unabhaengig vom gewaehlten Sortier-Modus. Array.sort ist stabil, daher bleibt die
		// oben ermittelte Reihenfolge innerhalb der beiden Gruppen (geplant/ungeplant) erhalten;
		// diese Gruppierung zieht die Aufgaben mit Faelligkeit lediglich nach vorne.
		copy.sort((a, b) => Number(!a.due) - Number(!b.due));
		return copy;
	}

	private compareByDueAscending(a: GtdTask, b: GtdTask): number {
		const ad = parseLocalDateTime(a.due)?.getTime() ?? Number.POSITIVE_INFINITY;
		const bd = parseLocalDateTime(b.due)?.getTime() ?? Number.POSITIVE_INFINITY;
		return ad - bd;
	}

	/** Aufgaben fuer die "Geplant"-Uebersichts-Lane: alle nicht erledigten Aufgaben mit Faelligkeit, aufsteigend sortiert. */
	private sortByDueAscending(tasks: GtdTask[]): GtdTask[] {
		return [...tasks].sort((a, b) => this.compareByDueAscending(a, b));
	}

	/** Rendert die dedizierte Agendas-Lane: eine Karte je Person mit ihren offenen Themen. */
	private renderAgendaLane(): HTMLElement {
		const collapsed = this.plugin.settings.collapsedLanes.includes(AGENDA_LANE_ID);
		const laneColor = "#5ac8fa";

		const laneEl = createDiv({ cls: "gtd-lane gtd-lane-agenda" });
		if (collapsed) laneEl.addClass("gtd-lane-collapsed");
		laneEl.setCssProps({ "--lane-color": laneColor });

		laneEl.addEventListener("dragover", (evt) => {
			evt.preventDefault();
			laneEl.addClass("gtd-lane-dragover");
		});
		laneEl.addEventListener("dragleave", () => laneEl.removeClass("gtd-lane-dragover"));
		laneEl.addEventListener("drop", (evt) => {
			evt.preventDefault();
			laneEl.removeClass("gtd-lane-dragover");
			// Agenda-Lane nimmt keine regulaeren Aufgaben per Drag & Drop an.
		});

		const header = laneEl.createDiv({ cls: "gtd-lane-header" });

		const toggleBtn = header.createEl("button", { cls: "gtd-lane-toggle" });
		toggleBtn.setText(collapsed ? "▸" : "▾");
		toggleBtn.setAttribute("aria-label", collapsed ? t("view.lane.expand") : t("view.lane.collapse"));
		toggleBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			void this.toggleLaneCollapsed(AGENDA_LANE_ID);
		});

		header.createSpan({ cls: "gtd-lane-dot" });
		header.createSpan({ cls: "gtd-lane-title", text: t("view.agendaLane.name") });

		const agendaItemsAll = this.tasks.filter((t) => t.laneId === AGENDA_LANE_ID && !t.done);
		const agendaItemsFiltered = agendaItemsAll.filter((t) => this.matchesFilter(t));
		header.createSpan({ cls: "gtd-lane-count", text: String(agendaItemsAll.length) });

		if (!collapsed) {
			const addBtn = header.createEl("button", { cls: "gtd-lane-add", text: "+" });
			addBtn.setAttribute("aria-label", t("view.agendaLane.add"));
			addBtn.addEventListener("click", () => this.openCreateAgendaModal());
		}

		if (!collapsed) {
			const body = laneEl.createDiv({ cls: "gtd-lane-body" });

			if (agendaItemsFiltered.length === 0) {
				body.createDiv({ cls: "gtd-agenda-lane-empty", text: t("view.agendaLane.empty") });
			} else {
				const sorted = this.sortByDueAscending(agendaItemsFiltered);

				// Eine Karte je Person mit ihren offenen Themen (Gross-/Kleinschreibung zaehlt nicht doppelt).
				const byPerson = new Map<string, { name: string; items: GtdTask[] }>();
				const noPerson: GtdTask[] = [];
				for (const item of sorted) {
					const name = item.person?.trim();
					if (!name) {
						noPerson.push(item);
						continue;
					}
					const key = name.toLowerCase();
					const group = byPerson.get(key) ?? { name, items: [] };
					group.items.push(item);
					byPerson.set(key, group);
				}

				const groups = Array.from(byPerson.values()).sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
				for (const group of groups) body.appendChild(this.renderAgendaPersonCard(group.name, group.items));

				if (noPerson.length > 0) {
					const group = body.createDiv({ cls: "gtd-agenda-person-group" });
					for (const item of noPerson) {
						group.appendChild(this.renderCard(item, {}));
					}
				}
			}
		}

		return laneEl;
	}

	/**
	 * Karte einer Person in der Agendas-Lane: Name mit Zahl der offenen Themen, darunter die
	 * Themen als abhakbare Liste. Klick auf Name oder Thema oeffnet "Besprechen mit".
	 */
	private renderAgendaPersonCard(person: string, items: GtdTask[]): HTMLElement {
		const card = createDiv({ cls: "gtd-card gtd-agenda-person-card" });
		card.setAttribute("title", t("view.person.openView"));
		card.addEventListener("click", () => this.openTalk(person));

		const header = card.createDiv({ cls: "gtd-agenda-person-card-header" });
		const icon = header.createSpan({ cls: "gtd-agenda-person-card-icon" });
		setIcon(icon, "user");
		header.createSpan({ cls: "gtd-agenda-person-card-name", text: person });
		header.createSpan({ cls: "gtd-lane-count", text: String(items.length) });

		const list = card.createDiv({ cls: "gtd-agenda-person-card-topics" });
		for (const item of items) {
			const row = list.createDiv({ cls: "gtd-agenda-person-card-topic" });
			const checkbox = row.createEl("input", {
				cls: "gtd-card-done-checkbox",
				attr: { type: "checkbox", title: t("view.person.markDiscussed") },
			});
			checkbox.addEventListener("click", (evt) => evt.stopPropagation());
			checkbox.addEventListener("change", () => void this.toggleTaskDone(item));
			row.createSpan({ cls: "gtd-agenda-person-card-title", text: item.title });
			const notes = item.description.split("\n").filter((l) => l.trim().length > 0).length;
			if (notes > 0) {
				const noteEl = row.createSpan({
					cls: "gtd-agenda-person-card-notes",
					attr: { title: t("view.person.notesCount", { count: notes }) },
				});
				setIcon(noteEl, "message-square");
				noteEl.createSpan({ text: String(notes) });
			}
			if (item.due) {
				const dueEl = row.createSpan({ cls: "gtd-card-due", text: this.shortDue(item.due) });
				const urgency = dueUrgency(item.due);
				if (urgency) dueEl.addClass(`gtd-card-due-${urgency}`);
			}
		}
		return card;
	}

	private renderLane(lane: LaneConfig): HTMLElement {
		const collapsed = this.plugin.settings.collapsedLanes.includes(lane.id);

		const laneEl = createDiv({ cls: "gtd-lane" });
		if (collapsed) laneEl.addClass("gtd-lane-collapsed");
		if (lane.isPlanned) laneEl.addClass("gtd-lane-planned");
		laneEl.setCssProps({ "--lane-color": lane.color });

		// Drop-Ziel ist der gesamte Lane-Container, damit auch eine eingeklappte
		// Lane (z.B. "Erledigt") weiterhin Karten per Drag & Drop annehmen kann.
		// Die "Geplant"-Uebersichts-Lane ist kein echtes Ziel: Aufgaben landen dort
		// automatisch ueber ihre Faelligkeit, nicht per Drag & Drop.
		if (!lane.isPlanned) {
			laneEl.addEventListener("dragover", (evt) => {
				evt.preventDefault();
				laneEl.addClass("gtd-lane-dragover");
			});
			laneEl.addEventListener("dragleave", () => laneEl.removeClass("gtd-lane-dragover"));
			laneEl.addEventListener("drop", (evt) => {
				evt.preventDefault();
				laneEl.removeClass("gtd-lane-dragover");
				if (this.draggedTaskId) {
					void this.handleDrop(this.draggedTaskId, lane.id);
					this.draggedTaskId = null;
				}
			});
		}

		const header = laneEl.createDiv({ cls: "gtd-lane-header" });

		const toggleBtn = header.createEl("button", { cls: "gtd-lane-toggle" });
		toggleBtn.setText(collapsed ? "▸" : "▾");
		toggleBtn.setAttribute("aria-label", collapsed ? t("view.lane.expand") : t("view.lane.collapse"));
		toggleBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			void this.toggleLaneCollapsed(lane.id);
		});

		header.createSpan({ cls: "gtd-lane-dot" });
		header.createSpan({ cls: "gtd-lane-title", text: lane.name });

		const laneTasksAll = lane.isPlanned
			? this.tasks.filter((t) => !t.done && !!t.due)
			: this.tasks.filter((t) => t.laneId !== AGENDA_LANE_ID && this.displayLaneId(t) === lane.id);
		const laneTasksFiltered = laneTasksAll.filter((t) => this.matchesFilter(t));
		const laneTasksVisible = lane.isPlanned
			? this.sortByDueAscending(laneTasksFiltered)
			: this.sortTasks(laneTasksFiltered);

		const overLimit = !!lane.wipLimit && laneTasksAll.length > lane.wipLimit;
		const countText = lane.wipLimit ? `${laneTasksAll.length}/${lane.wipLimit}` : String(laneTasksAll.length);
		const countEl = header.createSpan({ cls: "gtd-lane-count", text: countText });
		if (overLimit) {
			countEl.addClass("gtd-lane-count-over");
			countEl.setAttribute("aria-label", t("view.lane.wipLimitExceeded"));
		}

		if (!collapsed && !lane.isPlanned) {
			const addBtn = header.createEl("button", { cls: "gtd-lane-add", text: "+" });
			addBtn.setAttribute("aria-label", t("view.lane.add"));
			addBtn.addEventListener("click", () => this.openCreateModal(lane.id));
		}

		if (!collapsed) {
			const body = laneEl.createDiv({ cls: "gtd-lane-body" });
			for (const task of laneTasksVisible) {
				// Drop-auf-Karte-Reihenfolge ergibt nur in echten (nicht-virtuellen) Lanes Sinn -
				// die "Geplant"-Uebersicht zeigt Aufgaben ausserhalb ihrer eigentlichen Lane an.
				body.appendChild(
					this.renderCard(task, { showHomeLaneBadge: lane.isPlanned, enableReorder: !lane.isPlanned })
				);
			}
		}

		return laneEl;
	}

	/** Merkt sich den Eingeklappt-Status einer Lane persistent und zeichnet das Board neu. */
	private async toggleLaneCollapsed(laneId: string): Promise<void> {
		const collapsed = new Set(this.plugin.settings.collapsedLanes);
		if (collapsed.has(laneId)) {
			collapsed.delete(laneId);
		} else {
			collapsed.add(laneId);
		}
		this.plugin.settings.collapsedLanes = Array.from(collapsed);
		await this.plugin.saveSettings();
		this.renderBoard();
	}

	private renderCard(
		task: GtdTask,
		options: { showHomeLaneBadge?: boolean; enableReorder?: boolean; showPersonBadge?: boolean } = {}
	): HTMLElement {
		const card = createDiv({ cls: ["gtd-card", `gtd-card-priority-${task.priority ?? "medium"}`] });
		if (task.source === "inline") card.addClass("gtd-card-inline");
		card.setAttribute("draggable", "true");

		card.addEventListener("dragstart", (evt) => {
			this.draggedTaskId = task.id;
			evt.dataTransfer?.setData("text/plain", task.id);
		});
		card.addEventListener("dragend", () => {
			this.draggedTaskId = null;
		});

		// Drop direkt auf einer Karte (statt auf den leeren Lane-Hintergrund) reiht die gezogene
		// Aufgabe an dieser Position ein - sowohl innerhalb derselben Lane als auch ueber Lanes
		// hinweg (Lane-Wechsel + Positionierung in einem Zug). stopPropagation() verhindert, dass
		// zusaetzlich der Drop-Handler der Lane feuert und die Aufgabe doppelt verschoben wird.
		if (options.enableReorder) {
			card.addEventListener("dragover", (evt) => {
				if (!this.draggedTaskId || this.draggedTaskId === task.id) return;
				evt.preventDefault();
				evt.stopPropagation();
				const rect = card.getBoundingClientRect();
				const isAbove = evt.clientY < rect.top + rect.height / 2;
				card.toggleClass("gtd-card-drop-above", isAbove);
				card.toggleClass("gtd-card-drop-below", !isAbove);
			});
			card.addEventListener("dragleave", () => {
				card.removeClass("gtd-card-drop-above");
				card.removeClass("gtd-card-drop-below");
			});
			card.addEventListener("drop", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				card.removeClass("gtd-card-drop-above");
				card.removeClass("gtd-card-drop-below");
				const draggedId = this.draggedTaskId;
				this.draggedTaskId = null;
				if (!draggedId || draggedId === task.id) return;
				const rect = card.getBoundingClientRect();
				const position: "before" | "after" = evt.clientY < rect.top + rect.height / 2 ? "before" : "after";
				void this.handleCardDrop(draggedId, task, position);
			});
		}

		if (this.selectionMode) {
			card.addClass("gtd-card-selectable");
			const selected = this.selectedTaskIds.has(task.id);
			if (selected) card.addClass("gtd-card-selected");
			const checkbox = card.createEl("input", {
				cls: "gtd-card-select-checkbox",
				attr: { type: "checkbox" },
			});
			checkbox.checked = selected;
			checkbox.addEventListener("click", (evt) => evt.stopPropagation());
			checkbox.addEventListener("change", () => {
				this.setTaskSelected(task.id, checkbox.checked);
				card.toggleClass("gtd-card-selected", checkbox.checked);
			});
		}

		const titleRow = card.createDiv({ cls: "gtd-card-title-row" });
		const doneCheckbox = titleRow.createEl("input", {
			cls: "gtd-card-done-checkbox",
			attr: { type: "checkbox", title: t("view.card.doneCheckboxTitle") },
		});
		doneCheckbox.checked = task.done;
		// Verhindert, dass ein Klick auf den Haken zusaetzlich den Bearbeiten-Dialog oeffnet
		// oder (im Mehrfachauswahl-Modus) die Karte markiert.
		doneCheckbox.addEventListener("click", (evt) => evt.stopPropagation());
		doneCheckbox.addEventListener("change", () => {
			void this.toggleTaskDone(task);
		});
		if (task.priority && task.priority !== "medium") {
			titleRow.createSpan({
				cls: `gtd-card-priority-icon gtd-card-priority-icon-${task.priority}`,
				text: task.priority === "high" ? "🔺" : "🔽",
				attr: {
					"aria-label": t("view.card.priorityTitle", { priority: priorityLabel(task.priority) }),
					title: priorityLabel(task.priority),
				},
			});
		}
		const titleSpan = titleRow.createSpan({ cls: "gtd-card-title", text: task.title });
		if (task.source === "file") {
			titleSpan.addEventListener("click", (evt) => {
				evt.stopPropagation();
				this.startInlineTitleEdit(titleSpan, task);
			});
		}
		if (task.source === "inline") {
			titleRow.createSpan({ cls: "gtd-card-badge", text: t("view.card.inlineBadge") });
		}

		const inboxLaneId = this.plugin.settings.lanes.find((l) => l.isInbox)?.id;
		if (inboxLaneId && task.laneId === inboxLaneId && !task.done) {
			const processBtn = titleRow.createEl("button", {
				cls: "gtd-card-process-btn",
				attr: { title: t("view.card.processTitle"), "aria-label": t("view.card.processTitle") },
			});
			setIcon(processBtn, "arrow-right-circle");
			processBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				new ProcessModal(this.app, this.plugin, task, () => this.refresh()).open();
			});
		}

		// Eine Meta-Zeile fuer Faelligkeit und alle Badges, statt je einer eigenen Zeile.
		const metaEl = card.createDiv({ cls: "gtd-card-meta gtd-card-tags" });
		if (task.due) {
			const dueEl = metaEl.createSpan({ cls: "gtd-card-due" });
			const fullDue = task.due.replace("T", " ");
			dueEl.setAttribute("title", task.source === "file" ? `${fullDue} · ${t("view.card.editDueTitle")}` : fullDue);
			if (task.source === "file") dueEl.addClass("gtd-card-due-editable");
			const dueIcon = dueEl.createSpan({ cls: "gtd-card-due-icon" });
			setIcon(dueIcon, "calendar");
			dueEl.createSpan({ text: this.shortDue(task.due) });
			if (!task.done) {
				const urgency = dueUrgency(task.due);
				if (urgency) dueEl.addClass(`gtd-card-due-${urgency}`);
			}
			if (task.recurrence) {
				dueEl.createSpan({
					cls: "gtd-card-recurrence",
					text: `🔁 ${recurrenceLabel(task.recurrence)}`,
					attr: { title: t("view.card.recurrenceTitle") },
				});
			}
			if (task.source === "file") {
				dueEl.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.startInlineDueEdit(dueEl, task);
				});
			}
		}

		if (task.revisitOn && !task.done) {
			const revisitEl = card.createDiv({
				cls: "gtd-card-revisit",
				text: t("view.card.revisitOnBadge", { date: task.revisitOn }),
			});
			revisitEl.setAttribute("title", t("view.card.revisitOnBadge", { date: task.revisitOn }));
		}

		const subtasks = countSubtasks(task.description);
		if (subtasks) {
			const isExpanded = this.expandedSubtasks.has(task.id);
			const subtasksEl = card.createDiv({ cls: "gtd-card-subtasks" });

			const headerRow = subtasksEl.createDiv({
				cls: "gtd-card-subtasks-header",
				attr: { title: t("view.card.subtasksToggleTitle") },
			});
			headerRow.createSpan({
				cls: "gtd-card-subtasks-label",
				text: `☑ ${subtasks.done}/${subtasks.total}`,
			});
			// Naechstes Datum einer offenen Unteraufgabe auch im eingeklappten Zustand zeigen.
			const nextSubtaskDay = earliestOpenSubtaskDay(task.description);
			if (nextSubtaskDay && !task.done) {
				const nextEl = headerRow.createSpan({
					cls: "gtd-card-subtasks-next",
					text: this.shortDue(nextSubtaskDay),
					attr: { title: t("view.card.subtaskNextDueTitle") },
				});
				const urgency = dueUrgency(nextSubtaskDay);
				if (urgency) nextEl.addClass(`gtd-card-due-${urgency}`);
			}
			const bar = headerRow.createDiv({ cls: "gtd-card-subtasks-bar" });
			const fill = bar.createDiv({ cls: "gtd-card-subtasks-bar-fill" });
			const percent = subtasks.total > 0 ? Math.round((subtasks.done / subtasks.total) * 100) : 0;
			fill.setCssStyles({ width: `${percent}%` });
			const chevron = headerRow.createSpan({ cls: "gtd-card-subtasks-chevron" });
			setIcon(chevron, isExpanded ? "chevron-down" : "chevron-right");

			const listEl = subtasksEl.createDiv({ cls: "gtd-card-subtasks-list" });
			if (!isExpanded) listEl.setCssStyles({ display: "none" });

			parseSubtaskItems(task.description).forEach((item, idx) => {
				const row = listEl.createDiv({ cls: "gtd-card-subtask-row" });
				if (item.done) row.addClass("gtd-card-subtask-done");
				const cb = row.createEl("input", { attr: { type: "checkbox" } });
				cb.checked = item.done;
				row.createSpan({ cls: "gtd-card-subtask-text", text: item.text });
				if (item.due) {
					// Eigenes Datum der Unteraufgabe, mit derselben Dringlichkeitsfarbe wie die Karte.
					const dueEl = row.createSpan({ cls: "gtd-card-subtask-due", text: this.shortDue(item.due) });
					const urgency = item.done ? undefined : dueUrgency(item.due);
					if (urgency) dueEl.addClass(`gtd-card-due-${urgency}`);
				}
				cb.addEventListener("click", (evt) => evt.stopPropagation());
				if (task.source === "file") {
					cb.addEventListener("change", () => {
						const checked = cb.checked;
						let count = 0;
						const newDesc = (task.description ?? "").split(/\r?\n/).map((line) => {
							if (/^\s*[-*+]\s*\[[ xX]\]/.test(line)) {
								if (count++ === idx) return line.replace(/\[[ xX]\]/, checked ? "[x]" : "[ ]");
							}
							return line;
						}).join("\n");
						void this.plugin.store.patchFileTaskBody(task, newDesc)
							.then(() => void this.plugin.refreshBoardViews());
					});
				} else {
					cb.disabled = true;
				}
			});

			headerRow.addEventListener("click", (evt) => {
				evt.stopPropagation();
				if (this.expandedSubtasks.has(task.id)) {
					this.expandedSubtasks.delete(task.id);
					listEl.setCssStyles({ display: "none" });
					setIcon(chevron, "chevron-right");
				} else {
					this.expandedSubtasks.add(task.id);
					listEl.setCssStyles({ display: "" });
					setIcon(chevron, "chevron-down");
				}
			});
		}

		// Tatsaechliche Lane unabhaengig davon, ob sie als Badge gezeigt wird - wird fuer die
		// Someday/Maybe-Auffrischung gebraucht, auch im normalen Kanban.
		const agendaVirtualLane: LaneConfig = {
			id: AGENDA_LANE_ID,
			name: t("view.agendaLane.name"),
			color: "#5ac8fa",
			tag: "",
		};
		const actualLane =
			task.laneId === AGENDA_LANE_ID
				? agendaVirtualLane
				: this.plugin.settings.lanes.find((l) => l.id === this.displayLaneId(task));
		// In der "Geplant"-Uebersichts-Lane, der Agenda- und der Wochenansicht zusaetzlich die
		// eigentliche Lane der Aufgabe zeigen, da die Karte dort ausserhalb ihrer Lane dargestellt
		// wird - dezent wie ein Tag statt als auffaelliges Badge, um die Karte nicht zu dominieren.
		const homeLane = options.showHomeLaneBadge ? actualLane : undefined;

		// Person-Badge: standardmaessig anzeigen (showPersonBadge !== false), es sei denn,
		// die Person steht bereits als Gruppenüberschrift ueber der Karte (Agendas-Lane).
		const showPerson = task.person && options.showPersonBadge !== false;

		// Auffrischungs-Markierungen: "Wartet auf" ohne Regung seit X Tagen (Follow-up-Nudge) bzw.
		// "Irgendwann/Vielleicht" ohne Review seit X Tagen - beides GTD-Kernpraxis (Tickler/Review),
		// rein visuell ueber die im Wochenrueckblick gepflegte lastTouched-Zeit.
		const daysTouched = daysSince(task.lastTouched);
		const isStaleDelegate =
			!!task.delegatedTo && !task.done && daysTouched >= this.plugin.settings.delegateFollowUpDays;
		const isStaleSomeday =
			!!actualLane?.isSomeday && !task.done && daysTouched >= this.plugin.settings.somedayRefreshDays;
		if (isStaleDelegate) card.addClass("gtd-card-stale");
		if (isStaleSomeday) card.addClass("gtd-card-stale");

		const isMarkedToday = !task.done && task.today === formatLocalDate(new Date());

		if (
			isMarkedToday ||
			task.origin ||
			task.contexts.length > 0 ||
			task.tags.length > 0 ||
			task.delegatedTo ||
			task.project ||
			homeLane ||
			isStaleSomeday ||
			showPerson
		) {
			const tagsEl = metaEl;
			if (isMarkedToday) {
				tagsEl.createSpan({
					cls: "gtd-card-tag gtd-card-tag-today",
					text: t("view.card.todayBadge"),
					attr: { title: t("view.card.todayBadgeTitle") },
				});
			}
			if (task.origin) this.renderOriginBadge(tagsEl, task);
			if (showPerson) {
				tagsEl.createSpan({
					cls: "gtd-card-tag gtd-card-tag-person",
					text: `👤 ${task.person}`,
					attr: {
						title: t("view.card.agendaPersonTitle", { name: task.person! }),
					},
				});
			}
			if (homeLane) {
				const laneTag = tagsEl.createSpan({ cls: "gtd-card-tag gtd-card-tag-lane", text: homeLane.name });
				laneTag.setCssProps({ "--home-lane-color": homeLane.color });
			}
			if (task.project) {
				tagsEl.createSpan({ cls: "gtd-card-tag gtd-card-tag-project", text: `+${task.project}` });
			}
			if (task.delegatedTo) {
				tagsEl.createSpan({
					cls: `gtd-card-tag gtd-card-tag-delegate${isStaleDelegate ? " gtd-card-tag-stale" : ""}`,
					text: isStaleDelegate
						? t("view.card.staleDelegateText", { name: task.delegatedTo, days: daysTouched })
						: `👤 ${task.delegatedTo}`,
					attr: {
						title: isStaleDelegate
							? t("view.card.staleDelegateTitle", { days: daysTouched, name: task.delegatedTo })
							: t("view.card.delegatedToTitle", { name: task.delegatedTo }),
					},
				});
			}
			if (isStaleSomeday) {
				tagsEl.createSpan({
					cls: "gtd-card-tag gtd-card-tag-stale",
					text: t("view.card.staleSomedayText", { days: daysTouched }),
					attr: {
						title: t("view.card.staleSomedayTitle"),
					},
				});
			}
			for (const ctx of task.contexts) {
				tagsEl.createSpan({ cls: "gtd-card-context", text: `@${ctx}` });
			}
			for (const tag of task.tags) {
				tagsEl.createSpan({ cls: "gtd-card-tag", text: `#${tag}` });
			}
		}

		// Meta-Zeile ohne Faelligkeit und Badges entfaellt.
		if (metaEl.childElementCount === 0) metaEl.remove();

		card.addEventListener("click", () => {
			if (this.selectionMode) {
				const nextSelected = !this.selectedTaskIds.has(task.id);
				this.setTaskSelected(task.id, nextSelected);
				card.toggleClass("gtd-card-selected", nextSelected);
				const checkbox = card.querySelector<HTMLInputElement>(".gtd-card-select-checkbox");
				if (checkbox) checkbox.checked = nextSelected;
				return;
			}
			this.openEditModal(task);
		});
		card.addEventListener("contextmenu", (evt) => this.openContextMenu(evt, task));

		return card;
	}

	/**
	 * Herkunfts-Badge (Planner, Meeting, ...): zeigt sourceLabel bzw. die Art der Quelle. Mit
	 * sicherem sourceUrl oeffnet ein Klick die Quelle, statt den Bearbeiten-Dialog.
	 */
	/** Kurze Faelligkeit fuer Karten ("Heute", "Sa., 31.01.", mit Uhrzeit). */
	private shortDue(due: string): string {
		return formatShortDue(due, intlLocale(), {
			today: t("quick.note.today"),
			tomorrow: t("quick.note.tomorrow"),
			yesterday: t("quick.note.yesterday"),
		});
	}

	private renderOriginBadge(container: HTMLElement, task: GtdTask): void {
		const origin = task.origin;
		if (!origin) return;
		const kindLabel = originKindLabel(origin.kind);
		const name = origin.label ? `${kindLabel}: ${origin.label}` : kindLabel;
		const badge = container.createSpan({
			cls: `gtd-card-tag gtd-card-tag-origin gtd-card-tag-origin-${origin.kind.toLowerCase().replace(/[^a-z0-9-]/g, "")}`,
		});
		const icon = badge.createSpan({ cls: "gtd-card-tag-origin-icon" });
		setIcon(icon, origin.kind.toLowerCase() === "planner" ? "clipboard-list" : origin.kind.toLowerCase() === "meeting" ? "calendar-clock" : "link");
		badge.createSpan({ text: origin.label ?? kindLabel });
		if (origin.url) {
			const url = origin.url;
			badge.addClass("gtd-card-tag-origin-link");
			badge.setAttribute("title", t("view.card.originLinkTitle", { source: name }));
			badge.addEventListener("click", (evt) => {
				evt.stopPropagation();
				window.open(url);
			});
		} else if (origin.note) {
			const note = origin.note;
			badge.addClass("gtd-card-tag-origin-link");
			badge.setAttribute("title", t("view.card.originLinkTitle", { source: name }));
			badge.addEventListener("click", (evt) => {
				evt.stopPropagation();
				void this.app.workspace.openLinkText(note, task.filePath, "tab");
			});
		} else {
			badge.setAttribute("title", t("view.card.originTitle", { source: name }));
		}
	}

	private startInlineTitleEdit(span: HTMLElement, task: GtdTask): void {
		const original = task.title;
		const input = document.createElement("input");
		input.type = "text";
		input.value = original;
		input.className = "gtd-card-title-input";
		span.replaceWith(input);
		input.focus();
		input.select();

		let committed = false;
		const commit = async () => {
			if (committed) return;
			committed = true;
			const newTitle = input.value.trim();
			if (newTitle && newTitle !== original) {
				await this.plugin.store.updateTaskFile(task, {
					title: newTitle,
					description: task.description,
					due: task.due,
					reminderAt: task.reminderAt,
					priority: task.priority,
					recurrence: task.recurrence,
					contexts: task.contexts,
					tags: task.tags,
					delegatedTo: task.delegatedTo,
					project: task.project,
					person: task.person,
				});
				await this.refresh();
			} else {
				const restored = createSpan({ cls: "gtd-card-title", text: original });
				restored.addEventListener("click", (evt) => { evt.stopPropagation(); this.startInlineTitleEdit(restored, task); });
				input.replaceWith(restored);
			}
		};
		input.addEventListener("blur", () => void commit());
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") { evt.preventDefault(); void commit(); }
			if (evt.key === "Escape") {
				committed = true;
				const restored = createSpan({ cls: "gtd-card-title", text: original });
				restored.addEventListener("click", (e) => { e.stopPropagation(); this.startInlineTitleEdit(restored, task); });
				input.replaceWith(restored);
			}
		});
	}

	private startInlineDueEdit(dueEl: HTMLElement, task: GtdTask): void {
		const originalDue = task.due?.slice(0, 10) ?? "";
		const input = document.createElement("input");
		input.type = "date";
		input.value = originalDue;
		input.className = "gtd-card-due-input";
		dueEl.empty();
		dueEl.appendChild(input);
		input.focus();
		input.showPicker?.();

		let committed = false;
		const commit = async () => {
			if (committed) return;
			committed = true;
			const newDue = input.value;
			if (newDue !== originalDue) {
				await this.plugin.store.patchFileTaskDue(task, newDue || undefined);
			}
			await this.refresh();
		};
		input.addEventListener("change", () => void commit());
		input.addEventListener("blur", () => void commit());
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Escape") { committed = true; void this.refresh(); }
		});
	}

	private openContextMenu(evt: MouseEvent, task: GtdTask): void {
		evt.preventDefault();
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t("view.contextMenu.edit"))
				.setIcon("pencil")
				.onClick(() => this.openEditModal(task))
		);
		if (task.source === "file") {
			menu.addItem((item) =>
				item
					.setTitle(t("view.contextMenu.openFile"))
					.setIcon("file-text")
					.onClick(() => this.openTaskFile(task))
			);
		}
		if (!task.done) {
			const todayStr = formatLocalDate(new Date());
			const marked = task.today === todayStr;
			menu.addItem((item) =>
				item
					.setTitle(marked ? t("view.contextMenu.unmarkToday") : t("view.contextMenu.markToday"))
					.setIcon(marked ? "circle-off" : "target")
					.onClick(() => void this.toggleTodayMark(task))
			);
		}
		menu.addItem((item) =>
			item
				.setTitle(t("view.contextMenu.delete"))
				.setIcon("trash")
				.onClick(() => void this.deleteTask(task))
		);
		menu.showAtMouseEvent(evt);
	}

	/** Setzt oder entfernt die Heute-Markierung (Datum von heute) und zeichnet das Board neu. */
	private async toggleTodayMark(task: GtdTask): Promise<void> {
		const todayStr = formatLocalDate(new Date());
		await this.plugin.store.setTodayMark(task, task.today === todayStr ? undefined : todayStr);
		await this.refresh();
	}

	/** Lane, in der eine Aufgabe tatsaechlich angezeigt wird: erledigte Aufgaben immer in der Erledigt-Lane. */
	private displayLaneId(task: GtdTask): string {
		const doneLaneId = this.plugin.settings.lanes.find((l) => l.isDone)?.id;
		return task.done && doneLaneId ? doneLaneId : task.laneId;
	}

	private async handleDrop(taskId: string, newLaneId: string): Promise<void> {
		const task = this.tasks.find((t) => t.id === taskId);
		if (!task || this.displayLaneId(task) === newLaneId) return;
		if (task.source === "file") {
			await this.plugin.store.moveFileTask(task, newLaneId);
		} else {
			await this.plugin.store.moveInlineTask(task, newLaneId);
		}
		await this.refresh();
	}

	/**
	 * Wird eine Karte auf einer anderen Karte (statt dem leeren Lane-Hintergrund) fallen gelassen,
	 * reiht das die gezogene Aufgabe an dieser Position in die Ziel-Lane ein - ggf. inklusive
	 * Lane-Wechsel in einem Zug. Eine Inline-Aufgabe wird dafuer zuerst in eine Datei-Aufgabe
	 * umgewandelt (nur bei dieser Interaktion - reines Ueberziehen auf den Lane-Hintergrund bleibt
	 * beim einfachen moveInlineTask), da nur Datei-Aufgaben einen persistierbaren order-Wert haben.
	 * Manuelles Umsortieren ergibt nur im manuellen Sortiermodus visuell Sinn, deshalb schaltet ein
	 * abgeschlossener Reorder-Drop automatisch dorthin um.
	 */
	private async handleCardDrop(draggedTaskId: string, targetTask: GtdTask, position: "before" | "after"): Promise<void> {
		const draggedTask = this.tasks.find((t) => t.id === draggedTaskId);
		if (!draggedTask || draggedTaskId === targetTask.id) return;
		const targetLaneId = this.displayLaneId(targetTask);

		// Wichtig: die aktuell SICHTBARE Reihenfolge der Lane muss ermittelt werden, BEVOR
		// (falls noetig) auf "Manuell" umgeschaltet wird - sonst wird die neue Position relativ
		// zu einer ganz anderen (order-basierten) Reihenfolge berechnet, als die, in der die
		// Karten dem Nutzer gerade tatsaechlich angezeigt wurden (z. B. bei aktiver
		// Prioritaets-Sortierung), und die Karte landet sichtbar an der falschen Stelle.
		const laneTasks = this.tasks.filter((t) => this.displayLaneId(t) === targetLaneId);
		const laneTasksSorted = this.sortTasks(laneTasks);
		const orderedIds = laneTasksSorted.map((t) => t.id);
		const newOrderedIds = reorderTaskIds(orderedIds, draggedTaskId, targetTask.id, position);

		if (this.plugin.settings.sortMode !== "manual") {
			this.plugin.settings.sortMode = "manual";
			if (this.sortSelectEl) this.sortSelectEl.value = "manual";
			await this.plugin.saveSettings();
		}

		if (draggedTask.source === "inline") {
			const newFile = await this.plugin.store.convertInlineToFile(
				draggedTask,
				{
					title: draggedTask.title,
					description: draggedTask.description,
					due: draggedTask.due,
					reminderAt: draggedTask.reminderAt,
					priority: draggedTask.priority,
					recurrence: draggedTask.recurrence,
					contexts: draggedTask.contexts,
					tags: draggedTask.tags,
					delegatedTo: draggedTask.delegatedTo,
					project: draggedTask.project,
				},
				targetLaneId
			);
			const newId = fileTaskId(newFile.path);
			const idsWithNewId = newOrderedIds.map((id) => (id === draggedTaskId ? newId : id));
			const convertedTask: GtdTask = {
				...draggedTask,
				id: newId,
				laneId: targetLaneId,
				filePath: newFile.path,
				source: "file",
			};
			await this.plugin.store.reorderFileTask(convertedTask, targetLaneId, idsWithNewId);
		} else {
			await this.plugin.store.reorderFileTask(draggedTask, targetLaneId, newOrderedIds);
		}
		await this.refresh();
	}

	/**
	 * Haken auf der Karte: markiert eine Aufgabe als erledigt (verschiebt sie in die
	 * "Erledigt"-Lane, inkl. Wiederholungs-Logik) bzw. holt sie beim erneuten Klick wieder
	 * in ihre Herkunfts-Lane zurueck. Nutzt dieselbe Verschiebe-Logik wie Drag & Drop.
	 */
	private async toggleTaskDone(task: GtdTask): Promise<void> {
		const doneLaneId = this.plugin.settings.lanes.find((l) => l.isDone)?.id;
		if (!doneLaneId) {
			new Notice(t("notice.noDoneLane"));
			await this.refresh();
			return;
		}
		const targetLaneId = task.done ? task.laneId : doneLaneId;
		await this.handleDrop(task.id, targetLaneId);
	}

	private openCreateModal(laneId: string): void {
		this.openTaskEditor({
			mode: "create",
			laneId,
			onSubmit: async (result) => {
				// Wird die Aufgabe direkt mit Faelligkeit in der Eingang-Lane angelegt, landet sie
				// gleich in der "Naechste Aktionen"-Lane statt erst dort hinein verschoben zu werden.
				const targetLaneId =
					shouldPromoteFromInbox(
						laneId,
						result.due,
						this.plugin.settings.lanes,
						this.plugin.settings.autoPromoteInboxOnDueDate
					) ?? laneId;
				await this.plugin.store.createTaskFile({
					laneId: targetLaneId,
					title: result.title,
					description: result.description,
					priority: result.priority,
					contexts: result.contexts,
					tags: result.tags,
					recurrence: result.recurrence,
					delegatedTo: result.delegatedTo,
					project: result.project,
					due: result.due,
					reminderAt: result.reminderAt,
					visibleFrom: result.visibleFrom,
					revisitOn: result.revisitOn,
					targetFolder: result.projectFolder,
				});
				await this.refresh();
			},
		});
	}

	private openCreateAgendaModal(): void {
		this.openTalk();
	}

	private openEditModal(task: GtdTask): void {
		const isAgendaItem = task.laneId === AGENDA_LANE_ID;
		// Agendapunkte in Personennotizen bzw. mit #gtd/agenda sind Zeilen einer Notiz: sie werden
		// im Modal "Besprechen mit" der Person gezeigt und bearbeitet (das Aufgaben-Formular wuerde
		// sie in eine Aufgaben-Datei umwandeln).
		if (isAgendaItem && task.source === "inline") {
			this.openTalk(task.person);
			return;
		}
		this.openTaskEditor({
			mode: "edit",
			laneId: task.laneId,
			task,
			showPersonField: isAgendaItem,
			titleOverride: isAgendaItem ? t("agendaModal.titleEdit") : undefined,
			onSubmit: async (result) => {
				const promotedLaneId = isAgendaItem
					? undefined
					: shouldPromoteFromInbox(
							task.laneId,
							result.due,
							this.plugin.settings.lanes,
							this.plugin.settings.autoPromoteInboxOnDueDate
					  );
				if (task.source === "file") {
					await this.plugin.store.updateTaskFile(task, result);
					if (promotedLaneId) {
						await this.plugin.store.moveFileTask(task, promotedLaneId);
					}
				} else {
					// Jede inhaltliche Aenderung an einer Inline-Aufgabe (Titel, Beschreibung,
					// Faelligkeit/Erinnerung, Prioritaet oder Tags) ueberfuehrt sie in eine eigene
					// Datei, da Inline-Zeilen weder Beschreibung noch Erinnerungszeit abbilden koennen.
					const changed =
						result.title !== task.title ||
						result.description.trim().length > 0 ||
						result.due !== task.due ||
						result.reminderAt !== undefined ||
						result.priority !== (task.priority ?? "medium") ||
						result.recurrence !== task.recurrence ||
						result.contexts.join(",") !== task.contexts.join(",") ||
						result.tags.join(",") !== task.tags.join(",") ||
						(result.delegatedTo ?? "") !== (task.delegatedTo ?? "") ||
						(result.project ?? "") !== (task.project ?? "");
					if (changed) {
						await this.plugin.store.convertInlineToFile(task, result, promotedLaneId);
					}
				}
				await this.refresh();
			},
		});
	}

	private async deleteTask(task: GtdTask): Promise<void> {
		await this.plugin.store.deleteTask(task);
		await this.refresh();
	}

	/** Merkt sich, ob eine Aufgabe in der Mehrfachauswahl markiert ist, und baut die Aktionsleiste neu. */
	private setTaskSelected(taskId: string, selected: boolean): void {
		if (selected) {
			this.selectedTaskIds.add(taskId);
		} else {
			this.selectedTaskIds.delete(taskId);
		}
		this.updateBulkBar();
	}

	/** Baut die Bulk-Aktionsleiste (Anzahl, Verschieben-Dropdown, Loeschen) je nach Auswahl neu auf. */
	private updateBulkBar(): void {
		this.bulkBarEl.empty();
		if (!this.selectionMode || this.selectedTaskIds.size === 0) {
			this.bulkBarEl.hide();
			return;
		}
		this.bulkBarEl.show();
		this.bulkBarEl.createSpan({
			cls: "gtd-bulk-bar-count",
			text: t("view.bulk.selectedCount", { count: this.selectedTaskIds.size }),
		});

		const moveGroup = this.bulkBarEl.createDiv({ cls: "gtd-toolbar-group gtd-toolbar-inline-icon" });
		this.createToolbarIcon(moveGroup, "move-right");
		const moveSelect = moveGroup.createEl("select");
		moveSelect.setAttribute("title", t("view.bulk.moveTitle"));
		moveSelect.createEl("option", { text: t("view.bulk.moveTo"), value: "" });
		for (const lane of this.plugin.settings.lanes) {
			if (lane.isPlanned) continue;
			moveSelect.createEl("option", { text: lane.name, value: lane.id });
		}
		moveSelect.addEventListener("change", () => {
			if (moveSelect.value) void this.bulkMove(moveSelect.value);
		});

		const deleteBtn = this.createIconButton(this.bulkBarEl, "trash", t("view.bulk.delete"), "mod-warning");
		deleteBtn.setAttribute("title", t("view.bulk.deleteTitle"));
		deleteBtn.addEventListener("click", () => void this.bulkDelete());

		const cancelBtn = this.createIconButton(this.bulkBarEl, "x", t("view.bulk.cancel"));
		cancelBtn.addEventListener("click", () => {
			this.selectedTaskIds.clear();
			this.renderBoard();
		});
	}

	/** Verschiebt alle ausgewaehlten Aufgaben gemeinsam in eine Ziel-Lane. */
	private async bulkMove(newLaneId: string): Promise<void> {
		const ids = Array.from(this.selectedTaskIds);
		for (const id of ids) {
			const task = this.tasks.find((t) => t.id === id);
			if (!task || this.displayLaneId(task) === newLaneId) continue;
			if (task.source === "file") {
				await this.plugin.store.moveFileTask(task, newLaneId);
			} else {
				await this.plugin.store.moveInlineTask(task, newLaneId);
			}
		}
		this.selectedTaskIds.clear();
		await this.refresh();
	}

	/** Loescht alle ausgewaehlten Aufgaben gemeinsam, nach einer Sicherheitsabfrage. */
	private async bulkDelete(): Promise<void> {
		const ids = Array.from(this.selectedTaskIds);
		if (ids.length === 0) return;
		const confirmed = await confirmDialog(this.app, t("view.bulk.confirmDelete", { count: ids.length }));
		if (!confirmed) return;
		for (const id of ids) {
			const task = this.tasks.find((t) => t.id === id);
			if (task) await this.plugin.store.deleteTask(task);
		}
		this.selectedTaskIds.clear();
		await this.refresh();
	}

	async renderMarkdownInto(el: HTMLElement, markdown: string, sourcePath: string): Promise<void> {
		await MarkdownRenderer.render(this.app, markdown, el, sourcePath, this);
	}
}
