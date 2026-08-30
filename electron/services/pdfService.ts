/**
 * Report-to-PDF service (follow-up batch after Batch 11 — Priority 9).
 *
 * Deliberately separate from printService.ts: that service owns the
 * receipt-printing queue the whole POS checkout flow depends on, and this
 * must never share its window or its job queue — a slow/large report PDF
 * generation must never be able to block or interleave with a receipt
 * print job at the till.
 *
 * Uses Electron's built-in webContents.printToPDF() — no new dependency,
 * works fully offline, same approach as the existing receipt HTML-string
 * pattern (src/utils/receipt.ts) rendered through a hidden BrowserWindow.
 */
import { BrowserWindow } from 'electron';
import { logger } from '../logger';

class PdfService {
  private window: BrowserWindow | null = null;
  private queue: Promise<void> = Promise.resolve();
  private destroyed = false;

  private getWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    this.window = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    this.window.on('close', (e) => {
      if (!this.destroyed) {
        e.preventDefault();
        this.window?.hide();
      }
    });

    return this.window;
  }

  /** Renders a self-contained HTML report string to PDF bytes. */
  generatePdf(html: string): Promise<Buffer> {
    if (this.destroyed) {
      return Promise.reject(new Error('PDF service has been shut down.'));
    }

    const job = new Promise<Buffer>((resolve, reject) => {
      this.queue = this.queue.then(() => this.runJob(html, resolve, reject));
    });
    return job;
  }

  private async runJob(
    html: string,
    resolve: (buf: Buffer) => void,
    reject: (err: Error) => void
  ): Promise<void> {
    if (this.destroyed) {
      reject(new Error('PDF service has been shut down.'));
      return;
    }
    try {
      const win = this.getWindow();
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const buffer = await win.webContents.printToPDF({
        printBackground: true,
        landscape: false,
        pageSize: 'A4',
        margins: { marginType: 'default' },
      });
      logger.info('pdfService: PDF generated', { bytes: buffer.length });
      resolve(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('pdfService: generation failed', { error: msg });
      reject(err instanceof Error ? err : new Error(msg));
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
    logger.info('pdfService: destroyed');
  }
}

export const pdfService = new PdfService();
