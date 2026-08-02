/**
 * Idempotent versioned runtime migrator.
 *
 * Why this exists:
 *   Packaged Electron apps have no Prisma CLI. Existing restaurant databases
 *   were created with `prisma db push` and have no _prisma_migrations table.
 *   This migrator upgrades them in-place using PRAGMA user_version as a
 *   version counter and idempotent DDL (ALTER TABLE IF NOT EXISTS column,
 *   CREATE TABLE IF NOT EXISTS) so it is safe to run on every boot.
 *
 * Adding a new migration:
 *   1. Increment CURRENT_VERSION.
 *   2. Add a new entry to the MIGRATIONS array.
 *   3. The step runs exactly once on the first boot after the upgrade.
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from './logger';

const CURRENT_VERSION = 1;

type MigrationStep = {
  version: number;
  description: string;
  up: (prisma: PrismaClient) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Helper: check whether a column exists in a table.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Helper: check whether a table exists.
// ---------------------------------------------------------------------------
async function tableExists(prisma: PrismaClient, table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    table
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Migration steps — one entry per schema version.
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
        ['backupSchedule', `TEXT NOT NULL DEFAULT 'daily'`],
        ['backupOnExit', `INTEGER NOT NULL DEFAULT 1`],
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
// Read / write the schema version stored in the SQLite file itself.
// ---------------------------------------------------------------------------
async function readUserVersion(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ user_version: number }[]>(
    'PRAGMA user_version'
  );
  return rows[0]?.user_version ?? 0;
}

async function setUserVersion(prisma: PrismaClient, version: number): Promise<void> {
  // PRAGMA user_version does not support parameterised queries in SQLite.
  await prisma.$executeRawUnsafe(`PRAGMA user_version = ${version}`);
}

// ---------------------------------------------------------------------------
// Public entry point — call once on app ready, before any IPC handlers.
// ---------------------------------------------------------------------------
export async function runMigrations(prisma: PrismaClient): Promise<void> {
  const currentVersion = await readUserVersion(prisma);
  logger.info(`migrator: database at version ${currentVersion}, target ${CURRENT_VERSION}`);

  if (currentVersion >= CURRENT_VERSION) return;

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  for (const migration of pending) {
    logger.info(`migrator: running migration v${migration.version} — ${migration.description}`);
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
