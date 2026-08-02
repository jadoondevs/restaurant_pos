/**
 * Google Drive backup provider.
 * Implements the BackupProvider interface using the Drive REST API.
 * No googleapis npm package — uses Node's built-in fetch.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BackupProvider, CloudAccount, RemoteFile, UploadResult } from './contracts';
import {
  authenticate,
  clearTokens,
  getValidAccessToken,
  loadTokens,
} from './googleAuth';
import { logger } from '../logger';

const FOLDER_NAME = 'Restaurant POS Backups';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const USERINFO_URL = 'https://www.googleapis.com/drive/v3/about?fields=user';

/** Returns true when the error looks like a network connectivity failure. */
function isOfflineError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('etimedout')
  );
}

async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getValidAccessToken();
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
}

/** Finds or creates the backup folder, returns its Drive ID. */
async function ensureFolder(): Promise<string> {
  const token = await getValidAccessToken();

  // Search for existing folder.
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const listRes = await fetch(
    `${DRIVE_FILES_URL}?q=${q}&fields=files(id,name)`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!listRes.ok) throw new Error(`Drive folder search failed: ${listRes.status}`);
  const listData = (await listRes.json()) as { files: { id: string }[] };
  if (listData.files.length > 0) return listData.files[0].id;

  // Create the folder.
  const createRes = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!createRes.ok) throw new Error(`Drive folder creation failed: ${createRes.status}`);
  const created = (await createRes.json()) as { id: string };
  logger.info('googleDrive: created backup folder', { folderId: created.id });
  return created.id;
}

export class GoogleDriveProvider implements BackupProvider {
  readonly name = 'Google Drive';

  async isAuthenticated(): Promise<boolean> {
    const tokens = loadTokens();
    return tokens !== null;
  }

  async getAccount(): Promise<CloudAccount | null> {
    if (!(await this.isAuthenticated())) return null;
    try {
      const res = await authFetch(USERINFO_URL);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        user: { emailAddress: string; displayName: string };
      };
      return {
        email: data.user.emailAddress,
        displayName: data.user.displayName,
      };
    } catch {
      return null;
    }
  }

  async authenticate(): Promise<CloudAccount> {
    await authenticate();
    const account = await this.getAccount();
    if (!account) throw new Error('Authentication succeeded but could not retrieve account info.');
    return account;
  }

  async disconnect(): Promise<void> {
    clearTokens();
    logger.info('googleDrive: disconnected');
  }

  async upload(localPath: string, filename: string): Promise<UploadResult> {
    try {
      const folderId = await ensureFolder();
      const fileBuffer = fs.readFileSync(localPath);
      const fileSize = fileBuffer.length;

      // Use resumable upload for reliability (works for any file size).
      const token = await getValidAccessToken();
      const metadata = JSON.stringify({
        name: filename,
        parents: [folderId],
      });

      // Initiate resumable upload session.
      const initRes = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=resumable`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'application/octet-stream',
          'X-Upload-Content-Length': String(fileSize),
        },
        body: metadata,
        signal: AbortSignal.timeout(15_000),
      });

      if (!initRes.ok) {
        throw new Error(`Drive upload init failed: ${initRes.status}`);
      }

      const sessionUri = initRes.headers.get('Location');
      if (!sessionUri) throw new Error('Drive did not return a session URI.');

      // Upload the file content.
      const uploadRes = await fetch(sessionUri, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(fileSize),
        },
        body: fileBuffer,
        signal: AbortSignal.timeout(120_000), // 2 min for large DBs
      });

      if (!uploadRes.ok) {
        throw new Error(`Drive upload failed: ${uploadRes.status}`);
      }

      const uploaded = (await uploadRes.json()) as { id: string; name: string };
      logger.info('googleDrive: upload complete', { fileId: uploaded.id, filename });
      return { fileId: uploaded.id, name: uploaded.name };
    } catch (err) {
      if (isOfflineError(err)) {
        throw Object.assign(new Error('offline'), { isOffline: true });
      }
      throw err;
    }
  }

  async download(fileId: string, destPath: string): Promise<void> {
    const res = await authFetch(
      `${DRIVE_FILES_URL}/${fileId}?alt=media`,
      { signal: AbortSignal.timeout(120_000) }
    );
    if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    logger.info('googleDrive: download complete', { fileId, destPath });
  }

  async listFiles(): Promise<RemoteFile[]> {
    const folderId = await ensureFolder();
    const q = encodeURIComponent(
      `'${folderId}' in parents and trashed=false`
    );
    const res = await authFetch(
      `${DRIVE_FILES_URL}?q=${q}&fields=files(id,name,size,createdTime)&orderBy=createdTime desc&pageSize=50`
    );
    if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
    const data = (await res.json()) as {
      files: { id: string; name: string; size: string; createdTime: string }[];
    };
    return data.files.map((f) => ({
      id: f.id,
      name: f.name,
      sizeBytes: parseInt(f.size ?? '0', 10),
      createdAt: new Date(f.createdTime),
    }));
  }
}
