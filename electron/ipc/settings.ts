import prisma from '../database/client';
import { handle } from './util';

interface SettingsInput {
  restaurantName?: string;
  address?: string;
  phone?: string;
  taxPercentage?: number;
  currencySymbol?: string;
  receiptFooter?: string;
  darkMode?: boolean;
  receiptPaperSize?: string;
  backupSchedule?: string;
  backupOnExit?: boolean;
  cloudBackupEnabled?: boolean;
}

/** Ensures the singleton settings row (id = 1) always exists. */
async function ensureSettings() {
  return prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

export function registerSettingsHandlers() {
  handle('settings:get', async () => ensureSettings());

  handle('settings:update', async (data: SettingsInput) => {
    if (data.taxPercentage != null && data.taxPercentage < 0) {
      throw new Error('Tax percentage cannot be negative.');
    }
    if (
      data.receiptPaperSize != null &&
      !['80mm', 'A4'].includes(data.receiptPaperSize)
    ) {
      throw new Error('Invalid paper size. Must be "80mm" or "A4".');
    }
    if (
      data.backupSchedule != null &&
      !['daily', 'weekly', 'manual'].includes(data.backupSchedule)
    ) {
      throw new Error('Invalid backup schedule.');
    }

    await ensureSettings();
    return prisma.settings.update({
      where: { id: 1 },
      data: {
        restaurantName: data.restaurantName?.trim(),
        address: data.address?.trim(),
        phone: data.phone?.trim(),
        taxPercentage: data.taxPercentage,
        currencySymbol: data.currencySymbol?.trim() || '$',
        receiptFooter: data.receiptFooter,
        darkMode: data.darkMode,
        receiptPaperSize: data.receiptPaperSize,
        backupSchedule: data.backupSchedule,
        backupOnExit: data.backupOnExit,
        cloudBackupEnabled: data.cloudBackupEnabled,
      },
    });
  });
}
