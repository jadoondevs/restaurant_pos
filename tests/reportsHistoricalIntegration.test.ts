/**
 * Follow-up batch after Batch 11 — Priority 5's core data-integrity
 * requirement: partner-report data must come from the OrderItemPartnerAllocation
 * SNAPSHOT written at sale time (Batch 4), never re-derived from today's
 * live MenuItemPartner configuration. This is the one thing no pure-logic
 * mirror test can prove — it requires a real schema and a real query
 * against rows that predate a later ownership change. Uses Node's built-in
 * `node:sqlite` module (Node 22.5+), same convention as the migration
 * tests, so it runs without Electron or Prisma.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

function createSchema(db: InstanceType<typeof DatabaseSync>): void {
  db.exec(`
    CREATE TABLE Partner (
      id INTEGER PRIMARY KEY, name TEXT, isActive INTEGER DEFAULT 1
    );
    CREATE TABLE MenuItem (
      id INTEGER PRIMARY KEY, name TEXT, price REAL
    );
    CREATE TABLE MenuItemPartner (
      id INTEGER PRIMARY KEY, menuItemId INTEGER, partnerId INTEGER, percentage REAL
    );
    CREATE TABLE "Order" (
      id INTEGER PRIMARY KEY, receiptNumber TEXT, createdAt DATETIME
    );
    CREATE TABLE OrderItem (
      id INTEGER PRIMARY KEY, orderId INTEGER, menuItemId INTEGER, name TEXT,
      quantity INTEGER, lineTotal REAL
    );
    CREATE TABLE OrderItemPartnerAllocation (
      id INTEGER PRIMARY KEY, orderItemId INTEGER, orderId INTEGER, partnerId INTEGER,
      partnerName TEXT, percentage REAL, amount REAL
    );
  `);
}

/** Mirrors orders:create's allocation-snapshot write (electron/ipc/orders.ts). */
function snapshotAllocation(
  db: InstanceType<typeof DatabaseSync>,
  orderItemId: number,
  orderId: number,
  lineTotal: number
): void {
  const ownerships = db
    .prepare(
      `SELECT mip.partnerId, p.name AS partnerName, mip.percentage
       FROM MenuItemPartner mip JOIN Partner p ON p.id = mip.partnerId
       WHERE mip.menuItemId = (SELECT menuItemId FROM OrderItem WHERE id = ?)`
    )
    .all(orderItemId) as { partnerId: number; partnerName: string; percentage: number }[];

  for (const o of ownerships) {
    db.prepare(
      `INSERT INTO OrderItemPartnerAllocation (orderItemId, orderId, partnerId, partnerName, percentage, amount)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(orderItemId, orderId, o.partnerId, o.partnerName, o.percentage, +((lineTotal * o.percentage) / 100).toFixed(2));
  }
}

/** Mirrors reports:partners' date-ranged, allocation-driven aggregation query. */
function queryPartnerReport(
  db: InstanceType<typeof DatabaseSync>,
  gte: string,
  lte: string
): { partnerId: number; partnerName: string; totalShare: number }[] {
  const rows = db
    .prepare(
      `SELECT a.partnerId, a.partnerName, a.amount
       FROM OrderItemPartnerAllocation a
       JOIN "Order" o ON o.id = a.orderId
       WHERE o.createdAt >= ? AND o.createdAt <= ?`
    )
    .all(gte, lte) as { partnerId: number; partnerName: string; amount: number }[];

  const byPartner = new Map<number, { partnerId: number; partnerName: string; totalShare: number }>();
  for (const r of rows) {
    const entry = byPartner.get(r.partnerId) ?? { partnerId: r.partnerId, partnerName: r.partnerName, totalShare: 0 };
    entry.totalShare += r.amount;
    byPartner.set(r.partnerId, entry);
  }
  return [...byPartner.values()];
}

let db: InstanceType<typeof DatabaseSync>;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  createSchema(db);
});
afterEach(() => db.close());

describe('partner report — reads the historical snapshot, not live config', () => {
  it('a later ownership change never alters a past allocation', () => {
    db.exec(`INSERT INTO Partner (id, name) VALUES (1, 'Partner A'), (2, 'Partner B')`);
    db.exec(`INSERT INTO MenuItem (id, name, price) VALUES (1, 'Chicken Burger', 1000)`);
    db.exec(`INSERT INTO MenuItemPartner (menuItemId, partnerId, percentage) VALUES (1, 1, 60), (1, 2, 40)`);

    db.exec(`INSERT INTO "Order" (id, receiptNumber, createdAt) VALUES (1, 'R-1', '2026-08-25T10:00:00.000Z')`);
    db.exec(`INSERT INTO OrderItem (id, orderId, menuItemId, name, quantity, lineTotal) VALUES (1, 1, 1, 'Chicken Burger', 1, 1000)`);
    snapshotAllocation(db, 1, 1, 1000);

    // Admin later changes ownership entirely — Partner A now owns 100%.
    db.exec(`DELETE FROM MenuItemPartner WHERE menuItemId = 1`);
    db.exec(`INSERT INTO MenuItemPartner (menuItemId, partnerId, percentage) VALUES (1, 1, 100)`);

    const report = queryPartnerReport(db, '2026-08-25T00:00:00.000Z', '2026-08-25T23:59:59.999Z');
    const a = report.find((p) => p.partnerId === 1)!;
    const b = report.find((p) => p.partnerId === 2)!;
    // Still 60/40 — the snapshot, not the now-100/0 live config.
    expect(a.totalShare).toBe(600);
    expect(b.totalShare).toBe(400);
  });

  it('a sale made AFTER the ownership change uses the new percentages, not the old snapshot', () => {
    db.exec(`INSERT INTO Partner (id, name) VALUES (1, 'Partner A'), (2, 'Partner B')`);
    db.exec(`INSERT INTO MenuItem (id, name, price) VALUES (1, 'Pizza', 1000)`);
    db.exec(`INSERT INTO MenuItemPartner (menuItemId, partnerId, percentage) VALUES (1, 1, 60), (1, 2, 40)`);

    db.exec(`INSERT INTO "Order" (id, receiptNumber, createdAt) VALUES (1, 'R-1', '2026-08-25T10:00:00.000Z')`);
    db.exec(`INSERT INTO OrderItem (id, orderId, menuItemId, name, quantity, lineTotal) VALUES (1, 1, 1, 'Pizza', 1, 1000)`);
    snapshotAllocation(db, 1, 1, 1000);

    db.exec(`DELETE FROM MenuItemPartner WHERE menuItemId = 1`);
    db.exec(`INSERT INTO MenuItemPartner (menuItemId, partnerId, percentage) VALUES (1, 1, 100)`);

    db.exec(`INSERT INTO "Order" (id, receiptNumber, createdAt) VALUES (2, 'R-2', '2026-08-26T10:00:00.000Z')`);
    db.exec(`INSERT INTO OrderItem (id, orderId, menuItemId, name, quantity, lineTotal) VALUES (2, 2, 1, 'Pizza', 1, 1000)`);
    snapshotAllocation(db, 2, 2, 1000);

    const day1 = queryPartnerReport(db, '2026-08-25T00:00:00.000Z', '2026-08-25T23:59:59.999Z');
    const day2 = queryPartnerReport(db, '2026-08-26T00:00:00.000Z', '2026-08-26T23:59:59.999Z');

    expect(day1.find((p) => p.partnerId === 1)!.totalShare).toBe(600);
    expect(day1.find((p) => p.partnerId === 2)!.totalShare).toBe(400);
    expect(day2.find((p) => p.partnerId === 1)!.totalShare).toBe(1000);
    expect(day2.find((p) => p.partnerId === 2)).toBeUndefined();
  });

  it('aggregates correctly across multiple partners and multiple historical orders on different dates', () => {
    db.exec(`INSERT INTO Partner (id, name) VALUES (1, 'Partner A'), (2, 'Partner B'), (3, 'Partner C')`);
    db.exec(`INSERT INTO MenuItem (id, name, price) VALUES (1, 'Burger', 500), (2, 'Pizza', 1000)`);
    db.exec(`INSERT INTO MenuItemPartner (menuItemId, partnerId, percentage) VALUES (1, 1, 50), (1, 2, 50)`);
    db.exec(`INSERT INTO MenuItemPartner (menuItemId, partnerId, percentage) VALUES (2, 3, 100)`);

    // Two orders inside the window, one outside.
    db.exec(`INSERT INTO "Order" (id, receiptNumber, createdAt) VALUES
      (1, 'R-1', '2026-08-20T10:00:00.000Z'),
      (2, 'R-2', '2026-08-22T10:00:00.000Z'),
      (3, 'R-3', '2026-09-01T10:00:00.000Z')`);

    db.exec(`INSERT INTO OrderItem (id, orderId, menuItemId, name, quantity, lineTotal) VALUES
      (1, 1, 1, 'Burger', 2, 1000),
      (2, 2, 2, 'Pizza', 1, 1000),
      (3, 3, 1, 'Burger', 1, 500)`); // outside window

    snapshotAllocation(db, 1, 1, 1000);
    snapshotAllocation(db, 2, 2, 1000);
    snapshotAllocation(db, 3, 3, 500);

    const report = queryPartnerReport(db, '2026-08-20T00:00:00.000Z', '2026-08-31T23:59:59.999Z');
    expect(report).toHaveLength(3);
    expect(report.find((p) => p.partnerId === 1)!.totalShare).toBe(500); // 50% of 1000
    expect(report.find((p) => p.partnerId === 2)!.totalShare).toBe(500); // 50% of 1000
    expect(report.find((p) => p.partnerId === 3)!.totalShare).toBe(1000); // 100% of 1000, order 2 excludes order 3
  });

  it('excludes an order outside the date window entirely', () => {
    db.exec(`INSERT INTO Partner (id, name) VALUES (1, 'Partner A')`);
    db.exec(`INSERT INTO MenuItem (id, name, price) VALUES (1, 'Burger', 500)`);
    db.exec(`INSERT INTO MenuItemPartner (menuItemId, partnerId, percentage) VALUES (1, 1, 100)`);
    db.exec(`INSERT INTO "Order" (id, receiptNumber, createdAt) VALUES (1, 'R-1', '2026-09-01T10:00:00.000Z')`);
    db.exec(`INSERT INTO OrderItem (id, orderId, menuItemId, name, quantity, lineTotal) VALUES (1, 1, 1, 'Burger', 1, 500)`);
    snapshotAllocation(db, 1, 1, 500);

    const report = queryPartnerReport(db, '2026-08-20T00:00:00.000Z', '2026-08-31T23:59:59.999Z');
    expect(report).toHaveLength(0);
  });

  it('returns an empty report when orders exist but no item has partner ownership', () => {
    db.exec(`INSERT INTO Partner (id, name) VALUES (1, 'Partner A')`);
    db.exec(`INSERT INTO MenuItem (id, name, price) VALUES (1, 'Soda', 100)`); // no MenuItemPartner row
    db.exec(`INSERT INTO "Order" (id, receiptNumber, createdAt) VALUES (1, 'R-1', '2026-08-25T10:00:00.000Z')`);
    db.exec(`INSERT INTO OrderItem (id, orderId, menuItemId, name, quantity, lineTotal) VALUES (1, 1, 1, 'Soda', 1, 100)`);
    snapshotAllocation(db, 1, 1, 100); // no-op: no ownership configured

    const report = queryPartnerReport(db, '2026-08-25T00:00:00.000Z', '2026-08-25T23:59:59.999Z');
    expect(report).toHaveLength(0);
  });
});
