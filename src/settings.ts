import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type GtdBoardPlugin from "./main";
import { LaneConfig } from "./types";
import { t } from "./i18n";

let laneIdCounter = 0;
function newLaneId(): string {
	laneIdCounter += 1;
	return `lane-${Date.now()}-${laneIdCounter}`;
}

/**
 * Deklarative Settings-API (getSettingDefinitions()) statt der seit 1.13.0 veralteten
 * display()-Methode - dadurch tauchen die Einstellungen auch in Obsidians globaler
 * Einstellungs-Suche auf. Fast alle Zeilen nutzen weiterhin `render`, statt jede einzelne
 * auf den `control`/`key`-Mechanismus umzustellen: die meisten Zeilen loesen beim Aendern
 * Seiteneffekte aus (refreshBoardViews(), restartReminderScheduler(), exportIcs()) und die
 * Swimlane-Liste ist ein dynamisches Array mit mehreren Controls pro Zeile (Farbe, Name, Tag,
 * vier Toggles, WIP-Limit, Verschieben/Loeschen) - das passt nicht in das 1:1-Modell von
 * `control`. `render` ist dafuer der von Obsidian selbst vorgesehene Ausweg und behaelt Name/
 * Beschreibung jeder Zeile fuer die Suche bei.
 */
export class GtdBoardSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: GtdBoardPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const settings = this.plugin.settings;

		return [
			{
				type: "group",
				heading: t("settings.heading"),
				items: [
					{
						name: t("settings.folder.name"),
						desc: t("settings.folder.desc"),
						render: (setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder(t("settings.folder.placeholder"))
									.setValue(settings.watchFolder)
									.onChange(async (value) => {
										settings.watchFolder = value.trim();
										await this.plugin.saveSettings();
									})
							);
						},
					},
					{
						name: t("settings.taskFolder.name"),
						desc: t("settings.taskFolder.desc"),
						render: (setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder(t("settings.taskFolder.placeholder"))
									.setValue(settings.taskFilesFolder)
									.onChange(async (value) => {
										settings.taskFilesFolder = value.trim();
										await this.plugin.saveSettings();
									})
							);
						},
					},
					{
						name: t("settings.inlineCheckboxes.name"),
						desc: t("settings.inlineCheckboxes.desc"),
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle.setValue(settings.scanInlineTasks).onChange(async (value) => {
									settings.scanInlineTasks = value;
									await this.plugin.saveSettings();
									await this.plugin.refreshBoardViews();
								})
							);
						},
					},
					{
						name: t("settings.autoPromoteInbox.name"),
						desc: t("settings.autoPromoteInbox.desc"),
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle.setValue(settings.autoPromoteInboxOnDueDate).onChange(async (value) => {
									settings.autoPromoteInboxOnDueDate = value;
									await this.plugin.saveSettings();
								})
							);
						},
					},
					{
						name: t("settings.defaultReminder.name"),
						desc: t("settings.defaultReminder.desc"),
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(String(settings.defaultReminderOffsetMinutes)).onChange(async (value) => {
									const n = Number(value);
									if (!isNaN(n) && n >= 0) {
										settings.defaultReminderOffsetMinutes = n;
										await this.plugin.saveSettings();
									}
								})
							);
						},
					},
					{
						name: t("settings.checkInterval.name"),
						desc: t("settings.checkInterval.desc"),
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(String(settings.reminderCheckIntervalSeconds)).onChange(async (value) => {
									const n = Number(value);
									if (!isNaN(n) && n >= 15) {
										settings.reminderCheckIntervalSeconds = n;
										await this.plugin.saveSettings();
										this.plugin.restartReminderScheduler();
									}
								})
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: t("settings.archivingHeading"),
				items: [
					{
						name: t("settings.autoArchive.name"),
						desc: t("settings.autoArchive.desc"),
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(String(settings.archiveAfterDays)).onChange(async (value) => {
									const n = Number(value);
									if (!isNaN(n) && n >= 0) {
										settings.archiveAfterDays = n;
										await this.plugin.saveSettings();
									}
								})
							);
						},
					},
					{
						name: t("settings.archiveFolder.name"),
						desc: t("settings.archiveFolder.desc", { path: `${settings.taskFilesFolder}/Archiv` }),
						render: (setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder(t("settings.archiveFolder.placeholder", { path: `${settings.taskFilesFolder}/Archiv` }))
									.setValue(settings.archiveFolder)
									.onChange(async (value) => {
										settings.archiveFolder = value.trim();
										await this.plugin.saveSettings();
									})
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: t("settings.refreshHeading"),
				items: [
					{
						name: t("settings.delegateFollowUp.name"),
						desc: t("settings.delegateFollowUp.desc"),
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(String(settings.delegateFollowUpDays)).onChange(async (value) => {
									const n = Number(value);
									if (!isNaN(n) && n >= 0) {
										settings.delegateFollowUpDays = n;
										await this.plugin.saveSettings();
										await this.plugin.refreshBoardViews();
									}
								})
							);
						},
					},
					{
						name: t("settings.somedayRefresh.name"),
						desc: t("settings.somedayRefresh.desc"),
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(String(settings.somedayRefreshDays)).onChange(async (value) => {
									const n = Number(value);
									if (!isNaN(n) && n >= 0) {
										settings.somedayRefreshDays = n;
										await this.plugin.saveSettings();
										await this.plugin.refreshBoardViews();
									}
								})
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: t("settings.icsHeading"),
				desc: t("settings.icsDesc"),
				items: [
					{
						name: t("settings.icsEnable.name"),
						desc: t("settings.icsEnable.desc"),
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle.setValue(settings.icsExportEnabled).onChange(async (value) => {
									settings.icsExportEnabled = value;
									await this.plugin.saveSettings();
									if (value) await this.plugin.exportIcs(false);
								})
							);
						},
					},
					{
						name: t("settings.icsPath.name"),
						desc: t("settings.icsPath.desc"),
						render: (setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder(t("settings.icsPath.placeholder"))
									.setValue(settings.icsExportPath)
									.onChange(async (value) => {
										settings.icsExportPath = value.trim();
										await this.plugin.saveSettings();
									})
							);
						},
					},
					{
						name: t("settings.exportNow"),
						render: (setting) => {
							setting.addButton((btn) =>
								btn.setButtonText(t("settings.exportNow")).onClick(() => void this.plugin.exportIcs(true))
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: t("settings.swimlanesHeading"),
				desc: t("settings.swimlanesDesc"),
				items: [
					...settings.lanes.map((lane, index) => ({
						name: lane.name || t("settings.newLaneName"),
						render: (setting: Setting) => this.renderLaneRow(setting, lane, index),
					})),
					{
						name: t("settings.addLane"),
						render: (setting: Setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText(t("settings.addLane"))
									.setCta()
									.onClick(async () => {
										settings.lanes.push({
											id: newLaneId(),
											name: t("settings.newLaneName"),
											color: "#8e8e93",
											tag: "gtd/neu",
										});
										await this.plugin.saveSettings();
										this.update();
									})
							);
						},
					},
				],
			},
		];
	}

	private renderLaneRow(row: Setting, lane: LaneConfig, index: number): void {
		const settings = this.plugin.settings;
		row.setClass("gtd-lane-setting-row");

		row.addColorPicker((cp) =>
			cp.setValue(lane.color).onChange(async (value) => {
				lane.color = value;
				await this.plugin.saveSettings();
				await this.plugin.refreshBoardViews();
			})
		);

		row.addText((text) =>
			text
				.setPlaceholder(t("settings.lane.namePlaceholder"))
				.setValue(lane.name)
				.onChange(async (value) => {
					lane.name = value;
					await this.plugin.saveSettings();
					await this.plugin.refreshBoardViews();
				})
		);

		row.addText((text) => {
			const noTag = !!lane.isDone || !!lane.isPlanned;
			text
				.setPlaceholder(noTag ? t("settings.lane.noTag") : t("settings.lane.tagPlaceholder"))
				.setValue(noTag ? "" : lane.tag)
				.setDisabled(noTag)
				.onChange(async (value) => {
					lane.tag = value.replace(/^#/, "").trim();
					await this.plugin.saveSettings();
				});
			if (lane.isDone) {
				text.inputEl.title = t("settings.lane.doneTagTitle");
			} else if (lane.isPlanned) {
				text.inputEl.title = t("settings.lane.plannedTagTitle");
			}
		});

		row.addToggle((toggle) =>
			toggle
				.setTooltip(t("settings.lane.doneTooltip"))
				.setValue(!!lane.isDone)
				.onChange(async (value) => {
					lane.isDone = value;
					if (value) lane.isPlanned = false;
					await this.plugin.saveSettings();
					await this.plugin.refreshBoardViews();
					this.update();
				})
		);

		row.addToggle((toggle) =>
			toggle
				.setTooltip(t("settings.lane.plannedTooltip"))
				.setValue(!!lane.isPlanned)
				.onChange(async (value) => {
					lane.isPlanned = value;
					if (value) lane.isDone = false;
					await this.plugin.saveSettings();
					await this.plugin.refreshBoardViews();
					this.update();
				})
		);

		row.addToggle((toggle) =>
			toggle
				.setTooltip(t("settings.lane.somedayTooltip"))
				.setValue(!!lane.isSomeday)
				.onChange(async (value) => {
					lane.isSomeday = value;
					await this.plugin.saveSettings();
					await this.plugin.refreshBoardViews();
				})
		);

		row.addToggle((toggle) =>
			toggle
				.setTooltip(t("settings.lane.inboxTooltip"))
				.setValue(!!lane.isInbox)
				.onChange(async (value) => {
					lane.isInbox = value;
					await this.plugin.saveSettings();
				})
		);

		row.addToggle((toggle) =>
			toggle
				.setTooltip(t("settings.lane.nextActionsTooltip"))
				.setValue(!!lane.isNextActions)
				.onChange(async (value) => {
					lane.isNextActions = value;
					await this.plugin.saveSettings();
				})
		);

		row.addText((text) => {
			text
				.setPlaceholder(t("settings.lane.wipLimitPlaceholder"))
				.setValue(lane.wipLimit ? String(lane.wipLimit) : "")
				.onChange(async (value) => {
					const trimmed = value.trim();
					if (trimmed === "") {
						lane.wipLimit = undefined;
					} else {
						const parsed = Number.parseInt(trimmed, 10);
						lane.wipLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
					}
					await this.plugin.saveSettings();
					await this.plugin.refreshBoardViews();
				});
			text.inputEl.type = "number";
			text.inputEl.min = "1";
			text.inputEl.setCssStyles({ width: "70px" });
			text.inputEl.title = t("settings.lane.wipLimitTitle");
		});

		row.addExtraButton((btn) =>
			btn
				.setIcon("arrow-up")
				.setTooltip(t("settings.lane.moveUp"))
				.setDisabled(index === 0)
				.onClick(async () => {
					if (index === 0) return;
					[settings.lanes[index - 1], settings.lanes[index]] = [
						settings.lanes[index],
						settings.lanes[index - 1],
					];
					await this.plugin.saveSettings();
					this.update();
				})
		);

		row.addExtraButton((btn) =>
			btn
				.setIcon("arrow-down")
				.setTooltip(t("settings.lane.moveDown"))
				.setDisabled(index === settings.lanes.length - 1)
				.onClick(async () => {
					if (index === settings.lanes.length - 1) return;
					[settings.lanes[index + 1], settings.lanes[index]] = [
						settings.lanes[index],
						settings.lanes[index + 1],
					];
					await this.plugin.saveSettings();
					this.update();
				})
		);

		row.addExtraButton((btn) =>
			btn
				.setIcon("trash")
				.setTooltip(t("settings.lane.delete"))
				.onClick(async () => {
					settings.lanes.splice(index, 1);
					await this.plugin.saveSettings();
					this.update();
					await this.plugin.refreshBoardViews();
				})
		);
	}
}
