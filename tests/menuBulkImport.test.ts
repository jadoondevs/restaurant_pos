/**
 * Menu bulk import tests: CSV parsing (src/utils/csv.ts) and the
 * server-side validation logic mirrored from electron/ipc/menu.ts's
 * menu:bulkImport handler.
 */
import { describe, it, expect } from 'vitest';
import { parseCsvRows, parseCsvToObjects } from '../src/utils/csv';

describe('parseCsvRows', () => {
  it('parses a simple comma-separated file', () => {
    const rows = parseCsvRows('a,b,c\n1,2,3');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles a quoted field containing a comma', () => {
    const rows = parseCsvRows('name,description\nBurger,"Beef, cheese, lettuce"');
    expect(rows[1]).toEqual(['Burger', 'Beef, cheese, lettuce']);
  });

  it('handles a quoted field containing a newline', () => {
    const rows = parseCsvRows('name,description\nPizza,"Line one\nLine two"');
    expect(rows[1]).toEqual(['Pizza', 'Line one\nLine two']);
  });

  it('handles an escaped double-quote inside a quoted field', () => {
    const rows = parseCsvRows('name,description\nSpecial,"Chef\'s ""famous"" recipe"');
    expect(rows[1][1]).toBe('Chef\'s "famous" recipe');
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsvRows('a,b\r\n1,2\r\n3,4');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles an empty field', () => {
    const rows = parseCsvRows('a,b,c\n1,,3');
    expect(rows[1]).toEqual(['1', '', '3']);
  });

  it('ignores a trailing blank line', () => {
    const rows = parseCsvRows('a,b\n1,2\n');
    expect(rows).toHaveLength(2);
  });

  it('parses a file with no trailing newline', () => {
    const rows = parseCsvRows('a,b\n1,2');
    expect(rows).toHaveLength(2);
  });
});

describe('parseCsvToObjects', () => {
  it('keys each row by the header row', () => {
    const objs = parseCsvToObjects('name,price\nBurger,500\nPizza,800');
    expect(objs).toEqual([
      { name: 'Burger', price: '500' },
      { name: 'Pizza', price: '800' },
    ]);
  });

  it('is case-preserving on header names (matching is the caller\'s job)', () => {
    const objs = parseCsvToObjects('Name,Category\nBurger,Burgers');
    expect(objs[0]).toEqual({ Name: 'Burger', Category: 'Burgers' });
  });

  it('pads a short row with empty strings', () => {
    const objs = parseCsvToObjects('name,category,price\nBurger,Burgers');
    expect(objs[0]).toEqual({ name: 'Burger', category: 'Burgers', price: '' });
  });

  it('returns an empty array for a header-only file', () => {
    expect(parseCsvToObjects('name,category,price')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bulk import row validation — mirrors menu:bulkImport's per-row checks.
// ---------------------------------------------------------------------------
interface Row {
  name: string;
  categoryName: string;
  price: string;
  ownerships?: { partnerName: string; percentage: number }[];
}

function validateRow(
  row: Row,
  categoryNames: Set<string>,
  existingItems: Set<string> // "name::categoryLower"
): { ok: boolean; reason?: string } {
  const name = row.name.trim();
  if (!name) return { ok: false, reason: 'Missing item name.' };

  if (!categoryNames.has(row.categoryName.trim().toLowerCase())) {
    return { ok: false, reason: `Category "${row.categoryName}" not found.` };
  }

  const price = Number(row.price);
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, reason: `Invalid price "${row.price}".` };
  }

  if (existingItems.has(`${name.toLowerCase()}::${row.categoryName.trim().toLowerCase()}`)) {
    return { ok: false, reason: 'Already exists in this category.' };
  }

  return { ok: true };
}

describe('bulk import row validation', () => {
  const categories = new Set(['burgers', 'pizza']);

  it('accepts a well-formed row', () => {
    const result = validateRow({ name: 'Cheeseburger', categoryName: 'Burgers', price: '500' }, categories, new Set());
    expect(result.ok).toBe(true);
  });

  it('rejects a missing name', () => {
    const result = validateRow({ name: '', categoryName: 'Burgers', price: '500' }, categories, new Set());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/name/i);
  });

  it('rejects an unknown category — never silently creates one', () => {
    const result = validateRow({ name: 'Sushi', categoryName: 'Japanese', price: '500' }, categories, new Set());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not found/i);
  });

  it('rejects a non-numeric price', () => {
    const result = validateRow({ name: 'Burger', categoryName: 'Burgers', price: 'free' }, categories, new Set());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/invalid price/i);
  });

  it('rejects a negative price', () => {
    const result = validateRow({ name: 'Burger', categoryName: 'Burgers', price: '-5' }, categories, new Set());
    expect(result.ok).toBe(false);
  });

  it('accepts a zero price (free item)', () => {
    const result = validateRow({ name: 'Water', categoryName: 'Burgers', price: '0' }, categories, new Set());
    expect(result.ok).toBe(true);
  });

  it('rejects a duplicate item in the same category', () => {
    const existing = new Set(['cheeseburger::burgers']);
    const result = validateRow({ name: 'Cheeseburger', categoryName: 'Burgers', price: '500' }, categories, existing);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already exists/i);
  });

  it('does not corrupt existing data: a malformed row never touches other rows', () => {
    const rows: Row[] = [
      { name: 'Good Item', categoryName: 'Burgers', price: '500' },
      { name: '', categoryName: 'Burgers', price: '500' }, // malformed
      { name: 'Another Good Item', categoryName: 'Pizza', price: '800' },
    ];
    const results = rows.map((r) => validateRow(r, categories, new Set()));
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[2].ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ownership spec parsing (the "Partner A:50,Partner B:50" CSV column)
// ---------------------------------------------------------------------------
function parseOwnershipSpec(spec: string): { partnerName: string; percentage: number }[] | null {
  if (!spec.trim()) return [];
  const pairs = spec.split(',').map((s) => s.trim()).filter(Boolean);
  const parsed: { partnerName: string; percentage: number }[] = [];
  for (const pair of pairs) {
    const [name, pct] = pair.split(':').map((s) => s.trim());
    const percentage = parseFloat(pct);
    if (!name || !Number.isFinite(percentage) || percentage <= 0) return null;
    parsed.push({ partnerName: name, percentage });
  }
  return parsed;
}

describe('CSV partner ownership spec parsing', () => {
  it('parses a single-partner spec', () => {
    expect(parseOwnershipSpec('Partner A:100')).toEqual([{ partnerName: 'Partner A', percentage: 100 }]);
  });

  it('parses a two-partner 50/50 spec', () => {
    expect(parseOwnershipSpec('Partner A:50,Partner B:50')).toEqual([
      { partnerName: 'Partner A', percentage: 50 },
      { partnerName: 'Partner B', percentage: 50 },
    ]);
  });

  it('returns an empty array for a blank spec (no ownership configured)', () => {
    expect(parseOwnershipSpec('')).toEqual([]);
  });

  it('returns null for a malformed spec (missing percentage)', () => {
    expect(parseOwnershipSpec('Partner A')).toBeNull();
  });

  it('returns null for a non-numeric percentage', () => {
    expect(parseOwnershipSpec('Partner A:fifty')).toBeNull();
  });

  it('a malformed ownership spec never blocks the item itself — validated separately', () => {
    // The row-level validator above never inspects ownership; this
    // documents that the two checks are independent (an item with bad
    // ownership still imports, per menu:bulkImport's design).
    const row: Row = { name: 'Burger', categoryName: 'Burgers', price: '500' };
    const result = validateRow(row, new Set(['burgers']), new Set());
    expect(result.ok).toBe(true);
    expect(parseOwnershipSpec('garbage')).toBeNull();
  });
});
