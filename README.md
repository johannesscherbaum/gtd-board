# GTD Board (Obsidian-Plugin)

Ein anpassbares Kanban-Board fuer Obsidian auf GTD-Basis.

## Funktionsweise

- Durchsucht einen konfigurierbaren Ordner **inklusive Unterordner** nach Aufgaben.
- Zwei Aufgabenquellen:
  - **Datei-Aufgaben** (primär): jede Aufgabe ist eine eigene Markdown-Datei im
    Unterordner "Aufgaben-Unterordner". Frontmatter enthaelt Lane, Faelligkeit,
    Erinnerung und Tags; der Dateikoerper ist die Markdown-Beschreibung.
  - **Inline-Checkboxen**: `- [ ] Text #gtd/next 📅 2026-09-20` in normalen
    Notizen des ueberwachten Ordners. Die Lane wird ueber ein Tag erkannt
    (z. B. `#gtd/next`), das Faelligkeitsdatum ueber `📅 YYYY-MM-DD` (optional
    mit `⏰HH:mm`).
- **Swimlanes** sind farbig markiert und frei benennbar/verschiebbar. Vorgabe
  ist die GTD-Systematik (Eingang, Naechste Aktionen, Wartet auf,
  Irgendwann/Vielleicht, Erledigt), aber komplett anpassbar (Einstellungen).
  Jede Lane laesst sich per Pfeil-Icon zu einer schmalen, vertikalen Box
  einklappen; der Zustand wird gespeichert.
- **"Erledigt" ist rein hakenbasiert**: Eine Aufgabe erscheint automatisch in
  der als "isDone" markierten Lane, sobald ihr Haken gesetzt ist
  (Inline-Checkbox `- [x]` bzw. `done: true` im Frontmatter) - unabhaengig
  vom sonstigen Lane-Tag. Die Erledigt-Lane traegt bewusst kein eigenes Tag.
- **Drag & Drop** verschiebt Aufgaben zwischen Lanes und schreibt die
  Aenderung sofort in die zugrunde liegende Datei zurueck: bei Datei-Aufgaben
  ins Frontmatter (`lane:` / `done:`), bei Inline-Aufgaben durch Setzen des
  Hakens bzw. Austausch des Lane-Tags direkt in der Zeile. Beim Verschieben
  in "Erledigt" bleibt das urspruengliche Lane-Tag erhalten, damit die
  Aufgabe beim Zurueckziehen wieder in ihrer Herkunfts-Lane landet.
- **Neue Aufgaben** koennen ueber den "+"-Button jeder Lane angelegt werden
  (immer als Datei-Aufgabe).
- **Bearbeiten** einer Aufgabe (Titel, Markdown-Beschreibung, Faelligkeit,
  Erinnerung, Tags) oeffnet einen Dialog mit einem "Vorschau"/"Bearbeiten"-
  Umschalter fuer die Beschreibung (Markdown-Quelltext und gerenderte Vorschau
  nacheinander statt nebeneinander). Wird eine Inline-Aufgabe inhaltlich
  bearbeitet, legt das Plugin automatisch eine Aufgaben-Datei an und entfernt
  die urspruengliche Checkbox-Zeile.
- **Erinnerungen**: Faelligkeitsdatum plus optional eigener Erinnerungs-
  zeitpunkt (sonst Standard-Offset vor Faelligkeit). Das Plugin prueft
  periodisch faellige Erinnerungen und zeigt eine Desktop-Benachrichtigung
  (Browser-Notification) sowie eine Obsidian-Notice mit Snooze-Buttons
  ("1 Std.", "Morgen 9:00") - ein Klick verschiebt die Erinnerung auf den
  gewaehlten Zeitpunkt und loest sie danach automatisch erneut aus.
- **Suche/Filter**: Die Toolbar oberhalb des Boards enthaelt ein Suchfeld,
  das Karten nach Titel oder Tag filtert. Die Lane-Zaehler zeigen weiterhin
  die ungefilterte Gesamtanzahl.
- **WIP-Limit je Lane**: In den Einstellungen laesst sich pro Lane ein
  optionales Limit fuer gleichzeitige Aufgaben setzen. Bei Ueberschreitung
  wird der Zaehler in der Lane-Kopfzeile rot/fett hervorgehoben.
- **Faelligkeits-Farbcodierung**: Karten mit Faelligkeitsdatum werden je
  nach Dringlichkeit eingefaerbt - heute/ueberfaellig rot, diese Woche gelb,
  spaeter neutral. Erledigte Aufgaben werden nicht mehr farblich markiert.
- **Sortierbare Lanes**: Ueber ein Dropdown in der Toolbar lassen sich die
  Karten innerhalb aller Lanes nach eigener Reihenfolge, Prioritaet,
  Faelligkeit oder Titel sortieren (Standard: Prioritaet); die Auswahl wird
  gespeichert.
- **"Geplant"-Uebersichts-Lane**: eine optionale, virtuelle Lane (in den
  Einstellungen aktivierbar), die automatisch alle nicht erledigten Aufgaben
  mit Faelligkeit zeigt - unabhaengig von ihrer eigentlichen Lane, immer
  aufsteigend nach Faelligkeit sortiert. Jede Karte traegt zusaetzlich ein
  Badge mit ihrer Herkunfts-Lane. Kein eigenes Tag, kein Drop-Ziel.
- **Prioritaet**: Aufgaben koennen als Hoch/Mittel/Niedrig eingestuft werden
  (Inline ueber 🔺/🔽, sonst ohne Marker; Datei-Aufgaben ueber Frontmatter
  `priority:`). Karten zeigen einen farbigen linken Rahmen plus Icon; die
  Standard-Sortierung richtet sich nach der Prioritaet.
- **Quick-Capture**: Befehl "Schnellerfassung: neue Aufgabe anlegen" (per
  Hotkey belegbar) legt von ueberall im Vault sofort eine neue Aufgabe in der
  Standard-Lane an, ohne das Board zu oeffnen - klassisches GTD-Capture.
- **Subtasks/Checklisten**: Markdown-Checkboxen (`- [ ]`/`- [x]`) in der
  Beschreibung einer Datei-Aufgabe werden auf der Karte als Fortschritt
  ("3/5") inkl. Balken angezeigt.
- **Kontext-Tags**: `@Buero`, `@Telefon` usw. als zweite, von der Lane
  unabhaengige Filterdimension - naeher an "echtem" GTD als reine
  Status-Lanes. Werden wie Tags im Beschreibungs-Dialog gepflegt bzw. inline
  per `@wort` erkannt; ein eigenes Dropdown in der Toolbar filtert danach.
- **Automatische Archivierung**: erledigte Datei-Aufgaben koennen nach einer
  konfigurierbaren Anzahl Tage automatisch in einen Archiv-Ordner verschoben
  werden (Standard: deaktiviert), damit "Erledigt" nicht endlos waechst.
  Aufgaben ohne bekannten Erledigungs-Zeitpunkt werden nie automatisch
  verschoben.
- **ICS-Export**: alle offenen Faelligkeiten koennen als `.ics`-Datei ins
  Vault geschrieben werden (automatisch bei jeder Aktualisierung oder manuell
  per Befehl/Button in den Einstellungen). Ein echter Kalender kann diese
  Datei abonnieren/importieren und uebernimmt so die zuverlaessige
  Benachrichtigung, auch wenn Obsidian nicht laeuft.
- **Wiederkehrende Aufgaben**: eine Aufgabe kann als taeglich/woechentlich/
  monatlich/jaehrlich wiederkehrend markiert werden (Dialog-Dropdown
  "Wiederholung"; inline ueber `🔁 woechentlich` usw.). Wird sie nach
  "Erledigt" verschoben oder direkt in der Notiz abgehakt, springt sie
  automatisch auf den naechsten Termin und bleibt offen, statt abgeschlossen
  zu werden - klassisches "jeden Montag"-Verhalten, ohne Faelligkeit
  wirkungslos.
- **Agenda-Ansicht**: Umschalter "Kanban"/"Agenda" in der Toolbar. Die
  Agenda-Ansicht zeigt alle offenen Aufgaben lane-uebergreifend als flache,
  immer nach Faelligkeit aufsteigend sortierte Liste (Aufgaben ohne
  Faelligkeit stehen am Ende); jede Karte traegt ein Badge mit ihrer
  eigentlichen Lane.
- **Bulk-Aktionen**: Der Button "Mehrfachauswahl" blendet auf jeder Karte
  eine Checkbox ein; ausgewaehlte Aufgaben lassen sich gemeinsam in eine
  Ziel-Lane verschieben oder (mit Sicherheitsabfrage) gemeinsam loeschen.
- **Erledigt-Haken auf der Karte**: jede Karte traegt links im Titel eine
  Checkbox, die die Aufgabe direkt (ohne Bearbeiten-Dialog) als erledigt
  markiert bzw. wieder zurueckholt - verschiebt sie automatisch in bzw. aus
  der "Erledigt"-Lane, inkl. Wiederholungs-Logik.
- **Wochenansicht**: dritte Ansicht (neben Kanban/Agenda) mit echtem
  Kalender-Raster - Montag bis Sonntag als Spalten, offene Aufgaben mit
  Faelligkeit stehen unter ihrem Kalendertag. Navigation zur vorherigen/
  naechsten Woche sowie ein "Heute"-Button. Fuer alles daruber hinaus
  (Termine verschieben, mehrere Kalender kombinieren) bleibt der
  ICS-Export der bessere Weg.
- **Delegation**: eine Aufgabe kann als "an XY delegiert" markiert werden
  (Dialog-Feld "Delegiert an"; inline ueber `👤 Name`, ein Wort ohne
  Leerzeichen). Wird wie Kontext/Tags dezent auf der Karte angezeigt und
  bleibt beim Verschieben zwischen Lanes erhalten.
- **Projekt**: eine freie, zweite Ordnungsdimension neben Lane und Kontext -
  eine Aufgabe gehoert zu genau einem Projekt (Dialog-Feld "Projekt"; inline
  ueber `+ProjektName`, todo.txt-Syntax). Ein eigenes Dropdown in der Toolbar
  filtert danach; auf der Karte erscheint das Projekt dezent in der
  Tag-Zeile. Bildet GTD's Projektliste ab, ohne die Lanes/Status-Sicht zu
  verwassern.
- **Auffrischungs-Markierung ("Wartet auf" & "Irgendwann/Vielleicht")**: eine
  Karte, die laenger als konfiguriert (Einstellungen &rarr; "Auffrischung",
  Standard 5 bzw. 60 Tage) ohne inhaltliche Aenderung oder Review in "Wartet
  auf" bzw. einer als "Irgendwann/Vielleicht" markierten Lane liegt, erhaelt
  einen gelben Rahmen plus Hinweis-Tag. Rein visuell - verhindert, dass
  Delegationen im Sand verlaufen oder die Someday/Maybe-Liste zum Friedhof
  wird, ohne automatisch etwas zu veraendern. Welche Lanes als "Someday"
  zaehlen, ist in den Einstellungen je Lane umschaltbar.
- **Wochenrueckblick**: Toolbar-Button (Symbol Klemmbrett-Haken) bzw. Befehl
  "Wochenrueckblick starten" fuehrt gefuehrt durch alle offenen Aufgaben,
  Lane fuer Lane, innerhalb einer Lane am laengsten nicht angefasste zuerst -
  klassisches GTD Weekly Review. Pro Aufgabe drei Aktionen: "Passt so"
  (bestaetigt die Aufgabe unveraendert und setzt den Auffrischungs-Zeitpunkt
  zurueck), "Bearbeiten" (oeffnet den normalen Dialog) oder "Erledigt"
  (direkt in die Erledigt-Lane).
- **Natural-Language-Schnellerfassung**: die Schnellerfassung versteht beim
  Tippen dieselbe kompakte Syntax wie Inline-Checkboxen - `📅 Datum`,
  `@Kontext`, `+Projekt`, `👤 Delegation`, `🔺`/`🔽` Prioritaet, `🔁
  Wiederholung` sowie `#lane/tag` zur direkten Lane-Zuordnung - und zeigt
  eine Live-Vorschau, was erkannt wurde. So laesst sich z. B.
  "Angebot pruefen @Buero +SAP-Transformation 📅 morgen 🔺" in einem Zug
  vollstaendig erfassen, ohne die Aufgabe danach im Board nachzupflegen.
<<<<<<< HEAD
- **Mehrsprachigkeit**: die Oberflaeche (Buttons, Menues, Einstellungen,
  Benachrichtigungen) ist auf Deutsch und Englisch verfuegbar und folgt
  automatisch Obsidians eigener Spracheinstellung - keine zusaetzliche
  Konfiguration noetig. Die Inline-Syntax in den Notizen selbst (Tags,
  `heute`/`morgen`/`übermorgen`, Wiederholungswoerter) bleibt unabhaengig
  von der Oberflaechensprache unveraendert, damit bestehende Notizen nicht
  brechen. Weitere Sprachen lassen sich ueber `src/i18n/` ergaenzen.
=======
>>>>>>> origin/main

## Installation (manuell, zum Testen)

1. Ordner `gtd-board` in `<Vault>/.obsidian/plugins/` kopieren (oder
   `main.js`, `manifest.json`, `styles.css` dort in einen neuen Unterordner
   legen).
2. In Obsidian: Einstellungen → Community-Plugins → "GTD Board" aktivieren.
3. Einstellungen des Plugins pruefen: Ordner, Aufgaben-Unterordner, Lanes.
4. Board oeffnen ueber das Ribbon-Icon oder den Befehl "GTD Board oeffnen".

## Entwicklung

```bash
npm install
npm run dev      # esbuild watch
npm run build    # Typecheck + Produktionsbuild (main.js)
npm test         # Unit-Tests (Parser, Datumslogik, Erinnerungen)
```

## Veroeffentlichung im Community-Plugin-Verzeichnis

1. Quellcode in ein **oeffentliches GitHub-Repository** pushen (Repo-Name
   sollte zur Plugin-ID `gtd-board` passen). `LICENSE` (MIT) ist bereits
   vorhanden.
2. Pruefen, dass die Plugin-ID in `manifest.json` nicht mit einem bereits
   gelisteten Community-Plugin kollidiert.
3. Einen Git-Tag exakt nach der Versionsnummer aus `manifest.json` pushen,
   z. B. `git tag 0.1.0 && git push origin 0.1.0`. Der mitgelieferte
   GitHub-Actions-Workflow (`.github/workflows/release.yml`) baut das Plugin
   dann automatisch und haengt `main.js`, `manifest.json` und `styles.css`
   als Release-Assets an.
4. `versions.json` bei jedem Release um die neue Version erweitern (Mapping
   Plugin-Version → minimale Obsidian-Version).
5. Im Repo `obsidianmd/obsidian-releases` die Datei `community-plugins.json`
   forken, einen Eintrag (`id`, `name`, `author`, `description`, `repo`)
   ergaenzen und als Pull Request einreichen. Ein Bot prueft Manifest und
   Release automatisch, danach folgt ein manuelles Review durch die
   Obsidian-Maintainer.
6. Nach Freigabe genuegt fuer jede weitere Version ein neuer Tag/Release -
   Nutzer erhalten Updates dann automatisch ueber die
   Community-Plugin-Verwaltung.

Alternative fuer schnelle, informelle Verteilung ohne Review-Wartezeit: das
Plugin per [BRAT](https://github.com/TfTHacker/obsidian42-brat) aus dem
GitHub-Repo installierbar machen (Beta-Reviewer-Auto-Tester), ohne den
offiziellen Aufnahmeprozess zu durchlaufen.

## Bekannte Grenzen

- In-App-Erinnerungen (Desktop-Benachrichtigung/Notice) funktionieren nur,
  solange Obsidian laeuft; es gibt keinen App-unabhaengigen Hintergrunddienst.
  Der ICS-Export deckt diese Luecke ab, indem ein echter Kalender die
  Faelligkeiten unabhaengig von Obsidian benachrichtigt.
- Inline-Aufgaben unterstuetzen keine eigene Beschreibung, keine eigene
  Erinnerungszeit und keine Kontext-Tags im Bearbeiten-Dialog ueber die
  Inline-Syntax hinaus; inhaltliche Aenderungen ueberfuehren die Aufgabe
  automatisch in eine Datei.
