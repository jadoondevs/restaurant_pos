/**
 * Provider-agnostic backup contracts.
 * The rest of the application depends only on these interfaces —
 * never on Google Drive or any other cloud SDK directly.
 */

export interface RemoteFile {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface UploadResult {
  fileId: string;
  name: string;
}

export interface CloudAccount {
  email: string;
  displayName: string;
}

/**
 * Every cloud backup provider must implement this interface.
 * Swap providers by registering a different implementation in registry.ts.
 */
export interface BackupProvider {
  /** Human-readable name shown in the UI. */
  readonly name: string;

  /** Returns true when the provider has valid credentials. */
  isAuthenticated(): Promise<boolean>;

  /** Returns the authenticated account info, or null if not authenticated. */
  getAccount(): Promise<CloudAccount | null>;

  /** Starts the OAuth flow and stores credentials. */
  authenticate(): Promise<CloudAccount>;

  /** Revokes stored credentials. */
  disconnect(): Promise<void>;

  /** Uploads a local file. Returns the remote file ID. */
  upload(localPath: string, filename: string): Promise<UploadResult>;

  /** Downloads a remote file to a local path. */
  download(fileId: string, destPath: string): Promise<void>;

  /** Lists files in the backup folder, newest first. */
  listFiles(): Promise<RemoteFile[]>;
}
