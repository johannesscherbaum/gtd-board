import { App, PluginSettingTab, Setting } from "obsidian";
import type GtdBoardPlugin from "./main";
import { LaneConfig } from "./types";
import { t } from "./i18n";

let laneIdCounter = 0;
function newLaneId(): string {
	laneIdCounter += 1;
	return `lane-${Date.now()}-${laneIdCounter}`;
}

export class GtdBoardSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: GtdBoardPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;

		containerEl.createEl("h2", { text: t("settings.heading") });

		new Setting(containerEl)
			.setName(t("settings.folder.name"))
			.setDesc(t("settings.folder.desc"))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.folder.placeholder"))
					.setValue(settings.watchFolder)
					.onChange(async (value) => {
						settings.watchFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.taskFolder.name"))
			.setDesc(t("settings.taskFolder.desc"))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.taskFolder.placeholder"))
					.setValue(settings.taskFilesFolder)
					.onChange(async (value) => {
						settings.taskFilesFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.inlineCheckboxes.name"))
			.setDesc(t("settings.inlineCheckboxes.desc"))
			.addToggle((toggle) =>
				toggle.setValue(settings.scanInlineTasks).onChange(async (value) => {
					settings.scanInlineTasks = value;
					await this.plugin.saveSettings();
					await this.plugin.refreshBoardViews();
				})
			);

		new Setting(containerEl)
			.setName(t("settings.defaultReminder.name"))
			.setDesc(t("settings.defaultReminder.desc"))
			.addText((text) =>
				text
					.setValue(String(settings.defaultReminderOffsetMinutes))
					.onChange(async (value) => {
						const n = Number(value);
						if (!isNaN(n) && n >= 0) {
							settings.defaultReminderOffsetMinutes = n;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName(t("settings.checkInterval.name"))
			.setDesc(t("settings.checkInterval.desc"))
			.addText((text) =>
				text.setValue(String(settings.reminderCheckIntervalSeconds)).onChange(async (value) => {
					const n = Number(value);
					if (!isNaN(n) && n >= 15) {
						settings.reminderCheckIntervalSeconds = n;
						await this.plugin.saveSettings();
						this.plugin.restartReminderScheduler();
					}
				})
			);

		containerEl.createEl("h3", { text: t("settings.archivingHeading") });

		new Setting(containerEl)
			.setName(t("settings.autoArchive.name"))
			.setDesc(t("settings.autoArchive.desc"))
			.addText((text) =>
				text.setValue(String(settings.archiveAfterDays)).onChange(async (value) => {
					const n = Number(value);
					if (!isNaN(n) && n >= 0) {
						settings.archiveAfterDays = n;
						await this.plugin.saveSettings();
					}
				})
			);

		new Setting(containerEl)
			.setName(t("settings.archiveFolder.name"))
			.setDesc(t("settings.archiveFolder.desc", { path: `${settings.taskFilesFolder}/Archiv` }))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.archiveFolder.placeholder", { path: `${settings.taskFilesFolder}/Archiv` }))
					.setValue(settings.archiveFolder)
					.onChange(async (value) => {
						settings.archiveFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: t("settings.refreshHeading") });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: t("settings.refreshDesc"),
		});

		new Setting(containerEl)
			.setName(t("settings.delegateFollowUp.name"))
			.setDesc(t("settings.delegateFollowUp.desc"))
			.addText((text) =>
				text.setValue(String(settings.delegateFollowUpDays)).onChange(async (value) => {
					const n = Number(value);
					if (!isNaN(n) && n >= 0) {
						settings.delegateFollowUpDays = n;
						await this.plugin.saveSettings();
						await this.plugin.refreshBoardViews();
					}
				})
			);

		new Setting(containerEl)
			.setName(t("settings.somedayRefresh.name"))
			.setDesc(t("settings.somedayRefresh.desc"))
			.addText((text) =>
				text.setValue(String(settings.somedayRefreshDays)).onChange(async (value) => {
					const n = Number(value);
					if (!isNaN(n) && n >= 0) {
						settings.somedayRefreshDays = n;
						await this.plugin.saveSettings();
						await this.plugin.refreshBoardViews();
					}
				})
			);

		containerEl.createEl("h3", { text: t("settings.icsHeading") });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: t("settings.icsDesc"),
		});

		new Setting(containerEl)
			.setName(t("settings.icsEnable.name"))
			.setDesc(t("settings.icsEnable.desc"))
			.addToggle((toggle) =>
				toggle.setValue(settings.icsExportEnabled).onChange(async (value) => {
					settings.icsExportEnabled = value;
					await this.plugin.saveSettings();
					if (value) await this.plugin.exportIcs(false);
				})
			);

		new Setting(containerEl)
			.setName(t("settings.icsPath.name"))
			.setDesc(t("settings.icsPath.desc"))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.icsPath.placeholder"))
					.setValue(settings.icsExportPath)
					.onChange(async (value) => {
						settings.icsExportPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText(t("settings.exportNow")).onClick(() => void this.plugin.exportIcs(true))
		);

		containerEl.createEl("h3", { text: t("settings.swimlanesHeading") });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: t("settings.swimlanesDesc"),
		});

		const laneList = containerEl.createDiv({ cls: "gtd-settings-lane-list" });
		settings.lanes.forEach((lane, index) => this.renderLaneRow(laneList, lane, index));

		new Setting(containerEl).addButton((btn) =>
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
					this.display();
				})
		);
	}

	private renderLaneRow(container: HTMLElement, lane: LaneConfig, index: number): void {
		const settings = this.plugin.settings;
		const row = new Setting(container).setClass("gtd-lane-setting-row");

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
					this.display();
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
					this.display();
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
			text.inputEl.style.width = "70px";
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
					this.display();
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
					this.display();
				})
		);

		row.addExtraButton((btn) =>
			btn
				.setIcon("trash")
				.setTooltip(t("settings.lane.delete"))
				.onClick(async () => {
					settings.lanes.splice(index, 1);
					await this.plugin.saveSettings();
					this.display();
					await this.plugin.refreshBoardViews();
				})
		);
	}
}
