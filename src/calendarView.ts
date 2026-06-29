import { ItemView, WorkspaceLeaf, moment, requestUrl, Notice, Modal, Setting } from "obsidian";
import type WorkLogPlugin from "./main";
import { isSameDay } from "./dateUtils";
import { getHolidayName, fetchHolidays } from "./holidays";
import { getDailyPoem, fetchDailyPoem } from "./poems";
import type { Poem } from "./poems";

export const CALENDAR_VIEW_TYPE = "work-log-calendar";

export class CalendarView extends ItemView {
  private plugin: WorkLogPlugin;
  private currentYear: number;
  private currentMonth: number; // 1-12
  private selectedDate: moment.Moment | null = null;
  private tooltip: HTMLElement | null = null;
  private actionBtnEl: HTMLElement | null = null;
  /** 用户最后一次手动选中日期的时间戳，用于防止光标同步立即覆盖 */
  lastUserSelectTime: number = 0;
  private tooltipGen = 0; // 每次 showTooltip 调用递增

  constructor(leaf: WorkspaceLeaf, plugin: WorkLogPlugin) {
    super(leaf);
    this.plugin = plugin;
    const now = moment();
    this.currentYear = now.year();
    this.currentMonth = now.month() + 1;
    this.selectedDate = now.clone();
  }

  getViewType(): string {
    return CALENDAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "工作日志日历";
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen(): Promise<void> {
    // 滚动时清除 tooltip（tooltip 基于 pageX/pageY 定位，滚动后位置会错）
    this.registerDomEvent(document, "scroll", () => this.removeTooltip(), true);
    // 点击文档任意位置清除 tooltip
    this.registerDomEvent(document, "click", () => this.removeTooltip());
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.removeTooltip();
  }

  async refresh(): Promise<void> {
    try {
      await this.plugin.fileManager.getOrCreateFile(this.currentYear);
    } catch {
      // ignore
    }
    await this.render();
  }

  private async render(): Promise<void> {
    // 重新渲染前先清除残留的 tooltip，防止 re-render 销毁格子后 mouseleave 不触发
    this.removeTooltip();
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("work-log-calendar");

    // 加载当前月份有内容的日期
    const datesWithContent = await this.plugin.fileManager.getDatesWithContent(
      this.currentYear,
      this.currentMonth
    );

    // 加载未完成待办
    const incompleteTodoMap = await this.plugin.fileManager.getIncompleteTodoMap(
      this.currentYear,
      this.currentMonth
    );

    this.renderHeader(container);
    this.renderCalendarGrid(container, datesWithContent, incompleteTodoMap);
    // 鼠标离开日历网格区域时清除 tooltip（兜底）
    const grid = container.querySelector(".wl-cal-grid") as HTMLElement;
    if (grid) {
      grid.addEventListener("mouseleave", () => this.removeTooltip());
    }
    this.renderActionButton(container);

    // 每日诗词
    if (this.plugin.settings.showDailyPoem) {
      this.renderDailyPoem(container);
    }

    // 加载所有未完成待办（全文件，非仅选中日期）
    const allTodos = await this.plugin.fileManager.getAllIncompleteTodos(this.currentYear);
    this.renderTodoList(container, allTodos);
  }

  // ─────────────────────────────────────────────────────
  // Header
  // ─────────────────────────────────────────────────────

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv("wl-cal-header");

    const prevBtn = header.createEl("button", { cls: "wl-nav-btn", text: "‹" });
    prevBtn.title = "上一月";
    prevBtn.addEventListener("click", () => this.navigateMonth(-1));

    const titleArea = header.createDiv("wl-cal-title");
    const now = moment();

    const yearSel = titleArea.createEl("select", { cls: "wl-year-select" });
    const startYear = now.year() - 5;
    const endYear = now.year() + 2;
    for (let y = startYear; y <= endYear; y++) {
      const opt = yearSel.createEl("option", { value: String(y), text: String(y) });
      if (y === this.currentYear) opt.selected = true;
    }
    yearSel.addEventListener("change", async (e) => {
      this.currentYear = parseInt((e.target as HTMLSelectElement).value);
      await fetchHolidays(requestUrl, this.currentYear);
      await this.refresh();
    });

    titleArea.createSpan({ text: "年", cls: "wl-title-sep" });

    const monthSel = titleArea.createEl("select", { cls: "wl-month-select" });
    const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月",
      "七月", "八月", "九月", "十月", "十一月", "十二月"];
    for (let m = 1; m <= 12; m++) {
      const opt = monthSel.createEl("option", { value: String(m), text: monthNames[m - 1] });
      if (m === this.currentMonth) opt.selected = true;
    }
    monthSel.addEventListener("change", async (e) => {
      this.currentMonth = parseInt((e.target as HTMLSelectElement).value);
      await this.refresh();
    });

    const nextBtn = header.createEl("button", { cls: "wl-nav-btn", text: "›" });
    nextBtn.title = "下一月";
    nextBtn.addEventListener("click", () => this.navigateMonth(1));

    const todayBtn = header.createEl("button", { cls: "wl-today-btn", text: "今日" });
    todayBtn.addEventListener("click", async () => {
      const n = moment();
      this.currentYear = n.year();
      this.currentMonth = n.month() + 1;
      this.selectedDate = n.clone();
      this.lastUserSelectTime = Date.now();
      await this.refresh();
      await this.plugin.fileManager.openAndNavigateToDate(n);
    });
  }

  private async navigateMonth(delta: number): Promise<void> {
    let m = this.currentMonth + delta;
    let y = this.currentYear;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    this.currentMonth = m;
    this.currentYear = y;
    await this.refresh();
  }

  // ─────────────────────────────────────────────────────
  // Calendar grid
  // ─────────────────────────────────────────────────────

  private renderCalendarGrid(container: HTMLElement, datesWithContent: Set<string>, incompleteTodoMap: Map<string, number>): void {
    const grid = container.createDiv("wl-cal-grid");

    const weekStartDay = this.plugin.settings.weekStart;
    const headers = weekStartDay === "monday"
      ? ["一", "二", "三", "四", "五", "六", "日"]
      : ["日", "一", "二", "三", "四", "五", "六"];

    const headerRow = grid.createDiv("wl-cal-row wl-cal-weekdays");
    for (const h of headers) {
      headerRow.createDiv({ cls: "wl-cal-cell wl-weekday-header", text: h });
    }

    const firstDay = moment({ year: this.currentYear, month: this.currentMonth - 1, date: 1 });
    const lastDay = firstDay.clone().endOf("month");
    const today = moment();

    const dowFirst = firstDay.day();
    let startOffset: number;
    if (weekStartDay === "monday") {
      startOffset = (dowFirst + 6) % 7;
    } else {
      startOffset = dowFirst;
    }

    let dayRow = grid.createDiv("wl-cal-row");
    let cellCount = 0;

    for (let i = 0; i < startOffset; i++) {
      dayRow.createDiv("wl-cal-cell wl-cal-empty");
      cellCount++;
    }

    let cur = firstDay.clone();
    while (cur.isSameOrBefore(lastDay, "day")) {
      if (cellCount > 0 && cellCount % 7 === 0) {
        dayRow = grid.createDiv("wl-cal-row");
      }

      const isToday = isSameDay(cur, today);
      const isWeekend = cur.day() === 0 || cur.day() === 6;

      // Highlight if this date is the selected one
      let selectedCls = "";
      if (this.selectedDate && isSameDay(cur, this.selectedDate)) {
        selectedCls = "wl-selected";
      }

      const cell = dayRow.createDiv({
        cls: [
          "wl-cal-cell",
          "wl-cal-day",
          isToday ? "wl-today" : "",
          isWeekend ? "wl-weekend" : "",
          selectedCls,
        ].filter(Boolean).join(" "),
      });

      cell.createSpan({ cls: "wl-day-num", text: String(cur.date()) });

      // Dot marker for dates that have content
      if (datesWithContent.has(cur.format("YYYY-MM-DD"))) {
        cell.addClass("wl-has-content");
        cell.createDiv("wl-dot");
      }

      // Red dot marker for dates that have incomplete todos
      const dateKey = cur.format("YYYY-MM-DD");
      const todoCount = incompleteTodoMap.get(dateKey) || 0;
      if (todoCount > 0) {
        cell.addClass("wl-has-todo");
        const dot = cell.createDiv("wl-todo-dot");
        if (todoCount > 1) dot.setText(String(todoCount));
      }

      // Holiday label
      if (this.plugin.settings.showHolidays) {
        const holidayName = getHolidayName(dateKey);
        if (holidayName) {
          cell.addClass("wl-holiday");
          cell.createDiv({ cls: "wl-holiday-label", text: holidayName });
        }
      }

      const dateCopy = cur.clone();

      // Click: select date + open file
      cell.addEventListener("click", async () => {
        const today = moment();
        // 每天新增模式：未来日期跳转到今天
        const navigateTarget = (
          this.plugin.settings.generationMode === "up_to_today"
          && dateCopy.isAfter(today, "day")
        ) ? today.clone() : dateCopy.clone();

        this.selectedDate = navigateTarget.clone();
        this.lastUserSelectTime = Date.now();
        await this.render();
        await this.plugin.fileManager.openAndNavigateToDate(navigateTarget);
      });

      // 移动端：长按预览日期内容（替代桌面端 hover tooltip）
      if (this.app.isMobile) {
        let longPressTimer: number | null = null;
        cell.addEventListener("touchstart", (e) => {
          longPressTimer = window.setTimeout(async () => {
            longPressTimer = null;
            // 长按显示日期预览
            const [preview, todos] = await Promise.all([
              this.plugin.fileManager.getDayPreview(dateCopy, 4),
              this.plugin.fileManager.getIncompleteTodosForDate(dateCopy),
            ]);
            const lines: string[] = [];
            if (preview.length > 0) {
              lines.push("📄 工作记录：");
              for (const p of preview.split("\n")) {
                // mobile Notice 较窄，截断长行
                lines.push(p.length > 24 ? p.substring(0, 22) + "…" : p);
              }
            }
            if (todos.length > 0) {
              lines.push("");
              lines.push(`☐ 待办（${todos.length}）：`);
              for (const t of todos) {
                const text = `  ☐ ${t.text}`;
                lines.push(text.length > 24 ? text.substring(0, 22) + "…" : text);
              }
            }
            if (lines.length === 0) {
              lines.push("（无记录）");
            }
            new Notice(`${dateCopy.format("MM月DD日")}\n${lines.join("\n")}`, 5000);
          }, 600);
        }, { passive: true });
        cell.addEventListener("touchend", () => {
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        });
        cell.addEventListener("touchmove", () => {
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        }, { passive: true });
      } else {
        // 桌面端：Hover preview
        cell.addEventListener("mouseenter", async (e) => {
          cell.addClass("wl-hover");
          this.updateButtonTextForDate(dateCopy);
          await this.showTooltip(e, dateCopy);
        });
        cell.addEventListener("mouseleave", () => {
          cell.removeClass("wl-hover");
          this.updateButtonTextForDate(null);
          this.removeTooltip();
        });
      }

      cur.add(1, "day");
      cellCount++;
    }

    const remaining = cellCount % 7;
    if (remaining !== 0) {
      for (let i = remaining; i < 7; i++) {
        dayRow.createDiv("wl-cal-cell wl-cal-empty");
      }
    }
  }

  // ─────────────────────────────────────────────────────
  // Action button below calendar
  // ─────────────────────────────────────────────────────

  private renderActionButton(container: HTMLElement): void {
    const actionBar = container.createDiv("wl-action-bar");

    const today = moment();
    const sel = this.selectedDate;
    let label: string;

    if (sel && isSameDay(sel, today)) {
      label = "＋ 添加今日工作记录";
    } else if (sel) {
      label = `＋ 添加 ${sel.format("MM-DD")} 工作记录`;
    } else {
      label = "＋ 添加今日工作记录";
    }

    const btn = actionBar.createEl("button", { cls: "wl-add-btn" });
    btn.textContent = label;
    this.actionBtnEl = btn;

    const getTarget = (): moment.Moment => {
      return this.selectedDate ? this.selectedDate.clone() : moment();
    };

    if (this.plugin.settings.entryMode === "timestamp") {
      // 时间戳模式
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const target = getTarget();
        if (isSameDay(target, moment())) {
          // 当天：插入当前时间
          await this.plugin.fileManager.insertTimestampEntry(target);
        } else {
          // 非当天：打开并定位到该日期内容末尾
          await this.plugin.fileManager.openAndNavigateToEndOfDate(target);
        }
        await this.render();
      });
    } else {
      // 上午/下午模式：首次点击弹出上下午选项，再次点击添加全天
      const popup = actionBar.createDiv("wl-session-popup");
      popup.style.display = "none";

      const amBtn = popup.createEl("button", { cls: "wl-session-opt wl-session-am" });
      amBtn.textContent = "☀ 上午";
      amBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        popup.style.display = "none";
        await this.plugin.fileManager.insertSessionLabel(getTarget(), "上午");
        await this.render();
      });

      const pmBtn = popup.createEl("button", { cls: "wl-session-opt wl-session-pm" });
      pmBtn.textContent = "🌙 下午";
      pmBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        popup.style.display = "none";
        await this.plugin.fileManager.insertSessionLabel(getTarget(), "下午");
        await this.render();
      });

      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (popup.style.display !== "none") {
          // 再次点击：关闭弹窗，添加全天
          popup.style.display = "none";
          await this.plugin.fileManager.insertSessionLabel(getTarget(), "全天");
          await this.render();
        } else {
          popup.style.display = "flex";
        }
      });

      // Click/touch outside to close
      const closeHandler = (ev: Event) => {
        if (!actionBar.contains(ev.target as Node)) {
          popup.style.display = "none";
        }
      };
      document.addEventListener("click", closeHandler);
      if (this.app.isMobile) {
        document.addEventListener("touchstart", closeHandler, { passive: true });
      }
    }

    // ─── 添加待办按钮 ────────────────────────────
    const todoBtn = actionBar.createEl("button", { cls: "wl-todo-btn" });
    todoBtn.textContent = "☐ 添加待办";
    todoBtn.addEventListener("click", async () => {
      const editor = this.app.workspace.activeEditor?.editor;
      if (editor) {
        const cursor = editor.getCursor();
        if (cursor.ch === 0) {
          // 光标已经在行首，直接插入
          editor.replaceRange("- [ ] ", cursor);
          editor.setCursor({ line: cursor.line, ch: 6 });
        } else {
          // 光标在行中，换行后插入，确保 checkbox 在行首才能点选
          editor.replaceRange("\n- [ ] ", cursor);
          editor.setCursor({ line: cursor.line + 1, ch: 6 });
        }
        editor.focus();
      } else {
        // 没有活跃编辑器时，在当前选中日期下方插入
        const target = this.selectedDate ? this.selectedDate.clone() : moment();
        await this.plugin.fileManager.insertSessionLabel(target, "☐ 待办");
        await this.render();
      }
    });
  }

  // ─────────────────────────────────────────────────────
  // Tooltip (desktop only)
  // ─────────────────────────────────────────────────────

  // ────────────────────────────────────────────
  // Hover preview helpers
  // ────────────────────────────────────────────

  // ────────────────────────────────────────────
  // 待办列表（日历下方）
  // ────────────────────────────────────────────
  // Daily Poem
  // ────────────────────────────────────────────

  private poemData: Poem | null = null;

  private async renderDailyPoem(container: HTMLElement): Promise<void> {
    const today = moment().format("YYYY-MM-DD");
    // 优先尝试 API，失败则用本地诗词
    const skipCache = this.plugin.settings.refreshPoemOnOpen;
    let poem = await fetchDailyPoem(skipCache);
    if (!poem) {
      poem = getDailyPoem(today);
    }
    this.poemData = poem;

    const section = container.createDiv("wl-daily-poem");
    const text = section.createDiv("wl-poem-text");
    text.textContent = `"${poem.text}"`;
    const meta = section.createDiv("wl-poem-meta");
    meta.textContent = `—— ${poem.author}${poem.source ? " " + poem.source : ""}`;

    // 点击展开全文
    section.style.cursor = "pointer";
    section.addEventListener("click", () => this.showPoemModal());
  }

  private showPoemModal(): void {
    const poem = this.poemData;
    if (!poem) return;

    const modal = new Modal(this.app);
    modal.titleEl.setText(poem.source || "诗词赏析");

    const content = modal.contentEl.createDiv("wl-poem-modal");

    // 完整正文
    if (poem.fullText && poem.fullText.length > 0) {
      const body = content.createDiv("wl-poem-modal-body");
      const lines = poem.fullText.map((line, i) => {
        if (i === poem.fullText!.length - 1) return line;
        return line.endsWith("。") || line.endsWith("？") || line.endsWith("！")
          ? line : line + "，";
      });
      body.setText(lines.join(""));
    } else {
      content.createDiv("wl-poem-modal-body").setText(poem.text);
    }

    // 作者
    content.createDiv("wl-poem-modal-author").setText(`—— ${poem.author}`);

    // 复制按钮
    new Setting(content)
      .addButton((btn) =>
        btn
          .setButtonText("📋 复制全文")
          .setCta()
          .onClick(async () => {
            const titleLine = poem.source ? `${poem.source}\n` : "";
            const authorLine = `${poem.author}\n\n`;
            const body = poem.fullText
              ? poem.fullText.map((line, i) => {
                  if (i === poem.fullText!.length - 1) return line;
                  return /[。？！，]$/.test(line) ? line : line + "，";
                }).join("")
              : poem.text;
            const copyText = titleLine + authorLine + body;
            await navigator.clipboard.writeText(copyText);
            new Notice("已复制到剪贴板");
            modal.close();
          })
      );

    modal.open();
  }

  // ────────────────────────────────────────────

  private renderTodoList(container: HTMLElement, allTodos: { date: string; todos: { text: string; line: number }[] }[]): void {
    if (allTodos.length === 0) return;

    const section = container.createDiv("wl-todo-section");
    section.createDiv({ cls: "wl-todo-label", text: "待办事项" });

    for (const group of allTodos) {
      for (const todo of group.todos) {
        const item = section.createDiv("wl-todo-item");
        item.createSpan({ cls: "wl-todo-date", text: group.date });
        const textEl = item.createSpan({ cls: "wl-todo-text", text: "☐ " + todo.text });
        item.addClass("wl-clickable");

        item.addEventListener("click", async () => {
          await this.plugin.fileManager.jumpToLine(this.currentYear, todo.line);
        });
      }
    }
  }

  private updateButtonTextForDate(previewDate: moment.Moment | null): void {
    if (!this.actionBtnEl) return;
    const today = moment();
    const target = previewDate
      ? previewDate
      : this.selectedDate
      ? this.selectedDate
      : today;
    let label: string;
    if (isSameDay(target, today)) {
      label = "＋ 添加今日工作记录";
    } else {
      label = `＋ 添加 ${target.format("MM-DD")} 工作记录`;
    }
    this.actionBtnEl.textContent = label;
  }

  private async showTooltip(e: MouseEvent, date: moment.Moment): Promise<void> {
    this.removeTooltip();
    const gen = ++this.tooltipGen;

    const [preview, todos] = await Promise.all([
      this.plugin.fileManager.getDayPreview(date, 4),
      this.plugin.fileManager.getIncompleteTodosForDate(date),
    ]);

    // 如果在此期间有新的 tooltip 请求，放弃本次（避免多个 tooltip 同时显示）
    if (this.tooltipGen !== gen) return;
    if (!preview && todos.length === 0) return;

    const tt = document.createElement("div");
    tt.className = "wl-tooltip";
    // 先设置为不可见，用于测量
    tt.style.visibility = "hidden";

    tt.createDiv({ cls: "wl-tt-title", text: date.format("YYYY-MM-DD") });

    // 待办提示（红色高亮）
    if (todos.length > 0) {
      const todoSection = tt.createDiv("wl-tt-todos");
      for (const todo of todos) {
        todoSection.createDiv({ cls: "wl-tt-todo-line", text: "☐ " + todo });
      }
    }

    // 一般内容预览
    if (preview) {
      const body = tt.createDiv({ cls: "wl-tt-body" });
      preview.split("\n").forEach((line) => {
        body.createDiv({ cls: "wl-tt-line", text: line });
      });
    }

    // 先追加到 DOM 测量尺寸
    document.body.appendChild(tt);

    // 延迟一帧获取真实布局尺寸
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    // await 期间可能有新的 tooltip 请求或 removeTooltip 被调用，检查并清理
    if (this.tooltipGen !== gen) {
      if (document.body.contains(tt)) document.body.removeChild(tt);
      return;
    }

    const rect = tt.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = e.pageX + 12;
    let top = e.pageY + 4;

    // 右边界检查：如果超出视口，翻转到鼠标左侧
    if (left + rect.width > vw - 8) {
      left = e.pageX - rect.width - 12;
    }
    // 左边界检查
    if (left < 5) left = 5;
    // 下边界检查：如果超出视口，翻转到鼠标上方
    if (top + rect.height > vh - 8) {
      top = e.pageY - rect.height - 10;
    }
    // 上边界检查
    if (top < 5) top = 5;

    tt.style.left = `${left}px`;
    tt.style.top = `${top}px`;
    tt.style.visibility = "";
    this.tooltip = tt;
  }

  private removeTooltip(): void {
    this.tooltipGen++; // 使所有进行中的 showTooltip 失效
    if (this.tooltip && document.body.contains(this.tooltip)) {
      document.body.removeChild(this.tooltip);
    }
    this.tooltip = null;
    // 兜底：移除所有孤立的 wl-tooltip 元素（防止任何泄漏）
    document.querySelectorAll(".wl-tooltip").forEach((el) => {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    this.tooltip = null;
  }

  // ─────────────────────────────────────────────────────
  // Public
  // ─────────────────────────────────────────────────────

  async navigateTo(year: number, month: number): Promise<void> {
    this.currentYear = year;
    this.currentMonth = month;
    await this.refresh();
  }

  /**
   * 从编辑器光标同步：选中指定日期（导航到对应年月 + 标记选中）
   * 不打开文件，因为光标已经在文件里了
   */
  async selectDate(date: moment.Moment): Promise<void> {
    this.selectedDate = date.clone();
    this.currentYear = date.year();
    this.currentMonth = date.month() + 1;
    await this.refresh();
  }
}
