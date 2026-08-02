/**
 * Production print service.
 *
 * Fixes the "print dialog stops opening after several prints" bug by reusing
 * a single hidden BrowserWindow instead of creating a new one per job.
 * Jobs are serialised through a promise chain so dialogs never overlap.
 */
import { BrowserWindow, app } from 'electron';
import { logger } from '../logger';

export type PrintStatus = 'printed' | 'cancelled' | 'failed';

export interface PrintResult {
  status: PrintStatus;
  error?: string;
}

const PRINT_TIMEOUT_MS = 60_000; // 60 s — enough for any dialog interaction

class PrintService {
  private window: BrowserWindow | null = null;
  // Serialise jobs: each job waits for the previous promise to settle.
  private queue: Promise<void> = Promise.resolve();

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

    // Prevent the window from being shown if the user somehow triggers it.
    this.window.on('close', (e) => {
      if (!app.isQuitting) {
        e.preventDefault();
        this.window?.hide();
      }
    });

    return this.window;
  }

  // ---------------------------------------------------------------------------
  // Print a single HTML receipt. Returns a structured result — never throws.
  // ---------------------------------------------------------------------------
  print(html: string): Promise<PrintResult> {
    // Chain onto the existing queue so jobs run one at a time.
    const job = new Promise<PrintResult>((resolve) => {
      this.queue = this.queue.then(() => this.runJob(html, resolve));
    });
    return job;
  }

  private async runJob(
    html: string,
    resolve: (result: PrintResult) => void
  ): Promise<void> {
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

      // Load the receipt HTML via data URL.
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

      // Timeout guard — if the print callback never fires, resolve as failed.
      timeoutHandle = setTimeout(() => {
        logger.warn('printService: print job timed out');
        settle({ status: 'failed', error: 'Print timed out.' });
      }, PRINT_TIMEOUT_MS);

      win.webContents.print(
        {
          silent: false,
          printBackground: true,
          margins: { marginType: 'none' },
        },
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
  // Call on app quit to destroy the window cleanly.
  // ---------------------------------------------------------------------------
  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
  }
}

// Singleton — one instance for the lifetime of the app.
export const printService = new PrintService();
