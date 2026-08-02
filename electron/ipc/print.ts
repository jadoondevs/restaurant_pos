import { ipcMain } from 'electron';
import { printService } from '../services/printService';

/**
 * Registers the print IPC handler.
 *
 * Returns a structured result so the renderer can distinguish between
 * a successful print, a user cancellation, and a hardware/driver failure.
 *
 * The handler is registered idempotently — safe to call multiple times
 * (though registerIpcHandlers only calls it once).
 */
export function registerPrintHandlers(): void {
  // Remove any previously registered handler to prevent duplicates.
  ipcMain.removeHandler('print:receipt');

  ipcMain.handle('print:receipt', async (_event, html: string) => {
    try {
      const result = await printService.print(html);
      return { ok: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected print error';
      return { ok: false, error: message };
    }
  });
}
