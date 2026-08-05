/**
 * Authentication IPC handlers.
 *
 * ALL authentication uses the User table.
 * The legacy Admin table is never queried here.
 *
 * Session store integration:
 *   auth:login       — writes session to store on success
 *   auth:currentUser — writes session to store (repopulates on app reload)
 *   auth:logout      — clears session from store
 *   auth:changePassword — no store interaction; session remains valid
 */
import bcrypt from 'bcryptjs';
import prisma from '../database/client';
import { handle } from './util';
import { setSession, clearSession } from '../auth/sessionStore';
import type { AuthUser } from '../types/authUser';

/** Builds the AuthUser payload from a DB user row. */
function toAuthUser(user: {
  id: number;
  username: string;
  fullName: string;
  role: string;
  mustChangePassword: boolean;
}): AuthUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role as AuthUser['role'],
    mustChangePassword: user.mustChangePassword,
  };
}

export function registerAuthHandlers() {
  // ---------------------------------------------------------------------------
  // auth:login
  // Validates credentials and writes the session into the store.
  // ---------------------------------------------------------------------------
  handle(
    'auth:login',
    async (event, { username, password }: { username: string; password: string }) => {
      if (!username?.trim() || !password) {
        throw new Error('Username and password are required.');
      }

      const user = await prisma.user.findUnique({
        where: { username: username.trim() },
      });

      if (!user) throw new Error('Invalid username or password.');

      if (!user.isActive) {
        throw new Error('This account has been deactivated. Please contact your administrator.');
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) throw new Error('Invalid username or password.');

      const authUser = toAuthUser(user);
      setSession(event.sender.id, authUser);
      return authUser;
    }
  );

  // ---------------------------------------------------------------------------
  // auth:currentUser
  // Returns the current user by id. Also repopulates the session store so
  // authorization works correctly after an app reload.
  // ---------------------------------------------------------------------------
  handle('auth:currentUser', async (event, id: number) => {
    if (!id || typeof id !== 'number') throw new Error('Invalid user id.');

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new Error('User not found.');
    if (!user.isActive) throw new Error('Account is deactivated.');

    const authUser = toAuthUser(user);
    setSession(event.sender.id, authUser);
    return authUser;
  });

  // ---------------------------------------------------------------------------
  // auth:logout
  // Clears the session from the store. The renderer clears sessionStorage.
  // Does NOT trigger an exit backup — that belongs to graceful shutdown only.
  // ---------------------------------------------------------------------------
  handle('auth:logout', async (event) => {
    clearSession(event.sender.id);
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // auth:changePassword
  // Changes the password for the authenticated user.
  // Clears mustChangePassword on success.
  // No session store interaction — the session remains valid after a
  // password change. The renderer refreshes via auth:currentUser.
  // ---------------------------------------------------------------------------
  handle(
    'auth:changePassword',
    async (
      _event,
      {
        userId,
        currentPassword,
        newPassword,
      }: {
        userId: number;
        currentPassword: string;
        newPassword: string;
      }
    ) => {
      if (!newPassword || newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters.');
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('User not found.');

      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) throw new Error('Current password is incorrect.');

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false },
      });

      return { success: true };
    }
  );
}
