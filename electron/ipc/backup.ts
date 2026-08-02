import { shell } from 'electron';
import { handle } from './util';
import { backupService } from '../backup/backupService';
import { restoreService, validateBackup } from '../backup/restoreService';
import { listLocalBackups, getDbSizeBytes } from '../backup/localBackup';
import { getProvider } from '../backup/registry';
import { getBackupDir } from '../paths';
import prisma from '../database/client';
import { logger } from '../logger';

export function registerBackupHandlers(): void {
  handle('backup:status', async () => {
    const provider = getProvider();
    const isAuthenticated = await provider.isAuthenticated();
    const account = isAuthenticated ? await provider.getAccount() : null;

    const lastLocal =
      (await prisma.backupRecord.findFirst({
        where: { cloudStatus: { not: 'none' } },
        orderBy: { createdAt: 'desc' },
      })) ??
      (await prisma.backupRecord.findFirst({ orderBy: { createdAt: 'desc' } }));

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

  handle('backup:list', async () => listLocalBackups());

  handle('backup:now', async () => backupService.runBackup('manual'));

  handle('backup:validate', async (filePath: string) => validateBackup(filePath));

  handle('backup:restore', async (filePath: string) => {
    logger.info('backup:restore IPC called', { filePath });
    await restoreService.restoreBackup(filePath, prisma);
    return { success: true };
  });

  handle('backup:connectCloud', async () => {
    const provider = getProvider();
    return provider.authenticate();
  });

  handle('backup:disconnectCloud', async () => {
    await getProvider().disconnect();
    return { success: true };
  });

  handle('backup:openFolder', async () => {
    await shell.openPath(getBackupDir());
    return { success: true };
  });

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
          ...(data.cloudBackupEnabled !== undefined && {
            cloudBackupEnabled: data.cloudBackupEnabled,
          }),
        },
      });
      return { success: true };
    }
  );
}
