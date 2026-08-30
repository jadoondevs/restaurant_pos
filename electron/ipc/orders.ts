import prisma from '../database/client';
import { handle } from './util';
import { resolveDateRange, startOfLocalDay } from '../utils/dateRange';

interface OrderItemInput {
  menuItemId?: number | null;
  name: string;
  price: number;
  quantity: number;
  specialInstructions?: string | null;
}

interface OrderInput {
  items: OrderItemInput[];
  discount?: number;
  taxRate?: number;
  cashReceived?: number;
  tableNumber?: string | null;
  customerId?: number | null;
  cashierName?: string | null;
}

interface ListParams {
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
}

async function attachCashierRoles<T extends { cashierName: string | null }>(orders: T[]) {
  const users = await prisma.user.findMany({ select: { fullName: true, role: true } });
  const roles = new Map(users.map((u) => [u.fullName, u.role]));
  return orders.map((order) => ({
    ...order,
    cashierRole: order.cashierName ? roles.get(order.cashierName) ?? null : null,
  }));
}

async function peekReceiptNumber(): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateKey = `${y}${m}${d}`;

  const rows = await prisma.$queryRawUnsafe<{ lastSeq: number }[]>(
    `SELECT "lastSeq" FROM "ReceiptCounter" WHERE "dateKey" = ?`,
    dateKey
  );
  const next = (rows[0]?.lastSeq ?? 0) + 1;
  return `R-${y}${m}${d}-${String(next).padStart(4, '0')}`;
}

export function registerOrderHandlers() {
  handle('orders:peekReceiptNumber', async (_event) => peekReceiptNumber());

  handle('orders:create', async (_event, input: OrderInput) => {
    if (!input.items?.length) throw new Error('Cannot complete an empty order.');

    let subtotal = 0;
    for (const item of input.items) {
      if (!item.quantity || item.quantity < 1) throw new Error(`Invalid quantity for "${item.name}".`);
      if (item.price < 0) throw new Error(`Invalid price for "${item.name}".`);
      subtotal += item.price * item.quantity;
    }

    const discount = Math.max(0, input.discount ?? 0);
    if (discount > subtotal) throw new Error('Discount cannot exceed the subtotal.');

    const taxRate = Math.max(0, input.taxRate ?? 0);
    const taxable = subtotal - discount;
    const taxAmount = +(taxable * (taxRate / 100)).toFixed(2);
    const grandTotal = +(taxable + taxAmount).toFixed(2);
    const cashReceived = input.cashReceived ?? grandTotal;
    const change = +(Math.max(0, cashReceived - grandTotal)).toFixed(2);

    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const y = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, '0');
      const dy = String(now.getDate()).padStart(2, '0');
      const dateKey = `${y}${mo}${dy}`;

      await tx.$executeRawUnsafe(
        `INSERT INTO "ReceiptCounter" ("dateKey", "lastSeq")
         VALUES (?, 1)
         ON CONFLICT ("dateKey") DO UPDATE SET "lastSeq" = "lastSeq" + 1`,
        dateKey
      );
      const rows = await tx.$queryRawUnsafe<{ lastSeq: number }[]>(
        `SELECT "lastSeq" FROM "ReceiptCounter" WHERE "dateKey" = ?`,
        dateKey
      );
      const seq = String(rows[0].lastSeq).padStart(4, '0');
      const receiptNumber = `R-${y}${mo}${dy}-${seq}`;

      return tx.order.create({
        data: {
          receiptNumber,
          subtotal: +subtotal.toFixed(2),
          discount: +discount.toFixed(2),
          taxRate,
          taxAmount,
          grandTotal,
          cashReceived: +cashReceived.toFixed(2),
          change,
          tableNumber: input.tableNumber || null,
          customerId: input.customerId || null,
          cashierName: input.cashierName || null,
          status: 'completed',
          items: {
            create: input.items.map((item) => ({
              menuItemId: item.menuItemId || null,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              specialInstructions: item.specialInstructions || null,
              lineTotal: +(item.price * item.quantity).toFixed(2),
            })),
          },
        },
        include: { items: true, customer: true },
      });
    });
  });

  handle('orders:list', async (_event, params: ListParams = {}) => {
    const where: Record<string, unknown> = {};

    if (params.from || params.to) {
      // resolveDateRange() expands a date-only value ("2026-08-27") to the
      // full inclusive local day instead of truncating it to local midnight,
      // which used to silently drop most of that day's orders.
      const range = resolveDateRange({ from: params.from, to: params.to });
      where.createdAt = {};
      if (params.from) (where.createdAt as Record<string, unknown>).gte = range.gte;
      if (params.to) (where.createdAt as Record<string, unknown>).lte = range.lte;
    } else {
      where.createdAt = { gte: startOfLocalDay() };
    }

    if (params.search?.trim()) {
      const s = params.search.trim();
      where.OR = [
        { receiptNumber: { contains: s } },
        { customer: { name: { contains: s } } },
        { tableNumber: { contains: s } },
      ];
    }

    const orders = await prisma.order.findMany({
      where,
      include: { items: true, customer: true },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 200,
    });
    return attachCashierRoles(orders);
  });

  handle('orders:get', async (_event, id: number) => {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true },
    });
    if (!order) return null;
    const [withRole] = await attachCashierRoles([order]);
    return withRole;
  });

  handle('orders:delete', async (_event, id: number) => {
    await prisma.order.delete({ where: { id } });
    return { success: true };
  }, { requiredRole: 'MANAGER' });
}
