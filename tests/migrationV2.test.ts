/**
 * Migration v2 tests.
 *
 * Tests the User table creation and Admin data migration logic
 * using Node's built-in `node:sqlite` module (Node 22.5+).
 * No native compilation required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Replicate migration v2 logic
// ---------------------------------------------------------------------------

function createUserTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id"                 INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "username"           TEXT NOT NULL,
      "passwordHash"       TEXT NOT NULL,
      "fullName"           TEXT NOT NULL,
      "role"               TEXT NOT NULL DEFAULT 'CASHIER',
      "isActive"           INTEGER NOT NULL DEFAULT 1,
      "mustChangePassword" INTEGER NOT NULL DEFAULT 0,
      "createdAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User" ("username")`);
}

function createAdminTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "Admin" (
      "id"           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "username"     TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(table);
  return row !== undefined;
}

/** Mirrors migration v2 up() logic */
function runMigrationV2(db: DatabaseSync): void {
  createUserTable(db);

  if (!tableExists(db, 'Admin')) return;

  const admins = db.prepare(
    `SELECT "id", "username", "passwordHash" FROM "Admin"`
  ).all() as { id: number; username: string; passwordHash: string }[];

  for (const admin of admins) {
    const existing = db.prepare(
      `SELECT "id" FROM "User" WHERE "username" = ?`
    ).get(admin.username);

    if (!existing) {
      db.prepare(
        `INSERT INTO "User" ("username", "passwordHash", "fullName", "role",
                             "isActive", "mustChangePassword",
                             "createdAt", "updatedAt")
         VALUES (?, ?, ?, 'ADMIN', 1, 1,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).run(admin.username, admin.passwordHash, admin.username);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
});

afterEach(() => {
  db.close();
});

describe('Migration v2 — User table creation', () => {
  it('creates the User table when it does not exist', () => {
    expect(tableExists(db, 'User')).toBe(false);
    runMigrationV2(db);
    expect(tableExists(db, 'User')).toBe(true);
  });

  it('is idempotent — running twice does not throw', () => {
    expect(() => {
      runMigrationV2(db);
      runMigrationV2(db);
    }).not.toThrow();
  });

  it('User table has the correct columns', () => {
    runMigrationV2(db);
    const cols = db.prepare('PRAGMA table_info("User")').all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('username');
    expect(names).toContain('passwordHash');
    expect(names).toContain('fullName');
    expect(names).toContain('role');
    expect(names).toContain('isActive');
    expect(names).toContain('mustChangePassword');
    expect(names).toContain('createdAt');
    expect(names).toContain('updatedAt');
  });
});

describe('Migration v2 — Admin data migration', () => {
  it('migrates a single Admin row into User', () => {
    createAdminTable(db);
    db.prepare(
      `INSERT INTO Admin (username, passwordHash) VALUES ('admin', '$2b$10$fakehash')`
    ).run();

    runMigrationV2(db);

    const user = db.prepare(`SELECT * FROM "User" WHERE username = 'admin'`).get() as {
      username: string;
      passwordHash: string;
      role: string;
      isActive: number;
      mustChangePassword: number;
      fullName: string;
    };
    expect(user).toBeDefined();
    expect(user.username).toBe('admin');
    expect(user.passwordHash).toBe('$2b$10$fakehash');
    expect(user.role).toBe('ADMIN');
    expect(user.isActive).toBe(1);
    expect(user.mustChangePassword).toBe(1);
    expect(user.fullName).toBe('admin');
  });

  it('preserves the existing password hash exactly', () => {
    createAdminTable(db);
    const originalHash = '$2b$10$realhashabcdefghijklmnopqrstuvwxyz123456';
    db.prepare(
      `INSERT INTO Admin (username, passwordHash) VALUES ('admin', ?)`
    ).run(originalHash);

    runMigrationV2(db);

    const user = db.prepare(`SELECT passwordHash FROM "User" WHERE username = 'admin'`).get() as {
      passwordHash: string;
    };
    expect(user.passwordHash).toBe(originalHash);
  });

  it('does not duplicate a user if already migrated (idempotent)', () => {
    createAdminTable(db);
    db.prepare(
      `INSERT INTO Admin (username, passwordHash) VALUES ('admin', '$2b$10$fakehash')`
    ).run();

    runMigrationV2(db);
    runMigrationV2(db);

    const row = db.prepare(`SELECT COUNT(*) as c FROM "User" WHERE username = 'admin'`).get() as { c: number };
    expect(row.c).toBe(1);
  });

  it('does not overwrite an existing User when Admin has same username', () => {
    createAdminTable(db);
    createUserTable(db);

    db.prepare(
      `INSERT INTO "User" (username, passwordHash, fullName, role, isActive, mustChangePassword)
       VALUES ('admin', '$2b$10$existinghash', 'Admin User', 'ADMIN', 1, 0)`
    ).run();

    db.prepare(
      `INSERT INTO Admin (username, passwordHash) VALUES ('admin', '$2b$10$adminhash')`
    ).run();

    runMigrationV2(db);

    const user = db.prepare(`SELECT * FROM "User" WHERE username = 'admin'`).get() as {
      passwordHash: string;
      mustChangePassword: number;
    };
    expect(user.passwordHash).toBe('$2b$10$existinghash');
    expect(user.mustChangePassword).toBe(0);
  });

  it('migrates multiple Admin rows', () => {
    createAdminTable(db);
    db.prepare(`INSERT INTO Admin (username, passwordHash) VALUES ('admin1', '$2b$10$hash1')`).run();
    db.prepare(`INSERT INTO Admin (username, passwordHash) VALUES ('admin2', '$2b$10$hash2')`).run();

    runMigrationV2(db);

    const row = db.prepare(`SELECT COUNT(*) as c FROM "User"`).get() as { c: number };
    expect(row.c).toBe(2);
  });

  it('does nothing when Admin table does not exist (fresh install)', () => {
    expect(tableExists(db, 'Admin')).toBe(false);
    runMigrationV2(db);
    const row = db.prepare(`SELECT COUNT(*) as c FROM "User"`).get() as { c: number };
    expect(row.c).toBe(0);
  });

  it('sets role=ADMIN for all migrated Admin rows', () => {
    createAdminTable(db);
    db.prepare(`INSERT INTO Admin (username, passwordHash) VALUES ('admin', '$2b$10$hash')`).run();

    runMigrationV2(db);

    const user = db.prepare(`SELECT role FROM "User" WHERE username = 'admin'`).get() as { role: string };
    expect(user.role).toBe('ADMIN');
  });
});
