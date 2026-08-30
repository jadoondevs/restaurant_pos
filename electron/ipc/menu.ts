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

interface BulkImportRow {
  name: string;
  categoryName: string;
  price: number | string;
  description?: string;
  ownerships?: { partnerName: string; percentage: number }[];
}

interface BulkImportResult {
  created: number;
  skipped: { row: number; name: string; reason: string }[];
  warnings: { row: number; name: string; message: string }[];
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

  // Bulk import — CSV rows are parsed client-side; this handler is the
  // authoritative validation pass (never trust the client-side preview
  // alone). Each row succeeds or fails independently: a malformed row is
  // skipped with a reason, it never blocks or corrupts the rows around it,
  // and it never touches an existing menu item (only ever creates new ones).
  handle(
    'menu:bulkImport',
    async (_event, input: { rows: BulkImportRow[] }) => {
      const rows = input.rows ?? [];
      if (!rows.length) throw new Error('No rows to import.');
      if (rows.length > 2000) throw new Error('Too many rows in one import (max 2000).');

      const categories = await prisma.category.findMany();
      const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
      const partners = await prisma.partner.findMany();
      const partnerByName = new Map(partners.map((p) => [p.name.toLowerCase(), p]));

      const result: BulkImportResult = { created: 0, skipped: [], warnings: [] };

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rowNum = i + 2; // +1 for 0-index, +1 for the header row
        const name = r.name?.trim();
        if (!name) {
          result.skipped.push({ row: rowNum, name: '', reason: 'Missing item name.' });
          continue;
        }

        const category = categoryByName.get((r.categoryName ?? '').trim().toLowerCase());
        if (!category) {
          result.skipped.push({ row: rowNum, name, reason: `Category "${r.categoryName}" not found.` });
          continue;
        }

        const price = Number(r.price);
        if (!Number.isFinite(price) || price < 0) {
          result.skipped.push({ row: rowNum, name, reason: `Invalid price "${r.price}".` });
          continue;
        }

        const dupe = await prisma.menuItem.findFirst({ where: { name, categoryId: category.id } });
        if (dupe) {
          result.skipped.push({ row: rowNum, name, reason: 'Already exists in this category.' });
          continue;
        }

        // Ownership is best-effort: a malformed/incomplete ownership spec
        // never blocks the item itself from importing — it just gets
        // created with no ownership configured, plus a warning.
        let ownerships: { partnerId: number; percentage: number }[] = [];
        if (r.ownerships?.length) {
          let sum = 0;
          let ok = true;
          const resolved: { partnerId: number; percentage: number }[] = [];
          for (const o of r.ownerships) {
            const partner = partnerByName.get(o.partnerName.trim().toLowerCase());
            if (!partner || !(o.percentage > 0)) {
              ok = false;
              break;
            }
            resolved.push({ partnerId: partner.id, percentage: o.percentage });
            sum += o.percentage;
          }
          if (ok && Math.abs(sum - 100) <= 0.5) {
            ownerships = resolved;
          } else {
            result.warnings.push({
              row: rowNum,
              name,
              message: 'Partner ownership ignored — invalid or does not total 100%.',
            });
          }
        }

        await prisma.menuItem.create({
          data: {
            name,
            categoryId: category.id,
            price,
            description: r.description?.trim() || null,
            available: true,
            ...(ownerships.length ? { partnerOwnerships: { create: ownerships } } : {}),
          },
        });
        result.created++;
      }

      return result;
    },
    { requiredRole: 'ADMIN' }
  );
}
