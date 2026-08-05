import prisma from '../database/client';
import { handle } from './util';

interface CategoryInput {
  name: string;
  sortOrder?: number;
}

export function registerCategoryHandlers() {
  handle('categories:list', async (_event) =>
    prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    })
  );

  handle('categories:create', async (_event, data: CategoryInput) => {
    const name = data.name?.trim();
    if (!name) throw new Error('Category name is required.');

    const existing = await prisma.category.findUnique({ where: { name } });
    if (existing) throw new Error('A category with this name already exists.');

    return prisma.category.create({ data: { name, sortOrder: data.sortOrder ?? 0 } });
  }, { requiredRole: 'ADMIN' });

  handle(
    'categories:update',
    async (_event, { id, data }: { id: number; data: CategoryInput }) => {
      const name = data.name?.trim();
      if (!name) throw new Error('Category name is required.');

      const dupe = await prisma.category.findFirst({ where: { name, NOT: { id } } });
      if (dupe) throw new Error('A category with this name already exists.');

      return prisma.category.update({
        where: { id },
        data: { name, sortOrder: data.sortOrder ?? 0 },
      });
    },
    { requiredRole: 'ADMIN' }
  );

  handle('categories:delete', async (_event, id: number) => {
    await prisma.category.delete({ where: { id } });
    return { success: true };
  }, { requiredRole: 'ADMIN' });
}
