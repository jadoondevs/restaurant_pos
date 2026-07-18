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
}

interface ListParams {
  search?: string;
  from?: string; // ISO date
  to?: string; // ISO date
  limit?: number;
}

/** Generates a receipt number like R-20260718-0007 (date + daily sequence). */
async function nextReceiptNumber(): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const datePart = `${y}${m}${d}`;

  const start = new Date(y, now.getMonth(), now.getDate());
  const end = new Date(y, now.getMonth(), now.getDate() + 1);
  const countToday = await prisma.order.count({
    where: { createdAt: { gte: start, lt: end } },
  });

  const seq = String(countToday + 1).padStart(4, '0');
  return `R-${datePart}-${seq}`;
}

export function registerOrderHandlers() {
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

    const receiptNumber = await nextReceiptNumber();

    return prisma.order.create({
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

  handle('orders:list', async (params: ListParams = {}) => {
    const where: any = {};

    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to) where.createdAt.lte = new Date(params.to);
    } else {
      // Default: today's orders.
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
    return { success: true };
  });
}
