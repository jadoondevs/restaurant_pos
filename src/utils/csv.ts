/**
 * Parses CSV text into rows of string cells. Handles quoted fields
 * (commas/newlines inside quotes, escaped "" for a literal quote) — the
 * same escaping downloadCsv() below produces, and what Excel/Sheets export.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Normalize line endings so \r\n inside/outside quotes behaves the same.
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  // Flush the final field/row (files don't always end with a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully blank trailing rows (a common trailing-newline artifact).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/**
 * Parses CSV text using the first row as (case-insensitive) headers and
 * returns one object per remaining row, keyed by the ORIGINAL header text
 * (trimmed). Rows shorter than the header are padded with ''.
 */
export function parseCsvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());

  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, (row[i] ?? '').trim()]))
  );
}

/** Converts an array of records to a CSV string and triggers a download. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;

  const headers = Object.keys(rows[0]);
  const escape = (val: unknown) => {
    const str = val == null ? '' : String(val);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
