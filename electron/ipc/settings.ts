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
  logoPath?: string | null;
  currencyCode?: string;
  receiptShowLogo?: boolean;
  serviceChargePresets?: string | null; // JSON array of numbers, e.g. "[50,100,150]"
  googleReviewUrl?: string | null;
  googleReviewOnReceipt?: boolean;
}

async function ensureSettings() {
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export function registerSettingsHandlers() {
  // Read — unrestricted. Cashiers need currency symbol, tax rate, paper size.
  handle('settings:get', async (_event) => ensureSettings());

  // Write — ADMIN only.
  handle('settings:update', async (_event, data: SettingsInput) => {
    if (data.taxPercentage != null && data.taxPercentage < 0) {
      throw new Error('Tax percentage cannot be negative.');
    }
    if (data.receiptPaperSize != null && !['80mm', 'A4'].includes(data.receiptPaperSize)) {
      throw new Error('Invalid paper size. Must be "80mm" or "A4".');
    }
    if (data.backupSchedule != null && !['daily', 'weekly', 'manual'].includes(data.backupSchedule)) {
      throw new Error('Invalid backup schedule.');
    }
    if (data.serviceChargePresets) {
      try {
        const parsed = JSON.parse(data.serviceChargePresets);
        if (!Array.isArray(parsed) || !parsed.every((n) => typeof n === 'number' && n >= 0)) {
          throw new Error();
        }
      } catch {
        throw new Error('Service charge presets must be a list of non-negative numbers.');
      }
    }
    if (data.googleReviewUrl && !/^https?:\/\//i.test(data.googleReviewUrl.trim())) {
      throw new Error('Google Review URL must start with http:// or https://');
    }

    await ensureSettings();
    return prisma.settings.update({
      where: { id: 1 },
      data: {
        restaurantName: data.restaurantName?.trim(),
        address: data.address?.trim(),
        phone: data.phone?.trim(),
        taxPercentage: data.taxPercentage,
        currencySymbol: data.currencySymbol?.trim() || 'Rs',
        receiptFooter: data.receiptFooter,
        darkMode: data.darkMode,
        receiptPaperSize: data.receiptPaperSize,
        backupSchedule: data.backupSchedule,
        backupOnExit: data.backupOnExit,
        cloudBackupEnabled: data.cloudBackupEnabled,
        logoPath: data.logoPath,
        currencyCode: data.currencyCode?.trim() || undefined,
        receiptShowLogo: data.receiptShowLogo,
        serviceChargePresets: data.serviceChargePresets,
        googleReviewUrl: data.googleReviewUrl?.trim() || null,
        googleReviewOnReceipt: data.googleReviewOnReceipt,
      },
    });
  }, { requiredRole: 'ADMIN' });
}
