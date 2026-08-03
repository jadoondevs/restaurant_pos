import { PrismaClient } from '@prisma/client';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getDbPath } from '../paths';

/**
 * Creates a single shared Prisma client.
 *
 * Database path resolution:
 *
 *   Development:
 *     Uses getDbPath() which returns an absolute path based on APP_ROOT.
 *     This is the single source of truth — we do NOT use DATABASE_URL at
 *     runtime because Prisma Client and the Prisma CLI resolve relative
 *     file: paths differently (CLI resolves relative to prisma/, Client
 *     resolves relative to process.cwd()), which causes path mismatches.
 *
 *   Packaged build:
 *     Database lives in userData/pos.db. Copied from template.db on first
 *     launch if it does not exist.
 */
function resolveDatabaseUrl(): string {
  if (!app.isPackaged) {
    // Use an absolute path so Prisma Client always opens the correct file
    // regardless of process.cwd(). getDbPath() is the single source of truth.
    return `file:${getDbPath()}`;
  }

  const userDataDir = app.getPath('userData');
  const dbPath = path.join(userDataDir, 'pos.db');

  // On first launch, copy the bundled schema-only template database to a
  // writable location. The app bundle itself is read-only, so the live DB
  // must live in the user-data directory. ensureBootstrap() then fills in the
  // default admin, settings, and sample data.
  if (!fs.existsSync(dbPath)) {
    const template = path.join(process.resourcesPath, 'prisma', 'template.db');
    if (fs.existsSync(template)) {
      fs.copyFileSync(template, dbPath);
    }
  }

  return `file:${dbPath}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: resolveDatabaseUrl() } },
  log: app?.isPackaged ? ['error'] : ['error', 'warn'],
});

export default prisma;
