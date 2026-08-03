/**
 * Seeds the default admin account into the User table on fresh installations.
 *
 * This is the single place responsible for creating the initial admin user.
 * It is called by bootstrap.ts during application startup.
 *
 * Behaviour:
 *   - Checks the User table for any existing ADMIN account.
 *   - If none exists, creates admin / admin123 with role=ADMIN.
 *   - mustChangePassword=true so the user is prompted to change it.
 *   - Fully idempotent — safe to call on every launch.
 *   - Never writes to the legacy Admin table.
 */
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../logger';

export async function seedDefaultAdmin(prisma: PrismaClient): Promise<void> {
  const existingAdmin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });

  if (existingAdmin) {
    // At least one ADMIN user already exists — nothing to do.
    return;
  }

  const passwordHash = await bcrypt.hash('admin123', 10);

  await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash,
      fullName: 'Administrator',
      role: 'ADMIN',
      isActive: true,
      mustChangePassword: true,
    },
  });

  logger.info('bootstrap: created default admin user (admin / admin123)');
}
