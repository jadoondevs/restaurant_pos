import prisma from '../database/client';
import { handle } from './util';

interface CustomerInput {
  name: string;
  phone?: string | null;
  notes?: string | null;
}

export function registerCustomerHandlers() {
  handle('customers:list', async (_event, search?: string) => {
    const where = search?.trim()
      ? { OR: [{ name: { contains: search.trim() } }, { phone: { contains: search.trim() } }] }
      : {};
    return prisma.customer.findMany({ where, orderBy: { name: 'asc' }, take: 200 });
  });

  handle('customers:create', async (_event, data: CustomerInput) => {
    if (!data.name?.trim()) throw new Error('Customer name is required.');
    return prisma.customer.create({
      data: {
        name: data.name.trim(),
        phone: data.phone?.trim() || null,
        notes: data.notes?.trim() || null,
      },
    });
  });

  handle('customers:update', async (_event, { id, data }: { id: number; data: CustomerInput }) => {
    if (!data.name?.trim()) throw new Error('Customer name is required.');
    return prisma.customer.update({
      where: { id },
      data: {
        name: data.name.trim(),
        phone: data.phone?.trim() || null,
        notes: data.notes?.trim() || null,
      },
    });
  });

  // Batch 11 hardening: every other delete in the app (categories, menu,
  // orders) is role-gated; this one wasn't. Matches orders:delete's
  // MANAGER level rather than ADMIN — a customer record is comparable
  // low-frequency, supervisory-level cleanup, not an admin-only action.
  handle(
    'customers:delete',
    async (_event, id: number) => {
      await prisma.customer.delete({ where: { id } });
      return { success: true };
    },
    { requiredRole: 'MANAGER' }
  );
}
