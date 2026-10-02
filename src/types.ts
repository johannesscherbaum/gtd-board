/** Stabiler Lane-Bezeichner fuer die Agendas-Lane; nicht Teil der konfigurierbaren Lanes. */
export const AGENDA_LANE_ID = "__agenda__";

export interface LaneConfig {
	/** Stabile ID der Lane, wird in Frontmatter und als Inline-Tag genutzt. */
	id: string;
	/** Anzeigename der Swimlane. */
	name: string;
	/** Hex-Farbcode fuer die Swimlane-Markierung. */
	color: string;
	/** Tag (ohne #), der eine Inline-Checkbox dieser Lane zuordnet. */
	tag: string;
	/** Lanes mit isDone=true gelten als abgeschlossen (Haken wird gesetzt). */
	isDone?: boolean;
	/** Optionales WIP-Limit: bei Ueberschreitung wird die Lane visuell markiert. */
	wipLimit?: number;
	/**
	 * Lanes mit isPlanned=true sind eine reine Uebersichts-Lane: sie zeigt automatisch
	 * ALLE nicht erledigten Aufgaben mit Faelligkeit an (unabhaengig von deren eigentlicher
	 * Lane), aufsteigend nach Faelligkeitsdatum sortiert. Aufgaben behalten dabei ihre
	 * normale Lane und werden dort zusaetzlich weiterhin angezeigt. Hat kein eigenes Tag,
	 * nimmt keine neuen Aufgaben per "+" an und ist kein Drop-Ziel.
	 */
	isPlanned?: boolean;
	/**
	 * Markiert eine Lane als "Irgendwann/Vielleicht" im GTD-Sinn: Aufgaben, die hier laenger
	 * als "somedayRefreshDays" ohne Review liegen, werden auf der Karte als auffrischungs-
	 * beduerftig markiert, damit die Liste nicht zum Friedhof wird. Rein visuell, keine
	 * Funktionsaenderung.
	 */
	isSomeday?: boolean;
	/**
	 * Markiert die GTD-Eingang/Erfassungs-Lane: Aufgaben, die hier ein Faelligkeitsdatum
	 * bekommen (per Erstellungs-/Bearbeiten-Dialog oder Schnellerfassung), wandern automatisch
	 * in die als isNextActions markierte Lane, sofern "autoPromoteInboxOnDueDate" aktiviert ist.
	 */
	isInbox?: boolean;
	/**
	 * Markiert die "Naechste Aktionen"-Lane als Ziel der automatischen Befoerderung aus der
	 * Eingang-Lane (siehe isInbox). Ohne eine so markierte Lane hat isInbox keine Wirkung.
	 */
	isNextActions?: boolean;
}

export type TaskSource = "file" | "inline";

/** Prioritaet einer Aufgabe. Ohne explizite Angabe gilt eine Aufgabe als "medium". */
export type TaskPriority = "high" | "medium" | "low";

/** Sortierung der Karten innerhalb einer Lane. */
export type SortMode = "manual" | "priority" | "due" | "title" | "project";

/**
 * Wiederholungsregel einer Aufgabe. Wird eine Aufgabe mit Regel in eine Erledigt-Lane
 * verschoben (per Drag & Drop oder direkt in der Notiz abgehakt), setzt das Plugin
 * automatisch den naechsten Termin und laesst die Aufgabe offen, statt sie abzuschliessen.
 * Ohne Faelligkeitsdatum hat eine Regel keinen Ankerpunkt und wird ignoriert.
 */
export type RecurrenceRule = "daily" | "weekly" | "monthly" | "yearly";

export interface GtdTask {
	/** Eindeutige, stabile ID. Fuer Datei-Aufgaben = Dateipfad, fuer Inline = Dateipfad+Zeile+Titel-Hash. */
	id: string;
	source: TaskSource;
	title: string;
	/** Markdown-Beschreibung. Nur fuer Datei-Aufgaben gepflegt. */
	description: string;
	laneId: string;
	done: boolean;
	/** ISO-Datum oder Datum+Zeit der Faelligkeit. */
	due?: string;
	/** ISO-Datum+Zeit, zu der erinnert werden soll. */
	reminderAt?: string;
	/** Prioritaet; undefined wird wie "medium" behandelt (kein Badge). */
	priority?: TaskPriority;
	/** Wiederholungsregel; ohne Faelligkeit wirkungslos. */
	recurrence?: RecurrenceRule;
	tags: string[];
	/** Kontext-Marker (ohne @), z. B. "buero", "telefon" - zweite Filterdimension zusaetzlich zu den Lanes. */
	contexts: string[];
	/** Person, an die die Aufgabe delegiert wurde (frei formulierter Name), falls vorhanden. */
	delegatedTo?: string;
	/** Freies Projekt (GTD-Projektliste), unabhaengig von Lane und Kontext. */
	project?: string;
	/** Person, mit der dieser Agendapunkt besprochen werden soll (nur fuer Agenda-Eintraege). */
	person?: string;
	filePath: string;
	/** Nur bei Inline-Aufgaben gesetzt: Zeilennummer (0-basiert) in der Quelldatei. */
	line?: number;
	/** Reihenfolge innerhalb der Lane, kleiner = weiter oben. */
	order: number;
	/**
	 * Letzter bekannter "Beruehrungs"-Zeitpunkt (ms seit Epoch): das juengere von
	 * Datei-Aenderungszeit und einem expliziten Review im Wochenrueckblick. Grundlage fuer
	 * die Auffrischungs-Markierungen bei "Wartet auf" und "Irgendwann/Vielleicht".
	 */
	lastTouched: number;
	/**
	 * Tickler-Datum (YYYY-MM-DD): Aufgabe wird erst ab diesem Datum auf dem Board angezeigt.
	 * Davor ist sie vollstaendig ausgeblendet (nicht nur visuell gefiltert).
	 */
	visibleFrom?: string;
	/**
	 * Wiedervorlage-Datum fuer Someday/Maybe-Aufgaben: an diesem Datum wird die Aufgabe
	 * automatisch zurueck in die Inbox-Lane verschoben, um erneut verarbeitet zu werden.
	 */
	revisitOn?: string;
}

export interface GtdBoardSettings {
	/** Ordner (inkl. Unterordner), der nach Aufgaben durchsucht wird. */
	watchFolder: string;
	/** Unterordner (relativ zum Vault-Root), in dem Datei-Aufgaben abgelegt werden. */
	taskFilesFolder: string;
	lanes: LaneConfig[];
	/** Auch Inline-Checkboxen ("- [ ] ...") aus Notizen im Watch-Ordner anzeigen. */
	scanInlineTasks: boolean;
	/** Minuten vor Faelligkeit, zu denen standardmaessig erinnert wird, wenn keine explizite Erinnerung gesetzt ist. */
	defaultReminderOffsetMinutes: number;
	/** Wie oft (Sekunden) auf faellige Erinnerungen geprueft wird. */
	reminderCheckIntervalSeconds: number;
	/** Bereits ausgeloeste Erinnerungen: taskId -> ISO-Zeitpunkt, fuer den bereits benachrichtigt wurde. */
	firedReminders: Record<string, string>;
	/** IDs der Lanes, die im Board eingeklappt dargestellt werden. */
	collapsedLanes: string[];
	/** Aktuell gewaehlte Sortierung der Karten innerhalb der Lanes. */
	sortMode: SortMode;
	/** Snooze-Zeitpunkte fuer Erinnerungen: taskId -> ISO-Zeitpunkt, bis zu dem erneut erinnert werden soll. */
	snoozedUntil: Record<string, string>;
	/** Tage nach Erledigung, nach denen eine Datei-Aufgabe automatisch archiviert wird. 0/undefined = deaktiviert. */
	archiveAfterDays: number;
	/** Zielordner fuer archivierte Aufgaben. Leer = "<Aufgaben-Ordner>/Archiv". */
	archiveFolder: string;
	/** ICS-Kalenderdatei mit allen offenen Faelligkeiten automatisch im Vault pflegen. */
	icsExportEnabled: boolean;
	/** Vault-Pfad der ICS-Datei. */
	icsExportPath: string;
	/** Zeitpunkte, zu denen eine Aufgabe zuletzt im Wochenrueckblick bestaetigt wurde: taskId -> ISO-Zeitpunkt. */
	reviewedAt: Record<string, string>;
	/** Tage ohne Regung, nach denen eine delegierte Aufgabe ("Wartet auf") als auffrischungsbeduerftig markiert wird. */
	delegateFollowUpDays: number;
	/** Tage ohne Regung, nach denen eine Someday/Maybe-Aufgabe als auffrischungsbeduerftig markiert wird. */
	somedayRefreshDays: number;
	/**
	 * Aufgaben in der als isInbox markierten Lane, die ein Faelligkeitsdatum bekommen, automatisch
	 * in die als isNextActions markierte Lane befoerdern (statt in der Eingang-Lane liegen zu bleiben).
	 */
	autoPromoteInboxOnDueDate: boolean;
	/**
	 * Wurzelordner fuer die automatische Projekt-Ableitung. Wenn gesetzt, wird fuer jede Aufgabe
	 * (Datei- und Inline) der unmittelbare Unterordner relativ zu diesem Pfad als Projekt verwendet,
	 * statt relativ zu taskFilesFolder / watchFolder. Leer = bisheriges Verhalten.
	 */
	projectRootFolder: string;
	/** Agendas-Lane auf dem Board anzeigen. */
	agendaEnabled: boolean;
	/** Ordner (im Vault), aus dem Agenda-Eintraege gelesen werden. */
	agendaFolder: string;
	/** Namen der Projekte (oder "__no_project__"), die in der Projekteansicht eingeklappt sind. */
	collapsedProjects: string[];
	/** Namen der Kontexte (oder "__no_context__"), die in der Kontexteansicht eingeklappt sind. */
	collapsedContexts: string[];
	/** Zuletzt aktiver View-Modus (board/agenda/week/projects/contexts), wird beim Oeffnen wiederhergestellt. */
	lastViewMode: string;
	/** Zuletzt aktiver @Kontext-Filter (ohne @), wird beim Oeffnen wiederhergestellt. */
	lastContextFilter: string;
	/** Zuletzt aktiver +Projekt-Filter (ohne +), wird beim Oeffnen wiederhergestellt. */
	lastProjectFilter: string;
}

export const DEFAULT_LANES: LaneConfig[] = [
	{ id: "inbox", name: "Eingang", color: "#8e8e93", tag: "gtd/inbox", isInbox: true },
	{ id: "next-actions", name: "Naechste Aktionen", color: "#0a84ff", tag: "gtd/next", isNextActions: true },
	{ id: "waiting-for", name: "Wartet auf", color: "#ff9f0a", tag: "gtd/waiting" },
	{ id: "someday-maybe", name: "Irgendwann/Vielleicht", color: "#bf5af2", tag: "gtd/someday", isSomeday: true },
	{ id: "done", name: "Erledigt", color: "#30d158", tag: "gtd/done", isDone: true },
];

export const DEFAULT_SETTINGS: GtdBoardSettings = {
	watchFolder: "GTD",
	taskFilesFolder: "GTD/Aufgaben",
	lanes: DEFAULT_LANES,
	scanInlineTasks: true,
	defaultReminderOffsetMinutes: 0,
	reminderCheckIntervalSeconds: 60,
	firedReminders: {},
	collapsedLanes: [],
	sortMode: "priority",
	snoozedUntil: {},
	archiveAfterDays: 0,
	archiveFolder: "",
	icsExportEnabled: false,
	icsExportPath: "GTD/Termine.ics",
	reviewedAt: {},
	delegateFollowUpDays: 5,
	somedayRefreshDays: 60,
	autoPromoteInboxOnDueDate: true,
	projectRootFolder: "",
	agendaEnabled: false,
	agendaFolder: "GTD/Agendas",
	collapsedProjects: [],
	collapsedContexts: [],
	lastViewMode: "board",
	lastContextFilter: "",
	lastProjectFilter: "",
};
