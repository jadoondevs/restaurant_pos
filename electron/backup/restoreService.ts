/**
 * Production restore service.
 *
 * Validation pipeline:
 *   1. File exists and is non-empty.
 *   2. SQLite magic header check (first 16 bytes).
 *   3. PRAGMA integrity_check via a temporary Prisma client.
 *   4. Required tables present.
 *   5. Safety backup of the current database.
 *   6. Tear down all services (backup scheduler, print service, Prisma).
 *   7. Destroy all BrowserWindows.
 *   8. Atomic file swap (WAL + SHM cleanup).
 *   9. app.relaunch() + app.exit(0).
 *
 * The live database is NEVER overwritten before all validation passes.
 * Services are torn down BEFORE the file swap so the DB is fully released.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
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
// Validation — opens a temporary client against the backup, never the live DB.
// ---------------------------------------------------------------------------
export async function validateBackup(backupPath: string): Promise<ValidationResult> {
  if (!fs.existsSync(backupPath)) {
    return { valid: false, error: 'Backup file not found.' };
  }
  const stat = fs.statSync(backupPath);
  if (stat.size < 4096) {
    return { valid: false, error: 'Backup file is too small to be a valid database.' };
  }

  // SQLite magic header check.
  const header = Buffer.alloc(16);
  const fd = fs.openSync(backupPath, 'r');
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (header.toString('utf8') !== SQLITE_HEADER) {
    return { valid: false, error: 'File is not a valid SQLite database.' };
  }

  const tempClient = new PrismaClient({
    datasources: { db: { url: `file:${backupPath}` } },
    log: [],
  });

  try {
    const integrityRows = await tempClient.$queryRawUnsafe<{ integrity_check: string }[]>(
      'PRAGMA integrity_check'
    );
    if (!integrityRows.every((r) => r.integrity_check === 'ok')) {
      return {
        valid: false,
        error: 'Database integrity check failed. The backup may be corrupted.',
      };
    }

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
// Restore service
// ---------------------------------------------------------------------------
class RestoreService {
  private restoring = false;

  isRestoreInProgress(): boolean {
    return this.restoring;
  }

  async restoreBackup(
    backupPath: string,
    prisma: PrismaClient
  ): Promise<void> {
    if (this.restoring) throw new Error('A restore is already in progress.');
    this.restoring = true;

    logger.info('restoreService: starting restore', { backupPath });

    // Re-validate immediately before touching anything.
    const validation = await validateBackup(backupPath);
    if (!validation.valid) {
      this.restoring = false;
      throw new Error(validation.error ?? 'Backup validation failed.');
    }

    const liveDbPath = getDbPath();

    // --- Step 1: safety backup of the current live database ---
    const safetyFilename = `safety-before-restore-${Date.now()}.db`;
    const safetyPath = path.join(getBackupDir(), safetyFilename);
    try {
      await prisma.$executeRawUnsafe(`VACUUM INTO '${safetyPath.replace(/'/g, "''")}' `);
      logger.info('restoreService: safety backup created', { safetyPath });
    } catch (err) {
      this.restoring = false;
      throw new Error(
        `Failed to create safety backup: ${err instanceof Error ? err.message : err}`
      );
    }

    // --- Step 2: tear down all services before touching the DB file ---
    // Import lazily to avoid circular dependencies at module load time.
    try {
      const { backupService } = await import('./backupService');
      backupService.destroy();
    } catch { /* ignore if not initialised */ }

    try {
      const { printService } = await import('../services/printService');
      printService.destroy();
    } catch { /* ignore */ }

    // --- Step 3: disconnect Prisma so the DB file is fully released ---
    try {
      await prisma.$disconnect();
      logger.info('restoreService: Prisma disconnected');
    } catch (err) {
      logger.warn('restoreService: Prisma disconnect error', { err });
    }

    // --- Step 4: destroy all BrowserWindows ---
    // This releases any renderer-side DB connections and frees the file lock.
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch { /* ignore */ }
    }

    // --- Step 5: remove WAL and SHM sidecar files ---
    for (const ext of ['-wal', '-shm']) {
      const sidecar = liveDbPath + ext;
      if (fs.existsSync(sidecar)) {
        try { fs.unlinkSync(sidecar); } catch { /* ignore */ }
      }
    }

    // --- Step 6: atomic file swap ---
    const tmpPath = liveDbPath + '.restore-tmp';
    try {
      fs.copyFileSync(backupPath, tmpPath);
      fs.renameSync(tmpPath, liveDbPath);
      logger.info('restoreService: database swapped successfully');
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      // restoring flag stays true — app is in an inconsistent state, must exit.
      throw new Error(
        `Failed to replace database: ${err instanceof Error ? err.message : err}`
      );
    }

    // --- Step 7: relaunch and exit ---
    // app.relaunch() registers the new process to start after this one exits.
    // app.exit(0) terminates immediately without firing before-quit again,
    // so the graceful-shutdown sequence in main.ts does not run concurrently.
    logger.info('restoreService: relaunching application');
    app.relaunch();
    app.exit(0);
  }
}

export const restoreService = new RestoreService();

/** Used by main.ts before-quit guard to skip graceful shutdown during restore. */
export function isRestoreInProgress(): boolean {
  return restoreService.isRestoreInProgress();
}
