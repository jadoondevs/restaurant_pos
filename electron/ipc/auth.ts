import bcrypt from 'bcryptjs';
import prisma from '../database/client';
import { handle } from './util';

export function registerAuthHandlers() {
  // Validate credentials against the single admin account.
  handle('auth:login', async ({ username, password }: { username: string; password: string }) => {
    if (!username?.trim() || !password) {
      throw new Error('Username and password are required.');
    }

    const admin = await prisma.admin.findUnique({ where: { username: username.trim() } });
    if (!admin) throw new Error('Invalid username or password.');

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) throw new Error('Invalid username or password.');

    return { id: admin.id, username: admin.username };
  });

  // Change the admin password after verifying the current one.
  handle(
    'auth:changePassword',
    async ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string;
      newPassword: string;
    }) => {
      if (!newPassword || newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters.');
      }

      const admin = await prisma.admin.findFirst();
      if (!admin) throw new Error('Admin account not found.');

      const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
      if (!valid) throw new Error('Current password is incorrect.');

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await prisma.admin.update({ where: { id: admin.id }, data: { passwordHash } });
      return { success: true };
    }
  );
}
