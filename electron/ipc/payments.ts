/**
 * Payment recording/update/delete infrastructure.
 *
 * This is the backend half of the payment architecture: PaymentAccount is
 * the live, admin-configured list of what the restaurant accepts (Batch 8);
 * Payment is the actual, historical record of what was collected against an
 * order. No UI calls these yet — the existing POS checkout flow already
 * creates its own CASH Payment row atomically in orders:create. These
 * handlers exist so the Orders page can record/edit/remove a payment (e.g.
 * the customer decided to pay via Easypaisa after the bill was printed)
 * once that UI is built, without any further backend work.
 *
 * Payment.orderId is intentionally not unique — an order can carry more
 * than one Payment row. Order.paymentStatus is always derived from the
 * current set of Payment rows via computePaymentStatus(); it is never set
 * directly anywhere outside recalculateOrderPaymentStatus() below.
 */
import prisma from '../database/client';
import { handle } from './util';
import { calculateTotalDue, computePaymentStatus, assertValidPaymentAmount } from '../utils/billing';

interface RecordPaymentInput {
  orderId: number;
  method: string;
  amount: number;
  paymentAccountId?: number | null;
  recordedBy?: string | null;
}

interface UpdatePaymentInput {
  id: number;
  method?: string;
  amount?: number;
  paymentAccountId?: number | null;
}

/** Snapshot of a PaymentAccount's identifying details at the moment a payment is recorded. */
async function snapshotAccount(paymentAccountId: number | null | undefined) {
  if (!paymentAccountId) {
    return { paymentAccountId: null, accountDisplayName: null, accountNumberSnap: null, ibanSnap: null };
  }
  const account = await prisma.paymentAccount.findUnique({ where: { id: paymentAccountId } });
  if (!account) {
    return { paymentAccountId: null, accountDisplayName: null, accountNumberSnap: null, ibanSnap: null };
  }
  return {
    paymentAccountId: account.id,
    accountDisplayName: account.displayName,
    accountNumberSnap: account.accountNumber ?? account.phoneNumber ?? null,
    ibanSnap: account.iban ?? null,
  };
}

/**
 * Recomputes and persists Order.paymentStatus from its current Payment rows.
 * The single place paymentStatus is ever written after order creation.
 */
async function recalculateOrderPaymentStatus(orderId: number): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { grandTotal: true, serviceChargeAmount: true },
  });
  if (!order) return;

  const payments = await prisma.payment.findMany({
    where: { orderId },
    select: { amount: true },
  });

  const totalDue = calculateTotalDue(order.grandTotal, order.serviceChargeAmount);
  const status = computePaymentStatus(totalDue, payments);

  await prisma.order.update({ where: { id: orderId }, data: { paymentStatus: status } });
}

export function registerPaymentHandlers() {
  handle('payments:list', async (_event, orderId: number) => {
    return prisma.payment.findMany({ where: { orderId }, orderBy: { recordedAt: 'asc' } });
  });

  // Any authenticated user — recording the actual payment method after the
  // bill is printed is routine cashier work, same trust level as orders:create.
  handle('payments:record', async (_event, input: RecordPaymentInput) => {
    if (!input.orderId) throw new Error('orderId is required.');
    assertValidPaymentAmount(input.amount);

    const method = (input.method || '').trim().toUpperCase();
    if (!method) throw new Error('Payment method is required.');

    const order = await prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new Error('Order not found.');

    const snapshot = await snapshotAccount(input.paymentAccountId);

    const payment = await prisma.payment.create({
      data: {
        orderId: input.orderId,
        method,
        amount: +input.amount.toFixed(2),
        isLegacyPayment: false,
        recordedBy: input.recordedBy || null,
        ...snapshot,
      },
    });

    await recalculateOrderPaymentStatus(input.orderId);
    return payment;
  });

  // Editing/removing a recorded payment is audit-sensitive — MANAGER and above,
  // consistent with orders:delete.
  handle(
    'payments:update',
    async (_event, input: UpdatePaymentInput) => {
      if (!input.id) throw new Error('Payment id is required.');

      const existing = await prisma.payment.findUnique({ where: { id: input.id } });
      if (!existing) throw new Error('Payment not found.');

      if (input.amount !== undefined) assertValidPaymentAmount(input.amount);

      const data: Record<string, unknown> = {};
      if (input.amount !== undefined) data.amount = +input.amount.toFixed(2);
      if (input.method !== undefined) {
        const method = input.method.trim().toUpperCase();
        if (!method) throw new Error('Payment method is required.');
        data.method = method;
      }
      if (input.paymentAccountId !== undefined) {
        Object.assign(data, await snapshotAccount(input.paymentAccountId));
      }

      const payment = await prisma.payment.update({ where: { id: input.id }, data });
      await recalculateOrderPaymentStatus(existing.orderId);
      return payment;
    },
    { requiredRole: 'MANAGER' }
  );

  handle(
    'payments:delete',
    async (_event, id: number) => {
      const existing = await prisma.payment.findUnique({ where: { id } });
      if (!existing) throw new Error('Payment not found.');

      await prisma.payment.delete({ where: { id } });
      await recalculateOrderPaymentStatus(existing.orderId);
      return { success: true };
    },
    { requiredRole: 'MANAGER' }
  );
}
