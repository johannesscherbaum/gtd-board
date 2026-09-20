import { ReminderScheduler } from "../src/reminders";
import { DEFAULT_SETTINGS, GtdBoardSettings, GtdTask } from "../src/types";

const RealDate = Date;

async function withMockedNow<T>(isoNow: string, fn: () => Promise<T>): Promise<T> {
	class MockDate extends RealDate {
		constructor(...args: any[]) {
			if (args.length === 0) {
				super(isoNow);
			} else {
				// @ts-expect-error - spreading into Date constructor
				super(...args);
			}
		}
		static now(): number {
			return new RealDate(isoNow).getTime();
		}
	}
	(global as any).Date = MockDate;
	try {
		return await fn();
	} finally {
		(global as any).Date = RealDate;
	}
}

function makeTask(overrides: Partial<GtdTask>): GtdTask {
	return {
		id: "file::GTD/Aufgaben/Test.md",
		source: "file",
		title: "Test",
		description: "",
		laneId: "next-actions",
		done: false,
		tags: [],
		filePath: "GTD/Aufgaben/Test.md",
		order: 0,
		...overrides,
	};
}

describe("ReminderScheduler.checkNow", () => {
	it("benachrichtigt fuer eine faellige, noch nicht ausgeloeste Erinnerung und merkt sie sich", async () => {
		const settings: GtdBoardSettings = { ...DEFAULT_SETTINGS, firedReminders: {} };
		const task = makeTask({ reminderAt: "2026-09-20T13:55" });
		let saved: Record<string, string> | undefined;

		const scheduler = new ReminderScheduler({
			getSettings: () => settings,
			getAllTasks: async () => [task],
			saveFiredReminders: async (fired) => {
				saved = fired;
			},
			saveSnoozedUntil: async () => {},
		});

		await withMockedNow("2026-09-20T14:00:00", () => scheduler.checkNow());

		expect(saved).toBeDefined();
		expect(saved?.[task.id]).toBe(new Date("2026-09-20T13:55").toISOString());
	});

	it("benachrichtigt kein zweites Mal fuer denselben Erinnerungszeitpunkt", async () => {
		const reminderKey = new Date("2026-09-20T13:55").toISOString();
		const task = makeTask({ reminderAt: "2026-09-20T13:55" });
		const settings: GtdBoardSettings = {
			...DEFAULT_SETTINGS,
			firedReminders: { [task.id]: reminderKey },
		};
		let saveCalled = false;

		const scheduler = new ReminderScheduler({
			getSettings: () => settings,
			getAllTasks: async () => [task],
			saveFiredReminders: async () => {
				saveCalled = true;
			},
			saveSnoozedUntil: async () => {},
		});

		await withMockedNow("2026-09-20T14:00:00", () => scheduler.checkNow());
		expect(saveCalled).toBe(false);
	});

	it("ignoriert Aufgaben ohne Faelligkeit/Erinnerung und bereits erledigte Aufgaben", async () => {
		const settings: GtdBoardSettings = { ...DEFAULT_SETTINGS, firedReminders: {} };
		const noReminder = makeTask({ id: "a" });
		const doneTask = makeTask({ id: "b", done: true, reminderAt: "2020-01-01T00:00" });
		let saveCalled = false;

		const scheduler = new ReminderScheduler({
			getSettings: () => settings,
			getAllTasks: async () => [noReminder, doneTask],
			saveFiredReminders: async () => {
				saveCalled = true;
			},
			saveSnoozedUntil: async () => {},
		});

		await scheduler.checkNow();
		expect(saveCalled).toBe(false);
	});

	it("ignoriert Erinnerungen, die noch in der Zukunft liegen", async () => {
		const settings: GtdBoardSettings = { ...DEFAULT_SETTINGS, firedReminders: {} };
		const task = makeTask({ reminderAt: "2026-09-20T13:55" });
		let saveCalled = false;

		const scheduler = new ReminderScheduler({
			getSettings: () => settings,
			getAllTasks: async () => [task],
			saveFiredReminders: async () => {
				saveCalled = true;
			},
			saveSnoozedUntil: async () => {},
		});

		await withMockedNow("2026-09-20T10:00:00", () => scheduler.checkNow());
		expect(saveCalled).toBe(false);
	});

	it("ueberspringt eine noch snoozte Aufgabe, auch wenn ihre Erinnerung faellig waere", async () => {
		const task = makeTask({ reminderAt: "2026-09-20T09:00" });
		// Snooze-Ende liegt (in derselben lokalen Zeitzone wie "now") eine Stunde nach "now".
		const snoozeUntil = new Date(2026, 8, 20, 15, 0, 0).toISOString();
		const settings: GtdBoardSettings = {
			...DEFAULT_SETTINGS,
			firedReminders: {},
			snoozedUntil: { [task.id]: snoozeUntil },
		};
		let firedSaveCalled = false;
		let snoozedSaveCalled = false;

		const scheduler = new ReminderScheduler({
			getSettings: () => settings,
			getAllTasks: async () => [task],
			saveFiredReminders: async () => {
				firedSaveCalled = true;
			},
			saveSnoozedUntil: async () => {
				snoozedSaveCalled = true;
			},
		});

		await withMockedNow("2026-09-20T14:00:00", () => scheduler.checkNow());
		expect(firedSaveCalled).toBe(false);
		expect(snoozedSaveCalled).toBe(false);
	});

	it("loest eine abgelaufene Snooze erneut aus und entfernt den Snooze-Eintrag", async () => {
		const task = makeTask({ reminderAt: "2026-09-20T09:00" });
		// Snooze-Ende liegt (in derselben lokalen Zeitzone wie "now") eine Stunde vor "now".
		const snoozeUntil = new Date(2026, 8, 20, 13, 0, 0).toISOString();
		const settings: GtdBoardSettings = {
			...DEFAULT_SETTINGS,
			firedReminders: {},
			snoozedUntil: { [task.id]: snoozeUntil },
		};
		let savedFired: Record<string, string> | undefined;
		let savedSnoozed: Record<string, string> | undefined;

		const scheduler = new ReminderScheduler({
			getSettings: () => settings,
			getAllTasks: async () => [task],
			saveFiredReminders: async (fired) => {
				savedFired = fired;
			},
			saveSnoozedUntil: async (snoozed) => {
				savedSnoozed = snoozed;
			},
		});

		await withMockedNow("2026-09-20T14:00:00", () => scheduler.checkNow());
		expect(savedFired?.[task.id]).toBeDefined();
		expect(savedSnoozed?.[task.id]).toBeUndefined();
	});
});
