/**
 * Local backup engine.
 *
 * Uses SQLite's VACUUM INTO to create a consistent snapshot of the live
 * database without interrupting ongoing operations. Backups are written to
 * userData/Backups/ with timestamped filenames. The 30 oldest files beyond
 * the retention limit are deleted automatically.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { getBackupDir, getDbPath } from '../paths';
import { logger } from '../logger';

const MAX_LOCAL_BACKUPS = 30;

/** Generates a unique timestamped filename, adding a suffix if needed. */
function buildFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = [
    'backup',
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()) + pad(now.getMinutes()),
  ].join('-');

  const dir = getBackupDir();
  let filename = `${base}.db`;
  let counter = 1;
  // VACUUM INTO requires the target file not to exist.
  while (fs.existsSync(path.join(dir, filename))) {
    filename = `${base}-${counter}.db`;
    counter++;
  }
  return filename;
}

/** Deletes backups beyond the retention limit, oldest first. */
function pruneOldBackups(): void {
  const dir = getBackupDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.db'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime); // oldest first

  const excess = files.length - MAX_LOCAL_BACKUPS;
  for (let i = 0; i < excess; i++) {
    const target = path.join(dir, files[i].name);
    try {
      fs.unlinkSync(target);
      logger.info('localBackup: pruned old backup', { file: files[i].name });
    } catch (err) {
      logger.warn('localBackup: failed to prune backup', { file: files[i].name, err });
    }
  }
}

export interface LocalBackupResult {
  filename: string;
  filePath: string;
  fileSizeBytes: number;
}

/**
 * Creates a local backup of the live database.
 * Returns metadata about the created file.
 */
export async function createLocalBackup(
  prisma: PrismaClient
): Promise<LocalBackupResult> {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found at: ${dbPath}`);
  }

  const dir = getBackupDir();
  const filename = buildFilename();
  const filePath = path.join(dir, filename);

  logger.info('localBackup: starting VACUUM INTO', { dest: filePath });

  // VACUUM INTO creates a consistent, compacted copy without locking the DB
  // for writes — safe to run while the restaurant is serving customers.
  await prisma.$executeRawUnsafe(`VACUUM INTO '${filePath.replace(/'/g, "''")}' `);

  const fileSizeBytes = fs.statSync(filePath).size;
  logger.info('localBackup: backup created', { filename, fileSizeBytes });

  pruneOldBackups();

  return { filename, filePath, fileSizeBytes };
}

/** Returns all local backup files sorted newest first. */
export function listLocalBackups(): { filename: string; filePath: string; fileSizeBytes: number; createdAt: Date }[] {
  const dir = getBackupDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.db'))
    .map((f) => {
      const filePath = path.join(dir, f);
      const stat = fs.statSync(filePath);
      return { filename: f, filePath, fileSizeBytes: stat.size, createdAt: stat.mtime };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Returns the size of the live database in bytes. */
export function getDbSizeBytes(): number {
  const dbPath = getDbPath();
  try {
    return fs.statSync(dbPath).size;
  } catch {
    return 0;
  }
}
