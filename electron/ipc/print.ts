import { ipcMain } from 'electron';
import { handle } from './util';
import { printService } from '../services/printService';
import { pdfService } from '../services/pdfService';
import prisma from '../database/client';

/**
 * Registers the print IPC handlers.
 *
 * Migrated to the handle() wrapper for consistency with all other handlers.
 * No requiredRole — any authenticated user can print receipts.
 */
export function registerPrintHandlers(): void {
  ipcMain.removeHandler('print:receipt');
  handle('print:receipt', async (_event, html: string) => {
    // Read the configured printer fresh on every job (not cached) so a
    // Settings change takes effect on the very next print, no restart
    // needed. Falls back to the original silent:false dialog when no
    // printer has been chosen (settings.printerDeviceName is null).
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    return printService.print(html, settings?.printerDeviceName ?? null);
  });

  ipcMain.removeHandler('print:listPrinters');
  handle('print:listPrinters', async (_event) => printService.listPrinters());

  // Report-to-PDF (follow-up batch, Priority 9) — MANAGER and above, matching
  // the Reports page's own access level. Returns base64 so the renderer can
  // trigger a download the same way it already does for CSV (Blob + <a download>).
  ipcMain.removeHandler('reports:generatePdf');
  handle(
    'reports:generatePdf',
    async (_event, html: string) => {
      const buffer = await pdfService.generatePdf(html);
      return buffer.toString('base64');
    },
    { requiredRole: 'MANAGER' }
  );
}
