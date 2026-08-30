/**
 * Follow-up batch after Batch 11 — mirrors the new aggregation logic added
 * to electron/ipc/reports.ts: reports:dashboard's isToday computation,
 * reports:consumption's item-level per-person breakdown, and
 * reports:serviceCharges' fixed/percentage split.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Dashboard isToday
// ---------------------------------------------------------------------------
function computeIsToday(rangeGte: Date, rangeLte: Date, todayGte: Date, todayLte: Date): boolean {
  return rangeGte.getTime() === todayGte.getTime() && rangeLte.getTime() === todayLte.getTime();
}

describe('reports:dashboard — isToday', () => {
  it('is true when the resolved range exactly matches todayRange()', () => {
    const today = new Date(2026, 7, 30);
    const gte = new Date(2026, 7, 30, 0, 0, 0, 0);
    const lte = new Date(2026, 7, 30, 23, 59, 59, 999);
    expect(computeIsToday(gte, lte, gte, lte)).toBe(true);
    void today;
  });

  it('is false for a single historical date', () => {
    const historicalGte = new Date(2026, 7, 25, 0, 0, 0, 0);
    const historicalLte = new Date(2026, 7, 25, 23, 59, 59, 999);
    const todayGte = new Date(2026, 7, 30, 0, 0, 0, 0);
    const todayLte = new Date(2026, 7, 30, 23, 59, 59, 999);
    expect(computeIsToday(historicalGte, historicalLte, todayGte, todayLte)).toBe(false);
  });

  it('is false for a multi-day range that happens to include today', () => {
    const gte = new Date(2026, 7, 25, 0, 0, 0, 0);
    const lte = new Date(2026, 7, 30, 23, 59, 59, 999); // ends on today, but starts earlier
    const todayGte = new Date(2026, 7, 30, 0, 0, 0, 0);
    const todayLte = new Date(2026, 7, 30, 23, 59, 59, 999);
    expect(computeIsToday(gte, lte, todayGte, todayLte)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dashboard historical aggregation (Priority 1) — revenue/orderCount/
// averageOrderValue/activeTables computed over an arbitrary selected range,
// mirroring reports:dashboard exactly.
// ---------------------------------------------------------------------------
interface FakeDashboardOrder {
  grandTotal: number;
  tableNumber: string | null;
}

function summarizeDashboard(orders: FakeDashboardOrder[]) {
  const revenue = orders.reduce((sum, o) => sum + o.grandTotal, 0);
  const activeTables = new Set(orders.filter((o) => o.tableNumber).map((o) => o.tableNumber)).size;
  return {
    revenue: +revenue.toFixed(2),
    orderCount: orders.length,
    activeTables,
    averageOrderValue: orders.length ? +(revenue / orders.length).toFixed(2) : 0,
  };
}

describe('reports:dashboard — historical aggregation for a selected date/range', () => {
  it('sums revenue and counts orders only within the given set (the caller already filtered by date)', () => {
    const result = summarizeDashboard([
      { grandTotal: 1000, tableNumber: 'T1' },
      { grandTotal: 2000, tableNumber: 'T2' },
      { grandTotal: 500, tableNumber: null },
    ]);
    expect(result.revenue).toBe(3500);
    expect(result.orderCount).toBe(3);
    expect(result.averageOrderValue).toBeCloseTo(1166.67, 2);
  });

  it('counts distinct table numbers only, ignoring walk-in (null table) orders', () => {
    const result = summarizeDashboard([
      { grandTotal: 100, tableNumber: 'T1' },
      { grandTotal: 100, tableNumber: 'T1' }, // same table twice
      { grandTotal: 100, tableNumber: 'T2' },
      { grandTotal: 100, tableNumber: null },
    ]);
    expect(result.activeTables).toBe(2);
  });

  it('an empty period returns all-zero stats, not a crash', () => {
    const result = summarizeDashboard([]);
    expect(result).toEqual({ revenue: 0, orderCount: 0, activeTables: 0, averageOrderValue: 0 });
  });
});

// ---------------------------------------------------------------------------
// Item-level consumption (Priority 8)
// ---------------------------------------------------------------------------
interface FakeConsumptionOrder {
  consumptionPersonId: number | null;
  consumptionPersonName: string;
  orderType: 'OWNER_CONSUMPTION' | 'EMPLOYEE_CONSUMPTION';
  items: { name: string; quantity: number; lineTotal: number }[];
}

function summarizeConsumptionByPerson(orders: FakeConsumptionOrder[]) {
  interface PersonItem {
    name: string;
    quantity: number;
    value: number;
  }
  interface PersonSummary {
    consumptionPersonId: number | null;
    personName: string;
    orderType: string;
    orderCount: number;
    quantity: number;
    value: number;
    items: Map<string, PersonItem>;
  }
  const byPerson = new Map<string, PersonSummary>();

  for (const order of orders) {
    const orderValue = order.items.reduce((sum, i) => sum + i.lineTotal, 0);
    const key = `${order.consumptionPersonId ?? 'null'}:${order.orderType}`;
    const entry = byPerson.get(key) ?? {
      consumptionPersonId: order.consumptionPersonId,
      personName: order.consumptionPersonName,
      orderType: order.orderType,
      orderCount: 0,
      quantity: 0,
      value: 0,
      items: new Map<string, PersonItem>(),
    };
    entry.orderCount += 1;
    entry.quantity += order.items.reduce((sum, i) => sum + i.quantity, 0);
    entry.value += orderValue;
    for (const i of order.items) {
      const line = entry.items.get(i.name) ?? { name: i.name, quantity: 0, value: 0 };
      line.quantity += i.quantity;
      line.value += i.lineTotal;
      entry.items.set(i.name, line);
    }
    byPerson.set(key, entry);
  }

  return [...byPerson.values()].map((p) => ({
    ...p,
    items: [...p.items.values()],
  }));
}

describe('reports:consumption — item-level detail', () => {
  it('lists each distinct item an employee consumed, with quantity and value', () => {
    const orders: FakeConsumptionOrder[] = [
      {
        consumptionPersonId: 1,
        consumptionPersonName: 'John',
        orderType: 'EMPLOYEE_CONSUMPTION',
        items: [{ name: 'Burger', quantity: 1, lineTotal: 500 }],
      },
    ];
    const result = summarizeConsumptionByPerson(orders);
    expect(result).toHaveLength(1);
    expect(result[0].items).toEqual([{ name: 'Burger', quantity: 1, value: 500 }]);
  });

  it('aggregates the same item across multiple orders for one person', () => {
    const orders: FakeConsumptionOrder[] = [
      {
        consumptionPersonId: 1,
        consumptionPersonName: 'John',
        orderType: 'EMPLOYEE_CONSUMPTION',
        items: [{ name: 'Burger', quantity: 1, lineTotal: 500 }],
      },
      {
        consumptionPersonId: 1,
        consumptionPersonName: 'John',
        orderType: 'EMPLOYEE_CONSUMPTION',
        items: [{ name: 'Burger', quantity: 2, lineTotal: 1000 }],
      },
    ];
    const result = summarizeConsumptionByPerson(orders);
    expect(result[0].items).toEqual([{ name: 'Burger', quantity: 3, value: 1500 }]);
  });

  it('keeps different items as separate lines for the same person', () => {
    const orders: FakeConsumptionOrder[] = [
      {
        consumptionPersonId: 1,
        consumptionPersonName: 'John',
        orderType: 'EMPLOYEE_CONSUMPTION',
        items: [
          { name: 'Burger', quantity: 1, lineTotal: 500 },
          { name: 'Fries', quantity: 1, lineTotal: 200 },
        ],
      },
    ];
    const result = summarizeConsumptionByPerson(orders);
    expect(result[0].items).toHaveLength(2);
    expect(result[0].items.find((i) => i.name === 'Fries')?.value).toBe(200);
  });

  it('keeps multiple people fully separate (owner vs employee, item-level)', () => {
    const orders: FakeConsumptionOrder[] = [
      {
        consumptionPersonId: 1,
        consumptionPersonName: 'Owner Jane',
        orderType: 'OWNER_CONSUMPTION',
        items: [{ name: 'Pizza', quantity: 1, lineTotal: 1000 }],
      },
      {
        consumptionPersonId: 2,
        consumptionPersonName: 'Employee John',
        orderType: 'EMPLOYEE_CONSUMPTION',
        items: [{ name: 'Burger', quantity: 1, lineTotal: 500 }],
      },
    ];
    const result = summarizeConsumptionByPerson(orders);
    expect(result).toHaveLength(2);
    const owner = result.find((p) => p.personName === 'Owner Jane')!;
    const employee = result.find((p) => p.personName === 'Employee John')!;
    expect(owner.items).toEqual([{ name: 'Pizza', quantity: 1, value: 1000 }]);
    expect(employee.items).toEqual([{ name: 'Burger', quantity: 1, value: 500 }]);
  });
});

// ---------------------------------------------------------------------------
// Service charge fixed/percentage breakdown (Priority 7E)
// ---------------------------------------------------------------------------
interface FakeServiceChargeOrder {
  serviceChargeType: 'NONE' | 'FIXED' | 'PERCENTAGE';
  serviceChargeAmount: number;
}

function summarizeServiceChargeBreakdown(orders: FakeServiceChargeOrder[]) {
  let fixedCount = 0;
  let fixedTotal = 0;
  let percentageCount = 0;
  let percentageTotal = 0;
  for (const o of orders) {
    if (o.serviceChargeType === 'FIXED') {
      fixedCount += 1;
      fixedTotal += o.serviceChargeAmount;
    } else if (o.serviceChargeType === 'PERCENTAGE') {
      percentageCount += 1;
      percentageTotal += o.serviceChargeAmount;
    }
  }
  return { fixedCount, fixedTotal, percentageCount, percentageTotal };
}

describe('reports:serviceCharges — fixed vs percentage breakdown', () => {
  it('separates fixed and percentage charges into independent counts/totals', () => {
    const orders: FakeServiceChargeOrder[] = [
      { serviceChargeType: 'FIXED', serviceChargeAmount: 100 },
      { serviceChargeType: 'FIXED', serviceChargeAmount: 150 },
      { serviceChargeType: 'PERCENTAGE', serviceChargeAmount: 200 },
    ];
    const result = summarizeServiceChargeBreakdown(orders);
    expect(result.fixedCount).toBe(2);
    expect(result.fixedTotal).toBe(250);
    expect(result.percentageCount).toBe(1);
    expect(result.percentageTotal).toBe(200);
  });

  it('an order with NONE contributes to neither bucket', () => {
    const result = summarizeServiceChargeBreakdown([{ serviceChargeType: 'NONE', serviceChargeAmount: 0 }]);
    expect(result.fixedCount).toBe(0);
    expect(result.percentageCount).toBe(0);
  });

  it('empty period returns all-zero breakdown', () => {
    const result = summarizeServiceChargeBreakdown([]);
    expect(result).toEqual({ fixedCount: 0, fixedTotal: 0, percentageCount: 0, percentageTotal: 0 });
  });
});
