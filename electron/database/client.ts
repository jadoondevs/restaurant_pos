import { PrismaClient } from '@prisma/client';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Creates a single shared Prisma client.
 *
 * In development the SQLite file lives in the project's prisma/ folder.
 * In a packaged build it is copied to the user's writable app-data dir so
 * the database is persistent and writable outside the read-only app bundle.
 */
function resolveDatabaseUrl(): string {
  if (!app.isPackaged) {
    return process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
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
