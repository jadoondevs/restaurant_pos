import type { Settings, ReceiptData, PaymentAccount, SocialLink } from '@/types';
import { formatDate, formatTime } from './format';
import { buildQrCodeSvg } from './qrcode';

/**
 * Builds a self-contained HTML receipt string.
 *
 * Supports two paper sizes controlled by settings.receiptPaperSize:
 *   '80mm'  — thermal receipt printer (default)
 *   'A4'    — standard laser/inkjet printer (receipt centred in a narrow column)
 *
 * Works with both saved Order objects and draft ReceiptData so the receipt
 * can be printed BEFORE the order is committed to the database.
 *
 * paymentAccounts/socialLinks are the LIVE, current config (fetched fresh
 * by the caller, e.g. from SettingsContext) — printed as instructions for
 * how to pay / where to find the restaurant, deliberately NOT historical
 * snapshots the way Payment or OrderItemPartnerAllocation are, since a
 * "ways to pay" footer describes what's true today, not what was true when
 * this particular order happened.
 */
export function buildReceiptHtml(
  data: ReceiptData,
  settings: Settings,
  paymentAccounts: PaymentAccount[] = [],
  socialLinks: SocialLink[] = []
): string {
  const sym = settings.currencySymbol || '$';
  const money = (n: number) => `${sym}${n.toFixed(2)}`;
  const paperSize = settings.receiptPaperSize ?? '80mm';
  const isA4 = paperSize === 'A4';

  const printableAccounts = paymentAccounts.filter((a) => a.isActive && a.printOnReceipt);
  const printableSocialLinks = socialLinks
    .filter((l) => l.isEnabled && l.showOnReceipt)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const showLogo = !!(settings.receiptShowLogo && settings.logoPath);
  const showReviewQr = !!(settings.googleReviewOnReceipt && settings.googleReviewUrl);

  const itemRows = data.items
    .map(
      (item) => `
      <tr>
        <td class="name">${escapeHtml(item.name)}${
          item.specialInstructions
            ? `<div class="note">${escapeHtml(item.specialInstructions)}</div>`
            : ''
        }</td>
        <td class="qty">${item.quantity}</td>
        <td class="unit">${money(item.price)}</td>
        <td class="amt">${money(item.lineTotal)}</td>
      </tr>`
    )
    .join('');

  const bodyWidth = isA4 ? '210mm' : '80mm';
  const contentWidth = isA4 ? '80mm' : '80mm';
  const bodyPadding = isA4 ? '0' : '6px 8px';
  const contentMargin = isA4 ? '0 auto' : '0';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${bodyWidth};
    font-family: 'Courier New', monospace;
    font-size: 12px;
    color: #000;
    padding: ${bodyPadding};
    background: #fff;
  }
  .receipt {
    width: ${contentWidth};
    margin: ${contentMargin};
    padding: ${isA4 ? '12px 8px' : '0'};
  }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .title { font-size: 16px; font-weight: bold; }
  .muted { font-size: 11px; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 2px 0; vertical-align: top; }
  th.qty, td.qty { text-align: center; width: 28px; }
  th.unit, td.unit { text-align: right; width: 56px; }
  th.amt, td.amt { text-align: right; width: 60px; }
  .note { font-size: 10px; font-style: italic; padding-left: 6px; }
  .totals td { padding: 1px 0; }
  .totals .label { text-align: left; }
  .totals .val { text-align: right; }
  .grand { font-size: 14px; font-weight: bold; }
  .footer { margin-top: 8px; font-size: 11px; }
  .logo { max-width: 60px; max-height: 60px; margin: 0 auto 4px; display: block; }
  .payopt { margin-top: 4px; }
  .payopt .heading { font-size: 11px; font-weight: bold; margin-bottom: 2px; }
  .payopt .line { font-size: 11px; }
  .social { margin-top: 4px; font-size: 11px; }
  .qr-wrap { margin-top: 8px; text-align: center; }
  .qr-wrap svg { width: 70px; height: 70px; }
  .qr-wrap .qr-label { font-size: 10px; margin-top: 2px; }
  .due { color: #000; }
  @media print {
    body { width: ${bodyWidth}; }
    .receipt { width: ${contentWidth}; margin: ${contentMargin}; }
  }
</style>
</head>
<body>
<div class="receipt">
  <div class="center">
    ${showLogo ? `<img class="logo" src="${settings.logoPath}" alt="" />` : ''}
    <div class="title">${escapeHtml(settings.restaurantName)}</div>
    ${settings.address ? `<div class="muted">${escapeHtml(settings.address)}</div>` : ''}
    ${settings.phone ? `<div class="muted">${escapeHtml(settings.phone)}</div>` : ''}
  </div>
  <hr />
  <div class="muted">
    <div>Receipt: <span class="bold">${escapeHtml(data.receiptNumber)}</span></div>
    <div>Date: ${formatDate(data.createdAt)}</div>
    <div>Time: ${formatTime(data.createdAt)}</div>
    ${data.cashierName ? `<div>Cashier: ${escapeHtml(data.cashierName)}</div>` : ''}
    ${data.tableNumber ? `<div>Table: ${escapeHtml(data.tableNumber)}</div>` : ''}
    ${data.customer ? `<div>Customer: ${escapeHtml(data.customer.name)}</div>` : ''}
  </div>
  <hr />
  <table>
    <thead>
      <tr>
        <th class="name">Item</th>
        <th class="qty">Qty</th>
        <th class="unit">Price</th>
        <th class="amt">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  <hr />
  <table class="totals">
    <tr><td class="label">Subtotal</td><td class="val">${money(data.subtotal)}</td></tr>
    ${
      data.discount > 0
        ? `<tr><td class="label">Discount</td><td class="val">-${money(data.discount)}</td></tr>`
        : ''
    }
    ${
      data.taxAmount > 0
        ? `<tr><td class="label">Tax (${data.taxRate}%)</td><td class="val">${money(data.taxAmount)}</td></tr>`
        : ''
    }
    <tr class="grand"><td class="label">TOTAL</td><td class="val">${money(data.grandTotal)}</td></tr>
    ${
      data.serviceChargeAmount > 0
        ? `<tr><td class="label">Service Charge${
            data.serviceChargeType === 'PERCENTAGE' ? ` (${data.serviceChargeValue}%)` : ''
          }</td><td class="val">${money(data.serviceChargeAmount)}</td></tr>
           <tr class="grand"><td class="label">TOTAL DUE</td><td class="val">${money(data.totalDue)}</td></tr>`
        : ''
    }
    <tr><td class="label">Cash</td><td class="val">${money(data.cashReceived)}</td></tr>
    <tr><td class="label">Change</td><td class="val">${money(data.change)}</td></tr>
    ${
      data.paymentStatus !== 'PAID'
        ? `<tr class="due"><td class="label bold">Balance Due</td><td class="val bold">${money(
            Math.max(0, data.totalDue - data.payments.reduce((s, p) => s + p.amount, 0))
          )}</td></tr>`
        : ''
    }
  </table>
  ${printableAccounts.length > 0 ? buildPaymentOptionsHtml(printableAccounts) : ''}
  <hr />
  <div class="center footer">${escapeHtml(settings.receiptFooter)}</div>
  ${printableSocialLinks.length > 0 ? buildSocialLinksHtml(printableSocialLinks) : ''}
  ${showReviewQr ? buildReviewQrHtml(settings.googleReviewUrl as string) : ''}
</div>
</body>
</html>`;
}

/** Renders the live "ways to pay" instructions from active, printable PaymentAccounts. */
function buildPaymentOptionsHtml(accounts: PaymentAccount[]): string {
  const lines = accounts
    .map((a) => {
      const detail =
        a.type === 'BANK'
          ? [a.bankName, a.accountNumber, a.iban ? `IBAN: ${a.iban}` : null].filter(Boolean).join(' — ')
          : a.phoneNumber ?? '';
      return `<div class="line"><span class="bold">${escapeHtml(a.displayName)}</span>${
        detail ? `: ${escapeHtml(detail)}` : ''
      }</div>`;
    })
    .join('');
  return `<div class="payopt"><div class="heading">Ways to Pay</div>${lines}</div>`;
}

/** Renders the live "follow us" footer from enabled, receipt-visible SocialLinks. */
function buildSocialLinksHtml(links: SocialLink[]): string {
  const lines = links
    .map((l) => `<div>${escapeHtml(l.displayName)}: ${escapeHtml(l.value)}</div>`)
    .join('');
  return `<div class="center social">${lines}</div>`;
}

/** Renders a locally-generated Google Review QR code — no external service call. */
function buildReviewQrHtml(url: string): string {
  return `<div class="qr-wrap">${buildQrCodeSvg(url)}<div class="qr-label">Scan to leave a review</div></div>`;
}

/** Converts a saved Order to ReceiptData for reprinting. */
export function orderToReceiptData(order: {
  receiptNumber: string;
  createdAt: string;
  tableNumber: string | null;
  cashierName?: string | null;
  customer?: { id: number; name: string; phone: string | null; notes: string | null } | null;
  items: {
    name: string;
    price: number;
    quantity: number;
    specialInstructions: string | null;
    lineTotal: number;
  }[];
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  cashReceived: number;
  change: number;
  serviceChargeType?: ReceiptData['serviceChargeType'];
  serviceChargeValue?: number;
  serviceChargeAmount?: number;
  paymentStatus?: ReceiptData['paymentStatus'];
  payments?: { method: string; amount: number; accountDisplayName: string | null }[];
}): ReceiptData {
  const serviceChargeAmount = order.serviceChargeAmount ?? 0;
  return {
    receiptNumber: order.receiptNumber,
    createdAt: order.createdAt,
    tableNumber: order.tableNumber,
    cashierName: order.cashierName ?? null,
    customer: order.customer ?? null,
    items: order.items,
    subtotal: order.subtotal,
    discount: order.discount,
    taxRate: order.taxRate,
    taxAmount: order.taxAmount,
    grandTotal: order.grandTotal,
    cashReceived: order.cashReceived,
    change: order.change,
    serviceChargeType: order.serviceChargeType ?? 'NONE',
    serviceChargeValue: order.serviceChargeValue ?? 0,
    serviceChargeAmount,
    totalDue: +(order.grandTotal + serviceChargeAmount).toFixed(2),
    paymentStatus: order.paymentStatus ?? 'PAID',
    payments: order.payments ?? [],
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
