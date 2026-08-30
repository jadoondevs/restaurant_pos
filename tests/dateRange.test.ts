/**
 * Shared date-range utility tests (electron/utils/dateRange.ts).
 *
 * This module is pure Date math with no Electron/Prisma dependency, so it
 * is imported and tested directly.
 */
import { describe, it, expect } from 'vitest';
import {
  startOfLocalDay,
  endOfLocalDay,
  todayRange,
  resolveDateRange,
} from '../electron/utils/dateRange';

/** Mirrors what Prisma actually does for a `{ gte, lte }` filter. */
function inRange(ts: Date, range: { gte: Date; lte: Date }): boolean {
  return ts.getTime() >= range.gte.getTime() && ts.getTime() <= range.lte.getTime();
}

describe('startOfLocalDay / endOfLocalDay', () => {
  it('startOfLocalDay returns local midnight for a given date', () => {
    const d = new Date(2026, 7, 27, 14, 35, 12, 345); // Aug 27, 2026, 14:35:12.345
    const start = startOfLocalDay(d);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(27);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it('endOfLocalDay returns the last instant of the given date', () => {
    const d = new Date(2026, 7, 27, 9, 0, 0, 0);
    const end = endOfLocalDay(d);
    expect(end.getDate()).toBe(27);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it('defaults to today when no date is given', () => {
    const now = new Date();
    const start = startOfLocalDay();
    expect(start.getFullYear()).toBe(now.getFullYear());
    expect(start.getMonth()).toBe(now.getMonth());
    expect(start.getDate()).toBe(now.getDate());
    expect(start.getHours()).toBe(0);
  });
});

describe('todayRange', () => {
  it('returns an inclusive range spanning exactly today', () => {
    const range = todayRange();
    const now = new Date();
    expect(range.gte.getDate()).toBe(now.getDate());
    expect(range.gte.getHours()).toBe(0);
    expect(range.lte.getDate()).toBe(now.getDate());
    expect(range.lte.getHours()).toBe(23);
    expect(range.lte.getMilliseconds()).toBe(999);
    expect(range.gte.getTime()).toBeLessThan(range.lte.getTime());
  });
});

describe('resolveDateRange — defaults', () => {
  it('defaults to today when neither from nor to is given', () => {
    const range = resolveDateRange();
    const today = todayRange();
    expect(range.gte.getTime()).toBe(today.gte.getTime());
    expect(range.lte.getTime()).toBe(today.lte.getTime());
  });

  it('defaults to today when called with an empty object', () => {
    const range = resolveDateRange({});
    const today = todayRange();
    expect(range.gte.getTime()).toBe(today.gte.getTime());
    expect(range.lte.getTime()).toBe(today.lte.getTime());
  });

  it('only `from` given: from\'s day through the end of today', () => {
    const range = resolveDateRange({ from: '2026-08-20' });
    expect(range.gte.getFullYear()).toBe(2026);
    expect(range.gte.getMonth()).toBe(7);
    expect(range.gte.getDate()).toBe(20);
    expect(range.gte.getHours()).toBe(0);

    const expectedEnd = endOfLocalDay();
    expect(range.lte.getTime()).toBe(expectedEnd.getTime());
  });

  it('only `to` given: resolves to the single calendar day of `to`', () => {
    const range = resolveDateRange({ to: '2026-08-27' });
    expect(range.gte.getDate()).toBe(27);
    expect(range.gte.getHours()).toBe(0);
    expect(range.lte.getDate()).toBe(27);
    expect(range.lte.getHours()).toBe(23);
    expect(range.lte.getMinutes()).toBe(59);
  });
});

describe('resolveDateRange — same-day and multi-day ranges', () => {
  it('same-day range: from === to expands to the full inclusive day', () => {
    const range = resolveDateRange({ from: '2026-08-27', to: '2026-08-27' });
    expect(range.gte.toDateString()).toBe(new Date(2026, 7, 27).toDateString());
    expect(range.gte.getHours()).toBe(0);
    expect(range.lte.getHours()).toBe(23);
    expect(range.lte.getMinutes()).toBe(59);
    expect(range.lte.getSeconds()).toBe(59);
  });

  it('multi-day range: from start of the first day through end of the last day', () => {
    const range = resolveDateRange({ from: '2026-08-20', to: '2026-08-27' });
    expect(range.gte).toEqual(new Date(2026, 7, 20, 0, 0, 0, 0));
    expect(range.lte).toEqual(new Date(2026, 7, 27, 23, 59, 59, 999));
  });
});

describe('resolveDateRange — inclusive boundary and exclusion behaviour', () => {
  const range = resolveDateRange({ from: '2026-08-20', to: '2026-08-27' });

  it('includes a record exactly at the start boundary', () => {
    expect(inRange(range.gte, range)).toBe(true);
  });

  it('includes a record exactly at the end-of-day boundary', () => {
    expect(inRange(range.lte, range)).toBe(true);
  });

  it('includes a record 1ms after the start boundary', () => {
    const ts = new Date(range.gte.getTime() + 1);
    expect(inRange(ts, range)).toBe(true);
  });

  it('includes a record 1ms before the end boundary', () => {
    const ts = new Date(range.lte.getTime() - 1);
    expect(inRange(ts, range)).toBe(true);
  });

  it('excludes a record 1ms before the start boundary (just outside the range)', () => {
    const ts = new Date(range.gte.getTime() - 1);
    expect(inRange(ts, range)).toBe(false);
  });

  it('excludes a record 1ms after the end boundary (just outside the range)', () => {
    const ts = new Date(range.lte.getTime() + 1);
    expect(inRange(ts, range)).toBe(false);
  });

  it('excludes a record from the day before the range entirely', () => {
    const ts = new Date(2026, 7, 19, 23, 59, 59, 999);
    expect(inRange(ts, range)).toBe(false);
  });

  it('excludes a record from the day after the range entirely', () => {
    const ts = new Date(2026, 7, 28, 0, 0, 0, 0);
    expect(inRange(ts, range)).toBe(false);
  });

  it('includes records at various times of day within the range', () => {
    const timesOfDay = [
      new Date(2026, 7, 23, 0, 0, 0, 1),   // just after midnight
      new Date(2026, 7, 23, 6, 15, 0, 0),  // early morning
      new Date(2026, 7, 23, 12, 0, 0, 0),  // noon
      new Date(2026, 7, 23, 18, 45, 30, 0), // evening
      new Date(2026, 7, 23, 23, 59, 59, 998), // just before midnight
    ];
    for (const ts of timesOfDay) {
      expect(inRange(ts, range)).toBe(true);
    }
  });

  it('returns no matches for a set of timestamps entirely outside the range (empty result)', () => {
    const outside = [
      new Date(2026, 6, 1),   // a month before
      new Date(2026, 9, 1),   // a month after
      new Date(2025, 7, 23),  // a year before
    ];
    const matches = outside.filter((ts) => inRange(ts, range));
    expect(matches).toHaveLength(0);
  });
});

describe('resolveDateRange — passthrough for precise instants (existing callers)', () => {
  it('does not expand a full ISO datetime string — used exactly as given', () => {
    const from = '2026-08-20T10:00:00.000Z';
    const to = '2026-08-27T15:30:00.000Z';
    const range = resolveDateRange({ from, to });
    expect(range.gte.getTime()).toBe(new Date(from).getTime());
    expect(range.lte.getTime()).toBe(new Date(to).getTime());
  });

  it('does not expand a Date instance — used exactly as given', () => {
    const from = new Date(2026, 7, 20, 9, 30, 0);
    const to = new Date(2026, 7, 20, 17, 0, 0);
    const range = resolveDateRange({ from, to });
    expect(range.gte.getTime()).toBe(from.getTime());
    expect(range.lte.getTime()).toBe(to.getTime());
  });

  it('mirrors the renderer\'s existing rangeFor()-style full-instant boundaries unchanged', () => {
    // src/utils/format.ts rangeFor() already produces full local-day
    // instants before calling toISOString() — resolveDateRange must not
    // re-expand or otherwise alter those precise boundaries.
    const from = new Date(2026, 7, 20, 0, 0, 0, 0).toISOString();
    const to = new Date(2026, 7, 20, 23, 59, 59, 999).toISOString();
    const range = resolveDateRange({ from, to });
    expect(range.gte.toISOString()).toBe(from);
    expect(range.lte.toISOString()).toBe(to);
  });
});
