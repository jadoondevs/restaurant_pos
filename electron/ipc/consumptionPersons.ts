/**
 * Owner/employee lookup list used to classify a POS order as
 * OWNER_CONSUMPTION or EMPLOYEE_CONSUMPTION (see orders:create).
 *
 * Kept intentionally minimal for Batch 3: list + quick-create, mirroring
 * how Customer selection already works in the POS. No update/deactivate
 * UI exists yet — that belongs to a future Settings/management batch, not
 * this one. Records are never hard-deleted by app code (isActive supports
 * soft-delete), which is what keeps Order.consumptionPersonId safe to
 * reference without a DB-level foreign key.
 */
import prisma from '../database/client';
import { handle } from './util';

interface CreateConsumptionPersonInput {
  name: string;
  type: string;
}

export function registerConsumptionPersonHandlers() {
  handle('consumption:list', async (_event, type?: string) => {
    return prisma.consumptionPerson.findMany({
      where: {
        isActive: true,
        ...(type ? { type } : {}),
      },
      orderBy: { name: 'asc' },
    });
  });

  handle('consumption:create', async (_event, input: CreateConsumptionPersonInput) => {
    const name = input.name?.trim();
    if (!name) throw new Error('Name is required.');

    const type = input.type;
    if (type !== 'OWNER' && type !== 'EMPLOYEE') {
      throw new Error('Type must be OWNER or EMPLOYEE.');
    }

    return prisma.consumptionPerson.create({
      data: { name, type, isActive: true },
    });
  });
}
