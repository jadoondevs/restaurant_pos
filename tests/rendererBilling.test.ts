/**
 * Parity test — src/utils/billing.ts (the renderer's POS-screen preview
 * copy) must compute identically to electron/utils/billing.ts (the
 * authoritative, persisted calculation in orders:create). This guards
 * against the two copies drifting apart, since the renderer can't import
 * directly from electron/ in this project's Vite setup.
 */
import { describe, it, expect } from 'vitest';
import * as mainBilling from '../electron/utils/billing';
import * as rendererBilling from '../src/utils/billing';

describe('renderer billing mirrors the main-process calculation', () => {
  const cases: [mainBilling.ServiceChargeType, number, number][] = [
    ['NONE', 0, 1000],
    ['NONE', 500, 1000], // value ignored for NONE
    ['FIXED', 150, 5000],
    ['FIXED', -50, 5000], // negative clamps to 0
    ['PERCENTAGE', 10, 2000],
    ['PERCENTAGE', 7, 999],
    ['PERCENTAGE', 10, 0],
  ];

  it('calculateServiceCharge matches for every case', () => {
    for (const [type, value, grandTotal] of cases) {
      expect(rendererBilling.calculateServiceCharge(type, value, grandTotal)).toBe(
        mainBilling.calculateServiceCharge(type, value, grandTotal)
      );
    }
  });

  it('calculateTotalDue matches for a range of amounts', () => {
    const pairs: [number, number][] = [
      [1000, 0],
      [1000, 100],
      [4500, 225],
      [199.99, 20.01],
    ];
    for (const [grandTotal, serviceChargeAmount] of pairs) {
      expect(rendererBilling.calculateTotalDue(grandTotal, serviceChargeAmount)).toBe(
        mainBilling.calculateTotalDue(grandTotal, serviceChargeAmount)
      );
    }
  });
});
