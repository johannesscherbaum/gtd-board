import {
	combineDateTimeValue,
	dueChipDate,
	reminderChipValue,
	roundToQuarterHour,
	splitDateTimeValue,
} from "../src/util";

describe("splitDateTimeValue / combineDateTimeValue", () => {
	it("zerlegt und verbindet Datum mit und ohne Uhrzeit verlustfrei", () => {
		expect(splitDateTimeValue("2026-11-26T14:30")).toEqual(["2026-11-26", "14:30"]);
		expect(splitDateTimeValue("2026-11-26")).toEqual(["2026-11-26", ""]);
		expect(splitDateTimeValue(undefined)).toEqual(["", ""]);
		expect(combineDateTimeValue("2026-11-26", "14:30")).toBe("2026-11-26T14:30");
		expect(combineDateTimeValue("2026-11-26", "")).toBe("2026-11-26");
		expect(combineDateTimeValue("", "14:30")).toBeUndefined();
	});
});

describe("roundToQuarterHour", () => {
	it("rundet auf 15-Minuten-Schritte", () => {
		expect(roundToQuarterHour("14:07")).toBe("14:00");
		expect(roundToQuarterHour("14:08")).toBe("14:15");
		expect(roundToQuarterHour("23:55")).toBe("00:00");
		expect(roundToQuarterHour("")).toBe("");
	});
});

describe("Schnellwahl-Chips", () => {
	// Donnerstag, 26.11.2026, 10:20
	const now = new Date(2026, 10, 26, 10, 20);

	it("Faelligkeit: heute, morgen, Montag naechste Woche", () => {
		expect(dueChipDate("today", now)).toBe("2026-11-26");
		expect(dueChipDate("tomorrow", now)).toBe("2026-11-27");
		expect(dueChipDate("nextWeek", now)).toBe("2026-11-30");
	});

	it("Faelligkeit: naechste Woche von einem Sonntag aus ist der folgende Montag", () => {
		expect(dueChipDate("nextWeek", new Date(2026, 10, 29, 12, 0))).toBe("2026-11-30");
	});

	it("Erinnerung: in einer Stunde, auf die naechste Viertelstunde aufgerundet", () => {
		expect(reminderChipValue("in1h", now)).toEqual(["2026-11-26", "11:30"]);
		expect(reminderChipValue("in1h", new Date(2026, 10, 26, 10, 15))).toEqual(["2026-11-26", "11:15"]);
	});

	it("Erinnerung: in einer Stunde kurz vor Mitternacht faellt auf den naechsten Tag", () => {
		expect(reminderChipValue("in1h", new Date(2026, 10, 26, 23, 50))).toEqual(["2026-11-27", "01:00"]);
	});

	it("Erinnerung: morgen 9:00 und naechste Woche Montag 9:00", () => {
		expect(reminderChipValue("tomorrowMorning", now)).toEqual(["2026-11-27", "09:00"]);
		expect(reminderChipValue("nextWeek", now)).toEqual(["2026-11-30", "09:00"]);
	});
});
