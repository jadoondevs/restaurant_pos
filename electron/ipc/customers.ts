import prisma from '../database/client';
import { handle } from './util';

interface CustomerInput {
  name: string;
  phone?: string | null;
  notes?: string | null;
}

export function registerCustomerHandlers() {
  handle('customers:list', async (search?: string) => {
    const where = search?.trim()
      ? {
          OR: [
            { name: { contains: search.trim() } },
            { phone: { contains: search.trim() } },
          ],
        }
      : {};
    return prisma.customer.findMany({ where, orderBy: { name: 'asc' }, take: 200 });
  });

  handle('customers:create', async (data: CustomerInput) => {
    if (!data.name?.trim()) throw new Error('Customer name is required.');
    return prisma.customer.create({
      data: {
        name: data.name.trim(),
        phone: data.phone?.trim() || null,
        notes: data.notes?.trim() || null,
      },
    });
  });

  handle('customers:update', async ({ id, data }: { id: number; data: CustomerInput }) => {
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

  handle('customers:delete', async (id: number) => {
    await prisma.customer.delete({ where: { id } });
    return { success: true };
  });
}
