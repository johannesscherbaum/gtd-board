# GTD Board – Installation im Büro-Vault

## Enthalten
- `gtd-board/main.js`
- `gtd-board/manifest.json`
- `gtd-board/styles.css`

Das ist der aktuelle Stand inkl. aller zuletzt gebauten Erweiterungen
(Projekt-Feld, Wartet-auf-Follow-up, Someday-Auffrischung, Wochenrückblick,
Natural-Language-Schnellerfassung) – identisch mit dem, was bereits im
GitHub-Repo `johannesscherbaum/gtd-board` liegt.

## Installation (manuell, ohne Community-Plugin-Store)

1. Im Ziel-Vault den Ordner `.obsidian/plugins/gtd-board/` anlegen, falls er
   noch nicht existiert (versteckter Ordner `.obsidian` im Vault-Root).
2. Die drei Dateien aus `gtd-board/` in genau diesen Ordner kopieren:
   `.obsidian/plugins/gtd-board/main.js`
   `.obsidian/plugins/gtd-board/manifest.json`
   `.obsidian/plugins/gtd-board/styles.css`
3. Obsidian (neu) starten, dann unter
   **Einstellungen → Community-Plugins → Installierte Plugins** das
   Plugin "GTD Board" aktivieren (Schalter umlegen).
4. Ribbon-Icon (Kanban-Symbol) oder Befehl "GTD Board oeffnen" nutzen.
5. Einmalig in den Plugin-Einstellungen prüfen/anpassen:
   - **Ordner**: welcher Vault-Ordner nach Aufgaben durchsucht wird
   - **Aufgaben-Ordner**: wo neue Aufgaben-Dateien abgelegt werden
   - **Swimlanes**: Vorgabe ist GTD-Systematik, frei anpassbar

## Falls schon eine ältere Version installiert ist

Einfach die drei Dateien überschreiben (Schritt 2) und Obsidian neu laden
(`Cmd/Ctrl+R` oder Befehl "Anwendung neu laden ohne zu speichern"). Die
`data.json` (eigene Einstellungen/Lanes) im selben Ordner bleibt davon
unberührt und muss nicht angefasst werden.

## Bei einem komplett neuen Vault

Ohne vorhandene `data.json` startet das Plugin mit den GTD-Standard-Lanes
(Eingang, Nächste Aktionen, Wartet auf, Irgendwann/Vielleicht, Erledigt) und
Standard-Einstellungen – direkt einsatzbereit, alles weitere lässt sich über
die Einstellungen anpassen.

## Quellcode

Der vollständige TypeScript-Quellcode liegt im GitHub-Repo
`johannesscherbaum/gtd-board`. Für Weiterentwicklung dort klonen statt
dieses Zip zu verwenden – dieses Zip enthält nur die gebauten Dateien
zum Installieren, keine Sources/Tests.
