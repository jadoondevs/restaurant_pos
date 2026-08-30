/**
 * Idempotent versioned runtime migrator.
 *
 * Startup scenarios handled:
 *
 *   1. FRESH INSTALL (dev or packaged)
 *      The database file is empty — no tables exist yet.
 *      The migrator initialises the full schema first, then stamps
 *      user_version = CURRENT_VERSION so no migration steps run —
 *      the fresh schema already satisfies them all.
 *
 *      Dev:      invokes the local prisma binary. On Windows, cmd.exe is
 *                invoked directly with shell:false to avoid space-in-path
 *                tokenisation bugs. On Unix, the binary is exec'd directly.
 *                Passes an ABSOLUTE DATABASE_URL from getDatabaseUrl() so
 *                the CLI writes to the exact same location that Prisma
 *                Client reads from at runtime.
 *      Packaged: copies the bundled prisma/template.db over the empty file.
 *
 *   2. EXISTING DATABASE (upgrade path)
 *      Tables exist, user_version < CURRENT_VERSION.
 *      Only pending migration steps run. Existing data is never touched.
 *
 *   3. UP-TO-DATE DATABASE
 *      user_version === CURRENT_VERSION. Returns immediately.
 *
 *   4. RESTORED BACKUP
 *      Treated as scenario 2 or 3 depending on the backup's schema version.
 *
 * Adding a new migration:
 *   1. Increment CURRENT_VERSION.
 *   2. Add a new entry to the MIGRATIONS array.
 *   3. The step runs exactly once on the first boot after the upgrade.
 *
 *   4. PRE-MIGRATION BACKUP
 *      Immediately before any pending migration step runs against an
 *      existing (non-empty) database, a local backup is taken via the
 *      existing local backup engine (VACUUM INTO, same mechanism used by
 *      backupService). This is best-effort — a failed backup is logged
 *      but never blocks the migration itself, since refusing to start the
 *      app over a backup failure would be worse for a live restaurant than
 *      proceeding with an additive, idempotent migration. Fresh installs
 *      (nothing to back up yet) skip this step entirely.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { PrismaClient } from '@prisma/client';
import { logger } from './logger';
import { getDatabaseUrl } from './paths';
import { createLocalBackup } from './backup/localBackup';

const CURRENT_VERSION = 4;

// Core tables that must exist for the app to function.
// Presence of any one of these means the database is not empty.
const CORE_TABLES = [
  'Admin', 'Settings', 'Category', 'MenuItem', 'Customer', 'Order', 'OrderItem',
];

type MigrationStep = {
  version: number;
  description: string;
  up: (prisma: PrismaClient) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function tableExists(prisma: PrismaClient, table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    table
  );
  return rows.length > 0;
}

async function columnExists(
  prisma: PrismaClient,
  table: string,
  column: string
): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `PRAGMA table_info("${table}")`
  );
  return rows.some((r) => r.name === column);
}

/** Returns true when the database has no core tables — i.e. it is brand new. */
async function isDatabaseEmpty(prisma: PrismaClient): Promise<boolean> {
  for (const table of CORE_TABLES) {
    if (await tableExists(prisma, table)) return false;
  }
  return true;
}

/**
 * Resolves how to invoke the local Prisma CLI binary safely on all platforms.
 *
 * Windows:
 *   .cmd files are batch scripts that require cmd.exe to execute. Using
 *   shell:true causes Node to construct `cmd.exe /c <path> <args>` as a
 *   single string, which cmd.exe tokenises by spaces — breaking any path
 *   that contains spaces (e.g. "C:\Users\Shujahat Jadoon\...").
 *
 *   The correct approach (per Node.js child_process docs) is to invoke
 *   cmd.exe directly as the binary with shell:false, passing the .cmd path
 *   and its arguments as separate array elements. Node passes each element
 *   as a distinct argv entry to cmd.exe, so spaces in the path are safe.
 *
 *   Returns: { bin: 'cmd.exe', leadArgs: ['/c', '<prisma.cmd path>'], useShell: false }
 *
 * Unix:
 *   The prisma binary is directly executable. shell:false is used.
 *   Returns: { bin: '<prisma path>', leadArgs: [], useShell: false }
 *
 * Fallback (binary not found):
 *   Falls back to npx with shell:true. This is a last resort and may still
 *   fail on Windows paths with spaces, but it is only reached if the local
 *   binary is absent (i.e. node_modules is not installed).
 */
function resolvePrismaBin(): { bin: string; leadArgs: string[]; useShell: boolean } {
  const appRoot = process.env.APP_ROOT ?? process.cwd();

  if (process.platform === 'win32') {
    const winBin = path.join(appRoot, 'node_modules', '.bin', 'prisma.cmd');
    if (fs.existsSync(winBin)) {
      // Invoke cmd.exe directly with shell:false.
      // ['/c', winBin] tells cmd.exe to execute the .cmd file.
      // Each element is a separate argv — spaces in winBin are safe.
      return { bin: 'cmd.exe', leadArgs: ['/c', winBin], useShell: false };
    }
    // Fallback: npx requires shell:true on Windows.
    return { bin: 'npx', leadArgs: ['prisma'], useShell: true };
  }

  // Unix: execute the binary directly.
  const unixBin = path.join(appRoot, 'node_modules', '.bin', 'prisma');
  if (fs.existsSync(unixBin)) {
    return { bin: unixBin, leadArgs: [], useShell: false };
  }
  return { bin: 'npx', leadArgs: ['prisma'], useShell: true };
}

// ---------------------------------------------------------------------------
// Schema initialisation for a fresh database.
// ---------------------------------------------------------------------------
async function initialiseSchema(prisma: PrismaClient): Promise<void> {
  if (!app.isPackaged) {
    const appRoot = process.env.APP_ROOT ?? process.cwd();
    const { bin, leadArgs, useShell } = resolvePrismaBin();

    // Always pass an absolute DATABASE_URL to the Prisma CLI subprocess.
    // getDatabaseUrl() is the single source of truth — this guarantees the
    // CLI writes to the exact same file that Prisma Client reads at runtime.
    const absoluteDbUrl = getDatabaseUrl();

    logger.info('migrator: fresh dev database — running prisma db push', {
      bin,
      leadArgs,
      useShell,
      dbUrl: absoluteDbUrl,
    });

    // leadArgs contains any prefix arguments (e.g. ['/c', 'prisma.cmd'] on
    // Windows). The prisma subcommand arguments follow.
    const result = spawnSync(
      bin,
      [...leadArgs, 'db', 'push', '--skip-generate', '--accept-data-loss'],
      {
        stdio: 'pipe',
        shell: useShell,
        env: { ...process.env, DATABASE_URL: absoluteDbUrl },
        cwd: appRoot,
      }
    );

    if (result.status !== 0) {
      const stderr = result.stderr?.toString().trim() ?? '';
      const stdout = result.stdout?.toString().trim() ?? '';
      throw new Error(
        `prisma db push failed (exit ${result.status ?? 'null'}).\n${
          stderr || stdout || 'No output captured.'
        }`
      );
    }

    logger.info('migrator: prisma db push succeeded — schema initialised');
  } else {
    const templatePath = path.join(process.resourcesPath, 'prisma', 'template.db');
    if (!fs.existsSync(templatePath)) {
      throw new Error(
        `template.db not found at ${templatePath}. ` +
        'Run npm run prepare:db before packaging.'
      );
    }

    const dbPath = path.join(app.getPath('userData'), 'pos.db');
    logger.info('migrator: fresh packaged install — copying template.db', { dbPath });

    await prisma.$disconnect();
    fs.copyFileSync(templatePath, dbPath);
    await prisma.$connect();

    logger.info('migrator: template.db copied — schema initialised');
  }
}

// ---------------------------------------------------------------------------
// Migration steps — one entry per schema version.
// These only run on EXISTING databases being upgraded.
// Fresh installs skip all steps (schema already current).
// ---------------------------------------------------------------------------
const MIGRATIONS: MigrationStep[] = [
  {
    version: 1,
    description: 'Add Phase-1 columns and tables',
    up: async (prisma) => {
      // Order.cashierName
      if (!(await columnExists(prisma, 'Order', 'cashierName'))) {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "Order" ADD COLUMN "cashierName" TEXT`
        );
        logger.info('migrator: added Order.cashierName');
      }

      // Settings new columns
      const settingsCols: [string, string][] = [
        ['receiptPaperSize',   `TEXT NOT NULL DEFAULT '80mm'`],
        ['backupSchedule',     `TEXT NOT NULL DEFAULT 'daily'`],
        ['backupOnExit',       `INTEGER NOT NULL DEFAULT 1`],
        ['cloudBackupEnabled', `INTEGER NOT NULL DEFAULT 0`],
      ];
      for (const [col, def] of settingsCols) {
        if (!(await columnExists(prisma, 'Settings', col))) {
          await prisma.$executeRawUnsafe(
            `ALTER TABLE "Settings" ADD COLUMN "${col}" ${def}`
          );
          logger.info(`migrator: added Settings.${col}`);
        }
      }

      // ReceiptCounter table
      if (!(await tableExists(prisma, 'ReceiptCounter'))) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "ReceiptCounter" (
            "dateKey" TEXT NOT NULL PRIMARY KEY,
            "lastSeq" INTEGER NOT NULL DEFAULT 0
          )
        `);
        logger.info('migrator: created ReceiptCounter table');
      }

      // BackupRecord table
      if (!(await tableExists(prisma, 'BackupRecord'))) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "BackupRecord" (
            "id"            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "filename"      TEXT NOT NULL,
            "filePath"      TEXT NOT NULL,
            "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
            "trigger"       TEXT NOT NULL,
            "cloudStatus"   TEXT NOT NULL DEFAULT 'none',
            "cloudFileId"   TEXT,
            "errorMessage"  TEXT,
            "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await prisma.$executeRawUnsafe(
          `CREATE INDEX "BackupRecord_createdAt_idx" ON "BackupRecord" ("createdAt")`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX "BackupRecord_cloudStatus_idx" ON "BackupRecord" ("cloudStatus")`
        );
        logger.info('migrator: created BackupRecord table');
      }
    },
  },
  {
    version: 2,
    description: 'Add User table and migrate legacy Admin data',
    up: async (prisma) => {
      // Step 1: Create the User table if it does not already exist.
      if (!(await tableExists(prisma, 'User'))) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "User" (
            "id"                 INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "username"           TEXT NOT NULL,
            "passwordHash"       TEXT NOT NULL,
            "fullName"           TEXT NOT NULL,
            "role"               TEXT NOT NULL DEFAULT 'CASHIER',
            "isActive"           INTEGER NOT NULL DEFAULT 1,
            "mustChangePassword" INTEGER NOT NULL DEFAULT 0,
            "createdAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await prisma.$executeRawUnsafe(
          `CREATE UNIQUE INDEX "User_username_key" ON "User" ("username")`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX "User_username_idx" ON "User" ("username")`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX "User_role_idx" ON "User" ("role")`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX "User_isActive_idx" ON "User" ("isActive")`
        );
        logger.info('migrator: created User table');
      }

      // Step 2: Migrate legacy Admin rows into User.
      // Only runs if the Admin table exists (i.e. this is an existing database).
      // Idempotent: skips any username that already exists in User.
      if (await tableExists(prisma, 'Admin')) {
        const admins = await prisma.$queryRawUnsafe<
          { id: number; username: string; passwordHash: string }[]
        >(`SELECT "id", "username", "passwordHash" FROM "Admin"`);

        for (const admin of admins) {
          const existing = await prisma.$queryRawUnsafe<{ id: number }[]>(
            `SELECT "id" FROM "User" WHERE "username" = ?`,
            admin.username
          );

          if (existing.length === 0) {
            await prisma.$executeRawUnsafe(
              `INSERT INTO "User" ("username", "passwordHash", "fullName", "role",
                                   "isActive", "mustChangePassword",
                                   "createdAt", "updatedAt")
               VALUES (?, ?, ?, 'ADMIN', 1, 1,
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              admin.username,
              admin.passwordHash,
              admin.username
            );
            logger.info(`migrator: migrated Admin '${admin.username}' → User`);
          } else {
            logger.info(
              `migrator: User '${admin.username}' already exists, skipping Admin migration`
            );
          }
        }
      }
    },
  },
  {
    version: 3,
    description: 'Add payments, partners, owner/employee consumption, and social link tables',
    up: async (prisma) => {
      // --- Partner ---------------------------------------------------------
      if (!(await tableExists(prisma, 'Partner'))) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "Partner" (
            "id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "name"      TEXT NOT NULL,
            "isActive"  INTEGER NOT NULL DEFAULT 1,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Partner_name_key" ON "Partner" ("name")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX "Partner_isActive_idx" ON "Partner" ("isActive")`);
        logger.info('migrator: created Partner table');
      }

      // --- MenuItemPartner (live ownership config) --------------------------
      if (!(await tableExists(prisma, 'MenuItemPartner'))) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "MenuItemPartner" (
            "id"         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "menuItemId" INTEGER NOT NULL,
            "partnerId"  INTEGER NOT NULL,
            "percentage" REAL NOT NULL,
            "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE CASCADE,
            FOREIGN KEY ("partnerId") REFERENCES "Partner" ("id") ON DELETE CASCADE
          )
        `);
        await prisma.$executeRawUnsafe(
          `CREATE UNIQUE INDEX "MenuItemPartner_menuItemId_partnerId_key" ON "MenuItemPartner" ("menuItemId", "partnerId")`
        );
        await prisma.$executeRawUnsafe(`CREATE INDEX "MenuItemPartner_menuItemId_idx" ON "MenuItemPartner" ("menuItemId")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX "MenuItemPartner_partnerId_idx" ON "MenuItemPartner" ("partnerId")`);
        logger.info('migrator: created MenuItemPartner table');
      }

      // --- ConsumptionPerson -------------------------------------------------
      if (!(await tableExists(prisma, 'ConsumptionPerson'))) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "ConsumptionPerson" (
            "id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "name"      TEXT NOT NULL,
            "type"      TEXT NOT NULL,
            "isActive"  INTEGER NOT NULL DEFAULT 1,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await prisma.$executeRawUnsafe(`CREATE INDEX "ConsumptionPerson_type_idx" ON "ConsumptionPerson" ("type")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX "ConsumptionPerson_isActive_idx" ON "ConsumptionPerson" ("isActive")`);
        logger.info('migrator: created ConsumptionPerson table');
      }

      // --- PaymentAccount (live config) --------------------------------------
      if (!(await tableExists(prisma, 'PaymentAccount'))) {
        await prisma.$executeRawUnsafe(`
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
          )
        `);
        await prisma.$executeRawUnsafe(`CREATE INDEX "PaymentAccount_type_idx" ON "PaymentAccount" ("type")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX "PaymentAccount_isActive_idx" ON "PaymentAccount" ("isActive")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX "PaymentAccount_printOnReceipt_idx" ON "PaymentAccount" ("printOnReceipt")`);
        logger.info('migrator: created PaymentAccount table');
      }

      // --- Payment (actual transactions — many per order, from day one) -----
      if (!(await tableExists(prisma, 'Payment'))) {
        await prisma.$executeRawUnsafe(`
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
          )
        `);
        await prisma.$executeRawUnsafe(`CREATE INDEX "Payment_orderId_idx" ON "Payment" ("orderId")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX "Payment_method_idx" ON "Payment" ("method")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX "Payment_paymentAccountId_idx" ON "Payment" ("paymentAccountId")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX "Payment_isLegacyPayment_idx" ON "Payment" ("isLegacyPayment")`);
        logger.info('migrator: created Payment table');
      }

      // --- OrderItemPartnerAllocation (historical snapshot) ------------------
      if (!(await tableExists(prisma, 'OrderItemPartnerAllocation'))) {
        await prisma.$executeRawUnsafe(`
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
          )
        `);
        await prisma.$executeRawUnsafe(
          `CREATE INDEX "OrderItemPartnerAllocation_orderItemId_idx" ON "OrderItemPartnerAllocation" ("orderItemId")`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX "OrderItemPartnerAllocation_orderId_idx" ON "OrderItemPartnerAllocation" ("orderId")`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX "OrderItemPartnerAllocation_partnerId_idx" ON "OrderItemPartnerAllocation" ("partnerId")`
        );
        logger.info('migrator: created OrderItemPartnerAllocation table');
      }

      // --- SocialLink ----------------------------------------------------------
      if (!(await tableExists(prisma, 'SocialLink'))) {
        await prisma.$executeRawUnsafe(`
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
          )
        `);
        await prisma.$executeRawUnsafe(`CREATE INDEX "SocialLink_isEnabled_idx" ON "SocialLink" ("isEnabled")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX "SocialLink_sortOrder_idx" ON "SocialLink" ("sortOrder")`);
        logger.info('migrator: created SocialLink table');
      }

      // --- Order: new columns ---------------------------------------------
      // Plain ADD COLUMN, no inline FK — matches the existing cashierName
      // precedent (migration v1). ConsumptionPerson supports soft-delete
      // (isActive) precisely so app code never needs to hard-delete a row
      // this column points at.
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
        if (!(await columnExists(prisma, 'Order', col))) {
          await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "${col}" ${def}`);
          logger.info(`migrator: added Order.${col}`);
        }
      }
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Order_orderType_idx" ON "Order" ("orderType")`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "Order_consumptionPersonId_idx" ON "Order" ("consumptionPersonId")`
      );
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Order_paymentStatus_idx" ON "Order" ("paymentStatus")`);

      // --- Settings: new columns -------------------------------------------
      const settingsCols: [string, string][] = [
        ['logoPath', `TEXT`],
        ['currencyCode', `TEXT NOT NULL DEFAULT 'PKR'`],
        ['receiptShowLogo', `INTEGER NOT NULL DEFAULT 1`],
        ['serviceChargePresets', `TEXT`],
        ['googleReviewUrl', `TEXT`],
        ['googleReviewOnReceipt', `INTEGER NOT NULL DEFAULT 0`],
      ];
      for (const [col, def] of settingsCols) {
        if (!(await columnExists(prisma, 'Settings', col))) {
          await prisma.$executeRawUnsafe(`ALTER TABLE "Settings" ADD COLUMN "${col}" ${def}`);
          logger.info(`migrator: added Settings.${col}`);
        }
      }
    },
  },
  {
    version: 4,
    description: 'Backfill legacy payment records for pre-existing completed orders',
    up: async (prisma) => {
      // The pre-overhaul system was cash-only: every existing Order was, by
      // definition, paid in full in cash at the time it was created. This
      // step makes that fact explicit in the new Payment/paymentStatus model
      // without altering any original order data (totals, items, cashier,
      // timestamps are untouched).
      //
      // Idempotent: only orders that do not already have a Payment row are
      // backfilled, so running this step twice never creates duplicates.
      const orders = await prisma.$queryRawUnsafe<
        { id: number; grandTotal: number; createdAt: string }[]
      >(`SELECT "id", "grandTotal", "createdAt" FROM "Order"`);

      let backfilled = 0;
      for (const order of orders) {
        const existingPayment = await prisma.$queryRawUnsafe<{ id: number }[]>(
          `SELECT "id" FROM "Payment" WHERE "orderId" = ? LIMIT 1`,
          order.id
        );
        if (existingPayment.length > 0) continue;

        await prisma.$executeRawUnsafe(
          `INSERT INTO "Payment"
             ("orderId", "method", "amount", "accountDisplayName",
              "isLegacyPayment", "recordedBy", "recordedAt", "updatedAt")
           VALUES (?, 'CASH', ?, 'Cash (legacy — pre-overhaul record)',
                   1, NULL, ?, ?)`,
          order.id,
          order.grandTotal,
          order.createdAt,
          order.createdAt
        );

        await prisma.$executeRawUnsafe(
          `UPDATE "Order" SET "paymentStatus" = 'PAID' WHERE "id" = ?`,
          order.id
        );
        backfilled++;
      }

      logger.info(`migrator: v4 backfilled ${backfilled} legacy payment record(s)`, {
        totalOrders: orders.length,
      });
    },
  },
];

// ---------------------------------------------------------------------------
// PRAGMA user_version helpers
// ---------------------------------------------------------------------------
async function readUserVersion(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ user_version: number }[]>(
    'PRAGMA user_version'
  );
  return rows[0]?.user_version ?? 0;
}

async function setUserVersion(prisma: PrismaClient, version: number): Promise<void> {
  await prisma.$executeRawUnsafe(`PRAGMA user_version = ${version}`);
}

// ---------------------------------------------------------------------------
// Pre-migration backup — best-effort, never blocks the migration.
//
// Runs once, immediately before any pending migration step touches an
// existing (non-empty) database, so a snapshot of the pre-overhaul data
// always exists even though normal operation never requires restoring it.
// Reuses the existing local backup engine (VACUUM INTO) — no new backup
// mechanism is introduced. A BackupRecord audit row is written only if that
// table already exists (it does for any database that has ever run
// migration v1); its absence never prevents the physical backup file from
// being created.
// ---------------------------------------------------------------------------
async function runPreMigrationBackup(prisma: PrismaClient): Promise<void> {
  try {
    logger.info('migrator: creating pre-migration backup');
    const result = await createLocalBackup(prisma);

    if (await tableExists(prisma, 'BackupRecord')) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BackupRecord" ("filename", "filePath", "fileSizeBytes", "trigger", "cloudStatus")
         VALUES (?, ?, ?, 'pre-migration', 'none')`,
        result.filename,
        result.filePath,
        result.fileSizeBytes
      );
    }

    logger.info('migrator: pre-migration backup complete', { filename: result.filename });
  } catch (err) {
    // Never block startup/migration on a backup failure — log and continue.
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('migrator: pre-migration backup failed — continuing without it', { error: msg });
  }
}

// ---------------------------------------------------------------------------
// Public entry point — called once in main.ts before any IPC handlers.
// ---------------------------------------------------------------------------
export async function runMigrations(prisma: PrismaClient): Promise<void> {
  const empty = await isDatabaseEmpty(prisma);

  if (empty) {
    logger.info('migrator: database is empty — initialising schema');
    await initialiseSchema(prisma);
    await setUserVersion(prisma, CURRENT_VERSION);
    logger.info(`migrator: schema initialised and stamped at version ${CURRENT_VERSION}`);
    return;
  }

  const currentVersion = await readUserVersion(prisma);
  logger.info(
    `migrator: existing database at version ${currentVersion}, target ${CURRENT_VERSION}`
  );

  if (currentVersion >= CURRENT_VERSION) {
    logger.info('migrator: database is up-to-date, nothing to do');
    return;
  }

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  if (pending.length > 0) {
    await runPreMigrationBackup(prisma);
  }

  for (const migration of pending) {
    logger.info(
      `migrator: running migration v${migration.version} — ${migration.description}`
    );
    try {
      await migration.up(prisma);
      await setUserVersion(prisma, migration.version);
      logger.info(`migrator: migration v${migration.version} complete`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`migrator: migration v${migration.version} failed`, { error: msg });
      throw new Error(`Database migration v${migration.version} failed: ${msg}`);
    }
  }
}
