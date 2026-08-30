/**
 * Restore service validation tests.
 *
 * Tests the validation pipeline logic without requiring Electron or Prisma.
 * Uses Node's built-in `node:sqlite` module (Node 22.5+) to create real
 * SQLite files for header and integrity checks. No native compilation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Replicate validateBackup logic (without Electron/Prisma)
// ---------------------------------------------------------------------------
const SQLITE_HEADER = 'SQLite format 3\0';
const REQUIRED_TABLES = [
  'Admin', 'Category', 'MenuItem', 'Customer', 'Order', 'OrderItem', 'Settings',
];

interface ValidationResult {
  valid: boolean;
  error?: string;
}

function validateBackupSync(backupPath: string): ValidationResult {
  if (!fs.existsSync(backupPath)) {
    return { valid: false, error: 'Backup file not found.' };
  }
  const stat = fs.statSync(backupPath);
  if (stat.size < 4096) {
    return { valid: false, error: 'Backup file is too small to be a valid database.' };
  }

  const header = Buffer.alloc(16);
  const fd = fs.openSync(backupPath, 'r');
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (header.toString('utf8') !== SQLITE_HEADER) {
    return { valid: false, error: 'File is not a valid SQLite database.' };
  }

  // Open read-only to run integrity check and table verification.
  const db = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const rows = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    if (!rows.every((r) => r.integrity_check === 'ok')) {
      return { valid: false, error: 'Database integrity check failed.' };
    }
    for (const table of REQUIRED_TABLES) {
      const row = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      ).get(table);
      if (!row) {
        return { valid: false, error: `Backup is missing required table: ${table}` };
      }
    }
    return { valid: true };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let tmpDir: string;

function createValidBackup(): string {
  const p = path.join(tmpDir, `valid-${Date.now()}.db`);
  const db = new DatabaseSync(p);
  db.exec(`
    CREATE TABLE Admin (id INTEGER PRIMARY KEY, username TEXT, passwordHash TEXT, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE Category (id INTEGER PRIMARY KEY, name TEXT, sortOrder INTEGER, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE MenuItem (id INTEGER PRIMARY KEY, name TEXT, price REAL, available INTEGER, categoryId INTEGER, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE Customer (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, notes TEXT, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE "Order" (id INTEGER PRIMARY KEY, receiptNumber TEXT UNIQUE, subtotal REAL, grandTotal REAL, createdAt DATETIME);
    CREATE TABLE OrderItem (id INTEGER PRIMARY KEY, orderId INTEGER, name TEXT, price REAL, quantity INTEGER, lineTotal REAL);
    CREATE TABLE Settings (id INTEGER PRIMARY KEY, restaurantName TEXT, updatedAt DATETIME);
  `);
  // Insert enough rows to push the file past 4096 bytes.
  for (let i = 0; i < 50; i++) {
    db.prepare(
      `INSERT INTO Admin (username, passwordHash, createdAt, updatedAt)
       VALUES (?, 'hash', datetime('now'), datetime('now'))`
    ).run(`user${i}`);
  }
  db.close();
  return p;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Restore service validation', () => {
  it('accepts a valid backup', () => {
    const p = createValidBackup();
    const result = validateBackupSync(p);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects a non-existent file', () => {
    const result = validateBackupSync('/does/not/exist.db');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('rejects a file that is too small', () => {
    const p = path.join(tmpDir, 'tiny.db');
    fs.writeFileSync(p, Buffer.alloc(100));
    const result = validateBackupSync(p);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too small');
  });

  it('rejects a file with an invalid SQLite header', () => {
    const p = path.join(tmpDir, 'notadb.db');
    const buf = Buffer.alloc(8192, 0);
    buf.write('NOT A DB', 0, 'utf8');
    fs.writeFileSync(p, buf);
    const result = validateBackupSync(p);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not a valid SQLite');
  });

  it('rejects a backup missing a required table', () => {
    const p = path.join(tmpDir, 'missing-table.db');
    const db = new DatabaseSync(p);
    db.exec(`
      CREATE TABLE Admin (id INTEGER PRIMARY KEY);
      CREATE TABLE Category (id INTEGER PRIMARY KEY);
      CREATE TABLE MenuItem (id INTEGER PRIMARY KEY);
      CREATE TABLE Customer (id INTEGER PRIMARY KEY);
      CREATE TABLE "Order" (id INTEGER PRIMARY KEY);
      CREATE TABLE OrderItem (id INTEGER PRIMARY KEY);
    `);
    for (let i = 0; i < 50; i++) {
      db.prepare(`INSERT INTO Admin (id) VALUES (?)`).run(i);
    }
    db.close();
    const result = validateBackupSync(p);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Settings');
  });

  it('rejects a plain text file with .db extension', () => {
    const p = path.join(tmpDir, 'fake.db');
    fs.writeFileSync(p, 'this is not a database'.repeat(300));
    const result = validateBackupSync(p);
    expect(result.valid).toBe(false);
  });
});
