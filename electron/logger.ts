/**
 * Structured rotating file logger.
 * Writes JSON-lines to userData/logs/pos.log.
 * Rotates at 2 MB, keeps 5 files. No external dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_FILES = 5;

let logDir: string | null = null;
let logPath: string | null = null;

function ensureLogDir(): string {
  if (logDir) return logDir;
  logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  logPath = path.join(logDir, 'pos.log');
  return logDir;
}

function rotate(): void {
  if (!logPath || !logDir) return;
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < MAX_BYTES) return;
    // Shift existing rotated files.
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const src = path.join(logDir, `pos.${i}.log`);
      const dst = path.join(logDir, `pos.${i + 1}.log`);
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }
    fs.renameSync(logPath, path.join(logDir, 'pos.1.log'));
  } catch {
    // Rotation failure must never crash the app.
  }
}

function write(level: string, message: string, data?: unknown): void {
  try {
    ensureLogDir();
    rotate();
    const entry =
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        message,
        ...(data !== undefined ? { data } : {}),
      }) + '\n';
    fs.appendFileSync(logPath!, entry, 'utf8');
  } catch {
    // Logging must never crash the app.
  }
}

export const logger = {
  info: (message: string, data?: unknown) => write('info', message, data),
  warn: (message: string, data?: unknown) => write('warn', message, data),
  error: (message: string, data?: unknown) => write('error', message, data),
};
