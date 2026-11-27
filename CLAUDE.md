# GTD Board - Arbeitsanweisung fuer Claude Code

Obsidian-Plugin (id `gtd-board`): GTD-Kanban-Board ueber Markdown-Dateien im Vault.
Repo: github.com/johannesscherbaum/gtd-board. Antworte mir auf Deutsch.

## Arbeitsweise

- Zuerst die betroffenen Dateien lesen und das vorhandene Muster weiterverwenden.
- Bei groesseren Aufgaben erst einen kurzen Plan mit Dateiliste zeigen, dann in Schritten
  arbeiten. Nach jedem Schritt `npm run build` und `npm test`, ein Commit pro Schritt.
- Auf diesem Rechner laeuft kein Obsidian. Logik ist ueber Tests abgesichert, Optik und
  Bedienung kann ich nur selbst in Obsidian pruefen. Sag am Ende ausdruecklich, was ich dort
  ansehen muss.
- Arbeitsverzeichnis liegt lokal auf der NVMe, nicht auf dem SMB-Share (node_modules,
  Dateirechte).
- Kein Force-Push. `.github/workflows/` nur auf ausdrueckliche Anweisung aendern.

## Befehle

- `npm install`, `npm run build` (Typpruefung + esbuild), `npm run typecheck`, `npm test` (Jest).
- Build und Tests muessen vor jedem Commit gruen sein.

## Konventionen

- Code-Kommentare und Commit-Nachrichten auf Deutsch, in Code ohne Umlaute (ae, oe, ue, ss),
  wie im bestehenden Code. Einrueckung mit Tabs.
- Alle sichtbaren Texte in `src/i18n/de.ts` und `src/i18n/en.ts`, nie fest im Code.
- Einstellungen ueber die deklarative API (`getSettingDefinitions()` in `src/settings.ts`),
  nicht ueber `display()`.
- `minAppVersion` ist 1.13.0. Keine Obsidian-API verwenden, deren `@since` hoeher ist
  (der Linter meldet das als Fehler). Bestaetigungsdialoge ueber `ConfirmationModal`.
- Community-Plugin-Regeln: kein `innerHTML`/`outerHTML`, in CSS kein `!important` und keine
  doppelten Eigenschaften, Obsidian-Variablen statt fester Farben. Listener ueber
  `registerDomEvent`/`registerEvent`, Timer in `onunload` aufraeumen.
- Es gibt keinen eigenen persistenten Zustand ausser dem, was im Vault steht (plus Einstellungen).

## Datenmodell

- Datei-Aufgaben liegen unter `taskFilesFolder`. Frontmatter: `lane` (ohne `lane` ist die
  Datei keine Aufgabe), `title`, `due`, `reminder`, `priority`, `tags`, `contexts`,
  `delegatedTo`, `project`, `recurrence`, `order`, `done`. Unbekannte Felder beim
  Bearbeiten und Verschieben erhalten, nie verwerfen.
- Inline-Aufgaben (Checkboxen) im ueberwachten Ordner `watchFolder`: Lane per Tag
  (`#gtd/next`), `📅 YYYY-MM-DD` (optional `⏰HH:mm`), `🔺`/`🔽` Prioritaet, `🔁 weekly`,
  `@Kontext`, `+Projekt`, `👤 Name`. Parsen und Zurueckschreiben in `src/util.ts`,
  Round-Trip muss verlustfrei sein.
- "Erledigt" ist rein Checkbox-getrieben und von der Lane unabhaengig.
- Projekt: explizites `project:` bzw. `+Projekt` gewinnt. Sonst wird es aus dem
  unmittelbaren Unterordner abgeleitet, relativ zu `projectRootFolder` (falls gesetzt),
  sonst zu `taskFilesFolder` (Datei-Aufgaben) bzw. `watchFolder` (Inline). Leerer Wurzelordner
  ergibt kein abgeleitetes Projekt. Logik: `deriveProjectFromPath` in `src/util.ts`.

## Geplante Erweiterungen (Entscheidungen)

- Heute-Fokus: Smart-Liste "Heute" = heute faellig oder ueberfaellig oder manuell markiert.
  Die Markierung speichert ein DATUM (Frontmatter `today: YYYY-MM-DD`, inline Marker),
  damit sie am naechsten Tag verfaellt.
- Seitenleiste mit Zaehlern (Listen, Personen aus `delegatedTo`, Projekte, Herkunft).
  Anlegen, Bearbeiten und Detailansicht immer ueber Modals ueber dem Board (seit #7, das
  fruehere Detailpanel entfaellt); Aufgaben-Formular als gemeinsame Komponente (TaskForm).
- Unteraufgaben (Checklisten in der Beschreibung) behalten ihr eigenes Datum.
- Herkunft (Planner/Meetings) nur anzeigen: optionale Felder `source`, `sourceLabel`,
  `sourceUrl`, `plannerId`. Das Plugin liest sie, erhaelt sie und schreibt nie nach Planner.
  Planner-Aufgaben legt ein externer Lauf als Dateien an (`plannerId` als Schluessel).
- Meeting-Notizen: Termine per ICS direkt im Plugin (Parsing mit ical.js, inkl. Serien und
  Zeitzonen), URL als Geheimnis behandeln (Obsidian-Secret-Speicher, nie loggen). Notiz aus
  Vorlage anlegen und im normalen Editor oeffnen, kein eigener Editor. Wiederfinden ueber
  Frontmatter `meeting_uid`; Notizen des Plugins "Meetings Plus" (`meeting_dedup_key`)
  mit erkennen. Frontmatter-Listen von Meetings Plus (`open_tasks`, `open_questions`,
  `*_count`) sind keine Aufgaben.

## Versionierung und Releases

Tag und Release heissen exakt wie die Version (z. B. 0.5.7, ohne "v"). Releases entstehen nur
ueber `npm run release -- <patch|minor|major|x.y.z>`; Versionsdateien nie von Hand aendern
(`manifest.json`, `package.json`, `versions.json`). Den Rest macht
`.github/workflows/release.yml` nach dem Push (Build, Attestation, Release).

Vor jedem Release schlaegst du die Nummer vor und wartest auf meine Bestaetigung:
1. `npm run release -- patch --dry-run` ausfuehren, Aenderungen seit dem letzten Release lesen.
2. Nummer mit kurzer Begruendung und einer Alternative vorschlagen, z. B. "Vorschlag 0.6.0
   (minor): neue Seitenleiste. Alternative 0.5.8, falls nur die Fehlerkorrekturen raus sollen."
3. Erst nach meiner Bestaetigung ausfuehren.

Regeln unter 1.0.0:
- patch: Fehlerkorrekturen, Texte, Review-Anpassungen, Umbauten ohne neue Funktion.
- minor: neue Funktion, neue Einstellung, sichtbare Aenderung am Board, Anhebung von
  `minAppVersion`.
- Aenderungen, die bestehende Notizen betreffen (Felder umbenannt oder entfernt, andere
  Inline-Syntax), nennst du ausdruecklich und schlaegst minor vor.
- 1.0.0 schlaegst du nie von dir aus vor.
