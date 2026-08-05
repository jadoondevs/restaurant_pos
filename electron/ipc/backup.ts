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
  // Read-only — unrestricted.
  handle('backup:status', async (_event) => {
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

    const pendingCount = await prisma.backupRecord.count({ where: { cloudStatus: 'pending' } });
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

  handle('backup:list', async (_event) => listLocalBackups());
  handle('backup:validate', async (_event, filePath: string) => validateBackup(filePath));
  handle('backup:openFolder', async (_event) => {
    await shell.openPath(getBackupDir());
    return { success: true };
  });

  // Mutating operations — ADMIN only.
  handle('backup:now', async (_event) => backupService.runBackup('manual'), { requiredRole: 'ADMIN' });

  handle('backup:restore', async (_event, filePath: string) => {
    logger.info('backup:restore IPC called', { filePath });
    await restoreService.restoreBackup(filePath, prisma);
    return { success: true };
  }, { requiredRole: 'ADMIN' });

  handle('backup:connectCloud', async (_event) => {
    return getProvider().authenticate();
  }, { requiredRole: 'ADMIN' });

  handle('backup:disconnectCloud', async (_event) => {
    await getProvider().disconnect();
    return { success: true };
  }, { requiredRole: 'ADMIN' });

  handle('backup:retryUploads', async (_event) => {
    const pending = await prisma.backupRecord.findMany({
      where: { cloudStatus: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    const provider = getProvider();
    if (!(await provider.isAuthenticated())) throw new Error('Not connected to cloud storage.');

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
  }, { requiredRole: 'ADMIN' });

  handle(
    'backup:updateSchedule',
    async (_event, data: { backupSchedule?: string; backupOnExit?: boolean; cloudBackupEnabled?: boolean }) => {
      await prisma.settings.update({
        where: { id: 1 },
        data: {
          ...(data.backupSchedule !== undefined && { backupSchedule: data.backupSchedule }),
          ...(data.backupOnExit !== undefined && { backupOnExit: data.backupOnExit }),
          ...(data.cloudBackupEnabled !== undefined && { cloudBackupEnabled: data.cloudBackupEnabled }),
        },
      });
      return { success: true };
    },
    { requiredRole: 'ADMIN' }
  );
}
