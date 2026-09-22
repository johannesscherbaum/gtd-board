/**
 * Deutsche Uebersetzungstabelle. Enthaelt den ursprachlichen (deutschen) UI-Text,
 * verbatim aus dem bisherigen fest verdrahteten Quelltext uebernommen.
 */
export const de = {
	commands: {
		openBoard: "GTD Board oeffnen",
		quickCapture: "Schnellerfassung: neue Aufgabe anlegen",
		exportIcs: "ICS-Export jetzt ausfuehren",
		weeklyReview: "Wochenrueckblick starten",
	},
	ribbon: {
		openBoard: "GTD Board oeffnen",
	},
	notice: {
		archived: "{count} Aufgabe(n) archiviert.",
		icsExportUpdated: "ICS-Export aktualisiert: {path}",
		icsExportFailed: "ICS-Export fehlgeschlagen, siehe Konsole.",
		noDoneLane: "Keine Lane als 'Erledigt' markiert - siehe Einstellungen.",
	},
	taskModal: {
		titleCreate: "Neue Aufgabe",
		titleEdit: "Aufgabe bearbeiten",
		title: "Titel",
		description: "Beschreibung",
		descriptionDesc: "Unterstuetzt Markdown.",
		noDescription: "*Keine Beschreibung*",
		editButton: "Bearbeiten",
		previewButton: "Vorschau",
		dueDate: "Faellig am",
		dueDateDesc: "Uhrzeit optional (ganztaegig, wenn leer); wenn gesetzt, in 15-Minuten-Schritten.",
		timeTooltip: "Optional: Uhrzeit (wird auf 15-Minuten-Schritte gerundet)",
		recurrence: "Wiederholung",
		recurrenceDesc:
			'Beim Verschieben nach "Erledigt" wird automatisch der naechste Termin gesetzt, statt die Aufgabe abzuschliessen. Ohne Faelligkeit wirkungslos.',
		recurrenceNone: "Keine",
		reminder: "Erinnerung",
		reminderDesc:
			"Uhrzeit optional (ganztaegig, wenn leer; 15-Minuten-Schritte). Leer lassen fuer Standard ({minutes} Min. vor Faelligkeit).",
		priority: "Prioritaet",
		priorityDesc: "Standard-Sortierung des Boards richtet sich nach dieser Einstufung.",
		project: "Projekt",
		projectDesc:
			"Freies Projekt (GTD-Projektliste), unabhaengig von Lane und Kontext. Leer lassen, wenn die Aufgabe zu keinem Projekt gehoert.",
		projectPlaceholder: "z. B. SAP-Transformation",
		delegatedTo: "Delegiert an",
		delegatedToDesc: 'Name der Person, an die diese Aufgabe delegiert wurde (z. B. fuer "Wartet auf"). Leer lassen, wenn nicht delegiert.',
		delegatedToPlaceholder: "z. B. Christian",
		contexts: "Kontexte",
		contextsDesc: "Kommagetrennt, ohne @ (z. B. Buero, Telefon). Zweite Filterdimension zusaetzlich zur Lane.",
		tags: "Tags",
		tagsDesc: "Kommagetrennt, ohne #.",
		save: "Speichern",
		cancel: "Abbrechen",
		titleRequired: "Bitte einen Titel angeben.",
	},
	quickCapture: {
		title: "Schnellerfassung",
		placeholder: "z. B. Angebot pruefen @Buero +SAP-Transformation 📅 morgen 🔺",
		hint: "Enter zum Anlegen, Esc zum Abbrechen. 📅/@Kontext/+Projekt/👤/🔺🔽/🔁 werden erkannt.",
		captured: 'Aufgabe erfasst: "{title}"',
	},
	reviewModal: {
		title: "Wochenrueckblick ({index}/{total})",
		doneTitle: "Wochenrueckblick abgeschlossen",
		emptyState: "Keine offenen Aufgaben zu pruefen - alles aktuell.",
		summary: "{reviewed} von {total} Aufgabe(n) durchgesehen. Gut gemacht.",
		close: "Schliessen",
		laneMeta: "{lane} · zuletzt beruehrt vor {days} Tag(en)",
		due: "Faellig: {due}",
		project: "Projekt: {project}",
		delegatedTo: "Delegiert an: {name}",
		context: "Kontext: {contexts}",
		confirm: "Passt so",
		confirmTooltip: "Aufgabe bleibt unveraendert, Auffrischungs-Zeitpunkt wird zurueckgesetzt",
		edit: "Bearbeiten",
		editTooltip: "Oeffnet den Bearbeiten-Dialog, beendet den Rueckblick fuer diese Aufgabe",
		complete: "Erledigt",
		completeTooltip: "Direkt in 'Erledigt' verschieben",
		endReview: "Rueckblick beenden",
	},
	reminders: {
		title: "GTD-Erinnerung: {task}",
		due: "Faellig: {due}",
		at: "Erinnerung {time}",
		snooze1h: "1 Std.",
		snoozeTomorrow: "Morgen 9:00",
	},
	settings: {
		heading: "GTD Board",
		folder: {
			name: "Ordner",
			desc: "Ordner (inkl. Unterordner), der nach Inline-Checkboxen ('- [ ] ...') durchsucht wird.",
			placeholder: "GTD",
		},
		taskFolder: {
			name: "Aufgaben-Ordner",
			desc:
				"Ordner, in dem Aufgaben-Dateien liegen bzw. neu angelegt werden. Wird immer durchsucht - unabhaengig davon, ob er innerhalb des obigen Ordners liegt.",
			placeholder: "GTD/Aufgaben",
		},
		inlineCheckboxes: {
			name: "Inline-Checkboxen einlesen",
			desc: "Zusaetzlich zu Aufgaben-Dateien auch '- [ ]'-Checkboxen in normalen Notizen des Ordners als Aufgaben anzeigen.",
		},
		autoPromoteInbox: {
			name: "Eingang automatisch befoerdern",
			desc: "Aufgaben in der Eingang-Lane, denen ein Faelligkeitsdatum gegeben wird, wandern automatisch in die als 'Naechste Aktionen' markierte Lane.",
		},
		defaultReminder: {
			name: "Standard-Erinnerung",
			desc: "Minuten vor Faelligkeit, wenn keine explizite Erinnerung gesetzt ist.",
		},
		checkInterval: {
			name: "Pruefintervall",
			desc: "Wie oft (Sekunden) auf faellige Erinnerungen geprueft wird.",
		},
		archivingHeading: "Archivierung",
		autoArchive: {
			name: "Automatisch archivieren nach",
			desc: "Tage nach Erledigung, nach denen eine Datei-Aufgabe automatisch in den Archiv-Ordner verschoben wird. 0 = deaktiviert.",
		},
		archiveFolder: {
			name: "Archiv-Ordner",
			desc: 'Leer = "{path}".',
			placeholder: "{path}",
		},
		refreshHeading: "Auffrischung",
		refreshDesc:
			"Rein visuelle Erinnerung auf der Karte, damit 'Wartet auf' und 'Irgendwann/Vielleicht' nicht zum Friedhof werden - keine automatische Aktion.",
		delegateFollowUp: {
			name: "Wartet-auf Follow-up nach",
			desc: "Tage ohne Regung, nach denen eine delegierte Aufgabe auffrischungsbeduerftig markiert wird.",
		},
		somedayRefresh: {
			name: "Someday/Maybe-Auffrischung nach",
			desc: "Tage ohne Regung, nach denen eine Aufgabe in einer 'Irgendwann/Vielleicht'-Lane auffrischungsbeduerftig markiert wird.",
		},
		icsHeading: "ICS-Export",
		icsDesc:
			"Schreibt alle offenen Faelligkeiten als .ics-Kalenderdatei ins Vault, damit ein echter Kalender (statt nur Obsidian) zuverlaessig erinnern kann.",
		icsEnable: {
			name: "ICS-Export aktivieren",
			desc: "Datei automatisch bei jeder Board-Aktualisierung neu schreiben.",
		},
		icsPath: {
			name: "ICS-Dateipfad",
			desc: "Vault-Pfad der Kalenderdatei.",
			placeholder: "GTD/Termine.ics",
		},
		exportNow: "Jetzt exportieren",
		swimlanesHeading: "Swimlanes",
		swimlanesDesc: "Basierend auf GTD, aber frei anpassbar. Der Tag wird verwendet, um Inline-Checkboxen einer Lane zuzuordnen.",
		addLane: "Lane hinzufuegen",
		newLaneName: "Neue Lane",
		lane: {
			namePlaceholder: "Name",
			noTag: "kein Tag",
			tagPlaceholder: "tag/fuer/inline",
			doneTagTitle: "Erledigt-Lanes haben kein Tag: eine Aufgabe gilt als erledigt, wenn ihr Haken gesetzt ist.",
			plannedTagTitle: "Geplant-Uebersichts-Lanes haben kein eigenes Tag: sie zeigen automatisch alle faelligen Aufgaben.",
			doneTooltip: "Als erledigt behandeln",
			plannedTooltip: "Geplant-Uebersicht: zeigt automatisch alle faelligen Aufgaben, sortiert nach Faelligkeit",
			somedayTooltip:
				"Irgendwann/Vielleicht: Aufgaben, die hier lange ohne Review liegen, werden auf der Karte als auffrischungsbeduerftig markiert",
			inboxTooltip:
				"Eingang: Quell-Lane fuer die automatische Befoerderung. Eine Aufgabe hier, die ein Faelligkeitsdatum bekommt, wandert in die als 'Naechste Aktionen' markierte Lane (wenn in den Einstellungen aktiviert).",
			nextActionsTooltip:
				"Naechste Aktionen: Ziel-Lane der automatischen Befoerderung aus dem Eingang (siehe 'Eingang automatisch befoerdern' in den Einstellungen).",
			wipLimitPlaceholder: "WIP-Limit",
			wipLimitTitle: "Optionales WIP-Limit fuer diese Lane",
			moveUp: "Nach oben",
			moveDown: "Nach unten",
			delete: "Loeschen",
		},
	},
	view: {
		displayText: "GTD Board",
		search: {
			placeholder: "Suche nach Titel oder Tag...",
			title: "Suche nach Titel oder Tag",
		},
		context: {
			title: "Nach Kontext (@...) filtern",
			all: "Alle Kontexte",
		},
		project: {
			title: "Nach Projekt (+...) filtern",
			all: "Alle Projekte",
		},
		viewMode: {
			title: "Ansicht: Kanban-Board, Agenda-Liste oder Wochenkalender",
			board: "Kanban",
			agenda: "Agenda",
			week: "Woche",
		},
		sort: {
			title: "Sortierung der Karten innerhalb einer Lane",
			manual: "Eigene Reihenfolge",
			priority: "Priorität",
			due: "Fälligkeit",
			taskTitle: "Titel",
		},
		selection: {
			button: "Mehrfachauswahl",
			title: "Mehrfachauswahl: mehrere Aufgaben markieren, um sie gemeinsam zu verschieben oder zu loeschen",
		},
		review: {
			button: "Wochenrueckblick",
			title: "Gefuehrter Wochenrueckblick: geht alle offenen Aufgaben durch, am laengsten nicht angefasste zuerst (GTD Weekly Review).",
		},
		refresh: {
			button: "Aktualisieren",
			title:
				"Board manuell neu laden. Normalerweise nicht noetig - das Board aktualisiert sich automatisch bei Aenderungen im Vault; hilfreich z. B. direkt nach dem Umbenennen von Lanes in den Einstellungen.",
		},
		overflow: {
			title: "Weitere Aktionen",
		},
		agenda: {
			empty: "Keine offenen Aufgaben.",
		},
		week: {
			prevWeek: "Vorherige Woche",
			nextWeek: "Naechste Woche",
			today: "Heute",
			todayTitle: "Zur aktuellen Woche springen",
			emptyDay: "–",
		},
		lane: {
			expand: "Lane ausklappen",
			collapse: "Lane einklappen",
			add: "Aufgabe hinzufuegen",
			wipLimitExceeded: "WIP-Limit ueberschritten",
		},
		card: {
			doneCheckboxTitle: "Als erledigt markieren / zurueckholen",
			priorityTitle: "Prioritaet: {priority}",
			inlineBadge: "Inline",
			recurrenceTitle: "Beim Erledigen wird automatisch der naechste Termin gesetzt.",
			staleDelegateTitle: "Seit {days} Tagen keine Regung - evtl. bei {name} nachfassen.",
			staleDelegateText: "⚠ 👤 {name} ({days}d)",
			delegatedToTitle: "Delegiert an {name}",
			staleSomedayText: "⏳ seit {days}d",
			staleSomedayTitle: "Seit laengerem nicht mehr durchgesehen - beim naechsten Wochenrueckblick pruefen.",
		},
		contextMenu: {
			edit: "Bearbeiten",
			openFile: "Datei oeffnen",
			delete: "Loeschen",
		},
		bulk: {
			selectedCount: "{count} ausgewaehlt",
			moveTo: "Verschieben nach...",
			moveTitle: "Ausgewaehlte Aufgaben gemeinsam in eine Lane verschieben",
			delete: "Loeschen",
			deleteTitle: "Ausgewaehlte Aufgaben gemeinsam loeschen",
			cancel: "Auswahl aufheben",
			confirmDelete: "{count} Aufgabe(n) wirklich loeschen?",
		},
	},
	priority: {
		high: "Hoch",
		medium: "Mittel",
		low: "Niedrig",
	},
	recurrence: {
		daily: "Taeglich",
		weekly: "Woechentlich",
		monthly: "Monatlich",
		yearly: "Jaehrlich",
	},
	file: {
		fallbackName: "Aufgabe",
	},
};
