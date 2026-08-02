/**
 * Production restore service.
 *
 * Validation pipeline:
 *   1. File exists and is non-empty.
 *   2. SQLite magic header check (first 16 bytes).
 *   3. PRAGMA integrity_check via a temporary Prisma client.
 *   4. Required tables present.
 *   5. Safety backup of the current database.
 *   6. Atomic file swap (WAL + SHM cleanup).
 *   7. App restart.
 *
 * The live database is NEVER overwritten before all validation passes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { PrismaClient } from '@prisma/client';
import { getDbPath, getBackupDir } from '../paths';
import { logger } from '../logger';

const SQLITE_HEADER = 'SQLite format 3\0';
const REQUIRED_TABLES = [
  'Admin',
  'Category',
  'MenuItem',
  'Customer',
  'Order',
  'OrderItem',
  'Settings',
];

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Validation — safe to call without touching the live DB.
// ---------------------------------------------------------------------------
export async function validateBackup(backupPath: string): Promise<ValidationResult> {
  // 1. File existence and size.
  if (!fs.existsSync(backupPath)) {
    return { valid: false, error: 'Backup file not found.' };
  }
  const stat = fs.statSync(backupPath);
  if (stat.size < 4096) {
    return { valid: false, error: 'Backup file is too small to be a valid database.' };
  }

  // 2. SQLite magic header.
  const header = Buffer.alloc(16);
  const fd = fs.openSync(backupPath, 'r');
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (header.toString('utf8') !== SQLITE_HEADER) {
    return { valid: false, error: 'File is not a valid SQLite database.' };
  }

  // 3 & 4. Open a temporary Prisma client against the backup file.
  const tempClient = new PrismaClient({
    datasources: { db: { url: `file:${backupPath}` } },
    log: [],
  });

  try {
    // integrity_check
    const integrityRows = await tempClient.$queryRawUnsafe<{ integrity_check: string }[]>(
      'PRAGMA integrity_check'
    );
    const integrityOk = integrityRows.every((r) => r.integrity_check === 'ok');
    if (!integrityOk) {
      return { valid: false, error: 'Database integrity check failed. The backup may be corrupted.' };
    }

    // Required tables.
    for (const table of REQUIRED_TABLES) {
      const rows = await tempClient.$queryRawUnsafe<{ name: string }[]>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        table
      );
      if (rows.length === 0) {
        return { valid: false, error: `Backup is missing required table: ${table}` };
      }
    }

    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Backup validation error: ${msg}` };
  } finally {
    await tempClient.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Restore — only called after validateBackup() returns { valid: true }.
// ---------------------------------------------------------------------------
let isRestoring = false;

export function isRestoreInProgress(): boolean {
  return isRestoring;
}

export async function restoreBackup(
  backupPath: string,
  prisma: PrismaClient
): Promise<void> {
  if (isRestoring) throw new Error('A restore is already in progress.');
  isRestoring = true;

  logger.info('restoreService: starting restore', { backupPath });

  // Re-validate immediately before touching anything.
  const validation = await validateBackup(backupPath);
  if (!validation.valid) {
    isRestoring = false;
    throw new Error(validation.error ?? 'Backup validation failed.');
  }

  const liveDbPath = getDbPath();

  // 5. Create a safety backup of the current database.
  const safetyFilename = `safety-before-restore-${Date.now()}.db`;
  const safetyPath = path.join(getBackupDir(), safetyFilename);
  try {
    await prisma.$executeRawUnsafe(`VACUUM INTO '${safetyPath.replace(/'/g, "''")}' `);
    logger.info('restoreService: safety backup created', { safetyPath });
  } catch (err) {
    isRestoring = false;
    throw new Error(`Failed to create safety backup: ${err instanceof Error ? err.message : err}`);
  }

  // 6. Disconnect Prisma so the DB file is not locked.
  await prisma.$disconnect();

  // Remove WAL and SHM sidecar files to ensure a clean swap.
  for (const ext of ['-wal', '-shm']) {
    const sidecar = liveDbPath + ext;
    if (fs.existsSync(sidecar)) {
      try { fs.unlinkSync(sidecar); } catch { /* ignore */ }
    }
  }

  // Atomic copy: write to a temp file first, then rename.
  const tmpPath = liveDbPath + '.restore-tmp';
  try {
    fs.copyFileSync(backupPath, tmpPath);
    fs.renameSync(tmpPath, liveDbPath);
    logger.info('restoreService: database swapped successfully');
  } catch (err) {
    // Attempt to clean up the temp file.
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw new Error(`Failed to replace database: ${err instanceof Error ? err.message : err}`);
  }

  // 7. Restart the application.
  logger.info('restoreService: restarting application');
  app.relaunch();
  app.exit(0);
}
