/**
 * Billing foundation tests (electron/utils/billing.ts).
 *
 * Pure functions, no Electron/Prisma dependency — imported and tested directly.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateServiceCharge,
  calculateTotalDue,
  computePaymentStatus,
  assertValidPaymentAmount,
  isValidServiceChargeType,
} from '../electron/utils/billing';

describe('isValidServiceChargeType', () => {
  it('accepts NONE, FIXED, PERCENTAGE', () => {
    expect(isValidServiceChargeType('NONE')).toBe(true);
    expect(isValidServiceChargeType('FIXED')).toBe(true);
    expect(isValidServiceChargeType('PERCENTAGE')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isValidServiceChargeType('PERCENT')).toBe(false);
    expect(isValidServiceChargeType('')).toBe(false);
    expect(isValidServiceChargeType(undefined)).toBe(false);
    expect(isValidServiceChargeType(null)).toBe(false);
    expect(isValidServiceChargeType(5)).toBe(false);
  });
});

describe('calculateServiceCharge', () => {
  it('NONE always returns 0, regardless of value', () => {
    expect(calculateServiceCharge('NONE', 0, 5000)).toBe(0);
    expect(calculateServiceCharge('NONE', 500, 5000)).toBe(0);
  });

  it('FIXED returns the entered PKR amount as-is', () => {
    expect(calculateServiceCharge('FIXED', 150, 5000)).toBe(150);
    expect(calculateServiceCharge('FIXED', 99.5, 5000)).toBe(99.5);
  });

  it('FIXED clamps a negative value to 0', () => {
    expect(calculateServiceCharge('FIXED', -50, 5000)).toBe(0);
  });

  it('PERCENTAGE computes value% of grandTotal', () => {
    expect(calculateServiceCharge('PERCENTAGE', 10, 1000)).toBe(100);
    expect(calculateServiceCharge('PERCENTAGE', 5, 4500)).toBe(225);
  });

  it('PERCENTAGE of 0 is 0', () => {
    expect(calculateServiceCharge('PERCENTAGE', 0, 1000)).toBe(0);
  });

  it('PERCENTAGE rounds to 2 decimal places', () => {
    // 33.33% of 1000 = 333.3 exactly, but pick a value that forces rounding.
    expect(calculateServiceCharge('PERCENTAGE', 7, 999)).toBe(69.93);
  });

  it('a zero grandTotal produces a zero service charge for PERCENTAGE', () => {
    expect(calculateServiceCharge('PERCENTAGE', 10, 0)).toBe(0);
  });
});

describe('calculateTotalDue', () => {
  it('sums grandTotal and serviceChargeAmount', () => {
    expect(calculateTotalDue(1000, 100)).toBe(1100);
  });

  it('equals grandTotal when there is no service charge', () => {
    expect(calculateTotalDue(4500, 0)).toBe(4500);
  });

  it('handles fractional PKR amounts without float drift', () => {
    expect(calculateTotalDue(199.99, 20.01)).toBe(220);
  });
});

describe('computePaymentStatus', () => {
  it('PENDING when there are no payments', () => {
    expect(computePaymentStatus(1000, [])).toBe('PENDING');
  });

  it('PENDING when the only payment is zero or negative (defensive)', () => {
    expect(computePaymentStatus(1000, [{ amount: 0 }])).toBe('PENDING');
  });

  it('PARTIAL when payments sum to less than totalDue', () => {
    expect(computePaymentStatus(1000, [{ amount: 400 }])).toBe('PARTIAL');
  });

  it('PARTIAL sums multiple payment rows', () => {
    expect(computePaymentStatus(1000, [{ amount: 300 }, { amount: 200 }])).toBe('PARTIAL');
  });

  it('PAID when payments exactly equal totalDue', () => {
    expect(computePaymentStatus(1000, [{ amount: 1000 }])).toBe('PAID');
  });

  it('PAID when payments sum across multiple rows to exactly totalDue', () => {
    expect(computePaymentStatus(4500, [{ amount: 2000 }, { amount: 1500 }, { amount: 1000 }])).toBe(
      'PAID'
    );
  });

  it('PAID on overpayment — never rejected, never treated as an error', () => {
    expect(computePaymentStatus(1000, [{ amount: 1500 }])).toBe('PAID');
  });

  it('PAID despite tiny floating-point rounding just under totalDue', () => {
    // 0.1 + 0.2 famously does not equal 0.3 exactly in IEEE 754.
    const totalDue = 0.3;
    const payments = [{ amount: 0.1 }, { amount: 0.2 }];
    expect(computePaymentStatus(totalDue, payments)).toBe('PAID');
  });

  it('PARTIAL when clearly short, even with rounding tolerance considered', () => {
    expect(computePaymentStatus(1000, [{ amount: 989 }])).toBe('PARTIAL');
  });
});

describe('assertValidPaymentAmount', () => {
  it('accepts a positive finite number', () => {
    expect(() => assertValidPaymentAmount(1)).not.toThrow();
    expect(() => assertValidPaymentAmount(4500.5)).not.toThrow();
  });

  it('rejects zero', () => {
    expect(() => assertValidPaymentAmount(0)).toThrow(/positive/);
  });

  it('rejects a negative amount', () => {
    expect(() => assertValidPaymentAmount(-100)).toThrow(/positive/);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => assertValidPaymentAmount(NaN)).toThrow();
    expect(() => assertValidPaymentAmount(Infinity)).toThrow();
  });

  it('rejects non-number types', () => {
    expect(() => assertValidPaymentAmount('100')).toThrow();
    expect(() => assertValidPaymentAmount(null)).toThrow();
    expect(() => assertValidPaymentAmount(undefined)).toThrow();
  });

  it('does not clamp or reject a large overpayment amount', () => {
    // An overpayment is a valid amount at the validation stage — clamping
    // or rejecting it is computePaymentStatus's job to interpret, not this
    // function's job to prevent.
    expect(() => assertValidPaymentAmount(999999)).not.toThrow();
  });
});

describe('billing flow — cash-now checkout composition (mirrors orders:create)', () => {
  /** Mirrors the exact composition used in electron/ipc/orders.ts's orders:create. */
  function simulateCashNowCheckout(
    grandTotal: number,
    serviceChargeType: 'NONE' | 'FIXED' | 'PERCENTAGE',
    serviceChargeValue: number,
    cashReceivedInput: number | undefined
  ) {
    const serviceChargeAmount = calculateServiceCharge(serviceChargeType, serviceChargeValue, grandTotal);
    const totalDue = calculateTotalDue(grandTotal, serviceChargeAmount);
    const cashReceived = cashReceivedInput ?? totalDue;
    const change = +Math.max(0, cashReceived - totalDue).toFixed(2);
    const paymentAmount = +Math.min(Math.max(0, cashReceived), totalDue).toFixed(2);
    const paymentStatus =
      paymentAmount > 0 ? computePaymentStatus(totalDue, [{ amount: paymentAmount }]) : 'PENDING';
    return { serviceChargeAmount, totalDue, cashReceived, change, paymentAmount, paymentStatus };
  }

  it('no service charge, exact cash: PAID, no change, full amount applied', () => {
    const r = simulateCashNowCheckout(1000, 'NONE', 0, 1000);
    expect(r.totalDue).toBe(1000);
    expect(r.paymentAmount).toBe(1000);
    expect(r.change).toBe(0);
    expect(r.paymentStatus).toBe('PAID');
  });

  it('with a fixed service charge, totalDue includes it and defaults cashReceived to totalDue', () => {
    const r = simulateCashNowCheckout(1000, 'FIXED', 100, undefined);
    expect(r.serviceChargeAmount).toBe(100);
    expect(r.totalDue).toBe(1100);
    expect(r.cashReceived).toBe(1100);
    expect(r.paymentAmount).toBe(1100);
    expect(r.paymentStatus).toBe('PAID');
  });

  it('with a percentage service charge, more cash than due produces change but payment amount is capped at totalDue', () => {
    const r = simulateCashNowCheckout(2000, 'PERCENTAGE', 10, 2500);
    expect(r.serviceChargeAmount).toBe(200);
    expect(r.totalDue).toBe(2200);
    expect(r.change).toBe(300); // 2500 - 2200
    expect(r.paymentAmount).toBe(2200); // capped, never exceeds totalDue
    expect(r.paymentStatus).toBe('PAID');
  });

  it('cash received less than totalDue results in PARTIAL, not an error', () => {
    const r = simulateCashNowCheckout(1000, 'NONE', 0, 400);
    expect(r.paymentAmount).toBe(400);
    expect(r.change).toBe(0);
    expect(r.paymentStatus).toBe('PARTIAL');
  });

  it('cashReceived of 0 (future print-first flow) creates no payment — stays PENDING', () => {
    const r = simulateCashNowCheckout(1000, 'NONE', 0, 0);
    expect(r.paymentAmount).toBe(0);
    expect(r.paymentStatus).toBe('PENDING');
  });
});
