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
 *      Dev:      invokes the local prisma binary (node_modules/.bin/prisma)
 *                with `db push`. Passes an absolute DATABASE_URL derived
 *                from getDbPath() so the CLI writes to the same location
 *                that Prisma Client reads from at runtime.
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
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { PrismaClient } from '@prisma/client';
import { logger } from './logger';
import { getDbPath } from './paths';

const CURRENT_VERSION = 2;

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
 * Resolves the absolute path to the local prisma CLI binary.
 * Returns the full path so spawnSync can be called with shell:false,
 * avoiding cmd.exe on Windows and its spurious cleanup error messages.
 */
function resolvePrismaBin(): { bin: string; useShell: boolean } {
  const appRoot = process.env.APP_ROOT ?? process.cwd();
  const winBin = path.join(appRoot, 'node_modules', '.bin', 'prisma.cmd');
  const unixBin = path.join(appRoot, 'node_modules', '.bin', 'prisma');

  if (process.platform === 'win32') {
    if (fs.existsSync(winBin)) return { bin: winBin, useShell: true };
    return { bin: 'npx', useShell: true };
  }

  if (fs.existsSync(unixBin)) return { bin: unixBin, useShell: false };
  return { bin: 'npx', useShell: true };
}

// ---------------------------------------------------------------------------
// Schema initialisation for a fresh database.
// ---------------------------------------------------------------------------
async function initialiseSchema(prisma: PrismaClient): Promise<void> {
  if (!app.isPackaged) {
    const appRoot = process.env.APP_ROOT ?? process.cwd();
    const { bin, useShell } = resolvePrismaBin();

    // Use an absolute DATABASE_URL so the Prisma CLI writes to the exact
    // same location that Prisma Client reads from at runtime.
    // getDbPath() is the single source of truth for the dev DB location.
    const absoluteDbUrl = `file:${getDbPath()}`;

    logger.info('migrator: fresh dev database — running prisma db push', {
      bin,
      useShell,
      dbUrl: absoluteDbUrl,
    });

    const result = spawnSync(
      bin,
      ['db', 'push', '--skip-generate', '--accept-data-loss'],
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
