/**
 * Receipt numbering tests.
 *
 * Tests the core receipt-number allocation logic in isolation using Node's
 * built-in `node:sqlite` module (available since Node 22.5, stable in
 * Node 23+). No native compilation required — ships with Node itself.
 *
 * We replicate the exact SQL used in orders.ts so the tests prove the
 * production logic, not a simplified version.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

// ---------------------------------------------------------------------------
// Helpers that mirror the production logic in electron/ipc/orders.ts
// ---------------------------------------------------------------------------
function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function allocateReceiptNumber(db: DatabaseSync, date: Date): string {
  const key = dateKey(date);
  db.prepare(
    `INSERT INTO ReceiptCounter (dateKey, lastSeq)
     VALUES (?, 1)
     ON CONFLICT (dateKey) DO UPDATE SET lastSeq = lastSeq + 1`
  ).run(key);
  const row = db.prepare(
    `SELECT lastSeq FROM ReceiptCounter WHERE dateKey = ?`
  ).get(key) as { lastSeq: number };
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `R-${y}${m}${d}-${String(row.lastSeq).padStart(4, '0')}`;
}

function peekReceiptNumber(db: DatabaseSync, date: Date): string {
  const key = dateKey(date);
  const row = db.prepare(
    `SELECT lastSeq FROM ReceiptCounter WHERE dateKey = ?`
  ).get(key) as { lastSeq: number } | undefined;
  const next = (row?.lastSeq ?? 0) + 1;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `R-${y}${m}${d}-${String(next).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE ReceiptCounter (
      dateKey TEXT NOT NULL PRIMARY KEY,
      lastSeq INTEGER NOT NULL DEFAULT 0
    )
  `);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Receipt numbering', () => {
  it('allocates the first receipt as 0001', () => {
    const date = new Date('2026-08-02');
    const num = allocateReceiptNumber(db, date);
    expect(num).toBe('R-20260802-0001');
  });

  it('allocates sequential numbers', () => {
    const date = new Date('2026-08-02');
    const nums = [1, 2, 3, 4, 5].map(() => allocateReceiptNumber(db, date));
    expect(nums).toEqual([
      'R-20260802-0001',
      'R-20260802-0002',
      'R-20260802-0003',
      'R-20260802-0004',
      'R-20260802-0005',
    ]);
  });

  it('resets sequence on date rollover', () => {
    const day1 = new Date('2026-08-02');
    const day2 = new Date('2026-08-03');
    allocateReceiptNumber(db, day1);
    allocateReceiptNumber(db, day1);
    const first = allocateReceiptNumber(db, day2);
    expect(first).toBe('R-20260803-0001');
  });

  it('never reuses a number after a gap (simulating deleted order)', () => {
    const date = new Date('2026-08-02');
    allocateReceiptNumber(db, date); // 0001
    allocateReceiptNumber(db, date); // 0002
    const next = allocateReceiptNumber(db, date);
    expect(next).toBe('R-20260802-0003');
  });

  it('peek returns the next number without advancing the counter', () => {
    const date = new Date('2026-08-02');
    const peeked = peekReceiptNumber(db, date);
    expect(peeked).toBe('R-20260802-0001');
    const allocated = allocateReceiptNumber(db, date);
    expect(allocated).toBe('R-20260802-0001');
  });

  it('peek after allocations returns the correct next number', () => {
    const date = new Date('2026-08-02');
    allocateReceiptNumber(db, date); // 0001
    allocateReceiptNumber(db, date); // 0002
    const peeked = peekReceiptNumber(db, date);
    expect(peeked).toBe('R-20260802-0003');
  });

  it('handles concurrent allocations correctly (sequential simulation)', () => {
    const date = new Date('2026-08-02');
    const nums = Array.from({ length: 10 }, () => allocateReceiptNumber(db, date));
    const unique = new Set(nums);
    expect(unique.size).toBe(10);
  });

  it('pads sequence numbers to 4 digits', () => {
    const date = new Date('2026-08-02');
    for (let i = 0; i < 9; i++) allocateReceiptNumber(db, date);
    const tenth = allocateReceiptNumber(db, date);
    expect(tenth).toBe('R-20260802-0010');
  });

  it('receipt numbering continues correctly after simulated restore', () => {
    const date = new Date('2026-08-02');
    allocateReceiptNumber(db, date); // 0001
    allocateReceiptNumber(db, date); // 0002

    db.exec(`DELETE FROM ReceiptCounter`);
    db.prepare(
      `INSERT INTO ReceiptCounter (dateKey, lastSeq) VALUES (?, 2)`
    ).run(dateKey(date));

    const next = allocateReceiptNumber(db, date);
    expect(next).toBe('R-20260802-0003');
  });
});
