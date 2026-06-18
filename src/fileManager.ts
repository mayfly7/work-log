import { App, Notice, TFile, TFolder, normalizePath, moment } from "obsidian";
import type { WorkLogSettings } from "./settings";
import {
  buildYearStructure,
  formatDayTitle,
  formatMonthHeading,
  formatWeekTitle,
  parseDayTitle,
  MonthGroup,
  WeekGroup,
} from "./dateUtils";

/** 缓存：年份 → (日期字符串 YYYY-MM-DD → 行号) */
type DateLineCache = Map<string, Map<string, number>>;

export class FileManager {
  private app: App;
  private settings: WorkLogSettings;
  /** 内存缓存 */
  private cache: DateLineCache = new Map();

  constructor(app: App, settings: WorkLogSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: WorkLogSettings) {
    this.settings = settings;
  }

  // ─────────────────────────────────────────────────────
  // 文件路径
  // ─────────────────────────────────────────────────────

  getFileName(year: number): string {
    return this.settings.fileNameFormat.replace("{{year}}", String(year));
  }

  getFilePath(year: number): string {
    const dir = this.settings.logDirectory;
    const name = this.getFileName(year);
    return normalizePath(`${dir}/${name}.md`);
  }

  async getOrCreateFile(year: number): Promise<TFile> {
    const filePath = this.getFilePath(year);
    let file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) {
      await this.ensureDirectory(this.settings.logDirectory);
      const content = this.settings.generationMode === "full_year"
        ? await this.generateFullYearContent(year)
        : await this.generateUpToTodayContent(year);
      file = await this.app.vault.create(filePath, content);
      new Notice(`已创建 ${year} 年工作日志文件`);
    }
    return file;
  }

  private async ensureDirectory(dir: string): Promise<void> {
    const normalized = normalizePath(dir);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (!existing) {
      await this.app.vault.createFolder(normalized);
    }
  }

  // ─────────────────────────────────────────────────────
  // 内容生成
  // ─────────────────────────────────────────────────────

  private generateFileHeader(year: number): string {
    return this.settings.fileHeaderTemplate.replace("{{year}}", String(year)) + "\n";
  }

  async generateFullYearContent(year: number): Promise<string> {
    const groups = buildYearStructure(year, this.settings);
    const lines: string[] = [];

    lines.push(this.generateFileHeader(year).trimEnd());
    lines.push("");

    for (const mg of groups) {
      lines.push(`## ${formatMonthHeading(mg.month)}`);
      lines.push("");

      for (const wg of mg.weeks) {
        lines.push(`### ${formatWeekTitle(wg, year)}`);
        lines.push("");

        for (const day of wg.days) {
          lines.push(`#### ${formatDayTitle(day, this.settings)}`);
          lines.push("");
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * 生成从1月1日到今天的日期结构（每天新增模式）
   */
  async generateUpToTodayContent(year: number): Promise<string> {
    const today = moment();
    const groups = buildYearStructure(year, this.settings);
    const lines: string[] = [];

    lines.push(this.generateFileHeader(year).trimEnd());
    lines.push("");

    for (const mg of groups) {
      lines.push(`## ${formatMonthHeading(mg.month)}`);
      lines.push("");

      for (const wg of mg.weeks) {
        lines.push(`### ${formatWeekTitle(wg, year)}`);
        lines.push("");

        for (const day of wg.days) {
          // 只生成到今天的日期
          if (today.year() === year && day.isAfter(today, "day")) {
            break;
          }
          // 历史年份则生成全年
          lines.push(`#### ${formatDayTitle(day, this.settings)}`);
          lines.push("");
        }
      }
    }

    return lines.join("\n");
  }

  // ─────────────────────────────────────────────────────
  // 缓存管理
  // ─────────────────────────────────────────────────────

  /** 解析文件，建立 日期字符串→行号 的缓存 */
  async buildCache(file: TFile): Promise<Map<string, number>> {
    const year = this.extractYearFromFile(file);
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const dateMap = new Map<string, number>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("#### ")) {
        const m = parseDayTitle(line, this.settings.dateFormat);
        if (m && m.isValid()) {
          dateMap.set(m.format("YYYY-MM-DD"), i);
        }
      }
    }

    if (year) {
      this.cache.set(year, dateMap);
    }
    return dateMap;
  }

  invalidateCache(year: number) {
    this.cache.delete(String(year));
  }

  private extractYearFromFile(file: TFile): string | null {
    // 从文件路径中解析年份（从文件名中找4位数字）
    const m = file.basename.match(/(\d{4})/);
    return m ? m[1] : null;
  }

  async getDateLineMap(file: TFile): Promise<Map<string, number>> {
    const year = this.extractYearFromFile(file);
    if (year && this.cache.has(year)) {
      return this.cache.get(year)!;
    }
    return this.buildCache(file);
  }

  // ─────────────────────────────────────────────────────
  // 日期定位与创建
  // ─────────────────────────────────────────────────────

  /**
   * 打开文件并跳转到指定日期标题
   * 若不存在则先创建缺失的日期结构
   */
  async openAndNavigateToDate(date: moment.Moment): Promise<void> {
    const year = date.year();
    const file = await this.getOrCreateFile(year);

    let lineMap = await this.getDateLineMap(file);
    const dateKey = date.format("YYYY-MM-DD");

    if (!lineMap.has(dateKey)) {
      // 插入缺失的日期区块
      await this.insertMissingDateBlock(file, date);
      lineMap = await this.buildCache(file);
    }

    const lineNo = lineMap.get(dateKey);

    // 打开文件
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);

    // 等待编辑器渲染完成后定位（多次重试，防止大文件尚未渲染完毕）
    if (lineNo !== undefined) {
      this.scrollToLineWithRetry(leaf, lineNo, 0);
    }
  }

  /**
   * 打开文件并定位到指定日期，光标放在该日期内容块的末尾
   */
  async openAndNavigateToEndOfDate(date: moment.Moment): Promise<void> {
    const year = date.year();
    const file = await this.getOrCreateFile(year);

    let lineMap = await this.getDateLineMap(file);
    const dateKey = date.format("YYYY-MM-DD");

    if (!lineMap.has(dateKey)) {
      await this.insertMissingDateBlock(file, date);
      lineMap = await this.buildCache(file);
    }

    const headingLine = lineMap.get(dateKey);
    if (headingLine === undefined) return;

    // 找该日期内容块的末尾行
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    let endLine = headingLine;
    for (let i = headingLine + 1; i < lines.length; i++) {
      if (lines[i].startsWith("#### ") || lines[i].startsWith("### ") ||
          lines[i].startsWith("## ") || lines[i].startsWith("# ")) {
        break;
      }
      endLine = i;
    }

    // 如果该日期没有内容，光标放在标题行；否则放在内容末尾
    const targetLine = endLine === headingLine ? headingLine : endLine;

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    this.scrollToLineWithRetry(leaf, targetLine, 0);
  }

  /**
   * 在文件中插入缺失的日期区块，保持月/周/日结构完整
   */
  async insertMissingDateBlock(file: TFile, date: moment.Moment): Promise<void> {
    const year = date.year();
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    const groups = buildYearStructure(year, this.settings);

    // 找到目标月份和周
    const month = date.month() + 1;
    const targetMg = groups.find((mg) => mg.month === month);
    if (!targetMg) return;

    const dateKey = date.format("YYYY-MM-DD");
    const targetWg = targetMg.weeks.find((wg) =>
      wg.days.some((d) => d.format("YYYY-MM-DD") === dateKey)
    );
    if (!targetWg) return;

    // 检查月份标题是否存在
    const monthHeading = `## ${formatMonthHeading(month)}`;
    const monthLineIdx = lines.findIndex((l) => l.trim() === monthHeading);

    if (monthLineIdx === -1) {
      // 月份不存在，在合适位置插入最小月份块（只含目标日期）
      await this.insertMonthBlock(file, targetMg, groups, year, date);
    } else {
      // 月份存在，检查周标题
      const weekTitle = `### ${formatWeekTitle(targetWg, year)}`;
      const weekLineIdx = lines.findIndex((l) => l.trim() === weekTitle);

      if (weekLineIdx === -1) {
        await this.insertWeekBlock(file, targetMg, targetWg, month, year, date);
      } else {
        // 周已存在，只插入日期标题
        await this.insertDayHeading(file, date, targetWg, year);
      }
    }

    this.invalidateCache(year);
  }

  private async insertDayHeading(
    file: TFile,
    date: moment.Moment,
    wg: WeekGroup,
    year: number
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const dateKey = date.format("YYYY-MM-DD");
    const weekTitle = `### ${formatWeekTitle(wg, year)}`;

    const weekLineIdx = lines.findIndex((l) => l.trim() === weekTitle);
    if (weekLineIdx === -1) return;

    // 找到该周内日期应该插入的位置（按日期顺序）
    let insertIdx = weekLineIdx + 1;
    // 跳过空行
    while (insertIdx < lines.length && lines[insertIdx].trim() === "") {
      insertIdx++;
    }

    // 找到正确的日期插入位置（跳过已有日期块的全部内容）
    for (let i = insertIdx; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("## ") || line.startsWith("### ")) break;
      if (line.startsWith("#### ")) {
        const m = parseDayTitle(line, this.settings.dateFormat);
        if (m && m.isValid() && m.format("YYYY-MM-DD") > dateKey) {
          insertIdx = i;
          break;
        }
        // 该日期 <= 目标日期，跳过该日期块的全部内容
        insertIdx = i + 1;
        while (
          insertIdx < lines.length &&
          !lines[insertIdx].startsWith("#### ") &&
          !lines[insertIdx].startsWith("### ") &&
          !lines[insertIdx].startsWith("## ")
        ) {
          insertIdx++;
        }
        i = insertIdx - 1; // 让 for 循环从 insertIdx 继续
      }
    }

    const dayHeading = `#### ${formatDayTitle(date, this.settings)}`;
    lines.splice(insertIdx, 0, dayHeading, "");
    await this.app.vault.modify(file, lines.join("\n"));
  }

  private async insertWeekBlock(
    file: TFile,
    mg: MonthGroup,
    wg: WeekGroup,
    month: number,
    year: number,
    /** 只插入这一个日期，不插入整周 */
    targetDate?: moment.Moment
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const monthHeading = `## ${formatMonthHeading(month)}`;
    const monthLineIdx = lines.findIndex((l) => l.trim() === monthHeading);
    if (monthLineIdx === -1) return;

    // 找到周应插入的位置
    let insertIdx = monthLineIdx + 1;
    const weekTitle = `### ${formatWeekTitle(wg, year)}`;

    for (let i = monthLineIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("## ")) {
        insertIdx = i;
        break;
      }
      if (line.startsWith("### ")) {
        // 比较周序号
        const wMatch = line.match(/第(\d+)周/);
        if (wMatch && parseInt(wMatch[1]) > wg.weekIndex) {
          insertIdx = i;
          break;
        }
        insertIdx = i + 1;
      }
    }

    // 生成周块
    const weekLines: string[] = ["", `### ${formatWeekTitle(wg, year)}`, ""];
    if (targetDate) {
      // 只插入目标日期
      weekLines.push(`#### ${formatDayTitle(targetDate, this.settings)}`);
      weekLines.push("");
    } else {
      // 完整生成该周所有天
      for (const day of wg.days) {
        weekLines.push(`#### ${formatDayTitle(day, this.settings)}`);
        weekLines.push("");
      }
    }

    lines.splice(insertIdx, 0, ...weekLines);
    await this.app.vault.modify(file, lines.join("\n"));
  }

  private async insertMonthBlock(
    file: TFile,
    mg: MonthGroup,
    allGroups: MonthGroup[],
    year: number,
    /** 只插入这一个日期，不插入整月 */
    targetDate?: moment.Moment
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    // 找到月份应插入的位置（按月份顺序）
    let insertIdx = lines.length;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("## ")) {
        // 检查是否是月份标题
        const existingMonth = allGroups.findIndex(
          (g) => `## ${formatMonthHeading(g.month)}` === line.trim()
        );
        if (existingMonth !== -1 && allGroups[existingMonth].month > mg.month) {
          insertIdx = i;
          break;
        }
      }
    }

    // 生成月份块
    const monthLines: string[] = ["", `## ${formatMonthHeading(mg.month)}`, ""];
    if (targetDate) {
      // 只插入目标日期所在的周 + 目标日期
      const wg = mg.weeks.find((w) =>
        w.days.some((d) => d.format("YYYY-MM-DD") === targetDate.format("YYYY-MM-DD"))
      );
      if (wg) {
        monthLines.push(`### ${formatWeekTitle(wg, year)}`);
        monthLines.push("");
        monthLines.push(`#### ${formatDayTitle(targetDate, this.settings)}`);
        monthLines.push("");
      }
    } else {
      // 完整生成所有周
      for (const wg of mg.weeks) {
        monthLines.push(`### ${formatWeekTitle(wg, year)}`);
        monthLines.push("");
        for (const day of wg.days) {
          monthLines.push(`#### ${formatDayTitle(day, this.settings)}`);
          monthLines.push("");
        }
      }
    }

    lines.splice(insertIdx, 0, ...monthLines);
    await this.app.vault.modify(file, lines.join("\n"));
  }

  // ─────────────────────────────────────────────────────
  // 滚动定位工具（多次重试，确保大文件编辑器就绪）
  // ─────────────────────────────────────────────────────

  private scrollToLineWithRetry(leaf: any, lineNo: number, attempt: number): void {
    const view = leaf.view as any;
    const editor = view?.editor;
    if (editor && editor.lineCount() > lineNo) {
      editor.setCursor({ line: lineNo, ch: 0 });
      editor.scrollIntoView(
        { from: { line: lineNo, ch: 0 }, to: { line: lineNo, ch: 0 } },
        true
      );
      return;
    }
    // 编辑器还未就绪，最多重试 10 次（总计约 1.5 秒）
    if (attempt < 10) {
      setTimeout(() => this.scrollToLineWithRetry(leaf, lineNo, attempt + 1), 150);
    }
  }

  /** 跳转到指定年份文件的指定行 */
  async jumpToLine(year: number, lineNo: number): Promise<void> {
    const file = await this.getOrCreateFile(year);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    this.scrollToLineWithRetry(leaf, lineNo, 0);
  }

  // ─────────────────────────────────────────────────────
  // 结构修复
  // ─────────────────────────────────────────────────────

  /**
   * 修复/重建年度文件结构：读取已有内容，按正确结构重建，不丢失数据
   *
   * 策略：先解析所有日期及其内容 → 按 buildYearStructure 生成正确骨架 → 填入内容
   * 这比逐个插入单个日期更可靠，不会出现日期错位或内容被挤的问题
   */
  async repairYearStructure(year: number): Promise<void> {
    const file = await this.getOrCreateFile(year);
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    const groups = buildYearStructure(year, this.settings);

    // ── 第1步：解析已有文件，提取每个日期的内容 ──
    // dateContent: "YYYY-MM-DD" → 该日期下的所有行（不含标题行）
    const dateContent = new Map<string, string[]>();
    // 也保留文件头（第一个 ## 之前的内容）
    const headerLines: string[] = [];
    let currentDateKey: string | null = null;
    let currentContent: string[] = [];
    let headerDone = false;

    for (const line of lines) {
      if (!headerDone && !line.startsWith("## ")) {
        headerLines.push(line);
        continue;
      }
      headerDone = true;

      if (line.startsWith("#### ")) {
        // 保存上一个日期块
        if (currentDateKey && currentContent.length > 0) {
          // 去掉末尾空行
          while (currentContent.length > 0 && currentContent[currentContent.length - 1].trim() === "") {
            currentContent.pop();
          }
          if (currentContent.length > 0) {
            dateContent.set(currentDateKey, currentContent);
          }
        }
        // 解析新日期
        const m = parseDayTitle(line, this.settings.dateFormat);
        currentDateKey = m ? m.format("YYYY-MM-DD") : null;
        currentContent = [];
        // 冒号后的同行动内容
        const colonIdx = line.indexOf("：");
        if (colonIdx === -1) {
          const colonIdx2 = line.indexOf(":");
          if (colonIdx2 !== -1) currentContent.push(line.substring(colonIdx2 + 1).trim());
        } else {
          currentContent.push(line.substring(colonIdx + 1).trim());
        }
      } else if (line.startsWith("### ") || line.startsWith("## ") || line.startsWith("# ")) {
        // 遇到标题，保存当前日期块
        if (currentDateKey && currentContent.length > 0) {
          while (currentContent.length > 0 && currentContent[currentContent.length - 1].trim() === "") {
            currentContent.pop();
          }
          if (currentContent.length > 0) {
            dateContent.set(currentDateKey, currentContent);
          }
        }
        currentDateKey = null;
        currentContent = [];
      } else if (currentDateKey) {
        // 日期内容行
        currentContent.push(line);
      }
    }
    // 最后一个日期块
    if (currentDateKey && currentContent.length > 0) {
      while (currentContent.length > 0 && currentContent[currentContent.length - 1].trim() === "") {
        currentContent.pop();
      }
      if (currentContent.length > 0) {
        dateContent.set(currentDateKey, currentContent);
      }
    }

    // ── 第2步：按正确结构重建文件 ──
    const newLines: string[] = [...headerLines];

    // 确保文件头后有至少一个空行
    if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== "") {
      newLines.push("");
    }

    for (const mg of groups) {
      newLines.push(`## ${formatMonthHeading(mg.month)}`);
      newLines.push("");

      for (const wg of mg.weeks) {
        // 检查该周是否有日期（全年模式全部有，每天模式可能跳过）
        const weekDays = wg.days;
        if (weekDays.length === 0) continue;

        newLines.push(`### ${formatWeekTitle(wg, year)}`);
        newLines.push("");

        for (const day of weekDays) {
          const dateKey = day.format("YYYY-MM-DD");
          const heading = `#### ${formatDayTitle(day, this.settings)}`;
          const content = dateContent.get(dateKey);

          newLines.push(heading);

          if (content && content.length > 0) {
            // 单行非列表内容 → 冒号后缀合并到标题行
            if (content.length === 1 && content[0].trim() !== "" &&
                !content[0].trim().startsWith("- ") && 
                !content[0].trim().startsWith("- [") && 
                !content[0].trim().startsWith("-[")) {
              newLines[newLines.length - 1] = heading + "：" + content[0].trim();
            } else {
              // 多行或列表内容 → 逐行追加
              for (const cl of content) {
                newLines.push(cl);
              }
            }
            // 确保日期块末尾有空行
            if (newLines[newLines.length - 1].trim() !== "") {
              newLines.push("");
            }
          } else {
            newLines.push("");
          }
        }
      }
    }

    // 去掉末尾多余空行
    while (newLines.length > 0 && newLines[newLines.length - 1].trim() === "") {
      newLines.pop();
    }
    newLines.push("");

    const newContent = newLines.join("\n");
    if (newContent !== content) {
      await this.app.vault.modify(file, newContent);
      const mode = this.settings.generationMode === "full_year" ? "全年" : "每天";
      new Notice(`结构重建完成（${mode}模式），共 ${dateContent.size} 个日期块已恢复`);
    } else {
      new Notice("结构已是最新，无需重建");
    }

    this.invalidateCache(year);
  }

  /**
   * 清理文件中的 Git/Obsidian Git 冲突标记
   */
  async cleanGitConflicts(year: number): Promise<number> {
    const filePath = this.getFilePath(year);
    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) return 0;

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const cleaned: string[] = [];
    let removed = 0;

    for (const line of lines) {
      // 跳过纯冲突标记行
      const trimmed = line.trim();
      if (trimmed === '<mark class="conflict ours">' ||
          trimmed === '<mark class="conflict theirs">' ||
          trimmed === '</mark>' ||
          trimmed === '<<<<<<<' ||
          trimmed === '=======' ||
          trimmed === '>>>>>>>') {
        removed++;
        continue;
      }
      // 清理行中的冲突标记（如 `内容</mark><mark class="conflict theirs">`）
      let cleanedLine = line
        .replace(/<\/?mark class="conflict (ours|theirs)">/g, "")
        .replace(/<\/mark>/g, "");
      if (cleanedLine !== line) removed++;
      // 清理后如果变成空行，跳过
      if (cleanedLine.trim() === "" && line.trim() !== "") {
        removed++;
        continue;
      }
      cleaned.push(cleanedLine);
    }

    if (removed > 0) {
      await this.app.vault.modify(file, cleaned.join("\n"));
      this.invalidateCache(year);
    }
    return removed;
  }

  /**
   * 迁移日期格式：把文件中旧格式的日期标题替换为当前设置的日期格式
   */
  async migrateDateFormat(year: number): Promise<void> {
    // 先清理冲突标记，防止其污染迁移结果
    await this.cleanGitConflicts(year);

    const file = await this.getOrCreateFile(year);
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    let changed = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("#### ")) continue;

      const m = parseDayTitle(line, this.settings.dateFormat);
      if (!m) continue;

      const newTitle = `#### ${formatDayTitle(m, this.settings)}`;
      // 替换整行标题部分（日期+星期+节假日），保留冒号后的内容
      const headingPattern = /^(####\s+[^：:\n]+)/;
      const newLine = line.replace(headingPattern, newTitle);
      if (newLine !== line) {
        lines[i] = newLine;
        changed++;
      }
    }

    if (changed > 0) {
      await this.app.vault.modify(file, lines.join("\n"));
      this.invalidateCache(year);
      new Notice(`${year} 年共迁移 ${changed} 条日期标题为 ${this.settings.dateFormat} 格式`);
    } else {
      new Notice(`${year} 年无需迁移，所有日期标题已是 ${this.settings.dateFormat} 格式`);
    }
  }

  /**
   * 确保文件包含从年初到今天的日期结构（up_to_today 模式）
   * 文件不存在则创建，存在则补充缺失的日期标题
   */
  async ensureUpToToday(year: number): Promise<void> {
    const file = await this.getOrCreateFile(year);
    const today = moment();
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    const groups = buildYearStructure(year, this.settings);

    // ── 解析已有内容（与 repairYearStructure 相同逻辑）──
    const dateContent = new Map<string, string[]>();
    const headerLines: string[] = [];
    let currentDateKey: string | null = null;
    let currentContent: string[] = [];
    let headerDone = false;

    for (const line of lines) {
      if (!headerDone && !line.startsWith("## ")) {
        headerLines.push(line);
        continue;
      }
      headerDone = true;

      if (line.startsWith("#### ")) {
        if (currentDateKey && currentContent.length > 0) {
          while (currentContent.length > 0 && currentContent[currentContent.length - 1].trim() === "") {
            currentContent.pop();
          }
          if (currentContent.length > 0) {
            dateContent.set(currentDateKey, currentContent);
          }
        }
        const m = parseDayTitle(line, this.settings.dateFormat);
        currentDateKey = m ? m.format("YYYY-MM-DD") : null;
        currentContent = [];
        const colonIdx = line.indexOf("：");
        if (colonIdx === -1) {
          const colonIdx2 = line.indexOf(":");
          if (colonIdx2 !== -1) currentContent.push(line.substring(colonIdx2 + 1).trim());
        } else {
          currentContent.push(line.substring(colonIdx + 1).trim());
        }
      } else if (line.startsWith("### ") || line.startsWith("## ") || line.startsWith("# ")) {
        if (currentDateKey && currentContent.length > 0) {
          while (currentContent.length > 0 && currentContent[currentContent.length - 1].trim() === "") {
            currentContent.pop();
          }
          if (currentContent.length > 0) {
            dateContent.set(currentDateKey, currentContent);
          }
        }
        currentDateKey = null;
        currentContent = [];
      } else if (currentDateKey) {
        currentContent.push(line);
      }
    }
    if (currentDateKey && currentContent.length > 0) {
      while (currentContent.length > 0 && currentContent[currentContent.length - 1].trim() === "") {
        currentContent.pop();
      }
      if (currentContent.length > 0) {
        dateContent.set(currentDateKey, currentContent);
      }
    }

    // ── 重建文件（只到今天的日期）──
    const newLines: string[] = [...headerLines];
    if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== "") {
      newLines.push("");
    }

    let addedCount = 0;

    for (const mg of groups) {
      const visibleWeeks: { wg: WeekGroup; days: moment.Moment[] }[] = [];
      for (const wg of mg.weeks) {
        const daysToInclude = wg.days.filter(
          (d) => !d.isAfter(today, "day")
        );
        if (daysToInclude.length > 0) {
          visibleWeeks.push({ wg, days: daysToInclude });
        }
      }
      if (visibleWeeks.length === 0) continue;

      newLines.push(`## ${formatMonthHeading(mg.month)}`);
      newLines.push("");

      for (const { wg, days: daysToInclude } of visibleWeeks) {
        newLines.push(`### ${formatWeekTitle(wg, year)}`);
        newLines.push("");

        for (const day of daysToInclude) {
          const dateKey = day.format("YYYY-MM-DD");
          const heading = `#### ${formatDayTitle(day, this.settings)}`;
          const dc = dateContent.get(dateKey);

          if (!dc || dc.length === 0) {
            addedCount++;
          }

          newLines.push(heading);

          if (dc && dc.length > 0) {
            if (dc.length === 1 && dc[0].trim() !== "" &&
                !dc[0].trim().startsWith("- ") &&
                !dc[0].trim().startsWith("- [") &&
                !dc[0].trim().startsWith("-[")) {
              newLines[newLines.length - 1] = heading + "：" + dc[0].trim();
            } else {
              for (const cl of dc) {
                newLines.push(cl);
              }
            }
            if (newLines[newLines.length - 1].trim() !== "") {
              newLines.push("");
            }
          } else {
            newLines.push("");
          }
        }
      }
    }

    while (newLines.length > 0 && newLines[newLines.length - 1].trim() === "") {
      newLines.pop();
    }
    newLines.push("");

    const newContent = newLines.join("\n");
    if (newContent !== content) {
      await this.app.vault.modify(file, newContent);
      if (addedCount > 0) {
        new Notice(`${year} 年已补充 ${addedCount} 天日期结构`);
      }
    }

    this.invalidateCache(year);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * 切换为每天新增模式时，删除今天之后的所有日期和周标题
   */
  /**
   * 裁剪今天之后的日期：重建文件，只保留到今天
   * 使用与 repairYearStructure 相同的重建逻辑，确保结构正确
   */
  async trimAfterToday(year: number): Promise<void> {
    const filePath = this.getFilePath(year);
    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) return;

    const today = moment();
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    const groups = buildYearStructure(year, this.settings);

    // ── 解析已有内容 ──（与 repairYearStructure 相同逻辑）
    const dateContent = new Map<string, string[]>();
    const headerLines: string[] = [];
    let currentDateKey: string | null = null;
    let currentContent: string[] = [];
    let headerDone = false;

    for (const line of lines) {
      if (!headerDone && !line.startsWith("## ")) {
        headerLines.push(line);
        continue;
      }
      headerDone = true;

      if (line.startsWith("#### ")) {
        if (currentDateKey && currentContent.length > 0) {
          while (currentContent.length > 0 && currentContent[currentContent.length - 1].trim() === "") {
            currentContent.pop();
          }
          if (currentContent.length > 0) {
            dateContent.set(currentDateKey, currentContent);
          }
        }
        const m = parseDayTitle(line, this.settings.dateFormat);
        currentDateKey = m ? m.format("YYYY-MM-DD") : null;
        currentContent = [];
        const colonIdx = line.indexOf("：");
        if (colonIdx === -1) {
          const colonIdx2 = line.indexOf(":");
          if (colonIdx2 !== -1) currentContent.push(line.substring(colonIdx2 + 1).trim());
        } else {
          currentContent.push(line.substring(colonIdx + 1).trim());
        }
      } else if (line.startsWith("### ") || line.startsWith("## ") || line.startsWith("# ")) {
        if (currentDateKey && currentContent.length > 0) {
          while (currentContent.length > 0 && currentContent[currentContent.length - 1].trim() === "") {
            currentContent.pop();
          }
          if (currentContent.length > 0) {
            dateContent.set(currentDateKey, currentContent);
          }
        }
        currentDateKey = null;
        currentContent = [];
      } else if (currentDateKey) {
        currentContent.push(line);
      }
    }
    if (currentDateKey && currentContent.length > 0) {
      while (currentContent.length > 0 && currentContent[currentContent.length - 1].trim() === "") {
        currentContent.pop();
      }
      if (currentContent.length > 0) {
        dateContent.set(currentDateKey, currentContent);
      }
    }

    // ── 重建文件（只到今天的日期）──
    const newLines: string[] = [...headerLines];
    if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== "") {
      newLines.push("");
    }

    for (const mg of groups) {
      // 先收集该月所有到今天为止的周
      const visibleWeeks: { wg: WeekGroup; days: moment.Moment[] }[] = [];
      for (const wg of mg.weeks) {
        const daysToInclude = wg.days.filter(
          (d) => !d.isAfter(today, "day")
        );
        if (daysToInclude.length > 0) {
          visibleWeeks.push({ wg, days: daysToInclude });
        }
      }

      // 该月没有任何到今天为止的日期 → 跳过整个月份
      if (visibleWeeks.length === 0) continue;

      newLines.push(`## ${formatMonthHeading(mg.month)}`);
      newLines.push("");

      for (const { wg, days: daysToInclude } of visibleWeeks) {
        newLines.push(`### ${formatWeekTitle(wg, year)}`);
        newLines.push("");

        for (const day of daysToInclude) {
          const dateKey = day.format("YYYY-MM-DD");
          const heading = `#### ${formatDayTitle(day, this.settings)}`;
          const content = dateContent.get(dateKey);

          newLines.push(heading);

          if (content && content.length > 0) {
            if (content.length === 1 && content[0].trim() !== "" &&
                !content[0].trim().startsWith("- ") && 
                !content[0].trim().startsWith("- [") && 
                !content[0].trim().startsWith("-[")) {
              newLines[newLines.length - 1] = heading + "：" + content[0].trim();
            } else {
              for (const cl of content) {
                newLines.push(cl);
              }
            }
            if (newLines[newLines.length - 1].trim() !== "") {
              newLines.push("");
            }
          } else {
            newLines.push("");
          }
        }
      }
    }

    while (newLines.length > 0 && newLines[newLines.length - 1].trim() === "") {
      newLines.pop();
    }
    newLines.push("");

    const newContent = newLines.join("\n");
    if (newContent !== content) {
      await this.app.vault.modify(file, newContent);
      new Notice("已裁剪到今天，未来日期已移除");
    }

    this.invalidateCache(year);
  }

  // ─────────────────────────────────────────────────────
  // 快速插入条目
  // ─────────────────────────────────────────────────────

  /**
   * 在指定日期区块下追加工作记录标签（上午/下午）
   */
  async insertSessionLabel(date: moment.Moment, label: string): Promise<void> {
    const file = await this.getOrCreateFile(date.year());
    let lineMap = await this.getDateLineMap(file);
    const dateKey = date.format("YYYY-MM-DD");

    if (!lineMap.has(dateKey)) {
      await this.insertMissingDateBlock(file, date);
      lineMap = await this.buildCache(file);
    }

    const headingLine = lineMap.get(dateKey);
    if (headingLine === undefined) {
      new Notice("无法定位日期标题");
      return;
    }

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    const isTodo = label.includes("待办");
    const isSession = !isTodo; // 上午 / 下午

    // 上午/下午使用分隔线样式，待办使用 checkbox 格式
    const entry = isTodo ? `- [ ] ${label.replace("☐ ", "")}` : `----------------------------${label}-------------------------------`;

    // 扫描该日期区块，检查是否已存在相同标签
    let insertIdx = headingLine + 1;
    let found = false;
    for (let i = headingLine + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ") || lines[i].startsWith("### ") || lines[i].startsWith("#### ")) {
        break;
      }
      const trimmed = lines[i].trim();
      // 匹配：旧格式 `- 上午` / 新格式 `----上午----` / 待办 `- [ ] 待办`
      const dupMatch = isTodo
        ? (trimmed === `- [ ] ${label.replace("☐ ", "")}` || trimmed === `- ${label}`)
        : (trimmed === `- ${label}` || trimmed === entry);

      if (dupMatch) {
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);

        if (isSession) {
          // 上午/下午：光标放到分隔线的下一行（即该行之后）
          let cursorLine = i + 1;
          // 跳过空白行，停在第一个非空白行或下一个标题
          while (cursorLine < lines.length &&
                 lines[cursorLine].trim() === "" &&
                 !lines[cursorLine].startsWith("#### ") &&
                 !lines[cursorLine].startsWith("### ") &&
                 !lines[cursorLine].startsWith("## ")) {
            cursorLine++;
          }
          // 如果下一个是标题或文件末尾，停在空白行
          if (cursorLine >= lines.length ||
              lines[cursorLine].startsWith("#### ") ||
              lines[cursorLine].startsWith("### ") ||
              lines[cursorLine].startsWith("## ")) {
            cursorLine = i + 1; // 停在分隔线的下一行
          }
          this.scrollToLineWithRetry(leaf, cursorLine, 0);
          setTimeout(() => {
            const view = leaf.view as any;
            if (view?.editor) {
              view.editor.setCursor({ line: cursorLine, ch: 0 });
              view.editor.focus();
            }
          }, 300);
        } else {
          // 待办：光标放到行末
          this.scrollToLineWithRetry(leaf, i, 0);
          setTimeout(() => {
            const view = leaf.view as any;
            if (view?.editor) {
              view.editor.setCursor({ line: i, ch: lines[i].length });
              view.editor.focus();
            }
          }, 300);
        }
        found = true;
        break;
      }
      if (trimmed !== "") {
        insertIdx = i + 1;
      } else {
        insertIdx = i;
      }
    }

    if (!found) {
      if (isSession) {
        // 上午/下午：插入分隔线 + 空行
        lines.splice(insertIdx, 0, entry, "");
        await this.app.vault.modify(file, lines.join("\n"));
        const cursorLine = insertIdx + 2; // 分隔线 + 空行 → 光标在空行上
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
        this.scrollToLineWithRetry(leaf, cursorLine, 0);
        setTimeout(() => {
          const view = leaf.view as any;
          if (view?.editor) {
            view.editor.setCursor({ line: cursorLine, ch: 0 });
            view.editor.focus();
          }
        }, 300);
      } else {
        // 待办：插入 checkbox
        lines.splice(insertIdx, 0, entry);
        await this.app.vault.modify(file, lines.join("\n"));
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
        this.scrollToLineWithRetry(leaf, insertIdx, 0);
        setTimeout(() => {
          const view = leaf.view as any;
          if (view?.editor) {
            view.editor.setCursor({ line: insertIdx, ch: entry.length });
            view.editor.focus();
          }
        }, 300);
      }
    }

    this.invalidateCache(date.year());
  }

  /**
   * 在指定日期区块下追加带时间戳的工作条目
   */
  async insertTimestampEntry(customDate?: moment.Moment): Promise<void> {
    const today = customDate || moment();
    const file = await this.getOrCreateFile(today.year());
    let lineMap = await this.getDateLineMap(file);
    const dateKey = today.format("YYYY-MM-DD");

    if (!lineMap.has(dateKey)) {
      await this.insertMissingDateBlock(file, today);
      lineMap = await this.buildCache(file);
    }

    const headingLine = lineMap.get(dateKey);
    if (headingLine === undefined) {
      new Notice("无法定位日期标题");
      return;
    }

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    const timestamp = moment().format(this.settings.timestampFormat);
    const entry = `- ${timestamp} `;

    // 找到该日期标题下，下一个标题之前，追加到末尾
    let insertIdx = headingLine + 1;
    for (let i = headingLine + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ") || lines[i].startsWith("### ") || lines[i].startsWith("#### ")) {
        break;
      }
      if (lines[i].trim() !== "") {
        insertIdx = i + 1;
      } else {
        insertIdx = i;
      }
    }

    lines.splice(insertIdx, 0, entry);
    await this.app.vault.modify(file, lines.join("\n"));

    // 打开文件并将光标定位到新行
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    this.scrollToLineWithRetry(leaf, insertIdx, 0);
    // 聚焦到编辑器
    setTimeout(() => {
      const view = leaf.view as any;
      if (view?.editor) {
        view.editor.setCursor({ line: insertIdx, ch: entry.length });
        view.editor.focus();
      }
    }, 300);

    this.invalidateCache(today.year());
  }

  // ─────────────────────────────────────────────────────
  // 内容统计（供日历视图和统计面板使用）
  // ─────────────────────────────────────────────────────

  /**
   * 获取某年某月有内容的日期集合
   */
  async getDatesWithContent(year: number, month: number): Promise<Set<string>> {
    const filePath = this.getFilePath(year);
    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) return new Set();

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    const result = new Set<string>();
    let currentDate: string | null = null;
    let hasContent = false;

    for (const line of lines) {
      if (line.startsWith("#### ")) {
        if (currentDate && hasContent) {
          result.add(currentDate);
        }
        const m = parseDayTitle(line, this.settings.dateFormat);
        if (m && m.isValid() && m.year() === year && m.month() + 1 === month) {
          currentDate = m.format("YYYY-MM-DD");
          hasContent = false;
        } else {
          currentDate = null;
        }
      } else if (
        currentDate &&
        !line.startsWith("## ") &&
        !line.startsWith("### ") &&
        line.trim() !== ""
      ) {
        hasContent = true;
      }
    }
    // 最后一个日期
    if (currentDate && hasContent) {
      result.add(currentDate);
    }

    return result;
  }

  /**
   * 获取某日期的前几行工作内容（用于 hover 预览）
   */
  async getDayPreview(date: moment.Moment, maxLines = 4): Promise<string> {
    const year = date.year();
    const filePath = this.getFilePath(year);
    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) return "";

    const lineMap = await this.getDateLineMap(file);
    const dateKey = date.format("YYYY-MM-DD");
    const headingLine = lineMap.get(dateKey);
    if (headingLine === undefined) return "";

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    const previewLines: string[] = [];
    for (let i = headingLine + 1; i < lines.length && previewLines.length < maxLines; i++) {
      const line = lines[i];
      if (line.startsWith("## ") || line.startsWith("### ") || line.startsWith("#### ")) break;
      const trimmed = line.trim();
      if (trimmed === "") continue;
      // 跳过分隔线（如 ----------------------------上午-------------------------------）
      if (this.isSeparatorLine(trimmed)) continue;
      previewLines.push(trimmed);
    }

    return previewLines.join("\n");
  }

  /** 判断是否为分隔线（如 ----------------------------上午-------------------------------） */
  private isSeparatorLine(line: string): boolean {
    // 连续 10+ 个短横线即视为分隔线
    if (/-{10,}/.test(line)) return true;
    return false;
  }

  /**
   * 获取指定日期的未完成待办列表（- [ ] 开头的条目）
   */
  async getIncompleteTodosForDate(date: moment.Moment): Promise<string[]> {
    const year = date.year();
    const filePath = this.getFilePath(year);
    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) return [];

    const lineMap = await this.getDateLineMap(file);
    const dateKey = date.format("YYYY-MM-DD");
    const headingLine = lineMap.get(dateKey);
    if (headingLine === undefined) return [];

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const todos: string[] = [];

    for (let i = headingLine + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("## ") || line.startsWith("### ") || line.startsWith("#### ")) break;
      if (line.trim().startsWith("- [ ]")) {
        todos.push(line.trim().replace(/^- \[ \]\s*/, ""));
      }
    }
    return todos;
  }

  /**
   * 获取指定月份所有日期的未完成待办数（用于日历标记）
   */
  async getIncompleteTodoMap(year: number, month: number): Promise<Map<string, number>> {
    const filePath = this.getFilePath(year);
    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) return new Map();

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const result = new Map<string, number>();
    let currentDateKey: string | null = null;

    for (const line of lines) {
      if (line.startsWith("#### ")) {
        const m = parseDayTitle(line, this.settings.dateFormat);
        currentDateKey = m ? m.format("YYYY-MM-DD") : null;
      } else if (currentDateKey && line.trim().startsWith("- [ ]")) {
        const d = currentDateKey;
        result.set(d, (result.get(d) || 0) + 1);
      } else if (line.startsWith("## ") || line.startsWith("### ")) {
        currentDateKey = null;
      }
    }

    return result;
  }

  /**
   * 获取当前文件中所有未完成待办（附带日期）
   */
  async getAllIncompleteTodos(year: number): Promise<{ date: string; todos: { text: string; line: number }[] }[]> {
    const filePath = this.getFilePath(year);
    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) return [];

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const result: { date: string; todos: { text: string; line: number }[] }[] = [];
    let currentDateKey: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("#### ")) {
        const m = parseDayTitle(line, this.settings.dateFormat);
        currentDateKey = m ? m.format("MM-DD") : null;
      } else if (currentDateKey && line.trim().startsWith("- [ ]")) {
        const todoText = line.trim().replace(/^- \[ \]\s*/, "");
        // 找最后一个相同日期的条目或新建
        const last = result[result.length - 1];
        if (last && last.date === currentDateKey) {
          last.todos.push({ text: todoText, line: i });
        } else {
          result.push({ date: currentDateKey, todos: [{ text: todoText, line: i }] });
        }
      } else if (line.startsWith("## ") || line.startsWith("### ")) {
        currentDateKey = null;
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────────────
  // 导出
  // ─────────────────────────────────────────────────────

  async exportRange(
    year: number,
    format: "markdown" | "html" | "json",
    month?: number
  ): Promise<string> {
    const filePath = this.getFilePath(year);
    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) return "";

    const content = await this.app.vault.read(file);

    if (format === "markdown") {
      if (month === undefined) return content;
      return this.extractMonthContent(content, month);
    }

    if (format === "html") {
      const md = month !== undefined ? this.extractMonthContent(content, month) : content;
      return this.markdownToSimpleHtml(md, year, month);
    }

    if (format === "json") {
      return this.contentToJson(content, year, month);
    }

    return content;
  }

  private extractMonthContent(content: string, month: number): string {
    const monthHeading = `## ${this.getMonthName(month)}`;
    const lines = content.split("\n");
    let inMonth = false;
    const result: string[] = [];

    for (const line of lines) {
      if (line.trim() === monthHeading) {
        inMonth = true;
        result.push(line);
        continue;
      }
      if (inMonth) {
        if (line.startsWith("## ") && line.trim() !== monthHeading) {
          break;
        }
        result.push(line);
      }
    }

    return result.join("\n");
  }

  private getMonthName(month: number): string {
    const names = ["", "一月", "二月", "三月", "四月", "五月", "六月",
      "七月", "八月", "九月", "十月", "十一月", "十二月"];
    return names[month] || `${month}月`;
  }

  private markdownToSimpleHtml(md: string, year: number, month?: number): string {
    const title = month ? `${year}年${this.getMonthName(month)}工作日志` : `${year}年工作日志`;
    let body = md
      .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/^- \[x\] (.+)$/gm, '<li class="done">✅ $1</li>')
      .replace(/^- \[ \] (.+)$/gm, '<li class="todo">⬜ $1</li>')
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/\n{2,}/g, "\n<br>\n");

    return `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
  h1 { border-bottom: 2px solid #333; }
  h2 { color: #444; border-left: 4px solid #7c3aed; padding-left: 8px; }
  h3 { color: #666; }
  h4 { color: #888; }
  li { margin: 4px 0; }
  li.done { color: #22c55e; }
</style>
</head>
<body>${body}</body>
</html>`;
  }

  private contentToJson(content: string, year: number, month?: number): string {
    const lines = content.split("\n");
    const result: Record<string, string[]> = {};
    let currentDate: string | null = null;

    for (const line of lines) {
      if (line.startsWith("#### ")) {
        const m = parseDayTitle(line, this.settings.dateFormat);
        if (m && m.isValid()) {
          if (month !== undefined && m.month() + 1 !== month) {
            currentDate = null;
            continue;
          }
          currentDate = m.format("YYYY-MM-DD");
          result[currentDate] = [];
        }
      } else if (
        currentDate &&
        !line.startsWith("## ") &&
        !line.startsWith("### ") &&
        line.trim() !== ""
      ) {
        result[currentDate].push(line.trim());
      }
    }

    return JSON.stringify({ year, month: month ?? null, data: result }, null, 2);
  }

  // ─────────────────────────────────────────────────────
  // 搜索
  // ─────────────────────────────────────────────────────

  async searchAllLogs(keyword: string): Promise<Array<{ date: string; content: string; filePath: string }>> {
    const dir = this.settings.logDirectory;
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(dir));
    if (!(folder instanceof TFolder)) return [];

    const results: Array<{ date: string; content: string; filePath: string }> = [];

    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      const content = await this.app.vault.read(child);
      const lines = content.split("\n");

      let currentDate: string | null = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("#### ")) {
          const m = parseDayTitle(line, this.settings.dateFormat);
          currentDate = m ? m.format("YYYY-MM-DD") : null;
        } else if (currentDate && line.toLowerCase().includes(keyword.toLowerCase())) {
          results.push({
            date: currentDate,
            content: line.trim(),
            filePath: child.path,
          });
        }
      }
    }

    return results;
  }
}
