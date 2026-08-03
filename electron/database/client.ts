import { PrismaClient } from '@prisma/client';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getDatabaseUrl } from '../paths';

/**
 * Creates a single shared Prisma client.
 *
 * Database URL resolution:
 *   getDatabaseUrl() in paths.ts is the single source of truth.
 *   It always returns an absolute file: URL, eliminating the CLI/runtime
 *   path divergence that caused SQLite Error 14.
 *
 *   See paths.ts for the full explanation of why relative DATABASE_URL
 *   values are not used at runtime.
 */
function resolveDatabaseUrl(): string {
  if (!app.isPackaged) {
    return getDatabaseUrl();
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

  return getDatabaseUrl();
}

const prisma = new PrismaClient({
  datasources: { db: { url: resolveDatabaseUrl() } },
  log: app?.isPackaged ? ['error'] : ['error', 'warn'],
});

export default prisma;
