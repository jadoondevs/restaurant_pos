/**
 * User management IPC handlers.
 *
 * All handlers require ADMIN role.
 * Username is immutable after creation — see users:create for rationale.
 */
import bcrypt from 'bcryptjs';
import prisma from '../database/client';
import { handle } from './util';
import { getSession, clearSessionsForUser } from '../auth/sessionStore';

const VALID_ROLES = ['ADMIN', 'MANAGER', 'CASHIER'] as const;
type Role = typeof VALID_ROLES[number];

function validateRole(role: unknown): Role {
  if (!VALID_ROLES.includes(role as Role)) {
    throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}.`);
  }
  return role as Role;
}

export function registerUserHandlers() {
  // ---------------------------------------------------------------------------
  // users:list
  // Returns all users ordered by creation date. Never returns passwordHash.
  // ---------------------------------------------------------------------------
  handle('users:list', async (_event) => {
    return prisma.user.findMany({
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }, { requiredRole: 'ADMIN' });

  // ---------------------------------------------------------------------------
  // users:create
  // Creates a new user. The admin supplies an initial password which the
  // user must change on first login (mustChangePassword=true).
  //
  // ---------------------------------------------------------------------------
  handle('users:create', async (_event, data: {
    username: string;
    fullName: string;
    role: string;
    initialPassword: string;
  }) => {
    const username = data.username?.trim();
    if (!username) throw new Error('Username is required.');

    const fullName = data.fullName?.trim();
    if (!fullName) throw new Error('Full name is required.');

    const role = validateRole(data.role);

    if (!data.initialPassword || data.initialPassword.length < 6) {
      throw new Error('Initial password must be at least 6 characters.');
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) throw new Error(`Username "${username}" is already taken.`);

    const passwordHash = await bcrypt.hash(data.initialPassword, 10);

    const user = await prisma.user.create({
      data: {
        username,
        fullName,
        role,
        passwordHash,
        isActive: true,
        mustChangePassword: true,
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }, { requiredRole: 'ADMIN' });

  // ---------------------------------------------------------------------------
  // users:update
  // Edits username, fullName, and role. Password hashes are untouched.
  // ---------------------------------------------------------------------------
  handle('users:update', async (_event, data: {
    id: number;
    username: string;
    fullName: string;
    role: string;
  }) => {
    if (!data.id || typeof data.id !== 'number') throw new Error('Invalid user id.');

    const username = data.username?.trim();
    if (!username) throw new Error('Username is required.');

    const fullName = data.fullName?.trim();
    if (!fullName) throw new Error('Full name is required.');

    const role = validateRole(data.role);

    const user = await prisma.user.findUnique({ where: { id: data.id } });
    if (!user) throw new Error('User not found.');

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing && existing.id !== data.id) {
      throw new Error(`Username "${username}" is already taken.`);
    }

    const updated = await prisma.user.update({
      where: { id: data.id },
      data: { username, fullName, role },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Batch 11 hardening: a role change must take effect immediately, not
    // whenever this user's session next happens to be revalidated (session
    // store checks are keyed off the role snapshot captured at login/reload
    // time — see sessionStore.ts). Only invalidate on an actual change, so
    // a routine name/username edit doesn't force a mid-shift re-login.
    if (user.role !== role) clearSessionsForUser(data.id);

    return updated;
  }, { requiredRole: 'ADMIN' });

  // ---------------------------------------------------------------------------
  // users:setActive
  // Soft delete (isActive=false) or reactivation (isActive=true).
  //
  // Guards:
  //   1. Cannot deactivate your own account.
  //   2. Cannot deactivate the last active ADMIN account.
  // ---------------------------------------------------------------------------
  handle('users:setActive', async (event, data: { id: number; isActive: boolean }) => {
    if (!data.id || typeof data.id !== 'number') throw new Error('Invalid user id.');

    const user = await prisma.user.findUnique({ where: { id: data.id } });
    if (!user) throw new Error('User not found.');

    if (!data.isActive) {
      // Guard 1: cannot deactivate your own account.
      const session = getSession(event.sender.id);
      if (session && session.id === data.id) {
        throw new Error('You cannot deactivate your own account.');
      }

      // Guard 2: cannot deactivate the last active ADMIN.
      if (user.role === 'ADMIN') {
        const activeAdminCount = await prisma.user.count({
          where: { role: 'ADMIN', isActive: true },
        });
        if (activeAdminCount <= 1) {
          throw new Error(
            'Cannot deactivate the last active administrator account. ' +
            'Promote another user to Admin first.'
          );
        }
      }
    }

    const updated = await prisma.user.update({
      where: { id: data.id },
      data: { isActive: data.isActive },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Batch 11 hardening: deactivation must end that user's session now,
    // not whenever it next happens to be revalidated.
    if (!data.isActive) clearSessionsForUser(data.id);

    return updated;
  }, { requiredRole: 'ADMIN' });

  // ---------------------------------------------------------------------------
  // users:resetPassword
  // Admin sets a new password for any user.
  // Sets mustChangePassword=true so the user is prompted on next login.
  // Does not require the user's current password.
  // ---------------------------------------------------------------------------
  handle('users:resetPassword', async (_event, data: {
    id: number;
    newPassword: string;
  }) => {
    if (!data.id || typeof data.id !== 'number') throw new Error('Invalid user id.');

    if (!data.newPassword || data.newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }

    const user = await prisma.user.findUnique({ where: { id: data.id } });
    if (!user) throw new Error('User not found.');

    const passwordHash = await bcrypt.hash(data.newPassword, 10);

    await prisma.user.update({
      where: { id: data.id },
      data: { passwordHash, mustChangePassword: true },
    });

    // Batch 11 hardening: force the affected user to re-authenticate with
    // the new password rather than keep operating under their old session.
    clearSessionsForUser(data.id);

    return { success: true };
  }, { requiredRole: 'ADMIN' });
}
