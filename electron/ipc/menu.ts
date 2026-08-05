import prisma from '../database/client';
import { handle } from './util';
import type { Prisma } from '@prisma/client';

interface MenuInput {
  name: string;
  description?: string | null;
  price: number;
  available?: boolean;
  image?: string | null;
  categoryId: number;
}

interface ListParams {
  search?: string;
  categoryId?: number | null;
  availableOnly?: boolean;
}

function validate(data: MenuInput) {
  if (!data.name?.trim()) throw new Error('Item name is required.');
  if (typeof data.price !== 'number' || Number.isNaN(data.price) || data.price < 0) {
    throw new Error('Price must be zero or a positive number.');
  }
  if (!data.categoryId) throw new Error('A category is required.');
}

export function registerMenuHandlers() {
  handle('menu:list', async (_event, params: ListParams = {}) => {
    const where: Prisma.MenuItemWhereInput = {};
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.availableOnly) where.available = true;
    if (params.search?.trim()) where.name = { contains: params.search.trim() };

    return prisma.menuItem.findMany({
      where,
      include: { category: true },
      orderBy: { name: 'asc' },
    });
  });

  handle('menu:create', async (_event, data: MenuInput) => {
    validate(data);
    const name = data.name.trim();

    const dupe = await prisma.menuItem.findFirst({ where: { name, categoryId: data.categoryId } });
    if (dupe) throw new Error('This item already exists in the selected category.');

    return prisma.menuItem.create({
      data: {
        name,
        description: data.description?.trim() || null,
        price: data.price,
        available: data.available ?? true,
        image: data.image || null,
        categoryId: data.categoryId,
      },
    });
  }, { requiredRole: 'ADMIN' });

  handle('menu:update', async (_event, { id, data }: { id: number; data: MenuInput }) => {
    validate(data);
    const name = data.name.trim();

    const dupe = await prisma.menuItem.findFirst({
      where: { name, categoryId: data.categoryId, NOT: { id } },
    });
    if (dupe) throw new Error('This item already exists in the selected category.');

    return prisma.menuItem.update({
      where: { id },
      data: {
        name,
        description: data.description?.trim() || null,
        price: data.price,
        available: data.available ?? true,
        image: data.image || null,
        categoryId: data.categoryId,
      },
    });
  }, { requiredRole: 'ADMIN' });

  handle('menu:delete', async (_event, id: number) => {
    await prisma.menuItem.delete({ where: { id } });
    return { success: true };
  }, { requiredRole: 'ADMIN' });
}
