/**
 * Database version detection tests.
 *
 * Verifies PRAGMA user_version read/write behaviour and the version-gating
 * logic that decides which migrations to run.
 * Uses Node's built-in `node:sqlite` module (Node 22.5+).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

function setUserVersion(db: DatabaseSync, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`);
}

function pendingMigrations(
  currentVersion: number,
  migrations: { version: number }[]
): { version: number }[] {
  return migrations.filter((m) => m.version > currentVersion);
}

let db: DatabaseSync;

beforeEach(() => { db = new DatabaseSync(':memory:'); });
afterEach(() => { db.close(); });

describe('Database version detection', () => {
  it('fresh database has user_version 0', () => {
    expect(readUserVersion(db)).toBe(0);
  });

  it('sets and reads user_version correctly', () => {
    setUserVersion(db, 1);
    expect(readUserVersion(db)).toBe(1);
  });

  it('can advance version multiple times', () => {
    setUserVersion(db, 1);
    setUserVersion(db, 2);
    setUserVersion(db, 3);
    expect(readUserVersion(db)).toBe(3);
  });

  it('identifies all migrations as pending on a fresh database', () => {
    const migrations = [{ version: 1 }, { version: 2 }, { version: 3 }];
    const pending = pendingMigrations(0, migrations);
    expect(pending).toHaveLength(3);
  });

  it('identifies no migrations as pending when up-to-date', () => {
    const migrations = [{ version: 1 }];
    const pending = pendingMigrations(1, migrations);
    expect(pending).toHaveLength(0);
  });

  it('identifies only newer migrations as pending', () => {
    const migrations = [{ version: 1 }, { version: 2 }, { version: 3 }];
    const pending = pendingMigrations(1, migrations);
    expect(pending.map((m) => m.version)).toEqual([2, 3]);
  });

  it('handles version higher than known migrations gracefully', () => {
    const migrations = [{ version: 1 }];
    const pending = pendingMigrations(5, migrations);
    expect(pending).toHaveLength(0);
  });
});
