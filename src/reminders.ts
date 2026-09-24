import { Notice } from "obsidian";
// createFragment/createDiv/createEl usw. sind globale Ambient-Funktionen aus obsidian.d.ts
// (declare global), nicht Modul-Exporte - deshalb hier ohne Import direkt aufrufbar.
import { GtdBoardSettings, GtdTask } from "./types";
import { computeEffectiveReminder } from "./util";
import { t } from "./i18n";

export interface ReminderHost {
	getSettings: () => GtdBoardSettings;
	getAllTasks: () => Promise<GtdTask[]>;
	saveFiredReminders: (fired: Record<string, string>) => Promise<void>;
	saveSnoozedUntil: (snoozed: Record<string, string>) => Promise<void>;
}

/**
 * Snooze-Optionen, die auf einer Erinnerungs-Notice als Buttons angeboten werden.
 * `labelKey` statt eines fertigen Labels, damit die Uebersetzung erst beim tatsaechlichen
 * Anzeigen (mit der dann aktiven Sprache) aufgeloest wird, nicht schon beim Modul-Import.
 */
const SNOOZE_OPTIONS: { labelKey: "reminders.snooze1h" | "reminders.snoozeTomorrow"; computeUntil: (now: Date) => Date }[] = [
	{ labelKey: "reminders.snooze1h", computeUntil: (now) => new Date(now.getTime() + 60 * 60_000) },
	{
		labelKey: "reminders.snoozeTomorrow",
		computeUntil: (now) => {
			const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
			return next;
		},
	},
];

/**
 * Prueft periodisch alle Aufgaben auf faellige Erinnerungen und loest dafuer eine
 * Desktop-Benachrichtigung (Web-Notification-API, wenn verfuegbar) sowie eine
 * Obsidian-Notice aus. Merkt sich pro Aufgabe, fuer welchen Erinnerungszeitpunkt
 * bereits benachrichtigt wurde, damit nicht mehrfach erinnert wird.
 */
export class ReminderScheduler {
	private intervalId: number | null = null;

	constructor(private host: ReminderHost) {}

	start(): void {
		this.stop();
		const seconds = Math.max(15, this.host.getSettings().reminderCheckIntervalSeconds || 60);
		this.intervalId = window.setInterval(() => {
			void this.checkNow();
		}, seconds * 1000);
		void this.checkNow();
	}

	stop(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	async checkNow(): Promise<void> {
		const settings = this.host.getSettings();
		const tasks = await this.host.getAllTasks();
		const now = new Date();
		const fired = { ...settings.firedReminders };
		const snoozed = { ...(settings.snoozedUntil ?? {}) };
		let firedChanged = false;
		let snoozedChanged = false;

		for (const task of tasks) {
			if (task.done) continue;

			const snoozeUntilRaw = snoozed[task.id];
			if (snoozeUntilRaw) {
				const snoozeUntil = new Date(snoozeUntilRaw);
				if (!Number.isNaN(snoozeUntil.getTime()) && snoozeUntil.getTime() > now.getTime()) {
					// Noch snoozed, diesen Zyklus ueberspringen.
					continue;
				}
				// Snooze abgelaufen: Erinnerung erneut ausloesen und Snooze aufheben.
				delete snoozed[task.id];
				snoozedChanged = true;
				this.notify(task, now);
				fired[task.id] = now.toISOString();
				firedChanged = true;
				continue;
			}

			const reminderDate = computeEffectiveReminder(task, settings);
			if (!reminderDate) continue;
			if (reminderDate.getTime() > now.getTime()) continue;

			const reminderKey = reminderDate.toISOString();
			if (fired[task.id] === reminderKey) continue;

			this.notify(task, reminderDate);
			fired[task.id] = reminderKey;
			firedChanged = true;
		}

		if (firedChanged) {
			await this.host.saveFiredReminders(fired);
		}
		if (snoozedChanged) {
			await this.host.saveSnoozedUntil(snoozed);
		}
	}

	/** Snoozed eine Aufgabe bis zu einem bestimmten Zeitpunkt (persistiert sofort). */
	async snoozeTask(taskId: string, until: Date): Promise<void> {
		const settings = this.host.getSettings();
		const snoozed = { ...(settings.snoozedUntil ?? {}), [taskId]: until.toISOString() };
		await this.host.saveSnoozedUntil(snoozed);
	}

	private notify(task: GtdTask, reminderDate: Date): void {
		const timeLabel = `${String(reminderDate.getHours()).padStart(2, "0")}:${String(
			reminderDate.getMinutes()
		).padStart(2, "0")}`;
		const body = task.due ? t("reminders.due", { due: task.due }) : t("reminders.at", { time: timeLabel });
		const titleText = t("reminders.title", { task: task.title });

		if (typeof document === "undefined") {
			// Test-/Node-Umgebung ohne DOM: einfache Text-Notice.
			new Notice(`${titleText}\n${body}`, 10000);
		} else {
			let noticeRef: Notice | undefined;
			const frag = createFragment((el) => {
				el.createDiv({ text: titleText }).setCssStyles({ fontWeight: "600" });
				el.createDiv({ text: body }).setCssStyles({ marginBottom: "6px" });

				const buttonRow = el.createDiv();
				buttonRow.setCssStyles({ display: "flex", gap: "6px", marginTop: "4px" });
				for (const option of SNOOZE_OPTIONS) {
					const btn = buttonRow.createEl("button", { text: t(option.labelKey) });
					btn.setCssStyles({ fontSize: "12px" });
					btn.onclick = (evt) => {
						evt.preventDefault();
						evt.stopPropagation();
						void this.snoozeTask(task.id, option.computeUntil(new Date()));
						noticeRef?.hide();
					};
				}
			});

			noticeRef = new Notice(frag, 15000);
		}

		if (typeof Notification !== "undefined") {
			if (Notification.permission === "granted") {
				new Notification(titleText, { body });
			} else if (Notification.permission !== "denied") {
				void Notification.requestPermission().then((perm) => {
					if (perm === "granted") {
						new Notification(titleText, { body });
					}
				});
			}
		}
	}
}
