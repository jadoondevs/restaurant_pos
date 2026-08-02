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

// Vite injects these env vars during dev/build.
process.env.APP_ROOT = path.join(__dirname, '..');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

let mainWindow: BrowserWindow | null = null;
let isQuittingGracefully = false;

// Ensure only one instance of the app can access the database at a time.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

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

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

app.whenReady().then(async () => {
  // 1. Run schema migrations before anything else touches the database.
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
    logger.error('main: bootstrap failed', { error: err });
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

// Graceful exit: run exit backup, then quit.
app.on('before-quit', async (event) => {
  if (isQuittingGracefully) return; // already handled
  if (isRestoreInProgress()) return; // restore handles its own exit

  event.preventDefault();
  isQuittingGracefully = true;

  try {
    await backupService.runExitBackup();
  } catch (err) {
    logger.error('main: exit backup failed', { error: err });
  } finally {
    backupService.destroy();
    printService.destroy();
    await prisma.$disconnect();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    mainWindow = null;
  }
});

export { mainWindow };
