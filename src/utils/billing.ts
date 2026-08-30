/**
 * Renderer-side mirror of electron/utils/billing.ts's service-charge math.
 *
 * The main process is the authoritative source of truth — orders:create
 * recomputes and persists serviceChargeAmount independently. This copy
 * exists only so the POS screen can show a live, correct total *before*
 * submitting. Keep these two functions identical; if one changes, change
 * the other the same way.
 */

export type ServiceChargeType = 'NONE' | 'FIXED' | 'PERCENTAGE';

export function calculateServiceCharge(
  type: ServiceChargeType,
  value: number,
  grandTotal: number
): number {
  if (type === 'NONE') return 0;

  const safeValue = Math.max(0, value || 0);

  if (type === 'FIXED') return +safeValue.toFixed(2);

  const safeGrandTotal = Math.max(0, grandTotal || 0);
  return +((safeGrandTotal * safeValue) / 100).toFixed(2);
}

export function calculateTotalDue(grandTotal: number, serviceChargeAmount: number): number {
  return +((grandTotal || 0) + (serviceChargeAmount || 0)).toFixed(2);
}
