/**
 * Backup provider registry.
 * The rest of the application calls getProvider() — never imports a
 * concrete provider directly. Swap cloud providers here without touching
 * any other file.
 */
import type { BackupProvider } from './contracts';
import { GoogleDriveProvider } from './googleDriveProvider';

const providers = new Map<string, BackupProvider>();

// Register the default provider.
providers.set('google-drive', new GoogleDriveProvider());

/** Returns the active cloud backup provider. */
export function getProvider(): BackupProvider {
  const provider = providers.get('google-drive');
  if (!provider) throw new Error('No backup provider registered.');
  return provider;
}

/** Registers a custom provider (useful for testing or future providers). */
export function registerProvider(key: string, provider: BackupProvider): void {
  providers.set(key, provider);
}
