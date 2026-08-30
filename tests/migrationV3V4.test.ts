/**
 * Migration v3 (schema) and v4 (legacy payment backfill) tests.
 *
 * Mirrors the existing migrator.test.ts / migrationV2.test.ts pattern:
 * migration logic is replicated against Node's built-in `node:sqlite`
 * module (Node 22.5+) so it can be verified without Electron or Prisma.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

// ---------------------------------------------------------------------------
// Shared helpers (same shape as migrator.ts)
// ---------------------------------------------------------------------------
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

function indexExists(db: DatabaseSync, index: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' AND name=?`
  ).get(index);
  return row !== undefined;
}

/** Builds a database at "version 2" shape — i.e. a realistic pre-overhaul
 * production database, combining the base schema plus migrations v1 and v2. */
function createV2Schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE Admin (id INTEGER PRIMARY KEY, username TEXT UNIQUE, passwordHash TEXT, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE Category (id INTEGER PRIMARY KEY, name TEXT UNIQUE, sortOrder INTEGER DEFAULT 0, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE MenuItem (id INTEGER PRIMARY KEY, name TEXT, description TEXT, price REAL, available INTEGER DEFAULT 1, image TEXT, categoryId INTEGER, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE Customer (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, notes TEXT, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE "Order" (id INTEGER PRIMARY KEY AUTOINCREMENT, receiptNumber TEXT UNIQUE, subtotal REAL, discount REAL DEFAULT 0, taxRate REAL DEFAULT 0, taxAmount REAL DEFAULT 0, grandTotal REAL, cashReceived REAL DEFAULT 0, change REAL DEFAULT 0, tableNumber TEXT, cashierName TEXT, status TEXT DEFAULT 'completed', customerId INTEGER, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE OrderItem (id INTEGER PRIMARY KEY, orderId INTEGER, menuItemId INTEGER, name TEXT, price REAL, quantity INTEGER, specialInstructions TEXT, lineTotal REAL);
    CREATE TABLE Settings (id INTEGER PRIMARY KEY DEFAULT 1, restaurantName TEXT DEFAULT 'My Restaurant', address TEXT DEFAULT '', phone TEXT DEFAULT '', taxPercentage REAL DEFAULT 0, currencySymbol TEXT DEFAULT '$', receiptFooter TEXT DEFAULT 'Thank you!', darkMode INTEGER DEFAULT 0, receiptPaperSize TEXT DEFAULT '80mm', backupSchedule TEXT DEFAULT 'daily', backupOnExit INTEGER DEFAULT 1, cloudBackupEnabled INTEGER DEFAULT 0, updatedAt DATETIME);
    CREATE TABLE ReceiptCounter (dateKey TEXT PRIMARY KEY, lastSeq INTEGER DEFAULT 0);
    CREATE TABLE BackupRecord (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, filePath TEXT, fileSizeBytes INTEGER DEFAULT 0, trigger TEXT, cloudStatus TEXT DEFAULT 'none', cloudFileId TEXT, errorMessage TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE "User" (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      fullName TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'CASHIER',
      isActive INTEGER NOT NULL DEFAULT 1,
      mustChangePassword INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    PRAGMA user_version = 2;
  `);
}

// ---------------------------------------------------------------------------
// Replicates migrator.ts migration v3 up()
// ---------------------------------------------------------------------------
function runMigrationV3(db: DatabaseSync): void {
  if (!tableExists(db, 'Partner')) {
    db.exec(`
      CREATE TABLE "Partner" (
        "id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "name"      TEXT NOT NULL,
        "isActive"  INTEGER NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX "Partner_name_key" ON "Partner" ("name");
      CREATE INDEX "Partner_isActive_idx" ON "Partner" ("isActive");
    `);
  }

  if (!tableExists(db, 'MenuItemPartner')) {
    db.exec(`
      CREATE TABLE "MenuItemPartner" (
        "id"         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "menuItemId" INTEGER NOT NULL,
        "partnerId"  INTEGER NOT NULL,
        "percentage" REAL NOT NULL,
        "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE CASCADE,
        FOREIGN KEY ("partnerId") REFERENCES "Partner" ("id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX "MenuItemPartner_menuItemId_partnerId_key" ON "MenuItemPartner" ("menuItemId", "partnerId");
      CREATE INDEX "MenuItemPartner_menuItemId_idx" ON "MenuItemPartner" ("menuItemId");
      CREATE INDEX "MenuItemPartner_partnerId_idx" ON "MenuItemPartner" ("partnerId");
    `);
  }

  if (!tableExists(db, 'ConsumptionPerson')) {
    db.exec(`
      CREATE TABLE "ConsumptionPerson" (
        "id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "name"      TEXT NOT NULL,
        "type"      TEXT NOT NULL,
        "isActive"  INTEGER NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX "ConsumptionPerson_type_idx" ON "ConsumptionPerson" ("type");
      CREATE INDEX "ConsumptionPerson_isActive_idx" ON "ConsumptionPerson" ("isActive");
    `);
  }

  if (!tableExists(db, 'PaymentAccount')) {
    db.exec(`
      CREATE TABLE "PaymentAccount" (
        "id"                INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "type"              TEXT NOT NULL,
        "displayName"       TEXT NOT NULL,
        "accountHolderName" TEXT,
        "phoneNumber"       TEXT,
        "bankName"          TEXT,
        "accountNumber"     TEXT,
        "iban"              TEXT,
        "isActive"          INTEGER NOT NULL DEFAULT 1,
        "printOnReceipt"    INTEGER NOT NULL DEFAULT 0,
        "sortOrder"         INTEGER NOT NULL DEFAULT 0,
        "createdAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX "PaymentAccount_type_idx" ON "PaymentAccount" ("type");
      CREATE INDEX "PaymentAccount_isActive_idx" ON "PaymentAccount" ("isActive");
      CREATE INDEX "PaymentAccount_printOnReceipt_idx" ON "PaymentAccount" ("printOnReceipt");
    `);
  }

  if (!tableExists(db, 'Payment')) {
    db.exec(`
      CREATE TABLE "Payment" (
        "id"                 INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "orderId"            INTEGER NOT NULL,
        "paymentAccountId"   INTEGER,
        "method"             TEXT NOT NULL,
        "amount"             REAL NOT NULL,
        "accountDisplayName" TEXT,
        "accountNumberSnap"  TEXT,
        "ibanSnap"           TEXT,
        "isLegacyPayment"    INTEGER NOT NULL DEFAULT 0,
        "recordedBy"         TEXT,
        "recordedAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE,
        FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount" ("id") ON DELETE SET NULL
      );
      CREATE INDEX "Payment_orderId_idx" ON "Payment" ("orderId");
      CREATE INDEX "Payment_method_idx" ON "Payment" ("method");
      CREATE INDEX "Payment_paymentAccountId_idx" ON "Payment" ("paymentAccountId");
      CREATE INDEX "Payment_isLegacyPayment_idx" ON "Payment" ("isLegacyPayment");
    `);
  }

  if (!tableExists(db, 'OrderItemPartnerAllocation')) {
    db.exec(`
      CREATE TABLE "OrderItemPartnerAllocation" (
        "id"          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "orderItemId" INTEGER NOT NULL,
        "orderId"     INTEGER NOT NULL,
        "partnerId"   INTEGER,
        "partnerName" TEXT NOT NULL,
        "percentage"  REAL NOT NULL,
        "amount"      REAL NOT NULL,
        FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE CASCADE,
        FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE,
        FOREIGN KEY ("partnerId") REFERENCES "Partner" ("id") ON DELETE SET NULL
      );
      CREATE INDEX "OrderItemPartnerAllocation_orderItemId_idx" ON "OrderItemPartnerAllocation" ("orderItemId");
      CREATE INDEX "OrderItemPartnerAllocation_orderId_idx" ON "OrderItemPartnerAllocation" ("orderId");
      CREATE INDEX "OrderItemPartnerAllocation_partnerId_idx" ON "OrderItemPartnerAllocation" ("partnerId");
    `);
  }

  if (!tableExists(db, 'SocialLink')) {
    db.exec(`
      CREATE TABLE "SocialLink" (
        "id"            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "platform"      TEXT NOT NULL,
        "displayName"   TEXT NOT NULL,
        "value"         TEXT NOT NULL,
        "isEnabled"     INTEGER NOT NULL DEFAULT 1,
        "showOnReceipt" INTEGER NOT NULL DEFAULT 0,
        "sortOrder"     INTEGER NOT NULL DEFAULT 0,
        "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX "SocialLink_isEnabled_idx" ON "SocialLink" ("isEnabled");
      CREATE INDEX "SocialLink_sortOrder_idx" ON "SocialLink" ("sortOrder");
    `);
  }

  const orderCols: [string, string][] = [
    ['orderType', `TEXT NOT NULL DEFAULT 'SALE'`],
    ['consumptionPersonId', `INTEGER`],
    ['consumptionPersonName', `TEXT`],
    ['consumptionNotes', `TEXT`],
    ['serviceChargeType', `TEXT NOT NULL DEFAULT 'NONE'`],
    ['serviceChargeValue', `REAL NOT NULL DEFAULT 0`],
    ['serviceChargeAmount', `REAL NOT NULL DEFAULT 0`],
    ['paymentStatus', `TEXT NOT NULL DEFAULT 'PENDING'`],
  ];
  for (const [col, def] of orderCols) {
    if (!columnExists(db, 'Order', col)) {
      db.exec(`ALTER TABLE "Order" ADD COLUMN "${col}" ${def}`);
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS "Order_orderType_idx" ON "Order" ("orderType")`);
  db.exec(`CREATE INDEX IF NOT EXISTS "Order_consumptionPersonId_idx" ON "Order" ("consumptionPersonId")`);
  db.exec(`CREATE INDEX IF NOT EXISTS "Order_paymentStatus_idx" ON "Order" ("paymentStatus")`);

  const settingsCols: [string, string][] = [
    ['logoPath', `TEXT`],
    ['currencyCode', `TEXT NOT NULL DEFAULT 'PKR'`],
    ['receiptShowLogo', `INTEGER NOT NULL DEFAULT 1`],
    ['serviceChargePresets', `TEXT`],
    ['googleReviewUrl', `TEXT`],
    ['googleReviewOnReceipt', `INTEGER NOT NULL DEFAULT 0`],
  ];
  for (const [col, def] of settingsCols) {
    if (!columnExists(db, 'Settings', col)) {
      db.exec(`ALTER TABLE "Settings" ADD COLUMN "${col}" ${def}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Replicates migrator.ts migration v4 up()
// ---------------------------------------------------------------------------
function runMigrationV4(db: DatabaseSync): number {
  const orders = db.prepare(`SELECT "id", "grandTotal", "createdAt" FROM "Order"`).all() as {
    id: number;
    grandTotal: number;
    createdAt: string;
  }[];

  let backfilled = 0;
  for (const order of orders) {
    const existing = db.prepare(`SELECT "id" FROM "Payment" WHERE "orderId" = ? LIMIT 1`).get(order.id);
    if (existing) continue;

    db.prepare(
      `INSERT INTO "Payment"
         ("orderId", "method", "amount", "accountDisplayName",
          "isLegacyPayment", "recordedBy", "recordedAt", "updatedAt")
       VALUES (?, 'CASH', ?, 'Cash (legacy — pre-overhaul record)',
               1, NULL, ?, ?)`
    ).run(order.id, order.grandTotal, order.createdAt, order.createdAt);

    db.prepare(`UPDATE "Order" SET "paymentStatus" = 'PAID' WHERE "id" = ?`).run(order.id);
    backfilled++;
  }
  return backfilled;
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

describe('Migration v3 — new tables and columns', () => {
  it('creates all seven new tables on an existing v2 database', () => {
    createV2Schema(db);
    runMigrationV3(db);

    for (const table of [
      'Partner',
      'MenuItemPartner',
      'ConsumptionPerson',
      'PaymentAccount',
      'Payment',
      'OrderItemPartnerAllocation',
      'SocialLink',
    ]) {
      expect(tableExists(db, table)).toBe(true);
    }
  });

  it('adds all new Order columns with correct defaults', () => {
    createV2Schema(db);
    db.prepare(
      `INSERT INTO "Order" (receiptNumber, subtotal, grandTotal) VALUES ('R-1', 100, 100)`
    ).run();

    runMigrationV3(db);

    const order = db.prepare(`SELECT * FROM "Order" WHERE receiptNumber = 'R-1'`).get() as Record<
      string,
      unknown
    >;
    expect(order.orderType).toBe('SALE');
    expect(order.consumptionPersonId).toBeNull();
    expect(order.serviceChargeType).toBe('NONE');
    expect(order.serviceChargeValue).toBe(0);
    expect(order.serviceChargeAmount).toBe(0);
    expect(order.paymentStatus).toBe('PENDING');
  });

  it('adds all new Settings columns with correct defaults', () => {
    createV2Schema(db);
    db.prepare(`INSERT INTO "Settings" (id) VALUES (1)`).run();

    runMigrationV3(db);

    const settings = db.prepare(`SELECT * FROM "Settings" WHERE id = 1`).get() as Record<
      string,
      unknown
    >;
    expect(settings.currencyCode).toBe('PKR');
    expect(settings.receiptShowLogo).toBe(1);
    expect(settings.googleReviewOnReceipt).toBe(0);
    expect(settings.logoPath).toBeNull();
  });

  it('creates working foreign keys and indexes (valid SQLite DDL)', () => {
    createV2Schema(db);
    runMigrationV3(db);

    expect(indexExists(db, 'Partner_name_key')).toBe(true);
    expect(indexExists(db, 'MenuItemPartner_menuItemId_partnerId_key')).toBe(true);
    expect(indexExists(db, 'Payment_orderId_idx')).toBe(true);
    expect(indexExists(db, 'OrderItemPartnerAllocation_orderId_idx')).toBe(true);

    // Exercise the FKs with real inserts to prove the DDL is valid, not just parseable.
    db.prepare(`INSERT INTO "Partner" (name) VALUES ('Partner A')`).run();
    db.prepare(
      `INSERT INTO "MenuItem" (id, name, price, categoryId) VALUES (1, 'Burger', 500, 1)`
    ).run();
    expect(() =>
      db.prepare(
        `INSERT INTO "MenuItemPartner" (menuItemId, partnerId, percentage) VALUES (1, 1, 100)`
      ).run()
    ).not.toThrow();
  });

  it('is idempotent — running twice does not throw or duplicate tables/indexes', () => {
    createV2Schema(db);
    runMigrationV3(db);
    expect(() => runMigrationV3(db)).not.toThrow();

    const partnerTableCount = db
      .prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='Partner'`)
      .get() as { c: number };
    expect(partnerTableCount.c).toBe(1);
  });

  it('skips already-present columns and tables', () => {
    createV2Schema(db);
    db.exec(`ALTER TABLE "Order" ADD COLUMN "orderType" TEXT NOT NULL DEFAULT 'SALE'`);
    expect(() => runMigrationV3(db)).not.toThrow();
    expect(columnExists(db, 'Order', 'orderType')).toBe(true);
  });
});

describe('Migration v4 — legacy payment backfill', () => {
  function seedOrders(db: DatabaseSync) {
    db.prepare(
      `INSERT INTO "Order" (receiptNumber, subtotal, grandTotal, cashierName, createdAt)
       VALUES ('R-1001', 1000, 1000, 'Ali', '2026-01-15 12:30:00')`
    ).run();
    db.prepare(
      `INSERT INTO "Order" (receiptNumber, subtotal, grandTotal, cashierName, createdAt)
       VALUES ('R-1002', 2500, 2500, 'Sara', '2026-02-20 18:45:00')`
    ).run();
  }

  it('creates exactly one legacy Payment row per existing order', () => {
    createV2Schema(db);
    runMigrationV3(db);
    seedOrders(db);

    const backfilled = runMigrationV4(db);
    expect(backfilled).toBe(2);

    const count = db.prepare(`SELECT COUNT(*) as c FROM "Payment"`).get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('backfills method=CASH, isLegacyPayment=true, amount=grandTotal, using the order createdAt', () => {
    createV2Schema(db);
    runMigrationV3(db);
    seedOrders(db);
    runMigrationV4(db);

    const payment = db
      .prepare(`SELECT * FROM "Payment" p JOIN "Order" o ON p.orderId = o.id WHERE o.receiptNumber = 'R-1001'`)
      .get() as Record<string, unknown>;

    expect(payment.method).toBe('CASH');
    expect(payment.amount).toBe(1000);
    expect(payment.isLegacyPayment).toBe(1);
    expect(payment.recordedAt).toBe('2026-01-15 12:30:00');
  });

  it('sets paymentStatus=PAID on every backfilled order', () => {
    createV2Schema(db);
    runMigrationV3(db);
    seedOrders(db);
    runMigrationV4(db);

    const statuses = db.prepare(`SELECT paymentStatus FROM "Order"`).all() as { paymentStatus: string }[];
    expect(statuses.every((o) => o.paymentStatus === 'PAID')).toBe(true);
  });

  it('does not modify original order fields (totals, receipt number, cashier, timestamps)', () => {
    createV2Schema(db);
    runMigrationV3(db);
    seedOrders(db);

    const before = db.prepare(`SELECT * FROM "Order" WHERE receiptNumber = 'R-1002'`).get() as Record<
      string,
      unknown
    >;

    runMigrationV4(db);

    const after = db.prepare(`SELECT * FROM "Order" WHERE receiptNumber = 'R-1002'`).get() as Record<
      string,
      unknown
    >;

    expect(after.subtotal).toBe(before.subtotal);
    expect(after.grandTotal).toBe(before.grandTotal);
    expect(after.cashierName).toBe(before.cashierName);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.receiptNumber).toBe(before.receiptNumber);
  });

  it('is idempotent — running twice creates no duplicate Payment rows', () => {
    createV2Schema(db);
    runMigrationV3(db);
    seedOrders(db);

    const firstRun = runMigrationV4(db);
    const secondRun = runMigrationV4(db);

    expect(firstRun).toBe(2);
    expect(secondRun).toBe(0); // nothing left to backfill

    const count = db.prepare(`SELECT COUNT(*) as c FROM "Payment"`).get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('skips an order that already has a (non-legacy) payment — does not overwrite or duplicate', () => {
    createV2Schema(db);
    runMigrationV3(db);
    seedOrders(db);

    // Simulate an order that was already paid through the new system before
    // v4 ran (e.g. a dev/staging DB that exercised Batch 2 features early).
    const order = db.prepare(`SELECT id FROM "Order" WHERE receiptNumber = 'R-1001'`).get() as {
      id: number;
    };
    db.prepare(
      `INSERT INTO "Payment" (orderId, method, amount, isLegacyPayment, recordedBy)
       VALUES (?, 'EASYPAISA', 1000, 0, 'Manager Bilal')`
    ).run(order.id);
    db.prepare(`UPDATE "Order" SET paymentStatus = 'PAID' WHERE id = ?`).run(order.id);

    const backfilled = runMigrationV4(db);

    // Only the second order (R-1002) needed backfilling.
    expect(backfilled).toBe(1);

    const payments = db
      .prepare(`SELECT * FROM "Payment" WHERE orderId = ?`)
      .all(order.id) as Record<string, unknown>[];
    expect(payments).toHaveLength(1);
    expect(payments[0].method).toBe('EASYPAISA');
    expect(payments[0].isLegacyPayment).toBe(0);
  });

  it('does nothing when there are no existing orders', () => {
    createV2Schema(db);
    runMigrationV3(db);

    const backfilled = runMigrationV4(db);
    expect(backfilled).toBe(0);

    const count = db.prepare(`SELECT COUNT(*) as c FROM "Payment"`).get() as { c: number };
    expect(count.c).toBe(0);
  });
});

describe('Migration v3 + v4 — full upgrade path from a realistic production database', () => {
  it('takes a v2 database with real order history to a fully consistent v4 state', () => {
    createV2Schema(db);

    // Simulate a real production database with existing sales history.
    db.prepare(
      `INSERT INTO "Order" (receiptNumber, subtotal, grandTotal, cashierName, createdAt)
       VALUES ('R-0001', 450, 450, 'Ali', '2025-11-01 09:00:00')`
    ).run();
    db.prepare(
      `INSERT INTO "Order" (receiptNumber, subtotal, grandTotal, cashierName, createdAt)
       VALUES ('R-0002', 1800, 1800, 'Ali', '2025-11-02 13:15:00')`
    ).run();

    runMigrationV3(db);
    const backfilled = runMigrationV4(db);
    db.exec(`PRAGMA user_version = 4`);

    expect(backfilled).toBe(2);
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(4);

    const orders = db.prepare(`SELECT * FROM "Order" ORDER BY receiptNumber`).all() as Record<
      string,
      unknown
    >[];
    for (const order of orders) {
      expect(order.paymentStatus).toBe('PAID');
      expect(order.orderType).toBe('SALE');
    }

    const payments = db.prepare(`SELECT * FROM "Payment"`).all() as Record<string, unknown>[];
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.isLegacyPayment === 1 && p.method === 'CASH')).toBe(true);
  });
});
