/**
 * Follow-up batch after Batch 11 — tests the pure helpers in
 * src/components/DateRangeControl.tsx (todayIso, describeDateFilter) that
 * Dashboard, Orders, and Reports all now share for their date-filter UI.
 * The React components themselves aren't unit-tested here (no existing
 * convention for that in this codebase — pages are validated via
 * type-check + build + manual review, consistent with every other page).
 */
import { describe, it, expect } from 'vitest';
import { todayIso, describeDateFilter } from '../src/components/DateRangeControl';

describe('todayIso', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches the local calendar date', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(todayIso()).toBe(expected);
  });
});

describe('describeDateFilter', () => {
  const fmt = (d: string) => d; // identity formatter for these tests

  it('describes a single date (from === to) without a dash', () => {
    expect(describeDateFilter({ from: '2026-08-25', to: '2026-08-25' }, fmt)).toBe('2026-08-25');
  });

  it('describes a range with an en dash between the two dates', () => {
    expect(describeDateFilter({ from: '2026-08-20', to: '2026-08-30' }, fmt)).toBe('2026-08-20 – 2026-08-30');
  });

  it('uses the provided formatter for each date', () => {
    const upper = (d: string) => d.toUpperCase();
    expect(describeDateFilter({ from: 'aug-25', to: 'aug-25' }, upper)).toBe('AUG-25');
  });
});
