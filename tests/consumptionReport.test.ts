/**
 * Owner/employee consumption report aggregation tests — mirrors the exact
 * grouping/totals logic in electron/ipc/reports.ts's reports:consumption
 * handler, consistent with this project's approach of testing orders.ts/
 * reports.ts-adjacent logic without Electron or Prisma.
 */
import { describe, it, expect } from 'vitest';

interface FakeOrder {
  id: number;
  consumptionPersonId: number | null;
  consumptionPersonName: string | null;
  orderType: 'OWNER_CONSUMPTION' | 'EMPLOYEE_CONSUMPTION';
  items: { name: string; quantity: number; lineTotal: number }[];
}

/** Mirrors the byPerson/totals aggregation in reports:consumption. */
function summarizeConsumption(orders: FakeOrder[]) {
  interface PersonSummary {
    consumptionPersonId: number | null;
    personName: string;
    orderType: string;
    orderCount: number;
    quantity: number;
    value: number;
  }
  const byPerson = new Map<string, PersonSummary>();
  let ownerTotal = 0;
  let employeeTotal = 0;

  for (const order of orders) {
    const orderValue = order.items.reduce((sum, i) => sum + i.lineTotal, 0);
    const key = `${order.consumptionPersonId ?? 'null'}:${order.orderType}`;
    const entry = byPerson.get(key) ?? {
      consumptionPersonId: order.consumptionPersonId,
      personName: order.consumptionPersonName ?? 'Unknown',
      orderType: order.orderType,
      orderCount: 0,
      quantity: 0,
      value: 0,
    };
    entry.orderCount += 1;
    entry.quantity += order.items.reduce((sum, i) => sum + i.quantity, 0);
    entry.value += orderValue;
    byPerson.set(key, entry);

    if (order.orderType === 'OWNER_CONSUMPTION') ownerTotal += orderValue;
    else employeeTotal += orderValue;
  }

  return {
    byPerson: [...byPerson.values()].map((p) => ({ ...p, value: +p.value.toFixed(2) })),
    totals: {
      ownerTotal: +ownerTotal.toFixed(2),
      employeeTotal: +employeeTotal.toFixed(2),
      combinedTotal: +(ownerTotal + employeeTotal).toFixed(2),
      orderCount: orders.length,
    },
  };
}

describe('owner/employee consumption report — per-person aggregation', () => {
  it('groups multiple orders from the same person into one summary row', () => {
    const orders: FakeOrder[] = [
      {
        id: 1,
        consumptionPersonId: 1,
        consumptionPersonName: 'Ali (Owner)',
        orderType: 'OWNER_CONSUMPTION',
        items: [{ name: 'Burger', quantity: 2, lineTotal: 1000 }],
      },
      {
        id: 2,
        consumptionPersonId: 1,
        consumptionPersonName: 'Ali (Owner)',
        orderType: 'OWNER_CONSUMPTION',
        items: [{ name: 'Pizza', quantity: 1, lineTotal: 800 }],
      },
    ];
    const result = summarizeConsumption(orders);
    expect(result.byPerson).toHaveLength(1);
    expect(result.byPerson[0].orderCount).toBe(2);
    expect(result.byPerson[0].quantity).toBe(3);
    expect(result.byPerson[0].value).toBe(1800);
  });

  it('keeps different people as separate rows', () => {
    const orders: FakeOrder[] = [
      {
        id: 1,
        consumptionPersonId: 1,
        consumptionPersonName: 'Ali (Owner)',
        orderType: 'OWNER_CONSUMPTION',
        items: [{ name: 'Burger', quantity: 1, lineTotal: 500 }],
      },
      {
        id: 2,
        consumptionPersonId: 2,
        consumptionPersonName: 'Sara (Waiter)',
        orderType: 'EMPLOYEE_CONSUMPTION',
        items: [{ name: 'Fries', quantity: 1, lineTotal: 200 }],
      },
    ];
    const result = summarizeConsumption(orders);
    expect(result.byPerson).toHaveLength(2);
  });

  it('answers "what did Employee X consume": quantity and value are correct for one person', () => {
    const orders: FakeOrder[] = [
      {
        id: 1,
        consumptionPersonId: 2,
        consumptionPersonName: 'Sara (Waiter)',
        orderType: 'EMPLOYEE_CONSUMPTION',
        items: [
          { name: 'Burger', quantity: 1, lineTotal: 500 },
          { name: 'Soda', quantity: 2, lineTotal: 200 },
        ],
      },
    ];
    const result = summarizeConsumption(orders);
    const sara = result.byPerson.find((p) => p.personName === 'Sara (Waiter)')!;
    expect(sara.quantity).toBe(3);
    expect(sara.value).toBe(700);
    expect(sara.orderType).toBe('EMPLOYEE_CONSUMPTION');
  });
});

describe('owner/employee consumption report — totals', () => {
  it('separates owner total from employee total', () => {
    const orders: FakeOrder[] = [
      {
        id: 1,
        consumptionPersonId: 1,
        consumptionPersonName: 'Ali',
        orderType: 'OWNER_CONSUMPTION',
        items: [{ name: 'Burger', quantity: 1, lineTotal: 500 }],
      },
      {
        id: 2,
        consumptionPersonId: 2,
        consumptionPersonName: 'Sara',
        orderType: 'EMPLOYEE_CONSUMPTION',
        items: [{ name: 'Pizza', quantity: 1, lineTotal: 800 }],
      },
    ];
    const result = summarizeConsumption(orders);
    expect(result.totals.ownerTotal).toBe(500);
    expect(result.totals.employeeTotal).toBe(800);
    expect(result.totals.combinedTotal).toBe(1300);
    expect(result.totals.orderCount).toBe(2);
  });

  it('returns all-zero totals for an empty result set (no matching records)', () => {
    const result = summarizeConsumption([]);
    expect(result.totals).toEqual({ ownerTotal: 0, employeeTotal: 0, combinedTotal: 0, orderCount: 0 });
    expect(result.byPerson).toEqual([]);
  });

  it('"how much total owner/employee consumption occurred": combinedTotal answers it directly', () => {
    const orders: FakeOrder[] = [
      {
        id: 1,
        consumptionPersonId: 1,
        consumptionPersonName: 'Ali',
        orderType: 'OWNER_CONSUMPTION',
        items: [{ name: 'A', quantity: 1, lineTotal: 300 }],
      },
      {
        id: 2,
        consumptionPersonId: 3,
        consumptionPersonName: 'Bilal',
        orderType: 'EMPLOYEE_CONSUMPTION',
        items: [{ name: 'B', quantity: 1, lineTotal: 150 }],
      },
      {
        id: 3,
        consumptionPersonId: 3,
        consumptionPersonName: 'Bilal',
        orderType: 'EMPLOYEE_CONSUMPTION',
        items: [{ name: 'C', quantity: 2, lineTotal: 400 }],
      },
    ];
    const result = summarizeConsumption(orders);
    expect(result.totals.combinedTotal).toBe(850);
  });
});
