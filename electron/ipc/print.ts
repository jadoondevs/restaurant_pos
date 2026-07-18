import { BrowserWindow } from 'electron';
import { handle } from './util';

/**
 * Prints a receipt by loading the provided HTML into a hidden, 80mm-wide
 * BrowserWindow and invoking Electron's silent print. Works with thermal
 * printers set as the system default printer.
 */
export function registerPrintHandlers() {
  handle('print:receipt', async (html: string) => {
    const printWindow = new BrowserWindow({
      show: false,
      width: 320, // ~80mm at 96dpi
      webPreferences: { sandbox: true },
    });

    await printWindow.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    );

    await new Promise<void>((resolve, reject) => {
      printWindow.webContents.print(
        {
          silent: false, // show the print dialog so any printer can be chosen
          printBackground: true,
          margins: { marginType: 'none' },
        },
        (success, failureReason) => {
          if (!success && failureReason && failureReason !== 'cancelled') {
            reject(new Error(failureReason));
          } else {
            resolve();
          }
        }
      );
    });

    printWindow.close();
    return { success: true };
  });
}
