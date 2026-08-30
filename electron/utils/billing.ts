/**
 * Shared billing calculations — service charge and payment status.
 *
 * Kept pure and dependency-free (no Prisma/Electron) so the exact same
 * logic used by orders:create and payments:* is directly unit-tested, and
 * so there is exactly one place that defines what these numbers mean.
 */

export type ServiceChargeType = 'NONE' | 'FIXED' | 'PERCENTAGE';

const VALID_SERVICE_CHARGE_TYPES: ServiceChargeType[] = ['NONE', 'FIXED', 'PERCENTAGE'];

export function isValidServiceChargeType(value: unknown): value is ServiceChargeType {
  return typeof value === 'string' && VALID_SERVICE_CHARGE_TYPES.includes(value as ServiceChargeType);
}

/**
 * Computes the final PKR service-charge amount for an order.
 *
 *   NONE       -> 0, regardless of value
 *   FIXED      -> the value itself, as a PKR amount the cashier entered/selected
 *   PERCENTAGE -> value% of grandTotal (the food bill after discount/tax —
 *                 i.e. "a service charge of value% of the bill")
 *
 * The result is what gets persisted as Order.serviceChargeAmount. It is
 * PERMANENT — once an order is created this value is never recomputed,
 * even if this function's logic or a settings preset changes later.
 */
export function calculateServiceCharge(
  type: ServiceChargeType,
  value: number,
  grandTotal: number
): number {
  if (type === 'NONE') return 0;

  const safeValue = Math.max(0, value || 0);

  if (type === 'FIXED') return +safeValue.toFixed(2);

  // PERCENTAGE
  const safeGrandTotal = Math.max(0, grandTotal || 0);
  return +((safeGrandTotal * safeValue) / 100).toFixed(2);
}

/** totalDue = grandTotal + serviceChargeAmount — the full amount owed for the order. */
export function calculateTotalDue(grandTotal: number, serviceChargeAmount: number): number {
  return +((grandTotal || 0) + (serviceChargeAmount || 0)).toFixed(2);
}

export type PaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID';

// Amounts are stored as rounded-to-cents floats; a tiny epsilon prevents
// legitimate floating-point rounding (e.g. 0.1 + 0.2) from ever reporting
// PARTIAL for an order that was actually paid in full.
const STATUS_EPSILON = 0.01;

/**
 * Derives paymentStatus from the sum of an order's Payment rows against its
 * totalDue. This is the single source of truth for the status — it should
 * never be set by hand anywhere else, only ever written as this function's
 * output, so it can never drift from the actual Payment rows.
 *
 * An overpayment (sum > totalDue) is still PAID, never an error — amounts
 * are never clamped or discarded here or by callers.
 */
export function computePaymentStatus(
  totalDue: number,
  payments: { amount: number }[]
): PaymentStatus {
  const paid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  if (paid <= 0) return 'PENDING';
  if (paid + STATUS_EPSILON >= totalDue) return 'PAID';
  return 'PARTIAL';
}

/**
 * Validates a payment amount is a positive, finite number. Throws a
 * user-facing error on failure. Deliberately does NOT reject or clamp an
 * amount that would overpay the order — only non-positive/non-finite
 * values are invalid.
 */
export function assertValidPaymentAmount(amount: unknown): asserts amount is number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payment amount must be a positive number.');
  }
}
