import { ipcMain } from 'electron';
import { handle } from './util';
import { printService } from '../services/printService';

/**
 * Registers the print IPC handler.
 *
 * Migrated to the handle() wrapper for consistency with all other handlers.
 * No requiredRole — any authenticated user can print receipts.
 */
export function registerPrintHandlers(): void {
  ipcMain.removeHandler('print:receipt');
  handle('print:receipt', async (_event, html: string) => printService.print(html));
}
