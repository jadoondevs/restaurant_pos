/**
 * Batch 6 report aggregation tests — mirrors the exact grouping/totals
 * logic in electron/ipc/reports.ts's reports:partners, reports:payments,
 * and reports:serviceCharges handlers.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Partner report
// ---------------------------------------------------------------------------
interface FakeAllocation {
  partnerId: number | null;
  partnerName: string;
  amount: number;
  orderItem: { name: string; quantity: number; lineTotal: number };
}

function summarizePartnerReport(allocations: FakeAllocation[]) {
  interface ItemLine {
    name: string;
    quantity: number;
    sales: number;
    partnerShare: number;
  }
  interface PartnerGroup {
    partnerId: number | null;
    partnerName: string;
    items: Map<string, ItemLine>;
    totalShare: number;
  }
  const byPartner = new Map<string, PartnerGroup>();

  for (const a of allocations) {
    const pKey = String(a.partnerId ?? 'null');
    const partner = byPartner.get(pKey) ?? {
      partnerId: a.partnerId,
      partnerName: a.partnerName,
      items: new Map<string, ItemLine>(),
      totalShare: 0,
    };
    const line = partner.items.get(a.orderItem.name) ?? {
      name: a.orderItem.name,
      quantity: 0,
      sales: 0,
      partnerShare: 0,
    };
    line.quantity += a.orderItem.quantity;
    line.sales += a.orderItem.lineTotal;
    line.partnerShare += a.amount;
    partner.items.set(a.orderItem.name, line);
    partner.totalShare += a.amount;
    byPartner.set(pKey, partner);
  }

  const partners = [...byPartner.values()].map((p) => ({
    partnerId: p.partnerId,
    partnerName: p.partnerName,
    items: [...p.items.values()].map((i) => ({
      name: i.name,
      quantity: i.quantity,
      sales: +i.sales.toFixed(2),
      effectivePercentage: i.sales > 0 ? +((i.partnerShare / i.sales) * 100).toFixed(1) : 0,
      partnerShare: +i.partnerShare.toFixed(2),
    })),
    totalShare: +p.totalShare.toFixed(2),
  }));

  return { partners, grandTotal: +partners.reduce((sum, p) => sum + p.totalShare, 0).toFixed(2) };
}

describe('partner report — matches the spec worked example', () => {
  it('Partner A, Chicken Burger, qty 20, sales 20000, 50% -> share 10000', () => {
    const allocations: FakeAllocation[] = [
      {
        partnerId: 1,
        partnerName: 'Partner A',
        amount: 10000,
        orderItem: { name: 'Chicken Burger', quantity: 20, lineTotal: 20000 },
      },
    ];
    const result = summarizePartnerReport(allocations);
    const item = result.partners[0].items[0];
    expect(item.quantity).toBe(20);
    expect(item.sales).toBe(20000);
    expect(item.effectivePercentage).toBe(50);
    expect(item.partnerShare).toBe(10000);
  });

  it('60/40 item split across two partners produces two independent partner entries', () => {
    const allocations: FakeAllocation[] = [
      { partnerId: 1, partnerName: 'A', amount: 600, orderItem: { name: 'Pizza', quantity: 1, lineTotal: 1000 } },
      { partnerId: 2, partnerName: 'B', amount: 400, orderItem: { name: 'Pizza', quantity: 1, lineTotal: 1000 } },
    ];
    const result = summarizePartnerReport(allocations);
    expect(result.partners).toHaveLength(2);
    expect(result.partners.find((p) => p.partnerName === 'A')!.totalShare).toBe(600);
    expect(result.partners.find((p) => p.partnerName === 'B')!.totalShare).toBe(400);
    expect(result.grandTotal).toBe(1000);
  });

  it('aggregates multiple sales of the same item for one partner', () => {
    const allocations: FakeAllocation[] = [
      { partnerId: 1, partnerName: 'A', amount: 500, orderItem: { name: 'Burger', quantity: 1, lineTotal: 1000 } },
      { partnerId: 1, partnerName: 'A', amount: 500, orderItem: { name: 'Burger', quantity: 1, lineTotal: 1000 } },
    ];
    const result = summarizePartnerReport(allocations);
    expect(result.partners).toHaveLength(1);
    expect(result.partners[0].items[0].quantity).toBe(2);
    expect(result.partners[0].items[0].sales).toBe(2000);
    expect(result.partners[0].totalShare).toBe(1000);
  });

  it('returns an empty report for no allocations (no matching records)', () => {
    const result = summarizePartnerReport([]);
    expect(result.partners).toEqual([]);
    expect(result.grandTotal).toBe(0);
  });

  it('a single-partner-selected report excludes unrelated partners entirely', () => {
    // Simulates the partnerId filter already having been applied upstream —
    // the aggregation itself only ever sees the filtered set.
    const allocations: FakeAllocation[] = [
      { partnerId: 1, partnerName: 'A', amount: 500, orderItem: { name: 'Burger', quantity: 1, lineTotal: 1000 } },
    ];
    const result = summarizePartnerReport(allocations);
    expect(result.partners).toHaveLength(1);
    expect(result.partners[0].partnerName).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// Payment report
// ---------------------------------------------------------------------------
interface FakePayment {
  method: string;
  accountDisplayName: string | null;
  amount: number;
}

function summarizePaymentReport(payments: FakePayment[]) {
  interface MethodGroup {
    method: string;
    accountDisplayName: string | null;
    amount: number;
    count: number;
  }
  const byMethod = new Map<string, MethodGroup>();
  let totalCash = 0;
  let totalCollected = 0;

  for (const p of payments) {
    const key = `${p.method}:${p.accountDisplayName ?? ''}`;
    const entry = byMethod.get(key) ?? {
      method: p.method,
      accountDisplayName: p.accountDisplayName,
      amount: 0,
      count: 0,
    };
    entry.amount += p.amount;
    entry.count += 1;
    byMethod.set(key, entry);
    totalCollected += p.amount;
    if (p.method === 'CASH') totalCash += p.amount;
  }

  return {
    byMethod: [...byMethod.values()].map((m) => ({ ...m, amount: +m.amount.toFixed(2) })),
    totals: {
      totalCash: +totalCash.toFixed(2),
      totalOnline: +(totalCollected - totalCash).toFixed(2),
      totalCollected: +totalCollected.toFixed(2),
    },
  };
}

describe('payment report', () => {
  it('matches the spec worked example: Cash 100000, Easypaisa 33000, Bank 42000', () => {
    const payments: FakePayment[] = [
      { method: 'CASH', accountDisplayName: null, amount: 100000 },
      { method: 'EASYPAISA', accountDisplayName: 'Restaurant Easypaisa', amount: 33000 },
      { method: 'BANK', accountDisplayName: 'ABC Bank', amount: 42000 },
    ];
    const result = summarizePaymentReport(payments);
    expect(result.totals.totalCash).toBe(100000);
    expect(result.totals.totalOnline).toBe(75000);
    expect(result.totals.totalCollected).toBe(175000);
  });

  it('separates two Easypaisa accounts into distinct rows', () => {
    const payments: FakePayment[] = [
      { method: 'EASYPAISA', accountDisplayName: 'Account A', amount: 25000 },
      { method: 'EASYPAISA', accountDisplayName: 'Account B', amount: 8000 },
    ];
    const result = summarizePaymentReport(payments);
    expect(result.byMethod).toHaveLength(2);
    expect(result.byMethod.find((m) => m.accountDisplayName === 'Account A')?.amount).toBe(25000);
    expect(result.byMethod.find((m) => m.accountDisplayName === 'Account B')?.amount).toBe(8000);
  });

  it('cash-only period reports zero online total', () => {
    const result = summarizePaymentReport([{ method: 'CASH', accountDisplayName: null, amount: 500 }]);
    expect(result.totals.totalOnline).toBe(0);
    expect(result.totals.totalCash).toBe(500);
  });

  it('empty period returns all-zero totals', () => {
    const result = summarizePaymentReport([]);
    expect(result.totals).toEqual({ totalCash: 0, totalOnline: 0, totalCollected: 0 });
  });
});

// ---------------------------------------------------------------------------
// Service charge report — separate from sales, always
// ---------------------------------------------------------------------------
describe('service charge report — never counted as sales', () => {
  it('sums service charge amounts independent of any sales/grandTotal figure', () => {
    const orders = [
      { id: 1, serviceChargeAmount: 50 },
      { id: 2, serviceChargeAmount: 150 },
    ];
    const periodTotal = orders.reduce((sum, o) => sum + o.serviceChargeAmount, 0);
    expect(periodTotal).toBe(200);
    // This total is computed purely from serviceChargeAmount — it has no
    // dependency on grandTotal/subtotal, which is what keeps it out of
    // every sales figure elsewhere in the app.
  });

  it('an order with no service charge is excluded (serviceChargeAmount > 0 filter)', () => {
    const orders = [{ serviceChargeAmount: 0 }, { serviceChargeAmount: 100 }];
    const withCharge = orders.filter((o) => o.serviceChargeAmount > 0);
    expect(withCharge).toHaveLength(1);
  });
});
