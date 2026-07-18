// Creates a clean, schema-only SQLite database (prisma/template.db) that gets
// bundled into the packaged app. At runtime it is copied to a writable
// location and populated by electron/bootstrap.ts.
//
// Cross-platform: runs on Windows, macOS, and Linux via `node`.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const templatePath = resolve('prisma', 'template.db');

// Start from a fresh file so the shipped DB never contains test data.
if (existsSync(templatePath)) rmSync(templatePath);

// `prisma db push` reads DATABASE_URL from the environment. The path is
// relative to the schema location (prisma/), so this writes prisma/template.db.
const result = spawnSync(
  'npx',
  ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
  {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: 'file:./template.db' },
  }
);

if (result.status !== 0) {
  console.error('Failed to build template database.');
  process.exit(result.status ?? 1);
}

console.log('Created schema-only template database at prisma/template.db');
