const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * Parse a calendar date without letting the host timezone reinterpret it.
 * FoodLens stores school dates as YYYY-MM-DD in Asia/Taipei; calendar maths
 * therefore operates on integer UTC epoch-days rather than JavaScript Date
 * objects in the device timezone.
 */
export function parseCalendarDate(value: string): CalendarDateParts {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error(`無效日期：${value}`);
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    probe.getUTCFullYear() !== parts.year ||
    probe.getUTCMonth() !== parts.month - 1 ||
    probe.getUTCDate() !== parts.day
  )
    throw new Error(`無效日期：${value}`);
  return parts;
}

export function epochDay(value: string): number {
  const { year, month, day } = parseCalendarDate(value);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function calendarDateFromEpochDay(value: number): string {
  const date = new Date(value * DAY_MS);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function addCalendarDays(value: string, amount: number): string {
  return calendarDateFromEpochDay(epochDay(value) + amount);
}

export function calendarDayDifference(later: string, earlier: string): number {
  return epochDay(later) - epochDay(earlier);
}

/** 0 = Sunday, matching the conventional weekday numbering used by charts. */
export function calendarWeekday(value: string): number {
  return (((epochDay(value) + 4) % 7) + 7) % 7;
}

export function mondayOfCalendarWeek(value: string): string {
  const weekday = calendarWeekday(value);
  return addCalendarDays(value, weekday === 0 ? -6 : 1 - weekday);
}

export function formatCalendarMonthDay(value: string): string {
  const { month, day } = parseCalendarDate(value);
  return `${month}/${day}`;
}

export function distinctCalendarDates(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/** Return the school calendar date even when the device or server uses UTC. */
export function todayInTaipei(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
