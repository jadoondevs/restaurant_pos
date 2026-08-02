/**
 * Centralizes all file-system path resolution for the main process.
 * Both dev and packaged builds resolve paths through this module.
 */
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/** Absolute path to the live SQLite database file. */
export function getDbPath(): string {
  if (!app.isPackaged) {
    // In dev, Prisma writes to prisma/dev.db relative to the project root.
    // APP_ROOT is set by main.ts before this module is imported.
    return path.join(process.env.APP_ROOT ?? process.cwd(), 'prisma', 'dev.db');
  }
  return path.join(app.getPath('userData'), 'pos.db');
}

/** Absolute path to the Backups directory inside userData. */
export function getBackupDir(): string {
  const dir = path.join(app.getPath('userData'), 'Backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute path to the encrypted token storage file. */
export function getTokenPath(): string {
  return path.join(app.getPath('userData'), 'cloud-token.enc');
}
