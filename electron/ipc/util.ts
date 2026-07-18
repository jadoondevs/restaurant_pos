import { ipcMain } from 'electron';

/** Standard IPC response envelope so the renderer handles errors uniformly. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Wraps an async handler with consistent error handling. Any thrown error is
 * converted to a readable message instead of crashing the main process.
 */
export function handle<T>(
  channel: string,
  fn: (...args: any[]) => Promise<T>
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const data = await fn(...args);
      return { ok: true, data } satisfies IpcResult<T>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      console.error(`[IPC ${channel}]`, message);
      return { ok: false, error: message } satisfies IpcResult<T>;
    }
  });
}
