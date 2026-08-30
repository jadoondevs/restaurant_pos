/**
 * Live/current partner ownership configuration for menu items
 * (MenuItemPartner). This is what orders:create reads at sale time to
 * build the historical OrderItemPartnerAllocation snapshot — editing the
 * ownership here NEVER changes a past sale's already-recorded allocation.
 *
 * Kept intentionally simple: the full ownership set for one menu item is
 * replaced atomically on every save, rather than incremental add/remove
 * endpoints — there's no meaningful "partial" state worth supporting here,
 * and this avoids a class of bugs where stale rows are left behind.
 */
import prisma from '../database/client';
import { handle } from './util';

interface OwnershipRowInput {
  partnerId: number;
  percentage: number;
}

interface SetOwnershipInput {
  menuItemId: number;
  ownerships: OwnershipRowInput[];
}

// Ownership percentages are typically entered by hand as whole or
// half-point numbers — this tolerance absorbs minor rounding without
// being loose enough to let a genuinely wrong total (e.g. 90%) through.
const SUM_TOLERANCE = 0.5;

export function registerPartnerOwnershipHandlers() {
  handle('partnerOwnership:list', async (_event, menuItemId: number) => {
    return prisma.menuItemPartner.findMany({
      where: { menuItemId },
      include: { partner: true },
      orderBy: { id: 'asc' },
    });
  });

  handle(
    'partnerOwnership:set',
    async (_event, input: SetOwnershipInput) => {
      if (!input.menuItemId) throw new Error('menuItemId is required.');

      const menuItem = await prisma.menuItem.findUnique({ where: { id: input.menuItemId } });
      if (!menuItem) throw new Error('Menu item not found.');

      const rows = input.ownerships ?? [];

      if (rows.length > 0) {
        const seen = new Set<number>();
        let total = 0;
        for (const row of rows) {
          if (!row.partnerId) throw new Error('Each ownership row needs a partner.');
          if (seen.has(row.partnerId)) throw new Error('A partner cannot appear twice for the same item.');
          seen.add(row.partnerId);

          if (typeof row.percentage !== 'number' || row.percentage <= 0) {
            throw new Error('Each ownership percentage must be a positive number.');
          }
          total += row.percentage;
        }

        if (Math.abs(total - 100) > SUM_TOLERANCE) {
          throw new Error(`Ownership percentages must total 100% (currently ${total.toFixed(1)}%).`);
        }

        const partnerIds = [...seen];
        const partners = await prisma.partner.findMany({ where: { id: { in: partnerIds } } });
        if (partners.length !== partnerIds.length) {
          throw new Error('One or more selected partners could not be found.');
        }
      }

      await prisma.$transaction([
        prisma.menuItemPartner.deleteMany({ where: { menuItemId: input.menuItemId } }),
        ...(rows.length > 0
          ? [
              prisma.menuItemPartner.createMany({
                data: rows.map((r) => ({
                  menuItemId: input.menuItemId,
                  partnerId: r.partnerId,
                  percentage: r.percentage,
                })),
              }),
            ]
          : []),
      ]);

      return prisma.menuItemPartner.findMany({
        where: { menuItemId: input.menuItemId },
        include: { partner: true },
        orderBy: { id: 'asc' },
      });
    },
    { requiredRole: 'ADMIN' }
  );
}
