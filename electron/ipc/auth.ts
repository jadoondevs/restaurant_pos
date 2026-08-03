/**
 * Authentication IPC handlers.
 *
 * ALL authentication uses the User table.
 * The legacy Admin table is never queried here.
 */
import bcrypt from 'bcryptjs';
import prisma from '../database/client';
import { handle } from './util';

export function registerAuthHandlers() {
  // ---------------------------------------------------------------------------
  // auth:login
  // Validates credentials against the User table.
  // Returns the session payload on success.
  // ---------------------------------------------------------------------------
  handle(
    'auth:login',
    async ({ username, password }: { username: string; password: string }) => {
      if (!username?.trim() || !password) {
        throw new Error('Username and password are required.');
      }

      const user = await prisma.user.findUnique({
        where: { username: username.trim() },
      });

      // Use a generic message to avoid username enumeration.
      if (!user) throw new Error('Invalid username or password.');

      if (!user.isActive) {
        throw new Error('This account has been deactivated. Please contact your administrator.');
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) throw new Error('Invalid username or password.');

      return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role as 'ADMIN' | 'CASHIER',
        mustChangePassword: user.mustChangePassword,
      };
    }
  );

  // ---------------------------------------------------------------------------
  // auth:currentUser
  // Returns the current user by id. Used to rehydrate the session on startup
  // if the renderer has a stored session id.
  // ---------------------------------------------------------------------------
  handle('auth:currentUser', async (id: number) => {
    if (!id || typeof id !== 'number') throw new Error('Invalid user id.');

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new Error('User not found.');
    if (!user.isActive) throw new Error('Account is deactivated.');

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role as 'ADMIN' | 'CASHIER',
      mustChangePassword: user.mustChangePassword,
    };
  });

  // ---------------------------------------------------------------------------
  // auth:changePassword
  // Changes the password for the authenticated user.
  // Clears mustChangePassword on success.
  // ---------------------------------------------------------------------------
  handle(
    'auth:changePassword',
    async ({
      userId,
      currentPassword,
      newPassword,
    }: {
      userId: number;
      currentPassword: string;
      newPassword: string;
    }) => {
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
        data: {
          passwordHash,
          mustChangePassword: false,
        },
      });

      return { success: true };
    }
  );
}
