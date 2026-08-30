/**
 * General Sales Report — CSV and PDF builders (follow-up batch, Priorities
 * 7 and 9). Combines every report section the Reports page already fetches
 * (summary, all partners, item-level consumption, payments, service
 * charges) into ONE comprehensive export, rather than the previous
 * date/orders/revenue-only Sales CSV.
 *
 * Deliberately does no aggregation of its own — every number here comes
 * straight from the already-fetched report objects (each backed by a real
 * DB-side aggregation query in electron/ipc/reports.ts), so this file is
 * pure formatting, not a second place business logic could drift out of
 * sync. Payment methods are whatever's actually in paymentReport.byMethod —
 * never a hardcoded CASH/EASYPAISA/BANK list — so a method that was never
 * used in the period simply doesn't appear, and a method not in the list
 * above is included exactly as recorded.
 */
import type {
  ReportSummary,
  PartnerReport,
  ConsumptionReport,
  PaymentReport,
  ServiceChargeReport,
  Settings,
} from '@/types';
import { formatDate } from './format';

export interface SalesReportData {
  from: string;
  to: string;
  settings: Settings;
  summary: ReportSummary;
  partnerReport: PartnerReport;
  consumption: ConsumptionReport;
  paymentReport: PaymentReport;
  serviceChargeReport: ServiceChargeReport;
}

function periodLabel(data: SalesReportData): string {
  return data.from === data.to
    ? formatDate(data.from)
    : `${formatDate(data.from)} – ${formatDate(data.to)}`;
}

function money(n: number, sym: string): string {
  return `${sym}${n.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvEscape(val: unknown): string {
  const str = val == null ? '' : String(val);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvEscape).join(',');
}

/** Builds the full multi-section CSV text for the General Sales Report. */
export function buildSalesReportCsv(data: SalesReportData): string {
  const { settings, summary, partnerReport, consumption, paymentReport, serviceChargeReport } = data;
  const lines: string[] = [];

  lines.push(csvRow(['General Sales Report']));
  lines.push(csvRow([settings.restaurantName]));
  lines.push(csvRow(['Period', periodLabel(data)]));
  lines.push(csvRow(['Generated', new Date().toLocaleString()]));
  lines.push('');

  // A. Sales summary
  lines.push(csvRow(['SALES SUMMARY']));
  lines.push(csvRow(['Metric', 'Value']));
  lines.push(csvRow(['Total Orders', summary.orderCount]));
  lines.push(csvRow(['Total Revenue', summary.revenue.toFixed(2)]));
  lines.push(csvRow(['Subtotal', summary.totalSubtotal.toFixed(2)]));
  lines.push(csvRow(['Discounts', summary.totalDiscount.toFixed(2)]));
  lines.push(csvRow(['Tax', summary.totalTax.toFixed(2)]));
  lines.push(csvRow(['Service Charges', summary.totalServiceCharge.toFixed(2)]));
  lines.push(csvRow(['Total Due', summary.totalDue.toFixed(2)]));
  lines.push(csvRow(['Average Order Value', summary.averageOrderValue.toFixed(2)]));
  lines.push('');

  // B. Partner information — every partner, no selection required.
  lines.push(csvRow(['PARTNER SHARES']));
  if (partnerReport.partners.length === 0) {
    lines.push(csvRow(['No partner-owned sales in this period.']));
  } else {
    lines.push(csvRow(['Partner', 'Item', 'Quantity', 'Item Sales', 'Ownership %', 'Partner Share']));
    for (const p of partnerReport.partners) {
      for (const item of p.items) {
        lines.push(
          csvRow([p.partnerName, item.name, item.quantity, item.sales.toFixed(2), item.effectivePercentage.toFixed(1), item.partnerShare.toFixed(2)])
        );
      }
      lines.push(csvRow([`${p.partnerName} — Total`, '', '', '', '', p.totalShare.toFixed(2)]));
    }
    lines.push(csvRow(['Grand Total (all partners)', '', '', '', '', partnerReport.grandTotal.toFixed(2)]));
  }
  lines.push('');

  // C. Owner/Employee consumption — item-level detail.
  lines.push(csvRow(['OWNER / EMPLOYEE CONSUMPTION']));
  if (consumption.byPerson.length === 0) {
    lines.push(csvRow(['No owner or employee consumption in this period.']));
  } else {
    lines.push(csvRow(['Person', 'Type', 'Item', 'Quantity', 'Value']));
    for (const p of consumption.byPerson) {
      const type = p.orderType === 'OWNER_CONSUMPTION' ? 'Owner' : 'Employee';
      for (const item of p.items) {
        lines.push(csvRow([p.personName, type, item.name, item.quantity, item.value.toFixed(2)]));
      }
      lines.push(csvRow([`${p.personName} — Total`, type, '', p.quantity, p.value.toFixed(2)]));
    }
    lines.push(csvRow(['Owner Total', '', '', '', consumption.totals.ownerTotal.toFixed(2)]));
    lines.push(csvRow(['Employee Total', '', '', '', consumption.totals.employeeTotal.toFixed(2)]));
    lines.push(csvRow(['Combined Total', '', '', '', consumption.totals.combinedTotal.toFixed(2)]));
  }
  lines.push('');

  // D. Payment information — whatever methods actually appear, never invented.
  lines.push(csvRow(['PAYMENT BREAKDOWN']));
  if (paymentReport.byMethod.length === 0) {
    lines.push(csvRow(['No payments recorded in this period.']));
  } else {
    lines.push(csvRow(['Payment Method', 'Account', 'Number of Payments', 'Total Amount']));
    for (const m of paymentReport.byMethod) {
      lines.push(csvRow([m.method, m.accountDisplayName ?? '', m.count, m.amount.toFixed(2)]));
    }
    lines.push(
      csvRow([
        'Overall Total',
        '',
        paymentReport.byMethod.reduce((s, m) => s + m.count, 0),
        paymentReport.totals.totalCollected.toFixed(2),
      ])
    );
  }
  lines.push('');

  // E. Service charge information
  lines.push(csvRow(['SERVICE CHARGE INFORMATION']));
  lines.push(csvRow(['Metric', 'Value']));
  lines.push(csvRow(['Orders with Service Charge', serviceChargeReport.orderCount]));
  lines.push(csvRow(['Total Service Charge', serviceChargeReport.periodTotal.toFixed(2)]));
  lines.push(csvRow(['Fixed Charges — Count', serviceChargeReport.fixedCount]));
  lines.push(csvRow(['Fixed Charges — Total', serviceChargeReport.fixedTotal.toFixed(2)]));
  lines.push(csvRow(['Percentage Charges — Count', serviceChargeReport.percentageCount]));
  lines.push(csvRow(['Percentage Charges — Total', serviceChargeReport.percentageTotal.toFixed(2)]));

  return lines.join('\n');
}

/** Triggers a browser download of the given text content — same mechanism as downloadCsv(). */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// PDF (HTML rendered via Electron's printToPDF — see electron/services/pdfService.ts)
// ---------------------------------------------------------------------------

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Builds a formatted, human-readable HTML report — not a CSV dump. */
export function buildSalesReportHtml(data: SalesReportData): string {
  const { settings, summary, partnerReport, consumption, paymentReport, serviceChargeReport } = data;
  const sym = settings.currencySymbol || '$';

  const partnerSection = partnerReport.partners.length
    ? partnerReport.partners
        .map(
          (p) => `
      <h3>${esc(p.partnerName)} — <span class="total">${money(p.totalShare, sym)}</span></h3>
      <table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Sales</th><th class="num">%</th><th class="num">Share</th></tr></thead>
        <tbody>
          ${p.items
            .map(
              (i) =>
                `<tr><td>${esc(i.name)}</td><td class="num">${i.quantity}</td><td class="num">${money(i.sales, sym)}</td><td class="num">${i.effectivePercentage.toFixed(1)}%</td><td class="num">${money(i.partnerShare, sym)}</td></tr>`
            )
            .join('')}
        </tbody>
      </table>`
        )
        .join('')
    : '<p class="muted">No partner-owned sales in this period.</p>';

  const consumptionSection = consumption.byPerson.length
    ? consumption.byPerson
        .map((p) => {
          const type = p.orderType === 'OWNER_CONSUMPTION' ? 'Owner' : 'Employee';
          return `
      <h3>${esc(p.personName)} <span class="badge">${type}</span> — <span class="total">${money(p.value, sym)}</span></h3>
      <table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Value</th></tr></thead>
        <tbody>
          ${p.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${i.quantity}</td><td class="num">${money(i.value, sym)}</td></tr>`).join('')}
        </tbody>
      </table>`;
        })
        .join('')
    : '<p class="muted">No owner or employee consumption in this period.</p>';

  const paymentSection = paymentReport.byMethod.length
    ? `<table>
        <thead><tr><th>Method</th><th>Account</th><th class="num"># Payments</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${paymentReport.byMethod
            .map(
              (m) =>
                `<tr><td>${esc(m.method)}</td><td>${esc(m.accountDisplayName ?? '')}</td><td class="num">${m.count}</td><td class="num">${money(m.amount, sym)}</td></tr>`
            )
            .join('')}
        </tbody>
        <tfoot><tr><td colspan="2">Overall Total</td><td class="num">${paymentReport.byMethod.reduce((s, m) => s + m.count, 0)}</td><td class="num">${money(paymentReport.totals.totalCollected, sym)}</td></tr></tfoot>
      </table>`
    : '<p class="muted">No payments recorded in this period.</p>';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; padding: 24px; font-size: 13px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 2px solid #1a1a1a; padding-bottom: 4px; }
  h3 { font-size: 13px; margin: 14px 0 4px; }
  .muted { color: #666; font-size: 12px; margin: 6px 0 18px; }
  .subtitle { color: #444; font-size: 13px; margin-bottom: 20px; }
  .badge { display: inline-block; font-size: 10px; font-weight: normal; background: #eee; border-radius: 4px; padding: 1px 6px; color: #444; }
  .total { color: #0a6; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; }
  th { font-size: 11px; text-transform: uppercase; color: #555; border-bottom: 2px solid #999; }
  td.num, th.num { text-align: right; }
  tfoot td { font-weight: bold; border-top: 2px solid #999; border-bottom: none; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 10px; }
  .stat { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; }
  .stat .label { font-size: 10px; text-transform: uppercase; color: #777; }
  .stat .value { font-size: 16px; font-weight: bold; }
</style>
</head>
<body>
  <h1>General Sales Report</h1>
  <div class="subtitle">${esc(settings.restaurantName)} &middot; ${esc(periodLabel(data))} &middot; Generated ${esc(new Date().toLocaleString())}</div>

  <h2>Sales Summary</h2>
  <div class="summary-grid">
    <div class="stat"><div class="label">Total Orders</div><div class="value">${summary.orderCount}</div></div>
    <div class="stat"><div class="label">Total Revenue</div><div class="value">${money(summary.revenue, sym)}</div></div>
    <div class="stat"><div class="label">Avg Order Value</div><div class="value">${money(summary.averageOrderValue, sym)}</div></div>
    <div class="stat"><div class="label">Total Due</div><div class="value">${money(summary.totalDue, sym)}</div></div>
  </div>
  <table>
    <tbody>
      <tr><td>Subtotal</td><td class="num">${money(summary.totalSubtotal, sym)}</td></tr>
      <tr><td>Discounts</td><td class="num">-${money(summary.totalDiscount, sym)}</td></tr>
      <tr><td>Tax</td><td class="num">${money(summary.totalTax, sym)}</td></tr>
      <tr><td>Service Charges</td><td class="num">${money(summary.totalServiceCharge, sym)}</td></tr>
    </tbody>
  </table>

  <h2>Partner Shares</h2>
  ${partnerSection}
  ${partnerReport.partners.length ? `<p><strong>Grand Total (all partners): ${money(partnerReport.grandTotal, sym)}</strong></p>` : ''}

  <h2>Owner / Employee Consumption</h2>
  ${consumptionSection}
  ${
    consumption.byPerson.length
      ? `<p><strong>Owner: ${money(consumption.totals.ownerTotal, sym)} &middot; Employee: ${money(consumption.totals.employeeTotal, sym)} &middot; Combined: ${money(consumption.totals.combinedTotal, sym)}</strong></p>`
      : ''
  }

  <h2>Payment Breakdown</h2>
  ${paymentSection}

  <h2>Service Charge Information</h2>
  <table>
    <tbody>
      <tr><td>Orders with a service charge</td><td class="num">${serviceChargeReport.orderCount}</td></tr>
      <tr><td>Total service charge</td><td class="num">${money(serviceChargeReport.periodTotal, sym)}</td></tr>
      <tr><td>Fixed charges (count / total)</td><td class="num">${serviceChargeReport.fixedCount} / ${money(serviceChargeReport.fixedTotal, sym)}</td></tr>
      <tr><td>Percentage charges (count / total)</td><td class="num">${serviceChargeReport.percentageCount} / ${money(serviceChargeReport.percentageTotal, sym)}</td></tr>
    </tbody>
  </table>
</body>
</html>`;
}
