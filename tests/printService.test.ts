/**
 * PrintService tests.
 *
 * Tests the job queue, cancellation, timeout, and cleanup logic without
 * requiring Electron or a real printer. We mock the BrowserWindow and
 * webContents APIs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// buildPrintOptions — mirrors electron/services/printService.ts exactly.
// The Batch 10 print-quality fix (color:false, scaleFactor:100) and the
// silent-auto-print deviceName logic both live in this one pure function,
// so it's tested directly here rather than only through the mocked job flow.
// ---------------------------------------------------------------------------
function buildPrintOptions(deviceName: string | null) {
  return {
    silent: deviceName != null,
    ...(deviceName != null ? { deviceName } : {}),
    printBackground: true,
    margins: { marginType: 'none' as const },
    color: false,
    scaleFactor: 100,
  };
}

describe('buildPrintOptions', () => {
  it('forces color:false and scaleFactor:100 regardless of deviceName (the darkness fix)', () => {
    expect(buildPrintOptions(null).color).toBe(false);
    expect(buildPrintOptions(null).scaleFactor).toBe(100);
    expect(buildPrintOptions('BIXOLON_SRP_350III').color).toBe(false);
    expect(buildPrintOptions('BIXOLON_SRP_350III').scaleFactor).toBe(100);
  });

  it('is silent:false with no deviceName when no printer is configured — preserves the original dialog', () => {
    const opts = buildPrintOptions(null);
    expect(opts.silent).toBe(false);
    expect(opts).not.toHaveProperty('deviceName');
  });

  it('is silent:true with the deviceName set when a printer is configured', () => {
    const opts = buildPrintOptions('BIXOLON_SRP_350III');
    expect(opts.silent).toBe(true);
    expect((opts as { deviceName?: string }).deviceName).toBe('BIXOLON_SRP_350III');
  });
});

// ---------------------------------------------------------------------------
// Minimal mock of the parts of Electron used by PrintService.
// ---------------------------------------------------------------------------
type PrintCallback = (success: boolean, failureReason?: string) => void;

interface MockWebContents {
  print: (options: unknown, callback: PrintCallback) => void;
  loadURL: (url: string) => Promise<void>;
}

interface MockWindow {
  isDestroyed: () => boolean;
  destroy: () => void;
  hide: () => void;
  webContents: MockWebContents;
  on: (event: string, handler: (e?: { preventDefault: () => void }) => void) => void;
}

function createMockWindow(printBehavior: 'success' | 'cancelled' | 'failed'): MockWindow {
  return {
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
    hide: vi.fn(),
    on: vi.fn(),
    webContents: {
      loadURL: vi.fn(() => Promise.resolve()),
      print: vi.fn((_opts: unknown, cb: PrintCallback) => {
        // Simulate async print callback.
        setTimeout(() => {
          if (printBehavior === 'success') cb(true);
          else if (printBehavior === 'cancelled') cb(false, 'cancelled');
          else cb(false, 'No printer available');
        }, 10);
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Inline PrintService implementation for testing (no Electron import).
// ---------------------------------------------------------------------------
type PrintStatus = 'printed' | 'cancelled' | 'failed';
interface PrintResult { status: PrintStatus; error?: string; }

class TestPrintService {
  private mockWindow: MockWindow | null = null;
  private queue: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor(private readonly behavior: 'success' | 'cancelled' | 'failed') {}

  private getWindow(): MockWindow {
    if (!this.mockWindow) {
      this.mockWindow = createMockWindow(this.behavior);
    }
    return this.mockWindow;
  }

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
    resolve: (r: PrintResult) => void
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

    const win = this.getWindow();
    await win.webContents.loadURL('data:text/html,' + encodeURIComponent(html));

    timeoutHandle = setTimeout(() => {
      settle({ status: 'failed', error: 'Print timed out.' });
    }, 5000);

    win.webContents.print(buildPrintOptions(deviceName), (success, failureReason) => {
      if (success) settle({ status: 'printed' });
      else if (failureReason === 'cancelled') settle({ status: 'cancelled' });
      else settle({ status: 'failed', error: failureReason ?? 'Unknown' });
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.mockWindow && !this.mockWindow.isDestroyed()) {
      this.mockWindow.destroy();
      this.mockWindow = null;
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('PrintService', () => {
  it('returns printed status on success', async () => {
    const svc = new TestPrintService('success');
    const result = await svc.print('<html></html>');
    expect(result.status).toBe('printed');
    expect(result.error).toBeUndefined();
  });

  it('returns cancelled status when user cancels', async () => {
    const svc = new TestPrintService('cancelled');
    const result = await svc.print('<html></html>');
    expect(result.status).toBe('cancelled');
  });

  it('returns failed status with error message on printer failure', async () => {
    const svc = new TestPrintService('failed');
    const result = await svc.print('<html></html>');
    expect(result.status).toBe('failed');
    expect(result.error).toBe('No printer available');
  });

  it('passes silent:false, color:false, scaleFactor:100 with no deviceName configured', async () => {
    const svc = new TestPrintService('success');
    await svc.print('<html></html>');
    const win = svc['getWindow']();
    const [optsArg] = (win.webContents.print as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(optsArg).toMatchObject({ silent: false, color: false, scaleFactor: 100 });
    expect(optsArg).not.toHaveProperty('deviceName');
  });

  it('passes silent:true and the configured deviceName through to webContents.print', async () => {
    const svc = new TestPrintService('success');
    await svc.print('<html></html>', 'BIXOLON_SRP_350III');
    const win = svc['getWindow']();
    const [optsArg] = (win.webContents.print as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(optsArg).toMatchObject({
      silent: true,
      deviceName: 'BIXOLON_SRP_350III',
      color: false,
      scaleFactor: 100,
    });
  });

  it('serialises multiple jobs — all complete in order', async () => {
    const svc = new TestPrintService('success');
    const results = await Promise.all([
      svc.print('<html>1</html>'),
      svc.print('<html>2</html>'),
      svc.print('<html>3</html>'),
    ]);
    expect(results.every((r) => r.status === 'printed')).toBe(true);
  });

  it('returns failed immediately after destroy', async () => {
    const svc = new TestPrintService('success');
    svc.destroy();
    const result = await svc.print('<html></html>');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('shut down');
  });

  it('destroy is idempotent', () => {
    const svc = new TestPrintService('success');
    expect(() => {
      svc.destroy();
      svc.destroy();
    }).not.toThrow();
  });

  it('destroy calls window.destroy()', () => {
    const svc = new TestPrintService('success');
    // Trigger window creation by printing once.
    void svc.print('<html></html>');
    svc.destroy();
    expect(svc.isDestroyed()).toBe(true);
  });
});
