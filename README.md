# GTD Board (Obsidian Plugin)

A customizable GTD-based Kanban board for Obsidian.

## How it works

- Scans a configurable folder **including subfolders** for tasks.
- Two task sources:
  - **File tasks** (primary): each task is its own Markdown file inside the
    "task subfolder". Frontmatter holds lane, due date, reminder, and tags;
    the file body is the Markdown description.
  - **Inline checkboxes**: `- [ ] Text #gtd/next 📅 2026-09-20` in regular
    notes inside the watched folder. The lane is recognized via a tag
    (e.g. `#gtd/next`), the due date via `📅 YYYY-MM-DD` (optionally with
    `⏰HH:mm`).
- **Swimlanes** are color-coded and freely renamable/reorderable. The default
  follows the GTD system (Inbox, Next Actions, Waiting For,
  Someday/Maybe, Done), but is fully customizable (settings). Each lane can
  be collapsed into a narrow vertical strip via an arrow icon; the collapsed
  state is saved.
- **"Done" is purely checkbox-driven**: a task automatically appears in the
  lane marked "isDone" as soon as its checkbox is checked (inline checkbox
  `- [x]` or `done: true` in frontmatter) - independent of its regular lane
  tag. The Done lane deliberately carries no tag of its own.
- **Drag & drop** moves tasks between lanes and writes the change straight
  back into the underlying file: for file tasks into the frontmatter
  (`lane:` / `done:`), for inline tasks by toggling the checkbox or swapping
  the lane tag directly in the line. When moved to "Done", the original lane
  tag is kept so the task returns to its home lane when un-checked.
- **New tasks** can be created via the "+" button on each lane (always as a
  file task).
- **Editing** a task (title, Markdown description, due date, reminder, tags)
  opens a dialog with a "Preview"/"Edit" toggle for the description
  (Markdown source and rendered preview shown one after another rather than
  side by side). Editing the content of an inline task automatically creates
  a task file and removes the original checkbox line.
- **Reminders**: due date plus an optional custom reminder time (otherwise a
  default offset before the due date). The plugin periodically checks for
  due reminders and shows a desktop notification (browser notification) as
  well as an Obsidian notice with snooze buttons ("1 hr", "Tomorrow 9:00") -
  clicking one pushes the reminder to the chosen time and it fires again
  automatically afterward.
- **Search/filter**: the toolbar above the board has a search field that
  filters cards by title or tag. Lane counters still show the unfiltered
  total.
- **Per-lane WIP limit**: settings let you set an optional limit on
  simultaneous tasks per lane. When exceeded, the counter in the lane header
  is highlighted in bold red.
- **Due-date color coding**: cards with a due date are colored by urgency -
  today/overdue red, this week yellow, later neutral. Completed tasks are no
  longer color-highlighted.
- **Sortable lanes**: a dropdown in the toolbar lets you sort cards within
  all lanes by custom order, priority, due date, or title (default:
  priority); the choice is remembered.
- **"Planned" overview lane**: an optional, virtual lane (enabled in
  settings) that automatically shows all open tasks with a due date -
  regardless of their actual lane, always sorted ascending by due date. Each
  card additionally carries a badge showing its home lane. No tag of its
  own, not a drop target.
- **Priority**: tasks can be rated High/Medium/Low (inline via 🔺/🔽,
  otherwise no marker; file tasks via frontmatter `priority:`). Cards show a
  colored left border plus icon; the default sort order follows priority.
- **Quick capture**: the "Quick capture: create new task" command (can be
  bound to a hotkey) instantly creates a new task in the default lane from
  anywhere in the vault, without opening the board - classic GTD capture.
- **Subtasks/checklists**: Markdown checkboxes (`- [ ]`/`- [x]`) in a file
  task's description are shown on the card as progress ("3/5") including a
  bar.
- **Context tags**: `@Office`, `@Phone`, etc. as a second filter dimension
  independent of the lane - closer to "real" GTD than plain status lanes.
  Maintained like tags in the description dialog or recognized inline via
  `@word`; a dedicated dropdown in the toolbar filters by them.
- **Automatic archiving**: completed file tasks can be automatically moved
  to an archive folder after a configurable number of days (default:
  disabled), so "Done" doesn't grow forever. Tasks with no known completion
  time are never moved automatically.
- **ICS export**: all open due dates can be written into the vault as an
  `.ics` file (automatically on every refresh, or manually via a
  command/button in settings). A real calendar app can subscribe to/import
  this file and take over reliable notifications, even when Obsidian isn't
  running.
- **Recurring tasks**: a task can be marked as daily/weekly/monthly/yearly
  recurring (dialog dropdown "Recurrence"; inline via `🔁 weekly` etc.). When
  moved to "Done" or checked off directly in the note, it automatically
  jumps to its next due date and stays open instead of being completed -
  classic "every Monday" behavior, has no effect without a due date.
- **Agenda view**: "Kanban"/"Agenda" toggle in the toolbar. The agenda view
  shows all open tasks across lanes as a flat list, always sorted ascending
  by due date (tasks without a due date at the end); each card carries a
  badge with its actual lane.
- **Bulk actions**: the "Multi-select" button shows a checkbox on every
  card; selected tasks can be moved together to a target lane or (with a
  confirmation prompt) deleted together.
- **Done checkbox on the card**: every card has a checkbox on the left of
  its title that marks the task done (or undoes that) directly, without
  opening the edit dialog - moves it into/out of the "Done" lane
  automatically, including recurrence logic.
- **Week view**: a third view (alongside Kanban/Agenda) with a real calendar
  grid - Monday through Sunday as columns, open tasks with a due date sit
  under their calendar day. Navigation to the previous/next week plus a
  "Today" button. For anything beyond that (rescheduling, combining several
  calendars), the ICS export remains the better route.
- **Delegation**: a task can be marked as "delegated to XY" (dialog field
  "Delegated to"; inline via `👤 Name`, a single word with no spaces). Shown
  discreetly on the card like context/tags, and preserved when moved between
  lanes.
- **Project**: a free, second organizing dimension alongside lane and
  context - a task belongs to exactly one project (dialog field "Project";
  inline via `+ProjectName`, todo.txt syntax). A dedicated dropdown in the
  toolbar filters by it; the project appears discreetly on the card's tag
  row. Reflects GTD's project list without cluttering the lane/status view.
- **Staleness marker ("Waiting For" & "Someday/Maybe")**: a card that has
  sat longer than configured (Settings → "Refresh", default 5 or 60 days)
  without content changes or review in "Waiting For" or a lane marked
  "Someday/Maybe" gets a yellow border plus a hint tag. Purely visual -
  prevents delegations from stalling silently or the someday/maybe list from
  becoming a graveyard, without changing anything automatically. Which lanes
  count as "Someday" is toggled per lane in settings.
- **Weekly review**: toolbar button (clipboard-check icon) or the "Start
  weekly review" command walks you through all open tasks, lane by lane,
  within a lane the longest-untouched first - a classic GTD Weekly Review.
  Three actions per task: "Looks good" (confirms the task unchanged and
  resets its staleness timer), "Edit" (opens the normal dialog), or "Done"
  (moves straight to the Done lane).
- **Natural-language quick capture**: quick capture understands the same
  compact syntax as inline checkboxes while typing - `📅 date`, `@context`,
  `+project`, `👤 delegate`, `🔺`/`🔽` priority, `🔁 recurrence`, and
  `#lane/tag` for direct lane assignment - and shows a live preview of what
  was recognized. So e.g. "Review quote @Office +SAP-Transformation 📅
  tomorrow 🔺" can be captured completely in one go, without touching up the
  task afterward on the board.
- **Multi-language**: the interface (buttons, menus, settings,
  notifications) is available in German and English and automatically
  follows Obsidian's own language setting - no extra configuration needed.
  The inline syntax in your notes themselves (tags, `today`/`tomorrow`/`day
  after tomorrow`, recurrence words) stays independent of the interface
  language so existing notes don't break. Further languages can be added via
  `src/i18n/`.

## Installation (manual, for testing)

1. Copy the `gtd-board` folder into `<Vault>/.obsidian/plugins/` (or place
   `main.js`, `manifest.json`, `styles.css` there in a new subfolder).
2. In Obsidian: Settings → Community plugins → enable "GTD Board".
3. Check the plugin's settings: folder, task subfolder, lanes.
4. Open the board via the ribbon icon or the "Open GTD Board" command.

## Development

```bash
npm install
npm run dev      # esbuild watch
npm run build    # typecheck + production build (main.js)
npm test         # unit tests (parser, date logic, reminders)
```

## Publishing to the Community Plugins directory

Obsidian now handles plugin submission through a web form rather than a pull
request against `obsidian-releases`:

1. Push the source code to a **public GitHub repository** (the repo name
   should match the plugin ID `gtd-board`). `LICENSE` (MIT) is already
   included.
2. Make sure the plugin ID in `manifest.json` doesn't collide with an
   already-listed community plugin.
3. Push a Git tag matching the version number in `manifest.json` exactly
   (no `v` prefix), e.g. `git tag 0.1.0 && git push origin 0.1.0`. The
   included GitHub Actions workflow (`.github/workflows/release.yml`) then
   builds the plugin, runs typecheck/tests, attests build provenance for
   `main.js`/`styles.css`, and attaches `main.js`, `manifest.json`, and
   `styles.css` as release assets automatically.
4. Add the new version to `versions.json` on every release (mapping plugin
   version → minimum Obsidian version).
5. Go to [community.obsidian.md](https://community.obsidian.md), sign in
   with your Obsidian account, link your GitHub account, and use "Add your
   plugin" to point it at this repository. The platform reads `manifest.json`
   from the default branch and pulls the release assets from the GitHub
   Release whose tag matches the manifest version. An automated check
   (linting, API-version checks, security patterns) runs first; once that
   passes, a manual review by the Obsidian team follows before the plugin
   appears in the in-app Community Plugins browser.
6. After approval, a new tag/release is enough for every further version -
   users then get updates automatically through the Community Plugins
   manager.

Alternative for quick, informal distribution without the review wait: make
the plugin installable from the GitHub repo via
[BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewer's Auto
Tester), bypassing the official submission process.

## Known limitations

- In-app reminders (desktop notification/notice) only work while Obsidian
  is running; there's no app-independent background service. The ICS export
  covers this gap by letting a real calendar app notify you of due dates
  independently of Obsidian.
- Inline tasks don't support their own description, their own reminder
  time, or context tags in the edit dialog beyond the inline syntax; content
  edits automatically convert the task into a file.
