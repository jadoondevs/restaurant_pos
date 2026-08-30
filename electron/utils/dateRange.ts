/**
 * Shared date/date-range utilities for order and report queries.
 *
 * This is the SINGLE source of truth for "today" and day-boundary math in
 * the app. Every query that filters Order.createdAt by a date or date range
 * should resolve its bounds through resolveDateRange() (or the smaller
 * helpers below) instead of hand-rolling its own boundary calculation —
 * several call sites used to duplicate slightly different versions of this
 * logic, which is exactly how the "midnight hides yesterday's sales" class
 * of bug happens.
 *
 * INTERPRETATION (the "single consistent interpretation" this app uses):
 *
 *   - "Today" and all day boundaries are computed in the LOCAL time zone of
 *     the machine running the Electron main process — i.e. the restaurant's
 *     own wall-clock time. This is a single-machine, on-site desktop POS,
 *     so "midnight" means the restaurant's midnight, not UTC midnight.
 *     (This matches how the rest of the app already computed "today" —
 *     e.g. the receipt-numbering dateKey — so this is a consolidation, not
 *     a behaviour change for existing local-time-based logic.)
 *
 *   - A DATE-ONLY string ("2026-08-27", no time component) is expanded to
 *     the INCLUSIVE full local calendar day: 00:00:00.000 through
 *     23:59:59.999. This is what makes a plain "YYYY-MM-DD" value from a
 *     date picker behave correctly instead of silently excluding most or
 *     all of that day's records.
 *
 *   - A value that already carries a time component (a full ISO datetime
 *     string, or a Date instance) is used exactly as given — it is treated
 *     as a precise instant, not expanded. This preserves existing callers
 *     that already build precise boundaries themselves (e.g. the renderer's
 *     rangeFor() helper in src/utils/format.ts).
 */

export interface DateRangeInput {
  from?: string | Date | null;
  to?: string | Date | null;
}

export interface ResolvedDateRange {
  gte: Date;
  lte: Date;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a plain calendar-date string with no time component ("2026-08-27"). */
function isDateOnlyString(value: string): boolean {
  return DATE_ONLY_PATTERN.test(value.trim());
}

function parseDateOnlyParts(value: string): { y: number; m: number; d: number } {
  const [y, m, d] = value.trim().split('-').map(Number);
  return { y, m, d };
}

/** Midnight (00:00:00.000) of the given date, in local time. Defaults to today. */
export function startOfLocalDay(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/** The last instant (23:59:59.999) of the given date, in local time. Defaults to today. */
export function endOfLocalDay(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/** Today's inclusive local range: [start of today, end of today]. */
export function todayRange(): ResolvedDateRange {
  const now = new Date();
  return { gte: startOfLocalDay(now), lte: endOfLocalDay(now) };
}

/**
 * Resolves a boundary value to the START of the range it represents.
 *   - a date-only string  -> local midnight of that calendar date
 *   - anything else (full ISO datetime string, or a Date) -> used exactly as given
 */
function resolveStart(value: string | Date): Date {
  if (typeof value === 'string' && isDateOnlyString(value)) {
    const { y, m, d } = parseDateOnlyParts(value);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  return new Date(value);
}

/**
 * Resolves a boundary value to the END of the range it represents.
 *   - a date-only string  -> local 23:59:59.999 of that calendar date
 *   - anything else (full ISO datetime string, or a Date) -> used exactly as given
 */
function resolveEnd(value: string | Date): Date {
  if (typeof value === 'string' && isDateOnlyString(value)) {
    const { y, m, d } = parseDateOnlyParts(value);
    return new Date(y, m - 1, d, 23, 59, 59, 999);
  }
  return new Date(value);
}

/**
 * Resolves an optional {from, to} pair into an inclusive {gte, lte} Date
 * range suitable for a Prisma `createdAt` filter.
 *
 * Defaults (documented here so every caller behaves identically):
 *   - neither from nor to given -> today (local calendar day)
 *   - only `from` given         -> from's calendar day through the end of today
 *   - only `to` given           -> the single calendar day of `to`
 *   - both given                -> from's start through to's end, inclusive
 */
export function resolveDateRange(input: DateRangeInput = {}): ResolvedDateRange {
  const { from, to } = input;

  if (!from && !to) return todayRange();
  if (from && !to) return { gte: resolveStart(from), lte: endOfLocalDay() };
  if (!from && to) return { gte: resolveStart(to), lte: resolveEnd(to) };

  return { gte: resolveStart(from as string | Date), lte: resolveEnd(to as string | Date) };
}
