import { shell } from 'electron';
import { handle } from './util';
import { backupService } from '../backup/backupService';
import { restoreService } from '../backup/restoreService';
import { validateBackup } from '../backup/restoreService';
import { listLocalBackups, getDbSizeBytes } from '../backup/localBackup';
import { getProvider } from '../backup/registry';
import { getBackupDir } from '../paths';
import prisma from '../database/client';
import { logger } from '../logger';

export function registerBackupHandlers(): void {
  // -------------------------------------------------------------------------
  // Status — everything the UI needs to render the Backup section.
  // -------------------------------------------------------------------------
  handle('backup:status', async () => {
    const provider = getProvider();
    const isAuthenticated = await provider.isAuthenticated();
    const account = isAuthenticated ? await provider.getAccount() : null;

    const lastLocal = await prisma.backupRecord.findFirst({
      where: { cloudStatus: { not: 'none' } },
      orderBy: { createdAt: 'desc' },
    }) ?? await prisma.backupRecord.findFirst({ orderBy: { createdAt: 'desc' } });

    const lastCloud = await prisma.backupRecord.findFirst({
      where: { cloudStatus: 'uploaded' },
      orderBy: { createdAt: 'desc' },
    });

    const pendingCount = await prisma.backupRecord.count({
      where: { cloudStatus: 'pending' },
    });

    const localBackups = listLocalBackups();
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });

    return {
      cloudConnected: isAuthenticated,
      cloudAccount: account,
      providerName: provider.name,
      lastLocalBackup: lastLocal?.createdAt ?? null,
      lastCloudBackup: lastCloud?.createdAt ?? null,
      pendingUploads: pendingCount,
      backupFolder: getBackupDir(),
      dbSizeBytes: getDbSizeBytes(),
      localBackupCount: localBackups.length,
      backupSchedule: settings?.backupSchedule ?? 'daily',
      backupOnExit: settings?.backupOnExit ?? true,
      cloudBackupEnabled: settings?.cloudBackupEnabled ?? false,
      isRunning: backupService.isRunning(),
    };
  });

  // -------------------------------------------------------------------------
  // List local backups.
  // -------------------------------------------------------------------------
  handle('backup:list', async () => listLocalBackups());

  // -------------------------------------------------------------------------
  // Manual backup now.
  // -------------------------------------------------------------------------
  handle('backup:now', async () => {
    const result = await backupService.runBackup('manual');
    return result;
  });

  // -------------------------------------------------------------------------
  // Validate a backup file before restore.
  // -------------------------------------------------------------------------
  handle('backup:validate', async (filePath: string) => {
    return validateBackup(filePath);
  });

  // -------------------------------------------------------------------------
  // Restore from a local backup file path.
  // -------------------------------------------------------------------------
  handle('backup:restore', async (filePath: string) => {
    logger.info('backup:restore IPC called', { filePath });
    // restoreService.restoreBackup disconnects Prisma and restarts the app.
    await restoreService.restoreBackup(filePath, prisma);
    return { success: true };
  });

  // -------------------------------------------------------------------------
  // Connect Google Drive.
  // -------------------------------------------------------------------------
  handle('backup:connectCloud', async () => {
    const provider = getProvider();
    const account = await provider.authenticate();
    return account;
  });

  // -------------------------------------------------------------------------
  // Disconnect Google Drive.
  // -------------------------------------------------------------------------
  handle('backup:disconnectCloud', async () => {
    const provider = getProvider();
    await provider.disconnect();
    return { success: true };
  });

  // -------------------------------------------------------------------------
  // Open the backup folder in the OS file explorer.
  // -------------------------------------------------------------------------
  handle('backup:openFolder', async () => {
    await shell.openPath(getBackupDir());
    return { success: true };
  });

  // -------------------------------------------------------------------------
  // Retry all pending cloud uploads immediately.
  // -------------------------------------------------------------------------
  handle('backup:retryUploads', async () => {
    const pending = await prisma.backupRecord.findMany({
      where: { cloudStatus: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    const provider = getProvider();
    if (!(await provider.isAuthenticated())) {
      throw new Error('Not connected to cloud storage.');
    }

    let uploaded = 0;
    for (const record of pending) {
      try {
        const result = await provider.upload(record.filePath, record.filename);
        await prisma.backupRecord.update({
          where: { id: record.id },
          data: { cloudStatus: 'uploaded', cloudFileId: result.fileId, errorMessage: null },
        });
        uploaded++;
      } catch (err) {
        logger.warn('backup:retryUploads: upload failed', { id: record.id, err });
      }
    }

    return { uploaded, total: pending.length };
  });

  // -------------------------------------------------------------------------
  // Update backup schedule settings.
  // -------------------------------------------------------------------------
  handle(
    'backup:updateSchedule',
    async (data: {
      backupSchedule?: string;
      backupOnExit?: boolean;
      cloudBackupEnabled?: boolean;
    }) => {
      await prisma.settings.update({
        where: { id: 1 },
        data: {
          ...(data.backupSchedule !== undefined && { backupSchedule: data.backupSchedule }),
          ...(data.backupOnExit !== undefined && { backupOnExit: data.backupOnExit }),
          ...(data.cloudBackupEnabled !== undefined && { cloudBackupEnabled: data.cloudBackupEnabled }),
        },
      });
      return { success: true };
    }
  );
}
