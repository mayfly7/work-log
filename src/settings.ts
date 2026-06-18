import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type WorkLogPlugin from "./main";

export interface WorkLogSettings {
  /** 工作日志存储目录（相对仓库根目录） */
  logDirectory: string;
  /** 文件名格式，支持 {{year}} 变量 */
  fileNameFormat: string;
  /** 日期格式（Moment.js 格式）*/
  dateFormat: string;
  /** 周起始日：'monday' | 'sunday' */
  weekStart: "monday" | "sunday";
  /** 星期几语言：'zh' | 'en' */
  weekdayLanguage: "zh" | "en";
  /** 生成模式：'full_year'=每年自动生成全年, 'up_to_today'=每天只新增到当前日 */
  generationMode: "full_year" | "up_to_today";
  /** 插入时间戳格式 */
  timestampFormat: string;
  /** 添加工作记录的方式：'ampm'=选上午/下午, 'timestamp'=插入当前时间 */
  entryMode: "ampm" | "timestamp";
  /** 是否在日历上标记有内容的日期 */
  showContentDots: boolean;
  /** 是否在日历上标注节假日 */
  showHolidays: boolean;
  /** 文件头部模板 */
  fileHeaderTemplate: string;
}

export const DEFAULT_SETTINGS: WorkLogSettings = {
  logDirectory: "工作日志",
  fileNameFormat: "{{year}}-工作日志",
  dateFormat: "YYYY-MM-DD",
  weekStart: "monday",
  weekdayLanguage: "zh",
  generationMode: "up_to_today",
  timestampFormat: "HH:mm",
  entryMode: "ampm",
  showContentDots: true,
  showHolidays: true,
  fileHeaderTemplate: "# {{year}}年工作日志",
};

export class WorkLogSettingTab extends PluginSettingTab {
  plugin: WorkLogPlugin;

  constructor(app: App, plugin: WorkLogPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "工作日志设置" });

    // ─── 文件存储 ───────────────────────────────────────────────
    containerEl.createEl("h3", { text: "文件存储" });

    new Setting(containerEl)
      .setName("存储目录")
      .setDesc("所有年度文件存放的文件夹（相对仓库根目录）")
      .addText((text) =>
        text
          .setPlaceholder("工作日志")
          .setValue(this.plugin.settings.logDirectory)
          .onChange(async (value) => {
            this.plugin.settings.logDirectory = value.trim() || "工作日志";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("文件名格式")
      .setDesc("支持 {{year}} 变量，例如：{{year}}-工作日志")
      .addText((text) =>
        text
          .setPlaceholder("{{year}}-工作日志")
          .setValue(this.plugin.settings.fileNameFormat)
          .onChange(async (value) => {
            this.plugin.settings.fileNameFormat = value.trim() || "{{year}}-工作日志";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("文件头部模板")
      .setDesc("年度文件的第一行标题，支持 {{year}} 变量")
      .addText((text) =>
        text
          .setPlaceholder("# {{year}}年工作日志")
          .setValue(this.plugin.settings.fileHeaderTemplate)
          .onChange(async (value) => {
            this.plugin.settings.fileHeaderTemplate = value.trim() || "# {{year}}年工作日志";
            await this.plugin.saveSettings();
          })
      );

    // ─── 日期与时间 ──────────────────────────────────────────────
    containerEl.createEl("h3", { text: "日期与时间" });

    new Setting(containerEl)
      .setName("日期格式")
      .setDesc("四级标题中日期的显示格式")
      .addDropdown((dd) =>
        dd
          .addOption("YYYY-MM-DD", "YYYY-MM-DD（2026-06-11）")
          .addOption("MM-DD", "MM-DD（06-11）")
          .addOption("YYYY年MM月DD日", "YYYY年MM月DD日（2026年06月11日）")
          .addOption("M月D日", "M月D日（6月11日）")
          .setValue(this.plugin.settings.dateFormat)
          .onChange(async (value) => {
            this.plugin.settings.dateFormat = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("应用新日期格式")
      .setDesc("把当前年度文件中的旧格式日期标题全部替换为上方选择的格式")
      .addButton((btn) =>
        btn
          .setButtonText("一键迁移")
          .setCta()
          .onClick(async () => {
            const year = new Date().getFullYear();
            await this.plugin.fileManager.migrateDateFormat(year);
          })
      );

    new Setting(containerEl)
      .setName("清理 Git 冲突标记")
      .setDesc("清除文件中残留的 Git/Obsidian Git 冲突标记")
      .addButton((btn) =>
        btn
          .setButtonText("清理标记")
          .onClick(async () => {
            const year = new Date().getFullYear();
            const removed = await this.plugin.fileManager.cleanGitConflicts(year);
            new Notice(removed > 0
              ? `${year} 年文件已清理 ${removed} 处冲突标记`
              : `${year} 年文件无需清理`);
          })
      );

    new Setting(containerEl)
      .setName("周起始日")
      .setDesc("每周从哪一天开始")
      .addDropdown((dd) =>
        dd
          .addOption("monday", "周一")
          .addOption("sunday", "周日")
          .setValue(this.plugin.settings.weekStart)
          .onChange(async (value) => {
            this.plugin.settings.weekStart = value as "monday" | "sunday";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("星期几语言")
      .setDesc("日期标题中星期几的显示语言")
      .addDropdown((dd) =>
        dd
          .addOption("zh", "中文（星期一…星期日）")
          .addOption("en", "英文（Monday…Sunday）")
          .setValue(this.plugin.settings.weekdayLanguage)
          .onChange(async (value) => {
            this.plugin.settings.weekdayLanguage = value as "zh" | "en";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("插入时间戳格式")
      .setDesc("快速插入工作记录时的时间前缀（Moment.js 格式），默认 HH:mm")
      .addText((text) =>
        text
          .setPlaceholder("HH:mm")
          .setValue(this.plugin.settings.timestampFormat)
          .onChange(async (value) => {
            this.plugin.settings.timestampFormat = value.trim() || "HH:mm";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("添加工作记录方式")
      .setDesc('点击「添加工作记录」按钮时的行为')
      .addDropdown((dd) =>
        dd
          .addOption("ampm", "选择 上午 / 下午")
          .addOption("timestamp", "插入当前时间")
          .setValue(this.plugin.settings.entryMode)
          .onChange(async (value) => {
            this.plugin.settings.entryMode = value as "ampm" | "timestamp";
            await this.plugin.saveSettings();
          })
      );

    // ─── 自动化 ──────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "自动化" });

    new Setting(containerEl)
      .setName("日期生成模式")
      .setDesc("新文件的日期结构生成方式")
      .addDropdown((dd) =>
        dd
          .addOption("full_year", "每年自动生成全年")
          .addOption("up_to_today", "每天新增到当前日")
          .setValue(this.plugin.settings.generationMode)
          .onChange(async (value) => {
            this.plugin.settings.generationMode = value as "full_year" | "up_to_today";
            await this.plugin.saveSettings();
          })
      );

    // ─── 日历视图 ─────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "日历视图" });

    new Setting(containerEl)
      .setName("标记有内容的日期")
      .setDesc("在日历上用圆点标记有工作内容的日期")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showContentDots)
          .onChange(async (value) => {
            this.plugin.settings.showContentDots = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("标注节假日")
      .setDesc("在日历上显示中国法定节假日名称（元旦、春节、清明、劳动节、端午、中秋、国庆）")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showHolidays)
          .onChange(async (value) => {
            this.plugin.settings.showHolidays = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
