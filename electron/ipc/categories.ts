import prisma from '../database/client';
import { handle } from './util';

interface CategoryInput {
  name: string;
  sortOrder?: number;
}

export function registerCategoryHandlers() {
  handle('categories:list', async () =>
    prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    })
  );

  handle('categories:create', async (data: CategoryInput) => {
    const name = data.name?.trim();
    if (!name) throw new Error('Category name is required.');

    const existing = await prisma.category.findUnique({ where: { name } });
    if (existing) throw new Error('A category with this name already exists.');

    return prisma.category.create({ data: { name, sortOrder: data.sortOrder ?? 0 } });
  });

  handle(
    'categories:update',
    async ({ id, data }: { id: number; data: CategoryInput }) => {
      const name = data.name?.trim();
      if (!name) throw new Error('Category name is required.');

      const dupe = await prisma.category.findFirst({
        where: { name, NOT: { id } },
      });
      if (dupe) throw new Error('A category with this name already exists.');

      return prisma.category.update({
        where: { id },
        data: { name, sortOrder: data.sortOrder ?? 0 },
      });
    }
  );

  handle('categories:delete', async (id: number) => {
    // Cascade removes items in this category (see schema onDelete: Cascade).
    await prisma.category.delete({ where: { id } });
    return { success: true };
  });
}
