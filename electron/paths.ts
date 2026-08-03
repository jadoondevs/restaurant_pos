/**
 * Centralizes all file-system path resolution for the main process.
 * Both dev and packaged builds resolve paths through this module.
 *
 * DATABASE PATH RESOLUTION
 * ========================
 * There are two consumers of the database path with different resolution rules:
 *
 *   Prisma CLI (npx prisma db push / generate / studio)
 *     Resolves relative file: URLs relative to the prisma/ directory
 *     (where schema.prisma lives). This is Prisma's documented behavior.
 *
 *   Prisma Client (runtime)
 *     Resolves relative file: URLs relative to process.cwd().
 *
 * Using a relative path in DATABASE_URL causes these two consumers to
 * resolve to different files, which is the root cause of SQLite Error 14.
 *
 * SOLUTION: getDatabaseUrl() always returns an ABSOLUTE file: URL.
 * Every runtime consumer calls getDatabaseUrl(). The Prisma CLI subprocess
 * is always passed this absolute URL explicitly. No relative paths exist
 * anywhere in the runtime path resolution chain.
 *
 * The .env file uses file:./dev.db which is correct for developers running
 * Prisma CLI commands directly from the terminal (resolves from prisma/ to
 * prisma/dev.db). The runtime does not rely on .env for path resolution.
 */
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Database path
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the live SQLite database file.
 *
 * Dev:      <APP_ROOT>/prisma/dev.db
 * Packaged: <userData>/pos.db
 */
export function getDbPath(): string {
  if (!app.isPackaged) {
    // APP_ROOT is set by main.ts before any module that calls this is imported.
    return path.join(process.env.APP_ROOT ?? process.cwd(), 'prisma', 'dev.db');
  }
  return path.join(app.getPath('userData'), 'pos.db');
}

/**
 * Returns the absolute file: URL for the live SQLite database.
 * This is the single source of truth for database URL resolution.
 *
 * Override behaviour:
 *   If DATABASE_URL is set to an absolute file: URL (starts with 'file:/'),
 *   it is respected to allow intentional overrides for testing or tooling.
 *   Relative DATABASE_URL values from .env are intentionally ignored at
 *   runtime to prevent CLI/runtime path divergence.
 *
 * Dev:      file:<APP_ROOT>/prisma/dev.db
 * Packaged: file:<userData>/pos.db
 */
export function getDatabaseUrl(): string {
  const envUrl = process.env.DATABASE_URL;

  // Respect an absolute override (e.g. for integration tests or tooling).
  // An absolute file: URL starts with 'file:/' on Unix or 'file:C:' on Windows.
  // We detect this by checking that the path after 'file:' is absolute.
  if (envUrl) {
    const filePath = envUrl.startsWith('file:') ? envUrl.slice(5) : null;
    if (filePath && path.isAbsolute(filePath)) {
      return envUrl;
    }
    // Relative DATABASE_URL (e.g. from .env) is ignored at runtime.
    // The runtime always uses the absolute path from getDbPath().
  }

  return `file:${getDbPath()}`;
}

// ---------------------------------------------------------------------------
// Backup and cloud paths
// ---------------------------------------------------------------------------

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
