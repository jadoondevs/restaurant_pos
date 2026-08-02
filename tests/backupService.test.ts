/**
 * Backup service logic tests.
 *
 * Tests the scheduling logic, retention policy, and filename generation
 * without requiring Electron, a real filesystem, or Google Drive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Filename generation (mirrors localBackup.ts logic)
// ---------------------------------------------------------------------------
function buildFilename(now: Date, existingFiles: string[]): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = [
    'backup',
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()) + pad(now.getMinutes()),
  ].join('-');

  let filename = `${base}.db`;
  let counter = 1;
  while (existingFiles.includes(filename)) {
    filename = `${base}-${counter}.db`;
    counter++;
  }
  return filename;
}

// ---------------------------------------------------------------------------
// Retention policy (mirrors localBackup.ts pruneOldBackups logic)
// ---------------------------------------------------------------------------
const MAX_LOCAL_BACKUPS = 30;

function pruneBackups(files: { name: string; mtime: number }[]): string[] {
  const sorted = [...files].sort((a, b) => a.mtime - b.mtime); // oldest first
  const excess = sorted.length - MAX_LOCAL_BACKUPS;
  if (excess <= 0) return [];
  return sorted.slice(0, excess).map((f) => f.name);
}

// ---------------------------------------------------------------------------
// Scheduling logic (mirrors backupService.ts checkSchedule)
// ---------------------------------------------------------------------------
function shouldRunScheduledBackup(
  schedule: 'daily' | 'weekly' | 'manual',
  lastRun: Date | null,
  now: Date
): boolean {
  if (schedule === 'manual') return false;
  if (!lastRun) {
    return now.getHours() >= 22;
  }
  const msSinceLast = now.getTime() - lastRun.getTime();
  const threshold = schedule === 'weekly'
    ? 7 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  return msSinceLast >= threshold;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Backup service', () => {
  describe('Filename generation', () => {
    it('generates a timestamped filename', () => {
      const now = new Date('2026-08-02T22:00:00');
      const name = buildFilename(now, []);
      expect(name).toBe('backup-2026-08-02-2200.db');
    });

    it('adds a suffix when the filename already exists', () => {
      const now = new Date('2026-08-02T22:00:00');
      const existing = ['backup-2026-08-02-2200.db'];
      const name = buildFilename(now, existing);
      expect(name).toBe('backup-2026-08-02-2200-1.db');
    });

    it('increments suffix until unique', () => {
      const now = new Date('2026-08-02T22:00:00');
      const existing = [
        'backup-2026-08-02-2200.db',
        'backup-2026-08-02-2200-1.db',
        'backup-2026-08-02-2200-2.db',
      ];
      const name = buildFilename(now, existing);
      expect(name).toBe('backup-2026-08-02-2200-3.db');
    });
  });

  describe('Retention policy', () => {
    it('does not prune when under the limit', () => {
      const files = Array.from({ length: 29 }, (_, i) => ({
        name: `backup-${i}.db`,
        mtime: i,
      }));
      expect(pruneBackups(files)).toHaveLength(0);
    });

    it('does not prune exactly at the limit', () => {
      const files = Array.from({ length: 30 }, (_, i) => ({
        name: `backup-${i}.db`,
        mtime: i,
      }));
      expect(pruneBackups(files)).toHaveLength(0);
    });

    it('prunes the oldest file when over the limit by 1', () => {
      const files = Array.from({ length: 31 }, (_, i) => ({
        name: `backup-${i}.db`,
        mtime: i,
      }));
      const pruned = pruneBackups(files);
      expect(pruned).toHaveLength(1);
      expect(pruned[0]).toBe('backup-0.db'); // oldest
    });

    it('prunes multiple oldest files when significantly over limit', () => {
      const files = Array.from({ length: 35 }, (_, i) => ({
        name: `backup-${i}.db`,
        mtime: i,
      }));
      const pruned = pruneBackups(files);
      expect(pruned).toHaveLength(5);
      expect(pruned).toEqual(['backup-0.db', 'backup-1.db', 'backup-2.db', 'backup-3.db', 'backup-4.db']);
    });
  });

  describe('Scheduling logic', () => {
    it('never runs when schedule is manual', () => {
      const now = new Date('2026-08-02T23:00:00');
      expect(shouldRunScheduledBackup('manual', null, now)).toBe(false);
    });

    it('does not run on first check before 22:00', () => {
      const now = new Date('2026-08-02T21:59:00');
      expect(shouldRunScheduledBackup('daily', null, now)).toBe(false);
    });

    it('runs on first check at or after 22:00', () => {
      const now = new Date('2026-08-02T22:00:00');
      expect(shouldRunScheduledBackup('daily', null, now)).toBe(true);
    });

    it('does not run daily backup before 24h have elapsed', () => {
      const lastRun = new Date('2026-08-02T22:00:00');
      const now = new Date('2026-08-03T21:59:00'); // 23h59m later
      expect(shouldRunScheduledBackup('daily', lastRun, now)).toBe(false);
    });

    it('runs daily backup after 24h have elapsed', () => {
      const lastRun = new Date('2026-08-02T22:00:00');
      const now = new Date('2026-08-03T22:00:00'); // exactly 24h later
      expect(shouldRunScheduledBackup('daily', lastRun, now)).toBe(true);
    });

    it('does not run weekly backup before 7 days have elapsed', () => {
      const lastRun = new Date('2026-08-02T22:00:00');
      const now = new Date('2026-08-09T21:59:00'); // 6d23h59m later
      expect(shouldRunScheduledBackup('weekly', lastRun, now)).toBe(false);
    });

    it('runs weekly backup after 7 days have elapsed', () => {
      const lastRun = new Date('2026-08-02T22:00:00');
      const now = new Date('2026-08-09T22:00:00'); // exactly 7 days later
      expect(shouldRunScheduledBackup('weekly', lastRun, now)).toBe(true);
    });
  });
});
