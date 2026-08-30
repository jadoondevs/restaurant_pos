/**
 * Business partner management. A Partner can own a fractional share of one
 * or more menu items — the live configuration lives in MenuItemPartner
 * (see electron/ipc/partnerOwnership.ts); this file only manages the
 * Partner entities themselves (name, active/inactive).
 *
 * Partners are never hard-deleted by app code — isActive supports
 * soft-delete/reactivation, same pattern as User and ConsumptionPerson,
 * which is what keeps historical OrderItemPartnerAllocation snapshots
 * (partnerName, percentage) meaningful even after a partner is retired.
 */
import prisma from '../database/client';
import { handle } from './util';

interface CreatePartnerInput {
  name: string;
}

interface UpdatePartnerInput {
  id: number;
  name: string;
}

export function registerPartnerHandlers() {
  handle('partners:list', async (_event, activeOnly?: boolean) => {
    return prisma.partner.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { name: 'asc' },
    });
  });

  handle(
    'partners:create',
    async (_event, input: CreatePartnerInput) => {
      const name = input.name?.trim();
      if (!name) throw new Error('Partner name is required.');

      const existing = await prisma.partner.findUnique({ where: { name } });
      if (existing) throw new Error(`Partner "${name}" already exists.`);

      return prisma.partner.create({ data: { name, isActive: true } });
    },
    { requiredRole: 'ADMIN' }
  );

  handle(
    'partners:update',
    async (_event, input: UpdatePartnerInput) => {
      if (!input.id) throw new Error('Partner id is required.');
      const name = input.name?.trim();
      if (!name) throw new Error('Partner name is required.');

      const dupe = await prisma.partner.findFirst({ where: { name, NOT: { id: input.id } } });
      if (dupe) throw new Error(`Partner "${name}" already exists.`);

      return prisma.partner.update({ where: { id: input.id }, data: { name } });
    },
    { requiredRole: 'ADMIN' }
  );

  handle(
    'partners:setActive',
    async (_event, data: { id: number; isActive: boolean }) => {
      if (!data.id) throw new Error('Partner id is required.');
      return prisma.partner.update({ where: { id: data.id }, data: { isActive: data.isActive } });
    },
    { requiredRole: 'ADMIN' }
  );
}
