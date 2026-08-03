import { PrismaClient } from '@prisma/client';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getDbPath, getDatabaseUrl } from '../paths';

/**
 * Creates a single shared Prisma client.
 *
 * Database URL resolution:
 *   getDatabaseUrl() in paths.ts is the single source of truth.
 *   It always returns an absolute file: URL, eliminating the CLI/runtime
 *   path divergence that caused SQLite Error 14.
 *
 *   getDbPath() provides the raw filesystem path used for the template
 *   copy check on first packaged launch.
 *
 *   See paths.ts for the full explanation of why relative DATABASE_URL
 *   values are not used at runtime.
 */
function resolveDatabaseUrl(): string {
  if (!app.isPackaged) {
    return getDatabaseUrl();
  }

  // Packaged: on first launch copy the bundled schema-only template database
  // to the writable userData location. getDbPath() returns the absolute path
  // to userData/pos.db — the same path getDatabaseUrl() will return.
  const dbPath = getDbPath();
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
