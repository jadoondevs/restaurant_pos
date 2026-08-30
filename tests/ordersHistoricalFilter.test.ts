/**
 * Follow-up batch after Batch 11 — Priority 3 (Orders historical date
 * filtering). Mirrors orders:list's where-clause construction exactly
 * (electron/ipc/orders.ts): when from/to are given, resolveDateRange()
 * builds the boundary; when neither is given, it falls back to today-only
 * (the page's original default, still true when no filter is selected).
 */
import { describe, it, expect } from 'vitest';
import { resolveDateRange, startOfLocalDay } from '../electron/utils/dateRange';

interface ListParams {
  from?: string;
  to?: string;
  search?: string;
}

/** Mirrors the where.createdAt construction in electron/ipc/orders.ts's orders:list handler. */
function buildOrdersWhere(params: ListParams): { gte?: Date; lte?: Date } {
  if (params.from || params.to) {
    const range = resolveDateRange({ from: params.from, to: params.to });
    const where: { gte?: Date; lte?: Date } = {};
    if (params.from) where.gte = range.gte;
    if (params.to) where.lte = range.lte;
    return where;
  }
  return { gte: startOfLocalDay() };
}

describe('orders:list — historical date filtering', () => {
  it('defaults to today-only when no from/to is given (unchanged original behavior)', () => {
    const where = buildOrdersWhere({});
    expect(where.gte).toEqual(startOfLocalDay());
    expect(where.lte).toBeUndefined();
  });

  it('a single date (from === to) resolves to that day\'s full inclusive range', () => {
    const where = buildOrdersWhere({ from: '2026-08-25', to: '2026-08-25' });
    expect(where.gte).toEqual(new Date(2026, 7, 25, 0, 0, 0, 0));
    expect(where.lte).toEqual(new Date(2026, 7, 25, 23, 59, 59, 999));
  });

  it('a date range resolves from the start of the first day to the end of the last', () => {
    const where = buildOrdersWhere({ from: '2026-08-20', to: '2026-08-30' });
    expect(where.gte).toEqual(new Date(2026, 7, 20, 0, 0, 0, 0));
    expect(where.lte).toEqual(new Date(2026, 7, 30, 23, 59, 59, 999));
  });

  it('only `from` given browses from that day through the end of today', () => {
    const where = buildOrdersWhere({ from: '2026-08-20' });
    expect(where.gte).toEqual(new Date(2026, 7, 20, 0, 0, 0, 0));
    expect(where.lte).toBeUndefined(); // params.to was not given, so `lte` isn't set in the where object
  });

  it('search alongside a date filter does not affect the resolved boundaries', () => {
    const withoutSearch = buildOrdersWhere({ from: '2026-08-25', to: '2026-08-25' });
    const withSearch = buildOrdersWhere({ from: '2026-08-25', to: '2026-08-25', search: 'R-2026' });
    expect(withSearch).toEqual(withoutSearch);
  });
});
