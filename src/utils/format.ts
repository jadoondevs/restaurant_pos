import { format } from 'date-fns';

/** Formats a number as currency using the configured symbol. */
export function formatCurrency(amount: number, symbol = '$'): string {
  return `${symbol}${amount.toFixed(2)}`;
}

export function formatDate(date: string | Date): string {
  return format(new Date(date), 'MMM d, yyyy');
}

export function formatTime(date: string | Date): string {
  return format(new Date(date), 'h:mm a');
}

export function formatDateTime(date: string | Date): string {
  return format(new Date(date), 'MMM d, yyyy • h:mm a');
}

/** Returns ISO strings for a named range used by the reports screen. */
export function rangeFor(period: 'today' | 'week' | 'month'): { from: string; to: string } {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === 'week') from.setDate(from.getDate() - 6);
  if (period === 'month') from.setDate(from.getDate() - 29);

  return { from: from.toISOString(), to: to.toISOString() };
}
