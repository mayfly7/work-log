import { moment } from "obsidian";
import type { WorkLogSettings } from "./settings";
import { getHolidayName } from "./holidays";

export interface DayInfo {
  date: moment.Moment;
  /** 该日期所在月份（1-12） */
  month: number;
  /** 该日期所在周序号（自然年内，从1开始） */
  weekIndex: number;
  /** 该周的起始日期 */
  weekStart: moment.Moment;
  /** 该周的结束日期 */
  weekEnd: moment.Moment;
}

export interface WeekGroup {
  weekIndex: number;
  weekStart: moment.Moment;
  weekEnd: moment.Moment;
  days: moment.Moment[];
}

export interface MonthGroup {
  month: number; // 1-12
  monthName: string;
  weeks: WeekGroup[];
}

const ZH_MONTH_NAMES = [
  "", "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月",
];

const ZH_WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const EN_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * 格式化星期几
 */
export function formatWeekday(date: moment.Moment, lang: "zh" | "en"): string {
  const dow = date.day(); // 0=Sun ... 6=Sat
  return lang === "zh" ? ZH_WEEKDAYS[dow] : EN_WEEKDAYS[dow];
}

/**
 * 获取中文月份名称
 */
export function getMonthName(month: number): string {
  return ZH_MONTH_NAMES[month] || `${month}月`;
}

/**
 * 根据设置计算某一年的全部按月→按周分组结构
 */
export function buildYearStructure(year: number, settings: WorkLogSettings): MonthGroup[] {
  const weekStartDay = settings.weekStart === "monday" ? 1 : 0; // 1=Mon, 0=Sun

  // 迭代全年每一天
  const start = moment({ year, month: 0, date: 1 });
  const end = moment({ year, month: 11, date: 31 });

  // 收集全部 [weekKey -> WeekGroup] 的 Map
  const weekMap = new Map<string, WeekGroup>();
  // 月 -> weekKey[]
  const monthWeekKeys = new Map<number, Set<string>>();

  let cur = start.clone();
  while (cur.isSameOrBefore(end, "day")) {
    const month = cur.month() + 1; // 1-12
    // 计算该日期所在周的周一（或周日）
    const wStart = getWeekStart(cur, weekStartDay);
    const wEnd = wStart.clone().add(6, "days");

    const weekKey = wStart.format("YYYY-MM-DD");

    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, {
        weekIndex: 0, // 后面重新计算
        weekStart: wStart.clone(),
        weekEnd: wEnd.clone(),
        days: [],
      });
    }

    const week = weekMap.get(weekKey)!;
    // 只加入当年的日期
    if (cur.year() === year) {
      week.days.push(cur.clone());
    }

    if (!monthWeekKeys.has(month)) {
      monthWeekKeys.set(month, new Set());
    }
    monthWeekKeys.get(month)!.add(weekKey);

    cur.add(1, "day");
  }

  // 对所有 weekKey 排序，分配全局 weekIndex（按自然年）
  const allWeekKeys = Array.from(weekMap.keys()).sort();
  allWeekKeys.forEach((key, idx) => {
    weekMap.get(key)!.weekIndex = idx + 1;
  });

  // 构建月份分组（跨月周按月份拆分天数）
  const monthGroups: MonthGroup[] = [];
  for (let month = 1; month <= 12; month++) {
    const keys = monthWeekKeys.get(month);
    if (!keys) continue;

    const sortedKeys = Array.from(keys).sort();
    const weeks: WeekGroup[] = [];
    for (const k of sortedKeys) {
      const wg = weekMap.get(k)!;
      // 只保留属于当前月的日期
      const monthDays = wg.days.filter((d) => d.month() + 1 === month);
      if (monthDays.length === 0) continue;
      weeks.push({
        weekIndex: wg.weekIndex,
        weekStart: wg.weekStart.clone(),
        weekEnd: wg.weekEnd.clone(),
        days: monthDays,
      });
    }
    if (weeks.length === 0) continue;

    monthGroups.push({
      month,
      monthName: getMonthName(month),
      weeks,
    });
  }

  return monthGroups;
}

/**
 * 获取某一天所在周的周起始日
 */
export function getWeekStart(date: moment.Moment, weekStartDay: number): moment.Moment {
  const dow = date.day(); // 0=Sun...6=Sat
  let diff = dow - weekStartDay;
  if (diff < 0) diff += 7;
  return date.clone().subtract(diff, "days");
}

/**
 * 获取某日期所属周（WeekGroup）在指定年份结构中的信息
 */
export function getWeekGroupForDate(
  date: moment.Moment,
  yearGroups: MonthGroup[]
): WeekGroup | null {
  for (const mg of yearGroups) {
    for (const wg of mg.weeks) {
      if (date.isBetween(wg.weekStart, wg.weekEnd, "day", "[]")) {
        return wg;
      }
    }
  }
  return null;
}

/**
 * 格式化周标题：例如 "第3周（1月14日 - 1月20日）"
 */
export function formatWeekTitle(wg: WeekGroup, year: number): string {
  const s = wg.weekStart;
  const e = wg.weekEnd;

  const fmtDate = (d: moment.Moment) => {
    return `${d.month() + 1}月${d.date()}日`;
  };

  return `第${wg.weekIndex}周（${fmtDate(s)} - ${fmtDate(e)}）`;
}

/**
 * 格式化日期标题：例如 "2026-01-05 星期一"
 */
export function formatDayTitle(date: moment.Moment, settings: WorkLogSettings, dateFormat?: string): string {
  const dateStr = date.format(dateFormat || settings.dateFormat);
  const weekday = formatWeekday(date, settings.weekdayLanguage);
  const holiday = getHolidayName(date.format("YYYY-MM-DD"));
  const suffix = holiday ? `（${holiday}）` : "";
  return `${dateStr} ${weekday}${suffix}`;
}

/**
 * 解析四级标题的日期（返回 moment 或 null）
 * 先尝试当前格式，再尝试常见旧格式，兼容格式变更
 */
export function parseDayTitle(heading: string, dateFormat: string): moment.Moment | null {
  // 去除前缀 ####
  const stripped = heading.replace(/^####\s+/, "").trim();
  // 取第一个空格之前的部分作为日期字符串
  const datePart = stripped.split(/\s+/)[0];

  const formatsToTry = [dateFormat, "YYYY-MM-DD", "MM-DD", "M月D日", "YYYY年MM月DD日"];
  for (const fmt of formatsToTry) {
    const m = moment(datePart, fmt, true);
    if (m.isValid()) return m;
  }
  return null;
}

/**
 * 获取一个月内所有日期
 */
export function getDaysInMonth(year: number, month: number): moment.Moment[] {
  const days: moment.Moment[] = [];
  const start = moment({ year, month: month - 1, date: 1 });
  const end = start.clone().endOf("month");
  let cur = start.clone();
  while (cur.isSameOrBefore(end, "day")) {
    days.push(cur.clone());
    cur.add(1, "day");
  }
  return days;
}

/**
 * 判断两个日期是否是同一天
 */
export function isSameDay(a: moment.Moment, b: moment.Moment): boolean {
  return a.isSame(b, "day");
}

/**
 * 格式化月份标题：二级标题文字，如 "一月"
 */
export function formatMonthHeading(month: number): string {
  return getMonthName(month);
}
