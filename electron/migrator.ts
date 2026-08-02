/**
 * Idempotent versioned runtime migrator.
 *
 * Startup scenarios handled:
 *
 *   1. FRESH INSTALL (dev or packaged)
 *      The database file is empty — no tables exist yet.
 *      The migrator initialises the full schema first (prisma db push in dev,
 *      template.db copy in packaged), then stamps user_version = CURRENT_VERSION
 *      so no migration steps run — the fresh schema already satisfies them all.
 *
 *   2. EXISTING DATABASE (upgrade path)
 *      Tables exist, user_version < CURRENT_VERSION.
 *      Only pending migration steps run. Existing data is never touched.
 *
 *   3. UP-TO-DATE DATABASE
 *      user_version === CURRENT_VERSION. Nothing runs.
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

const CURRENT_VERSION = 1;

// Core tables that must exist for the app to function.
// Used to detect a completely uninitialised (fresh) database.
const CORE_TABLES = ['Admin', 'Settings', 'Category', 'MenuItem', 'Customer', 'Order', 'OrderItem'];

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

// ---------------------------------------------------------------------------
// Schema initialisation for a fresh database.
// ---------------------------------------------------------------------------

/**
 * Initialises a completely empty database with the full current schema.
 *
 * Dev:      runs `prisma db push` against the dev.db file.
 * Packaged: copies the bundled template.db (which was built by prepare-db.mjs
 *           and already contains the full schema) over the empty file.
 *
 * After this call the database has all tables and is ready for use.
 * user_version is then stamped to CURRENT_VERSION so migration steps are
 * skipped — the fresh schema already satisfies every migration.
 */
async function initialiseSchema(prisma: PrismaClient): Promise<void> {
  if (!app.isPackaged) {
    // -----------------------------------------------------------------------
    // Development: use prisma db push to create the schema.
    // -----------------------------------------------------------------------
    logger.info('migrator: fresh dev database — running prisma db push');

    // Resolve the dev.db path the same way client.ts does.
    const dbUrl = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';

    const result = spawnSync(
      'npx',
      ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
      {
        stdio: 'pipe',
        shell: true,
        env: { ...process.env, DATABASE_URL: dbUrl },
        cwd: process.env.APP_ROOT ?? process.cwd(),
      }
    );

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? '';
      const stdout = result.stdout?.toString() ?? '';
      throw new Error(
        `prisma db push failed (exit ${result.status}).\n${stderr || stdout}`
      );
    }

    logger.info('migrator: prisma db push succeeded — schema initialised');
  } else {
    // -----------------------------------------------------------------------
    // Packaged: copy the bundled template.db over the empty file.
    // -----------------------------------------------------------------------
    logger.info('migrator: fresh packaged install — copying template.db');

    const templatePath = path.join(process.resourcesPath, 'prisma', 'template.db');
    if (!fs.existsSync(templatePath)) {
      throw new Error(
        `template.db not found at ${templatePath}. ` +
        'Run npm run prepare:db before packaging.'
      );
    }

    // Resolve the live DB path.
    const dbPath = path.join(app.getPath('userData'), 'pos.db');

    // Disconnect Prisma before replacing the file.
    await prisma.$disconnect();
    fs.copyFileSync(templatePath, dbPath);

    // Reconnect so subsequent operations work.
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
      // --- Order.cashierName ---
      if (!(await columnExists(prisma, 'Order', 'cashierName'))) {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "Order" ADD COLUMN "cashierName" TEXT`
        );
        logger.info('migrator: added Order.cashierName');
      }

      // --- Settings new columns ---
      const settingsCols: [string, string][] = [
        ['receiptPaperSize', `TEXT NOT NULL DEFAULT '80mm'`],
        ['backupSchedule',   `TEXT NOT NULL DEFAULT 'daily'`],
        ['backupOnExit',     `INTEGER NOT NULL DEFAULT 1`],
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

      // --- ReceiptCounter table ---
      if (!(await tableExists(prisma, 'ReceiptCounter'))) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "ReceiptCounter" (
            "dateKey" TEXT NOT NULL PRIMARY KEY,
            "lastSeq" INTEGER NOT NULL DEFAULT 0
          )
        `);
        logger.info('migrator: created ReceiptCounter table');
      }

      // --- BackupRecord table ---
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
// Public entry point
// ---------------------------------------------------------------------------
export async function runMigrations(prisma: PrismaClient): Promise<void> {
  // Step 1: detect a completely uninitialised database.
  const empty = await isDatabaseEmpty(prisma);

  if (empty) {
    logger.info('migrator: database is empty — initialising schema');
    await initialiseSchema(prisma);
    // Stamp as fully up-to-date: fresh schema satisfies all migrations.
    await setUserVersion(prisma, CURRENT_VERSION);
    logger.info(`migrator: schema initialised and stamped at version ${CURRENT_VERSION}`);
    return;
  }

  // Step 2: existing database — check version and run pending steps.
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
