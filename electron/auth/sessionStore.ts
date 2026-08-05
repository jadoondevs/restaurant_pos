/**
 * In-process session store for IPC authorization.
 *
 * After a successful login, auth:login writes the authenticated AuthUser
 * into this store keyed by the renderer's webContents.id. The handle()
 * wrapper in ipc/util.ts reads from this store to enforce role-based
 * access control without requiring the renderer to send any identity
 * information with each call.
 *
 * WHY webContents.id AS THE KEY
 * ==============================
 * webContents.id is assigned by Electron and is not accessible or
 * forgeable by renderer-side JavaScript. This makes it a reliable
 * identity anchor for the main process. If the renderer window is
 * destroyed and recreated, it gets a new webContents.id, which
 * automatically invalidates the old session.
 *
 * WHY NOT PERSIST THE SESSION
 * ============================
 * Sessions are intentionally in-memory only. The renderer already
 * persists the session in sessionStorage and revalidates it against
 * the DB via auth:currentUser on every mount (see AuthContext.tsx).
 * auth:currentUser also writes into this store, so the store is always
 * populated for any renderer that has a valid session.
 */
import type { AuthUser } from '../types/authUser';

// TODO (Phase 2.1):
// Authorization currently relies on the authenticated session snapshot.
// When user management (create/edit/deactivate users) is implemented,
// introduce immediate session invalidation for affected users by calling
// clearSession() inside the deactivate-user and change-role IPC handlers.

/** Role order from lowest to highest privilege. */
export const ROLE_HIERARCHY: AuthUser['role'][] = ['CASHIER', 'MANAGER', 'ADMIN'];

const store = new Map<number, AuthUser>();

/** Stores the authenticated user for a given webContents.id. */
export function setSession(webContentsId: number, user: AuthUser): void {
  store.set(webContentsId, user);
}

/** Returns the authenticated user for a given webContents.id, or undefined. */
export function getSession(webContentsId: number): AuthUser | undefined {
  return store.get(webContentsId);
}

/** Removes the session for a given webContents.id (called on logout). */
export function clearSession(webContentsId: number): void {
  store.delete(webContentsId);
}

/** Clears all sessions. Called during graceful shutdown. */
export function clearAll(): void {
  store.clear();
}

/**
 * Returns true if userRole meets or exceeds requiredRole.
 *
 * Examples:
 *   hasRole('ADMIN',   'CASHIER') → true
 *   hasRole('MANAGER', 'MANAGER') → true
 *   hasRole('CASHIER', 'MANAGER') → false
 */
export function hasRole(
  userRole: AuthUser['role'],
  requiredRole: AuthUser['role']
): boolean {
  return ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf(requiredRole);
}
