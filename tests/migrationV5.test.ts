/**
 * Migration v5 test — adds Settings.printerDeviceName for silent auto-print
 * (Batch 10). Mirrors the existing migrator.test.ts / migrationV3V4.test.ts
 * pattern: migration logic replicated against Node's built-in `node:sqlite`
 * module so it's verified without Electron or Prisma.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

/** Builds a minimal "version 4" Settings table shape (pre-Batch-10). */
function createV4Settings(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE Settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      restaurantName TEXT NOT NULL DEFAULT 'My Restaurant',
      logoPath TEXT,
      currencyCode TEXT NOT NULL DEFAULT 'PKR',
      googleReviewUrl TEXT,
      googleReviewOnReceipt INTEGER NOT NULL DEFAULT 0,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`INSERT INTO Settings (id) VALUES (1)`);
  db.exec(`PRAGMA user_version = 4`);
}

/** Mirrors migrator.ts's v5 migration step exactly. */
function runMigrationV5(db: DatabaseSync): void {
  if (!columnExists(db, 'Settings', 'printerDeviceName')) {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "printerDeviceName" TEXT`);
  }
  db.exec(`PRAGMA user_version = 5`);
}

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  createV4Settings(db);
});
afterEach(() => db.close());

describe('Migration v5 — Settings.printerDeviceName', () => {
  it('adds the printerDeviceName column', () => {
    expect(columnExists(db, 'Settings', 'printerDeviceName')).toBe(false);
    runMigrationV5(db);
    expect(columnExists(db, 'Settings', 'printerDeviceName')).toBe(true);
  });

  it('defaults the column to NULL on existing rows — no printer chosen means fall back to the dialog', () => {
    runMigrationV5(db);
    const row = db.prepare(`SELECT "printerDeviceName" FROM "Settings" WHERE "id" = 1`).get() as {
      printerDeviceName: string | null;
    };
    expect(row.printerDeviceName).toBeNull();
  });

  it('does not touch any pre-existing Settings column', () => {
    db.exec(`UPDATE "Settings" SET "currencyCode" = 'USD', "googleReviewUrl" = 'https://g.page/r/x' WHERE "id" = 1`);
    runMigrationV5(db);
    const row = db.prepare(`SELECT "currencyCode", "googleReviewUrl" FROM "Settings" WHERE "id" = 1`).get() as {
      currencyCode: string;
      googleReviewUrl: string;
    };
    expect(row.currencyCode).toBe('USD');
    expect(row.googleReviewUrl).toBe('https://g.page/r/x');
  });

  it('is idempotent — running twice does not throw or duplicate the column', () => {
    expect(() => {
      runMigrationV5(db);
      runMigrationV5(db);
    }).not.toThrow();
    const rows = db.prepare(`PRAGMA table_info("Settings")`).all() as { name: string }[];
    expect(rows.filter((r) => r.name === 'printerDeviceName')).toHaveLength(1);
  });

  it('stamps user_version at 5 after running', () => {
    runMigrationV5(db);
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(5);
  });
});
