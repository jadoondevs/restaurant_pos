/**
 * Shared AuthUser type for the main process.
 *
 * Mirrors src/types/index.ts AuthUser but lives in the electron/ tree
 * so main-process modules (sessionStore, ipc/util) can import it without
 * crossing the renderer boundary.
 *
 * The role union includes MANAGER even though no MANAGER users exist yet.
 * The authorization layer supports all three roles from day one.
 * No DB migration is needed — the role column is already TEXT.
 *
 * Keep this in sync with src/types/index.ts AuthUser.
 */
export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER';
  mustChangePassword: boolean;
}
