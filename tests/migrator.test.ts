/**
 * Runtime migrator tests.
 *
 * Uses Node's built-in `node:sqlite` module (Node 22.5+) — no native
 * compilation required. We replicate the migrator helper logic and DDL
 * to verify idempotency without Electron or Prisma.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

// ---------------------------------------------------------------------------
// Replicate migrator helpers
// ---------------------------------------------------------------------------
const CORE_TABLES = [
  'Admin', 'Settings', 'Category', 'MenuItem', 'Customer', 'Order', 'OrderItem',
];

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(table);
  return row !== undefined;
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

function isDatabaseEmpty(db: DatabaseSync): boolean {
  return CORE_TABLES.every((t) => !tableExists(db, t));
}

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

function setUserVersion(db: DatabaseSync, version: number): void {
  // PRAGMA user_version does not support parameterised queries.
  db.exec(`PRAGMA user_version = ${version}`);
}

function createBaseSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Admin (id INTEGER PRIMARY KEY, username TEXT UNIQUE, passwordHash TEXT, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE IF NOT EXISTS Category (id INTEGER PRIMARY KEY, name TEXT UNIQUE, sortOrder INTEGER DEFAULT 0, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE IF NOT EXISTS MenuItem (id INTEGER PRIMARY KEY, name TEXT, description TEXT, price REAL, available INTEGER DEFAULT 1, image TEXT, categoryId INTEGER, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE IF NOT EXISTS Customer (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, notes TEXT, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE IF NOT EXISTS "Order" (id INTEGER PRIMARY KEY, receiptNumber TEXT UNIQUE, subtotal REAL, discount REAL DEFAULT 0, taxRate REAL DEFAULT 0, taxAmount REAL DEFAULT 0, grandTotal REAL, cashReceived REAL DEFAULT 0, change REAL DEFAULT 0, tableNumber TEXT, status TEXT DEFAULT 'completed', customerId INTEGER, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS OrderItem (id INTEGER PRIMARY KEY, orderId INTEGER, menuItemId INTEGER, name TEXT, price REAL, quantity INTEGER, specialInstructions TEXT, lineTotal REAL);
    CREATE TABLE IF NOT EXISTS Settings (id INTEGER PRIMARY KEY DEFAULT 1, restaurantName TEXT DEFAULT 'My Restaurant', address TEXT DEFAULT '', phone TEXT DEFAULT '', taxPercentage REAL DEFAULT 0, currencySymbol TEXT DEFAULT '$', receiptFooter TEXT DEFAULT 'Thank you!', darkMode INTEGER DEFAULT 0, updatedAt DATETIME);
  `);
}

function runMigrationV1(db: DatabaseSync): void {
  if (!columnExists(db, 'Order', 'cashierName')) {
    db.exec(`ALTER TABLE "Order" ADD COLUMN "cashierName" TEXT`);
  }
  const settingsCols: [string, string][] = [
    ['receiptPaperSize', `TEXT NOT NULL DEFAULT '80mm'`],
    ['backupSchedule', `TEXT NOT NULL DEFAULT 'daily'`],
    ['backupOnExit', `INTEGER NOT NULL DEFAULT 1`],
    ['cloudBackupEnabled', `INTEGER NOT NULL DEFAULT 0`],
  ];
  for (const [col, def] of settingsCols) {
    if (!columnExists(db, 'Settings', col)) {
      db.exec(`ALTER TABLE "Settings" ADD COLUMN "${col}" ${def}`);
    }
  }
  if (!tableExists(db, 'ReceiptCounter')) {
    db.exec(`CREATE TABLE ReceiptCounter (dateKey TEXT NOT NULL PRIMARY KEY, lastSeq INTEGER NOT NULL DEFAULT 0)`);
  }
  if (!tableExists(db, 'BackupRecord')) {
    db.exec(`
      CREATE TABLE BackupRecord (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        filePath TEXT NOT NULL,
        fileSizeBytes INTEGER NOT NULL DEFAULT 0,
        trigger TEXT NOT NULL,
        cloudStatus TEXT NOT NULL DEFAULT 'none',
        cloudFileId TEXT,
        errorMessage TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
});

afterEach(() => {
  db.close();
});

describe('Runtime migrator', () => {
  describe('isDatabaseEmpty', () => {
    it('returns true for a brand-new empty database', () => {
      expect(isDatabaseEmpty(db)).toBe(true);
    });

    it('returns false when any core table exists', () => {
      db.exec(`CREATE TABLE Admin (id INTEGER PRIMARY KEY)`);
      expect(isDatabaseEmpty(db)).toBe(false);
    });

    it('returns false when all core tables exist', () => {
      createBaseSchema(db);
      expect(isDatabaseEmpty(db)).toBe(false);
    });
  });

  describe('tableExists', () => {
    it('returns false for non-existent table', () => {
      expect(tableExists(db, 'NonExistent')).toBe(false);
    });

    it('returns true for existing table', () => {
      db.exec(`CREATE TABLE Foo (id INTEGER PRIMARY KEY)`);
      expect(tableExists(db, 'Foo')).toBe(true);
    });
  });

  describe('columnExists', () => {
    it('returns false for non-existent column', () => {
      db.exec(`CREATE TABLE Foo (id INTEGER PRIMARY KEY)`);
      expect(columnExists(db, 'Foo', 'missing')).toBe(false);
    });

    it('returns true for existing column', () => {
      db.exec(`CREATE TABLE Foo (id INTEGER PRIMARY KEY, name TEXT)`);
      expect(columnExists(db, 'Foo', 'name')).toBe(true);
    });
  });

  describe('user_version', () => {
    it('reads 0 on a fresh database', () => {
      expect(readUserVersion(db)).toBe(0);
    });

    it('reads back the version that was set', () => {
      setUserVersion(db, 1);
      expect(readUserVersion(db)).toBe(1);
    });

    it('can be incremented', () => {
      setUserVersion(db, 1);
      setUserVersion(db, 2);
      expect(readUserVersion(db)).toBe(2);
    });
  });

  describe('migration v1', () => {
    it('adds all required columns and tables to an existing schema', () => {
      createBaseSchema(db);
      expect(readUserVersion(db)).toBe(0);

      runMigrationV1(db);
      setUserVersion(db, 1);

      expect(columnExists(db, 'Order', 'cashierName')).toBe(true);
      expect(columnExists(db, 'Settings', 'receiptPaperSize')).toBe(true);
      expect(columnExists(db, 'Settings', 'backupSchedule')).toBe(true);
      expect(columnExists(db, 'Settings', 'backupOnExit')).toBe(true);
      expect(columnExists(db, 'Settings', 'cloudBackupEnabled')).toBe(true);
      expect(tableExists(db, 'ReceiptCounter')).toBe(true);
      expect(tableExists(db, 'BackupRecord')).toBe(true);
      expect(readUserVersion(db)).toBe(1);
    });

    it('is idempotent — running twice does not throw or duplicate', () => {
      createBaseSchema(db);
      runMigrationV1(db);
      expect(() => runMigrationV1(db)).not.toThrow();
      expect(columnExists(db, 'Order', 'cashierName')).toBe(true);
    });

    it('skips already-present columns', () => {
      createBaseSchema(db);
      db.exec(`ALTER TABLE "Order" ADD COLUMN "cashierName" TEXT`);
      expect(() => runMigrationV1(db)).not.toThrow();
    });

    it('skips already-present tables', () => {
      createBaseSchema(db);
      db.exec(`CREATE TABLE ReceiptCounter (dateKey TEXT PRIMARY KEY, lastSeq INTEGER DEFAULT 0)`);
      expect(() => runMigrationV1(db)).not.toThrow();
      expect(tableExists(db, 'ReceiptCounter')).toBe(true);
    });
  });

  describe('fresh install scenario', () => {
    it('empty database is detected before any DDL runs', () => {
      expect(isDatabaseEmpty(db)).toBe(true);
      createBaseSchema(db);
      expect(isDatabaseEmpty(db)).toBe(false);
    });
  });
});
