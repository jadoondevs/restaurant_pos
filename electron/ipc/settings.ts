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
      },
    });
  });
}
