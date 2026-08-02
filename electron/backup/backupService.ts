/**
 * Backup orchestration service.
 *
 * Responsibilities:
 *  - Run scheduled backups (daily / weekly / manual).
 *  - Prevent concurrent backup jobs via a mutex.
 *  - Attempt cloud upload after each local backup.
 *  - Mark uploads as pending when offline; retry every 5 minutes.
 *  - Trigger a backup on graceful application exit.
 */
import type { PrismaClient } from '@prisma/client';
import { createLocalBackup } from './localBackup';
import { getProvider } from './registry';
import { logger } from '../logger';

type BackupTrigger = 'scheduled' | 'manual' | 'exit';

interface BackupSettings {
  schedule: 'daily' | 'weekly' | 'manual';
  cloudEnabled: boolean;
  backupOnExit: boolean;
}

class BackupService {
  private prisma: PrismaClient | null = null;
  private running = false; // mutex
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private lastScheduledRun: Date | null = null;
  private isExiting = false;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  init(prisma: PrismaClient): void {
    this.prisma = prisma;
    this.startScheduler();
    this.startRetryLoop();
    logger.info('backupService: initialised');
  }

  destroy(): void {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.scheduleTimer = null;
    this.retryTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Scheduler — checks every 5 minutes whether a scheduled backup is due.
  // ---------------------------------------------------------------------------
  private startScheduler(): void {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = setInterval(() => this.checkSchedule(), 5 * 60 * 1000);
  }

  private async checkSchedule(): Promise<void> {
    if (!this.prisma) return;
    try {
      const settings = await this.getSettings();
      if (settings.schedule === 'manual') return;

      const now = new Date();
      if (!this.lastScheduledRun) {
        // On first check, only run if it's past 22:00 local time.
        if (now.getHours() < 22) return;
      } else {
        const msSinceLast = now.getTime() - this.lastScheduledRun.getTime();
        const threshold =
          settings.schedule === 'weekly'
            ? 7 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
        if (msSinceLast < threshold) return;
      }

      this.lastScheduledRun = now;
      await this.runBackup('scheduled');
    } catch (err) {
      logger.error('backupService: scheduler error', { err });
    }
  }

  // ---------------------------------------------------------------------------
  // Retry loop — uploads pending backups every 5 minutes.
  // ---------------------------------------------------------------------------
  private startRetryLoop(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = setInterval(() => this.retryPendingUploads(), 5 * 60 * 1000);
  }

  private async retryPendingUploads(): Promise<void> {
    if (!this.prisma) return;
    try {
      const pending = await this.prisma.backupRecord.findMany({
        where: { cloudStatus: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: 5,
      });

      for (const record of pending) {
        await this.uploadRecord(record.id, record.filePath, record.filename);
      }
    } catch (err) {
      logger.warn('backupService: retry loop error', { err });
    }
  }

  // ---------------------------------------------------------------------------
  // Core backup job.
  // ---------------------------------------------------------------------------
  async runBackup(trigger: BackupTrigger): Promise<{ filename: string; cloudStatus: string }> {
    if (this.running) {
      throw new Error('A backup is already in progress. Please wait.');
    }
    if (!this.prisma) throw new Error('Backup service not initialised.');

    this.running = true;
    try {
      logger.info('backupService: starting backup', { trigger });

      const local = await createLocalBackup(this.prisma);
      const settings = await this.getSettings();

      // Record the backup in the database.
      const record = await this.prisma.backupRecord.create({
        data: {
          filename: local.filename,
          filePath: local.filePath,
          fileSizeBytes: local.fileSizeBytes,
          trigger,
          cloudStatus: settings.cloudEnabled ? 'pending' : 'none',
        },
      });

      let cloudStatus = record.cloudStatus;

      // Attempt cloud upload if enabled.
      if (settings.cloudEnabled) {
        cloudStatus = await this.uploadRecord(
          record.id,
          local.filePath,
          local.filename
        );
      }

      logger.info('backupService: backup complete', { filename: local.filename, cloudStatus });
      return { filename: local.filename, cloudStatus };
    } finally {
      this.running = false;
    }
  }

  /** Attempts to upload a backup record. Returns the new cloudStatus. */
  private async uploadRecord(
    recordId: number,
    filePath: string,
    filename: string
  ): Promise<string> {
    if (!this.prisma) return 'pending';
    try {
      const provider = getProvider();
      if (!(await provider.isAuthenticated())) return 'none';

      const result = await provider.upload(filePath, filename);
      await this.prisma.backupRecord.update({
        where: { id: recordId },
        data: { cloudStatus: 'uploaded', cloudFileId: result.fileId, errorMessage: null },
      });
      logger.info('backupService: cloud upload complete', { fileId: result.fileId });
      return 'uploaded';
    } catch (err: unknown) {
      const isOffline =
        err instanceof Error && (err as Error & { isOffline?: boolean }).isOffline === true;
      const msg = err instanceof Error ? err.message : String(err);

      if (isOffline) {
        logger.warn('backupService: offline — upload marked pending', { filename });
        await this.prisma.backupRecord.update({
          where: { id: recordId },
          data: { cloudStatus: 'pending', errorMessage: 'Offline — will retry.' },
        });
        return 'pending';
      }

      logger.error('backupService: cloud upload failed', { filename, error: msg });
      await this.prisma.backupRecord.update({
        where: { id: recordId },
        data: { cloudStatus: 'failed', errorMessage: msg },
      });
      return 'failed';
    }
  }

  // ---------------------------------------------------------------------------
  // Exit backup — called by main.ts before app.quit().
  // ---------------------------------------------------------------------------
  async runExitBackup(): Promise<void> {
    if (this.isExiting) return;
    this.isExiting = true;
    if (!this.prisma) return;
    try {
      const settings = await this.getSettings();
      if (!settings.backupOnExit) return;
      await this.runBackup('exit');
    } catch (err) {
      logger.error('backupService: exit backup failed', { err });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers.
  // ---------------------------------------------------------------------------
  private async getSettings(): Promise<BackupSettings> {
    if (!this.prisma) return { schedule: 'daily', cloudEnabled: false, backupOnExit: true };
    const s = await this.prisma.settings.findUnique({ where: { id: 1 } });
    return {
      schedule: (s?.backupSchedule ?? 'daily') as BackupSettings['schedule'],
      cloudEnabled: s?.cloudBackupEnabled ?? false,
      backupOnExit: s?.backupOnExit ?? true,
    };
  }

  isRunning(): boolean {
    return this.running;
  }
}

export const backupService = new BackupService();
