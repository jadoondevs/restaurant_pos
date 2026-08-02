import prisma from '../database/client';
import { handle } from './util';

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

/**
 * Peeks at the next receipt number without persisting anything.
 * Used by the renderer to display the receipt number before the user
 * confirms the sale. The actual allocation happens inside orders:create.
 */
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
  handle('orders:peekReceiptNumber', async () => peekReceiptNumber());

  handle('orders:create', async (input: OrderInput) => {
    if (!input.items?.length) throw new Error('Cannot complete an empty order.');

    // Validate line items and compute totals server-side (source of truth).
    let subtotal = 0;
    for (const item of input.items) {
      if (!item.quantity || item.quantity < 1) {
        throw new Error(`Invalid quantity for "${item.name}".`);
      }
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

    // Allocate receipt number and create the order atomically in one transaction.
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const y = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, '0');
      const dy = String(now.getDate()).padStart(2, '0');
      const dateKey = `${y}${mo}${dy}`;

      // Atomic upsert: create counter row with seq=1, or increment existing.
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

  handle('orders:list', async (params: ListParams = {}) => {
    const where: Record<string, unknown> = {};

    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) (where.createdAt as Record<string, unknown>).gte = new Date(params.from);
      if (params.to) (where.createdAt as Record<string, unknown>).lte = new Date(params.to);
    } else {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      where.createdAt = { gte: start };
    }

    if (params.search?.trim()) {
      const s = params.search.trim();
      where.OR = [
        { receiptNumber: { contains: s } },
        { customer: { name: { contains: s } } },
        { tableNumber: { contains: s } },
      ];
    }

    return prisma.order.findMany({
      where,
      include: { items: true, customer: true },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 200,
    });
  });

  handle('orders:get', async (id: number) =>
    prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true },
    })
  );

  handle('orders:delete', async (id: number) => {
    await prisma.order.delete({ where: { id } });
    // ReceiptCounter is intentionally NOT decremented.
    // Deleted orders must never cause receipt number reuse.
    return { success: true };
  });
}
