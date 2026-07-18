import type { Order, Settings } from '@/types';
import { formatDate, formatTime } from './format';

/**
 * Builds a self-contained HTML string for an 80mm thermal receipt.
 * Inline styles keep it printable in a standalone print window.
 */
export function buildReceiptHtml(order: Order, settings: Settings): string {
  const sym = settings.currencySymbol || '$';
  const money = (n: number) => `${sym}${n.toFixed(2)}`;

  const itemRows = order.items
    .map(
      (item) => `
      <tr>
        <td class="name">${escapeHtml(item.name)}${
          item.specialInstructions
            ? `<div class="note">${escapeHtml(item.specialInstructions)}</div>`
            : ''
        }</td>
        <td class="qty">${item.quantity}</td>
        <td class="amt">${money(item.lineTotal)}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 80mm; font-family: 'Courier New', monospace; font-size: 12px; color: #000; padding: 6px 8px; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .title { font-size: 16px; font-weight: bold; }
  .muted { font-size: 11px; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 2px 0; vertical-align: top; }
  th.qty, td.qty { text-align: center; width: 30px; }
  th.amt, td.amt { text-align: right; width: 64px; }
  .note { font-size: 10px; font-style: italic; padding-left: 6px; }
  .totals td { padding: 1px 0; }
  .totals .label { text-align: left; }
  .totals .val { text-align: right; }
  .grand { font-size: 14px; font-weight: bold; }
  .footer { margin-top: 8px; font-size: 11px; }
  @media print { body { width: 80mm; } }
</style>
</head>
<body>
  <div class="center">
    <div class="title">${escapeHtml(settings.restaurantName)}</div>
    ${settings.address ? `<div class="muted">${escapeHtml(settings.address)}</div>` : ''}
    ${settings.phone ? `<div class="muted">${escapeHtml(settings.phone)}</div>` : ''}
  </div>
  <hr />
  <div class="muted">
    <div>Receipt: <span class="bold">${escapeHtml(order.receiptNumber)}</span></div>
    <div>Date: ${formatDate(order.createdAt)}</div>
    <div>Time: ${formatTime(order.createdAt)}</div>
    ${order.tableNumber ? `<div>Table: ${escapeHtml(order.tableNumber)}</div>` : ''}
    ${order.customer ? `<div>Customer: ${escapeHtml(order.customer.name)}</div>` : ''}
  </div>
  <hr />
  <table>
    <thead>
      <tr><th class="name">Item</th><th class="qty">Qty</th><th class="amt">Total</th></tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  <hr />
  <table class="totals">
    <tr><td class="label">Subtotal</td><td class="val">${money(order.subtotal)}</td></tr>
    ${
      order.discount > 0
        ? `<tr><td class="label">Discount</td><td class="val">-${money(order.discount)}</td></tr>`
        : ''
    }
    ${
      order.taxAmount > 0
        ? `<tr><td class="label">Tax (${order.taxRate}%)</td><td class="val">${money(
            order.taxAmount
          )}</td></tr>`
        : ''
    }
    <tr class="grand"><td class="label">TOTAL</td><td class="val">${money(order.grandTotal)}</td></tr>
    <tr><td class="label">Cash</td><td class="val">${money(order.cashReceived)}</td></tr>
    <tr><td class="label">Change</td><td class="val">${money(order.change)}</td></tr>
  </table>
  <hr />
  <div class="center footer">${escapeHtml(settings.receiptFooter)}</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
