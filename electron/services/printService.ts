/**
 * Production print service.
 *
 * Fixes the "print dialog stops opening after several prints" bug by reusing
 * a single hidden BrowserWindow instead of creating a new one per job.
 * Jobs are serialised through a promise chain so dialogs never overlap.
 *
 * Batch 10 print-quality fix — diagnosed against a real BIXOLON SRP-350III:
 * the printer's own Windows self-test page and Notepad print crisp/dark,
 * but receipts from this app printed faint/dull. The printer, paper, and
 * driver were confirmed fine, which points at how Chromium hands the job
 * to the driver rather than the hardware. `webContents.print()` never set
 * `color`, so it defaulted to color/RGB mode — a monochrome thermal driver
 * then has to convert that through its grayscale-halftone (photo) path,
 * which dithers anti-aliased text into a sparse, lighter dot pattern
 * instead of the driver's solid-black text-mode threshold Notepad/the
 * self-test get. Forcing `color: false` requests true monochrome printing,
 * and `scaleFactor: 100` avoids any implicit fit-to-page downscale adding
 * further blur. See buildPrintOptions() below and receipt.ts's bolder
 * default weight for the CSS half of this fix.
 */
import { BrowserWindow } from 'electron';
import { logger } from '../logger';

export type PrintStatus = 'printed' | 'cancelled' | 'failed';

export interface PrintResult {
  status: PrintStatus;
  error?: string;
}

export interface PrinterInfo {
  name: string; // system-defined name — pass back as deviceName, never the display label
  displayName: string;
  isDefault: boolean;
}

const PRINT_TIMEOUT_MS = 60_000;

/**
 * Builds the WebContents.print() options object. Pulled out as a pure
 * function so the darkness/scale/silent-mode fix is unit-testable without
 * Electron (see tests/printService.test.ts).
 *
 * deviceName === null means "no printer configured yet" — falls back to
 * the original silent:false OS dialog exactly as before this batch, so an
 * un-configured install behaves identically to pre-Batch-10.
 */
export function buildPrintOptions(deviceName: string | null): Electron.WebContentsPrintOptions {
  return {
    silent: deviceName != null,
    ...(deviceName != null ? { deviceName } : {}),
    printBackground: true,
    margins: { marginType: 'none' },
    color: false,
    scaleFactor: 100,
  };
}

class PrintService {
  private window: BrowserWindow | null = null;
  private queue: Promise<void> = Promise.resolve();
  private destroyed = false;

  // ---------------------------------------------------------------------------
  // Lazy-create the hidden print window. Recreate it if it was destroyed.
  // ---------------------------------------------------------------------------
  private getWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    this.window = new BrowserWindow({
      show: false,
      width: 400,
      height: 600,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Hide instead of closing when the window receives a close event during
    // normal operation. During app shutdown, destroy() is called explicitly
    // so this handler is never reached.
    this.window.on('close', (e) => {
      if (!this.destroyed) {
        e.preventDefault();
        this.window?.hide();
      }
    });

    return this.window;
  }

  // ---------------------------------------------------------------------------
  // Lists installed printers so Settings can offer a deviceName picker.
  // ---------------------------------------------------------------------------
  async listPrinters(): Promise<PrinterInfo[]> {
    const win = this.getWindow();
    const printers = await win.webContents.getPrintersAsync();
    return printers.map((p) => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault }));
  }

  // ---------------------------------------------------------------------------
  // Print a single HTML receipt. Returns a structured result — never throws.
  //
  // deviceName: the system printer name saved in Settings (Batch 10 silent
  // auto-print). Null/undefined preserves the original silent:false dialog
  // behavior exactly — nothing changes for an install that hasn't picked a
  // printer yet.
  // ---------------------------------------------------------------------------
  print(html: string, deviceName: string | null = null): Promise<PrintResult> {
    if (this.destroyed) {
      return Promise.resolve({ status: 'failed', error: 'Print service has been shut down.' });
    }

    const job = new Promise<PrintResult>((resolve) => {
      this.queue = this.queue.then(() => this.runJob(html, deviceName, resolve));
    });
    return job;
  }

  private async runJob(
    html: string,
    deviceName: string | null,
    resolve: (result: PrintResult) => void
  ): Promise<void> {
    if (this.destroyed) {
      resolve({ status: 'failed', error: 'Print service has been shut down.' });
      return;
    }

    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const settle = (result: PrintResult) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve(result);
    };

    try {
      const win = this.getWindow();

      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

      timeoutHandle = setTimeout(() => {
        logger.warn('printService: print job timed out');
        settle({ status: 'failed', error: 'Print timed out.' });
      }, PRINT_TIMEOUT_MS);

      win.webContents.print(
        buildPrintOptions(deviceName),
        (success, failureReason) => {
          if (success) {
            logger.info('printService: print succeeded');
            settle({ status: 'printed' });
          } else if (failureReason === 'cancelled') {
            logger.info('printService: print cancelled by user');
            settle({ status: 'cancelled' });
          } else {
            const msg = failureReason ?? 'Unknown print error';
            logger.error('printService: print failed', { reason: msg });
            settle({ status: 'failed', error: msg });
          }
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('printService: unexpected error', { error: msg });
      settle({ status: 'failed', error: msg });
    }
  }

  // ---------------------------------------------------------------------------
  // Called by main.ts during graceful shutdown.
  // Sets the destroyed flag first so the close-event handler does not
  // preventDefault, then destroys the window unconditionally.
  // ---------------------------------------------------------------------------
  destroy(): void {
    this.destroyed = true;
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
    logger.info('printService: destroyed');
  }
}

export const printService = new PrintService();
