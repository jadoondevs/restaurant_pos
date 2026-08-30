/**
 * Order classification (SALE / OWNER_CONSUMPTION / EMPLOYEE_CONSUMPTION)
 * tests — mirrors the exact validation/snapshot logic in
 * electron/ipc/orders.ts's orders:create so it can be verified without
 * Electron or a live database (consistent with this project's existing
 * testing approach for orders.ts-adjacent logic).
 */
import { describe, it, expect } from 'vitest';

const ORDER_TYPES = ['SALE', 'OWNER_CONSUMPTION', 'EMPLOYEE_CONSUMPTION'] as const;
type OrderType = (typeof ORDER_TYPES)[number];

interface ConsumptionPersonRecord {
  id: number;
  name: string;
  type: 'OWNER' | 'EMPLOYEE';
}

/** Mirrors the orderType/consumptionPerson resolution block in orders:create. */
function resolveOrderClassification(
  input: { orderType?: string; consumptionPersonId?: number | null; consumptionNotes?: string | null },
  lookupPerson: (id: number) => ConsumptionPersonRecord | undefined
) {
  const orderType: OrderType = ORDER_TYPES.includes(input.orderType as OrderType)
    ? (input.orderType as OrderType)
    : 'SALE';

  let consumptionPersonId: number | null = null;
  let consumptionPersonName: string | null = null;
  let consumptionNotes: string | null = null;

  if (orderType !== 'SALE') {
    if (!input.consumptionPersonId) {
      throw new Error('Select the owner or employee for this order.');
    }
    const person = lookupPerson(input.consumptionPersonId);
    if (!person) throw new Error('Selected owner/employee not found.');

    consumptionPersonId = person.id;
    consumptionPersonName = person.name;
    consumptionNotes = input.consumptionNotes?.trim() || null;
  }

  return { orderType, consumptionPersonId, consumptionPersonName, consumptionNotes };
}

const people: ConsumptionPersonRecord[] = [
  { id: 1, name: 'Ali (Owner)', type: 'OWNER' },
  { id: 2, name: 'Sara (Waiter)', type: 'EMPLOYEE' },
];
const lookup = (id: number) => people.find((p) => p.id === id);

describe('order classification — SALE (default)', () => {
  it('defaults to SALE when orderType is not provided', () => {
    const r = resolveOrderClassification({}, lookup);
    expect(r.orderType).toBe('SALE');
    expect(r.consumptionPersonId).toBeNull();
    expect(r.consumptionPersonName).toBeNull();
    expect(r.consumptionNotes).toBeNull();
  });

  it('falls back to SALE for an unrecognised orderType value', () => {
    const r = resolveOrderClassification({ orderType: 'NOT_A_REAL_TYPE' }, lookup);
    expect(r.orderType).toBe('SALE');
  });

  it('never requires a consumption person for a SALE order', () => {
    expect(() => resolveOrderClassification({ orderType: 'SALE' }, lookup)).not.toThrow();
  });

  it('ignores consumptionNotes on a SALE order even if provided', () => {
    const r = resolveOrderClassification(
      { orderType: 'SALE', consumptionNotes: 'should be ignored' },
      lookup
    );
    expect(r.consumptionNotes).toBeNull();
  });
});

describe('order classification — OWNER_CONSUMPTION', () => {
  it('requires a consumptionPersonId', () => {
    expect(() => resolveOrderClassification({ orderType: 'OWNER_CONSUMPTION' }, lookup)).toThrow(
      /select the owner or employee/i
    );
  });

  it('resolves and snapshots the person name', () => {
    const r = resolveOrderClassification(
      { orderType: 'OWNER_CONSUMPTION', consumptionPersonId: 1 },
      lookup
    );
    expect(r.orderType).toBe('OWNER_CONSUMPTION');
    expect(r.consumptionPersonId).toBe(1);
    expect(r.consumptionPersonName).toBe('Ali (Owner)');
  });

  it('throws when the referenced person does not exist', () => {
    expect(() =>
      resolveOrderClassification({ orderType: 'OWNER_CONSUMPTION', consumptionPersonId: 999 }, lookup)
    ).toThrow(/not found/i);
  });

  it('trims and stores consumptionNotes when provided', () => {
    const r = resolveOrderClassification(
      { orderType: 'OWNER_CONSUMPTION', consumptionPersonId: 1, consumptionNotes: '  staff meal  ' },
      lookup
    );
    expect(r.consumptionNotes).toBe('staff meal');
  });

  it('stores null notes when none provided', () => {
    const r = resolveOrderClassification(
      { orderType: 'OWNER_CONSUMPTION', consumptionPersonId: 1 },
      lookup
    );
    expect(r.consumptionNotes).toBeNull();
  });
});

describe('order classification — EMPLOYEE_CONSUMPTION', () => {
  it('requires a consumptionPersonId', () => {
    expect(() => resolveOrderClassification({ orderType: 'EMPLOYEE_CONSUMPTION' }, lookup)).toThrow(
      /select the owner or employee/i
    );
  });

  it('resolves and snapshots the person name', () => {
    const r = resolveOrderClassification(
      { orderType: 'EMPLOYEE_CONSUMPTION', consumptionPersonId: 2 },
      lookup
    );
    expect(r.orderType).toBe('EMPLOYEE_CONSUMPTION');
    expect(r.consumptionPersonId).toBe(2);
    expect(r.consumptionPersonName).toBe('Sara (Waiter)');
  });

  it('snapshot is taken from the person record at resolution time, not re-derived later', () => {
    // Simulates a person being renamed between two separate orders — each
    // order's snapshot reflects the name in effect when THAT order was
    // created, exactly like cashierName/consumptionPersonName elsewhere.
    const before = resolveOrderClassification(
      { orderType: 'EMPLOYEE_CONSUMPTION', consumptionPersonId: 2 },
      lookup
    );

    const renamedPeople = [{ id: 2, name: 'Sara Khan (renamed)', type: 'EMPLOYEE' as const }];
    const renamedLookup = (id: number) => renamedPeople.find((p) => p.id === id);
    const after = resolveOrderClassification(
      { orderType: 'EMPLOYEE_CONSUMPTION', consumptionPersonId: 2 },
      renamedLookup
    );

    expect(before.consumptionPersonName).toBe('Sara (Waiter)');
    expect(after.consumptionPersonName).toBe('Sara Khan (renamed)');
  });
});
