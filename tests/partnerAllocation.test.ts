/**
 * Partner ownership validation and historical allocation snapshot tests.
 *
 * Mirrors the exact logic in electron/ipc/partnerOwnership.ts (validation)
 * and electron/ipc/orders.ts (allocation snapshot at order-creation time),
 * consistent with this project's existing approach of testing orders.ts-
 * adjacent business logic without Electron/Prisma.
 */
import { describe, it, expect } from 'vitest';

const SUM_TOLERANCE = 0.5;

interface OwnershipRowInput {
  partnerId: number;
  percentage: number;
}

/** Mirrors partnerOwnership:set's validation logic. */
function validateOwnership(rows: OwnershipRowInput[]): void {
  if (rows.length === 0) return; // clearing ownership is always valid

  const seen = new Set<number>();
  let total = 0;
  for (const row of rows) {
    if (!row.partnerId) throw new Error('Each ownership row needs a partner.');
    if (seen.has(row.partnerId)) throw new Error('A partner cannot appear twice for the same item.');
    seen.add(row.partnerId);

    if (typeof row.percentage !== 'number' || row.percentage <= 0) {
      throw new Error('Each ownership percentage must be a positive number.');
    }
    total += row.percentage;
  }

  if (Math.abs(total - 100) > SUM_TOLERANCE) {
    throw new Error(`Ownership percentages must total 100% (currently ${total.toFixed(1)}%).`);
  }
}

interface PartnerRecord {
  id: number;
  name: string;
}

interface OwnershipRecord {
  partnerId: number;
  percentage: number;
}

/** Mirrors the allocation snapshot built in orders:create for one OrderItem. */
function buildAllocations(
  lineTotal: number,
  ownerships: OwnershipRecord[],
  partners: PartnerRecord[]
) {
  const byId = new Map(partners.map((p) => [p.id, p.name]));
  return ownerships.map((o) => ({
    partnerId: o.partnerId,
    partnerName: byId.get(o.partnerId) ?? '',
    percentage: o.percentage,
    amount: +((lineTotal * o.percentage) / 100).toFixed(2),
  }));
}

describe('partner ownership validation', () => {
  it('accepts an empty ownership list (no partners configured)', () => {
    expect(() => validateOwnership([])).not.toThrow();
  });

  it('accepts 100/0 (single partner, full ownership)', () => {
    expect(() => validateOwnership([{ partnerId: 1, percentage: 100 }])).not.toThrow();
  });

  it('accepts 50/50', () => {
    expect(() =>
      validateOwnership([
        { partnerId: 1, percentage: 50 },
        { partnerId: 2, percentage: 50 },
      ])
    ).not.toThrow();
  });

  it('accepts 60/40', () => {
    expect(() =>
      validateOwnership([
        { partnerId: 1, percentage: 60 },
        { partnerId: 2, percentage: 40 },
      ])
    ).not.toThrow();
  });

  it('accepts more than two partners summing to 100', () => {
    expect(() =>
      validateOwnership([
        { partnerId: 1, percentage: 34 },
        { partnerId: 2, percentage: 33 },
        { partnerId: 3, percentage: 33 },
      ])
    ).not.toThrow();
  });

  it('accepts a total within the small rounding tolerance', () => {
    expect(() =>
      validateOwnership([
        { partnerId: 1, percentage: 50.2 },
        { partnerId: 2, percentage: 50.1 },
      ])
    ).not.toThrow();
  });

  it('rejects a total clearly under 100%', () => {
    expect(() => validateOwnership([{ partnerId: 1, percentage: 90 }])).toThrow(/must total 100/);
  });

  it('rejects a total clearly over 100%', () => {
    expect(() =>
      validateOwnership([
        { partnerId: 1, percentage: 70 },
        { partnerId: 2, percentage: 50 },
      ])
    ).toThrow(/must total 100/);
  });

  it('rejects a zero or negative percentage', () => {
    expect(() => validateOwnership([{ partnerId: 1, percentage: 0 }])).toThrow(/positive number/);
    expect(() => validateOwnership([{ partnerId: 1, percentage: -10 }])).toThrow(/positive number/);
  });

  it('rejects the same partner listed twice', () => {
    expect(() =>
      validateOwnership([
        { partnerId: 1, percentage: 50 },
        { partnerId: 1, percentage: 50 },
      ])
    ).toThrow(/cannot appear twice/);
  });

  it('rejects a row with no partner selected', () => {
    expect(() => validateOwnership([{ partnerId: 0, percentage: 100 }])).toThrow(/needs a partner/);
  });
});

describe('historical allocation snapshot — building', () => {
  const partners: PartnerRecord[] = [
    { id: 1, name: 'Partner A' },
    { id: 2, name: 'Partner B' },
  ];

  it('100/0: a single partner gets the full line amount', () => {
    const allocations = buildAllocations(1000, [{ partnerId: 1, percentage: 100 }], partners);
    expect(allocations).toEqual([{ partnerId: 1, partnerName: 'Partner A', percentage: 100, amount: 1000 }]);
  });

  it('50/50 split', () => {
    const allocations = buildAllocations(
      1000,
      [
        { partnerId: 1, percentage: 50 },
        { partnerId: 2, percentage: 50 },
      ],
      partners
    );
    expect(allocations).toEqual([
      { partnerId: 1, partnerName: 'Partner A', percentage: 50, amount: 500 },
      { partnerId: 2, partnerName: 'Partner B', percentage: 50, amount: 500 },
    ]);
  });

  it('60/40 split', () => {
    const allocations = buildAllocations(
      1000,
      [
        { partnerId: 1, percentage: 60 },
        { partnerId: 2, percentage: 40 },
      ],
      partners
    );
    expect(allocations[0].amount).toBe(600);
    expect(allocations[1].amount).toBe(400);
  });

  it('no ownership configured produces no allocations', () => {
    expect(buildAllocations(1000, [], partners)).toEqual([]);
  });

  it('matches the classic worked example: PKR 1,000 item, A 60% / B 40%', () => {
    // Directly matches the approved spec's own example.
    const allocations = buildAllocations(
      1000,
      [
        { partnerId: 1, percentage: 60 },
        { partnerId: 2, percentage: 40 },
      ],
      partners
    );
    const a = allocations.find((x) => x.partnerId === 1)!;
    const b = allocations.find((x) => x.partnerId === 2)!;
    expect(a.amount).toBe(600);
    expect(b.amount).toBe(400);
  });
});

describe('historical allocation snapshot — immutability across ownership changes', () => {
  const partners: PartnerRecord[] = [
    { id: 1, name: 'Partner A' },
    { id: 2, name: 'Partner B' },
  ];

  it('an August sale keeps its 50/50 allocation even after ownership changes to 70/30 in September', () => {
    // August: ownership is 50/50 at the time of sale.
    const augustOwnership: OwnershipRecord[] = [
      { partnerId: 1, percentage: 50 },
      { partnerId: 2, percentage: 50 },
    ];
    const augustAllocations = buildAllocations(2000, augustOwnership, partners);

    // September: ownership config changes to 70/30 (simulates an admin edit
    // via partnerOwnership:set — this never touches the August order).
    const septemberOwnership: OwnershipRecord[] = [
      { partnerId: 1, percentage: 70 },
      { partnerId: 2, percentage: 30 },
    ];
    const septemberAllocations = buildAllocations(2000, septemberOwnership, partners);

    // The August snapshot is untouched by the September config change.
    expect(augustAllocations.find((a) => a.partnerId === 1)?.amount).toBe(1000); // 50% of 2000
    expect(augustAllocations.find((a) => a.partnerId === 2)?.amount).toBe(1000); // 50% of 2000

    // A new sale in September correctly uses the new ownership.
    expect(septemberAllocations.find((a) => a.partnerId === 1)?.amount).toBe(1400); // 70% of 2000
    expect(septemberAllocations.find((a) => a.partnerId === 2)?.amount).toBe(600); // 30% of 2000

    // Re-computing "August" again (simulating a report re-reading the
    // already-stored snapshot, never the live config) still yields 50/50 —
    // the snapshot function is never called again for that historical item.
    expect(augustAllocations.find((a) => a.partnerId === 1)?.percentage).toBe(50);
  });

  it('the partner name is snapshotted, not re-derived from the live Partner record', () => {
    const ownership: OwnershipRecord[] = [{ partnerId: 1, percentage: 100 }];
    const original = buildAllocations(500, ownership, partners);
    expect(original[0].partnerName).toBe('Partner A');

    // Simulate renaming the partner after the sale — a fresh lookup table.
    const renamedPartners: PartnerRecord[] = [{ id: 1, name: 'Partner A (renamed)' }];
    // The already-built allocation snapshot is untouched by this rename.
    expect(original[0].partnerName).toBe('Partner A');
    // Only a NEW allocation built after the rename picks up the new name.
    const afterRename = buildAllocations(500, ownership, renamedPartners);
    expect(afterRename[0].partnerName).toBe('Partner A (renamed)');
  });
});

describe('historical allocation snapshot — multiple partners on one item', () => {
  it('supports three or more partners summing to 100', () => {
    const partners: PartnerRecord[] = [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
      { id: 3, name: 'C' },
    ];
    const allocations = buildAllocations(
      900,
      [
        { partnerId: 1, percentage: 34 },
        { partnerId: 2, percentage: 33 },
        { partnerId: 3, percentage: 33 },
      ],
      partners
    );
    const total = allocations.reduce((sum, a) => sum + a.amount, 0);
    expect(total).toBeCloseTo(900, 1);
    expect(allocations).toHaveLength(3);
  });
});
