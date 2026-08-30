import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipc';
import { ensureBootstrap } from './bootstrap';
import { runMigrations } from './migrator';
import { backupService } from './backup/backupService';
import { isRestoreInProgress } from './backup/restoreService';
import { printService } from './services/printService';
import prisma from './database/client';
import { logger } from './logger';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Batch 11 hardening — top-level safety nets.
//
// Without these, a bug in any rarely-hit code path (a stray unhandled
// promise, an unexpected exception outside the try/catch'd IPC handlers)
// could either crash the whole app with no record of why, or leave it in a
// half-broken state a cashier can't diagnose mid-service. Every IPC handler
// already goes through handle()'s own try/catch and returns a structured
// error to the renderer, so these are strictly a last-resort log-and-
// continue net — never routine, never expected to fire in normal use.
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err) => {
  logger.error('main: uncaught exception', { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
});

process.on('unhandledRejection', (reason) => {
  logger.error('main: unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// Vite injects these env vars during dev/build.
process.env.APP_ROOT = path.join(__dirname, '..');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

let mainWindow: BrowserWindow | null = null;

// Single flag that gates the entire graceful-shutdown sequence.
// Set to true the moment we begin shutting down so re-entrant quit() calls
// from window-all-closed or second app.quit() invocations are ignored.
let isQuittingGracefully = false;

// ---------------------------------------------------------------------------
// Single-instance lock — prevents two processes sharing the same SQLite file.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running — bring it to the front and exit.
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // When the main window is closed by the user, initiate graceful shutdown.
  // We handle the actual quit in before-quit so the exit backup runs first.
  mainWindow.on('close', () => {
    mainWindow = null;
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

// ---------------------------------------------------------------------------
// App ready — migrations → bootstrap → scheduler → IPC → window
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  // 1. Run schema migrations before anything else touches the database.
  //    This handles fresh installs, upgrades, and restored backups.
  try {
    await runMigrations(prisma);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('main: migration failed', { error: msg });
    dialog.showErrorBox(
      'Database Migration Failed',
      `The application could not upgrade the database:\n\n${msg}\n\nPlease contact support.`
    );
    app.exit(1);
    return;
  }

  // 2. Bootstrap default data (admin, settings, sample menu).
  try {
    await ensureBootstrap();
  } catch (err) {
    // JSON.stringify(Error) drops the message/stack (non-enumerable), so
    // this must be normalized the same way every other catch in the app
    // does — otherwise the log line records only "{}".
    logger.error('main: bootstrap failed', { error: err instanceof Error ? err.message : String(err) });
  }

  // 3. Start the backup scheduler.
  backupService.init(prisma);

  // 4. Register IPC handlers and open the window.
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown sequence
// ---------------------------------------------------------------------------
//
// Flow:
//   User closes window
//     → window-all-closed fires → app.quit()
//     → before-quit fires (first time) → runs exit backup → cleanup → app.quit()
//     → before-quit fires (second time) → isQuittingGracefully is true → returns
//     → app exits
//
// The isQuittingGracefully flag prevents the sequence from running twice.

app.on('before-quit', async (event) => {
  // If a restore is in progress it handles its own exit via app.exit(0).
  if (isRestoreInProgress()) return;

  // Already in the shutdown sequence — let this quit() call through.
  if (isQuittingGracefully) return;

  // First time: intercept, run cleanup, then re-quit.
  event.preventDefault();
  isQuittingGracefully = true;

  logger.info('main: graceful shutdown started');

  try {
    await backupService.runExitBackup();
  } catch (err) {
    logger.error('main: exit backup failed', { error: err instanceof Error ? err.message : String(err) });
  }

  // Tear down services in order.
  backupService.destroy();
  printService.destroy();

  // Explicitly destroy the main window so its renderer process exits cleanly.
  // Without this, the renderer can keep the process alive after app.quit().
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }

  // Destroy any other windows (e.g. the hidden print window if not already gone).
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }

  try {
    await prisma.$disconnect();
    logger.info('main: Prisma disconnected');
  } catch (err) {
    logger.error('main: Prisma disconnect failed', { error: err instanceof Error ? err.message : String(err) });
  }

  logger.info('main: graceful shutdown complete — calling app.quit()');
  app.quit();
});

app.on('window-all-closed', () => {
  // On macOS apps conventionally stay open until Cmd+Q.
  // On all other platforms, closing the last window quits the app.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export { mainWindow };
