import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { getSession, hasRole } from '../auth/sessionStore';
import type { AuthUser } from '../types/authUser';
import { logger } from '../logger';

/** Standard IPC response envelope so the renderer handles errors uniformly. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Options for the handle() wrapper.
 *
 * requiredRole — when set, the caller must have an active session whose
 *   role meets or exceeds this level. If not, the handler is never called
 *   and an error envelope is returned to the renderer.
 *
 *   Omitting requiredRole preserves the existing behaviour exactly:
 *   the handler runs for any caller (backward compatible).
 */
export interface HandleOptions {
  requiredRole?: AuthUser['role'];
}

/**
 * Wraps an async IPC handler with:
 *   1. Consistent error handling — thrown errors become { ok: false } envelopes.
 *   2. Optional role-based authorization — when requiredRole is set, the
 *      caller's session is checked before the handler runs.
 *
 * Authorization uses the in-process session store (sessionStore.ts), keyed
 * by event.sender.id (webContents.id). The renderer sends no identity data —
 * webContents.id comes from Electron and cannot be forged by the renderer.
 *
 * Backward compatibility: all existing handle() calls without a third
 * argument are completely unaffected. The only mechanical change to existing
 * handlers is adding _event as the first parameter to the fn callback.
 */
export function handle<T>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T>,
  options?: HandleOptions
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      // --- Authorization check (skipped when requiredRole is not set) ---
      if (options?.requiredRole) {
        const session = getSession(event.sender.id);

        if (!session) {
          logger.warn(`ipc: unauthorized call to '${channel}' — no session`);
          return { ok: false, error: 'Authentication required.' } satisfies IpcResult<T>;
        }

        if (!hasRole(session.role, options.requiredRole)) {
          logger.warn(
            `ipc: forbidden call to '${channel}' — ` +
            `role '${session.role}' does not meet required '${options.requiredRole}'`
          );
          return { ok: false, error: 'Insufficient permissions.' } satisfies IpcResult<T>;
        }
      }

      // --- Handler invocation ---
      const data = await fn(event, ...args);
      return { ok: true, data } satisfies IpcResult<T>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      logger.error(`[IPC ${channel}]`, { error: message });
      return { ok: false, error: message } satisfies IpcResult<T>;
    }
  });
}
