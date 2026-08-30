import { useEffect, useState, useCallback } from 'react';
import { Download, DollarSign, ShoppingBag, TrendingUp, Users, HandCoins, Wallet, Receipt } from 'lucide-react';
import { api } from '@/services/api';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrency, rangeFor, formatDate } from '@/utils/format';
import { downloadCsv } from '@/utils/csv';
import { Card, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader, EmptyState, Spinner } from '@/components/ui/Misc';
import type {
  ReportSummary,
  TopItem,
  ConsumptionReport,
  PartnerReport,
  PaymentReport,
  ServiceChargeReport,
  Partner,
} from '@/types';

type Period = 'today' | 'week' | 'month' | 'custom';
const periodLabels: Record<Period, string> = {
  today: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  custom: 'Custom Range',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function Reports() {
  const { settings } = useSettings();
  const { toast } = useToast();
  const sym = settings?.currencySymbol ?? '$';

  const [period, setPeriod] = useState<Period>('today');
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(todayIso());

  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [consumption, setConsumption] = useState<ConsumptionReport | null>(null);
  const [partnerReport, setPartnerReport] = useState<PartnerReport | null>(null);
  const [paymentReport, setPaymentReport] = useState<PaymentReport | null>(null);
  const [serviceChargeReport, setServiceChargeReport] = useState<ServiceChargeReport | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerFilter, setPartnerFilter] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);

  const currentRange = useCallback(
    (): { from: string; to: string } =>
      period === 'custom' ? { from: customFrom, to: customTo } : rangeFor(period),
    [period, customFrom, customTo]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const range = currentRange();
      const [sum, tops, cons, partnersRep, paymentsRep, serviceRep, partnerList] = await Promise.all([
        api.reportSummary(range),
        api.topItems(range),
        api.consumptionReport(range),
        api.partnerReport({ ...range, partnerId: partnerFilter || undefined }),
        api.paymentReport(range),
        api.serviceChargeReport(range),
        api.listPartners(true),
      ]);
      setSummary(sum);
      setTopItems(tops);
      setConsumption(cons);
      setPartnerReport(partnersRep);
      setPaymentReport(paymentsRep);
      setServiceChargeReport(serviceRep);
      setPartners(partnerList);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load reports.', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRange, partnerFilter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const rangeLabel = () => {
    const r = currentRange();
    return `${formatDate(r.from)} – ${formatDate(r.to)}`;
  };

  const exportSales = () => {
    if (!summary?.daily.length) return toast('Nothing to export.', 'info');
    downloadCsv(
      `sales-${period}-${todayIso()}.csv`,
      summary.daily.map((d) => ({ Date: d.date, Orders: d.orders, Revenue: d.revenue.toFixed(2) }))
    );
  };

  const exportTopItems = () => {
    if (!topItems.length) return toast('Nothing to export.', 'info');
    downloadCsv(
      `top-items-${period}-${todayIso()}.csv`,
      topItems.map((t) => ({ Item: t.name, Quantity: t.quantity, Revenue: t.revenue.toFixed(2) }))
    );
  };

  const exportConsumption = () => {
    if (!consumption?.byPerson.length) return toast('Nothing to export.', 'info');
    downloadCsv(
      `owner-employee-consumption-${period}-${todayIso()}.csv`,
      consumption.byPerson.map((p) => ({
        Person: p.personName,
        Type: p.orderType === 'OWNER_CONSUMPTION' ? 'Owner' : 'Employee',
        Orders: p.orderCount,
        Quantity: p.quantity,
        Value: p.value.toFixed(2),
      }))
    );
  };

  const exportPartners = () => {
    if (!partnerReport?.partners.length) return toast('Nothing to export.', 'info');
    const rows = partnerReport.partners.flatMap((p) =>
      p.items.map((i) => ({
        Partner: p.partnerName,
        Item: i.name,
        Quantity: i.quantity,
        Sales: i.sales.toFixed(2),
        'Ownership %': i.effectivePercentage.toFixed(1),
        'Partner Share': i.partnerShare.toFixed(2),
      }))
    );
    downloadCsv(`partner-report-${period}-${todayIso()}.csv`, rows);
  };

  const exportPayments = () => {
    if (!paymentReport?.payments.length) return toast('Nothing to export.', 'info');
    downloadCsv(
      `payment-report-${period}-${todayIso()}.csv`,
      paymentReport.payments.map((p) => ({
        Order: p.receiptNumber,
        Method: p.method,
        Account: p.accountDisplayName ?? '',
        Amount: p.amount.toFixed(2),
        Date: formatDate(p.recordedAt),
        'Recorded By': p.recordedBy ?? '',
      }))
    );
  };

  const exportServiceCharges = () => {
    if (!serviceChargeReport?.orders.length) return toast('Nothing to export.', 'info');
    downloadCsv(
      `service-charges-${period}-${todayIso()}.csv`,
      serviceChargeReport.orders.map((o) => ({
        Order: o.receiptNumber,
        Date: formatDate(o.createdAt),
        Type: o.serviceChargeType,
        Amount: o.serviceChargeAmount.toFixed(2),
        Cashier: o.cashierName ?? '',
      }))
    );
  };

  const maxRevenue = Math.max(1, ...(summary?.daily.map((d) => d.revenue) ?? [1]));

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={`Sales performance and insights — ${rangeLabel()}`}
        action={
          <Button variant="secondary" onClick={exportSales}>
            <Download size={18} /> Export Sales CSV
          </Button>
        }
      />

      {/* Period selector */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {(Object.keys(periodLabels) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                period === p
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
        )}
      </div>

      {loading || !summary ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="h-8 w-8" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Revenue"
              value={formatCurrency(summary.revenue, sym)}
              icon={<DollarSign size={22} />}
              accent="text-emerald-600"
            />
            <StatCard
              label="Orders"
              value={String(summary.orderCount)}
              icon={<ShoppingBag size={22} />}
              accent="text-brand-600"
            />
            <StatCard
              label="Avg Order Value"
              value={formatCurrency(summary.averageOrderValue, sym)}
              icon={<TrendingUp size={22} />}
              accent="text-amber-600"
            />
            <StatCard
              label="Total Tax"
              value={formatCurrency(summary.totalTax, sym)}
              icon={<DollarSign size={22} />}
              accent="text-purple-600"
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Daily revenue bar chart */}
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
                Revenue Trend
              </h2>
              {summary.daily.length === 0 ? (
                <EmptyState title="No sales in this period" />
              ) : (
                <div className="space-y-2">
                  {summary.daily.map((d) => (
                    <div key={d.date} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 text-xs text-slate-500">
                        {formatDate(d.date)}
                      </span>
                      <div className="h-6 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                        <div
                          className="flex h-full items-center justify-end rounded bg-brand-500 px-2 text-xs font-medium text-white"
                          style={{ width: `${Math.max(6, (d.revenue / maxRevenue) * 100)}%` }}
                        >
                          {formatCurrency(d.revenue, sym)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Top selling items */}
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Top Selling Items
                </h2>
                <Button size="sm" variant="ghost" onClick={exportTopItems}>
                  <Download size={16} /> CSV
                </Button>
              </div>
              {topItems.length === 0 ? (
                <EmptyState title="No items sold in this period" />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {topItems.map((item, idx) => (
                    <li key={item.name} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {item.name}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {formatCurrency(item.revenue, sym)}
                        </p>
                        <p className="text-xs text-slate-400">{item.quantity} sold</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Owner/Employee consumption */}
          <Card className="mt-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                <Users size={18} /> Owner / Employee Consumption
              </h2>
              <Button size="sm" variant="ghost" onClick={exportConsumption}>
                <Download size={16} /> CSV
              </Button>
            </div>

            {!consumption || consumption.byPerson.length === 0 ? (
              <EmptyState title="No owner or employee consumption in this period" />
            ) : (
              <>
                <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <StatCard
                    label="Owner Consumption"
                    value={formatCurrency(consumption.totals.ownerTotal, sym)}
                    icon={<Users size={22} />}
                    accent="text-purple-600"
                  />
                  <StatCard
                    label="Employee Consumption"
                    value={formatCurrency(consumption.totals.employeeTotal, sym)}
                    icon={<Users size={22} />}
                    accent="text-amber-600"
                  />
                  <StatCard
                    label="Combined Total"
                    value={formatCurrency(consumption.totals.combinedTotal, sym)}
                    icon={<Users size={22} />}
                    accent="text-brand-600"
                  />
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {consumption.byPerson.map((p) => (
                    <li
                      key={`${p.consumptionPersonId}-${p.orderType}`}
                      className="flex items-center justify-between py-2.5"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {p.personName}
                        </p>
                        <p className="text-xs text-slate-400">
                          {p.orderType === 'OWNER_CONSUMPTION' ? 'Owner' : 'Employee'} ·{' '}
                          {p.orderCount} order{p.orderCount === 1 ? '' : 's'} · {p.quantity} item
                          {p.quantity === 1 ? '' : 's'}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrency(p.value, sym)}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          {/* Partner report */}
          <Card className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                <HandCoins size={18} /> Partner Report
              </h2>
              <div className="flex items-center gap-2">
                <select
                  value={partnerFilter}
                  onChange={(e) => setPartnerFilter(e.target.value ? Number(e.target.value) : '')}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                >
                  <option value="">All Partners</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="ghost" onClick={exportPartners}>
                  <Download size={16} /> CSV
                </Button>
              </div>
            </div>

            {!partnerReport || partnerReport.partners.length === 0 ? (
              <EmptyState title="No partner-owned sales in this period" />
            ) : (
              <div className="space-y-5">
                {partnerReport.partners.map((p) => (
                  <div key={String(p.partnerId)}>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {p.partnerName}
                      </h3>
                      <span className="text-sm font-bold text-brand-600 dark:text-brand-400">
                        {formatCurrency(p.totalShare, sym)}
                      </span>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-slate-400">
                        <tr>
                          <th className="pb-1 font-medium">Item</th>
                          <th className="pb-1 text-right font-medium">Qty</th>
                          <th className="pb-1 text-right font-medium">Sales</th>
                          <th className="pb-1 text-right font-medium">%</th>
                          <th className="pb-1 text-right font-medium">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.items.map((i) => (
                          <tr key={i.name} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="py-1.5">{i.name}</td>
                            <td className="py-1.5 text-right">{i.quantity}</td>
                            <td className="py-1.5 text-right">{formatCurrency(i.sales, sym)}</td>
                            <td className="py-1.5 text-right">{i.effectivePercentage.toFixed(1)}%</td>
                            <td className="py-1.5 text-right font-medium">
                              {formatCurrency(i.partnerShare, sym)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-bold dark:border-slate-700">
                  <span>Grand Total</span>
                  <span>{formatCurrency(partnerReport.grandTotal, sym)}</span>
                </div>
              </div>
            )}
          </Card>

          {/* Payment report */}
          <Card className="mt-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                <Wallet size={18} /> Payment Report
              </h2>
              <Button size="sm" variant="ghost" onClick={exportPayments}>
                <Download size={16} /> CSV
              </Button>
            </div>

            {!paymentReport || paymentReport.payments.length === 0 ? (
              <EmptyState title="No payments recorded in this period" />
            ) : (
              <>
                <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <StatCard
                    label="Cash"
                    value={formatCurrency(paymentReport.totals.totalCash, sym)}
                    icon={<Wallet size={22} />}
                    accent="text-emerald-600"
                  />
                  <StatCard
                    label="Online (Easypaisa/Bank/etc)"
                    value={formatCurrency(paymentReport.totals.totalOnline, sym)}
                    icon={<Wallet size={22} />}
                    accent="text-brand-600"
                  />
                  <StatCard
                    label="Total Collected"
                    value={formatCurrency(paymentReport.totals.totalCollected, sym)}
                    icon={<Wallet size={22} />}
                    accent="text-purple-600"
                  />
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {paymentReport.byMethod.map((m) => (
                    <li
                      key={`${m.method}-${m.accountDisplayName}`}
                      className="flex items-center justify-between py-2.5"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {m.method}
                          {m.accountDisplayName ? ` — ${m.accountDisplayName}` : ''}
                        </p>
                        <p className="text-xs text-slate-400">
                          {m.count} payment{m.count === 1 ? '' : 's'}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrency(m.amount, sym)}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          {/* Service charge report */}
          <Card className="mt-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                <Receipt size={18} /> Service Charges
              </h2>
              <Button size="sm" variant="ghost" onClick={exportServiceCharges}>
                <Download size={16} /> CSV
              </Button>
            </div>

            {!serviceChargeReport || serviceChargeReport.orders.length === 0 ? (
              <EmptyState title="No service charges in this period" />
            ) : (
              <>
                <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <StatCard
                    label="Period Total (not counted as sales)"
                    value={formatCurrency(serviceChargeReport.periodTotal, sym)}
                    icon={<Receipt size={22} />}
                    accent="text-amber-600"
                  />
                  <StatCard
                    label="Orders with a Service Charge"
                    value={String(serviceChargeReport.orderCount)}
                    icon={<Receipt size={22} />}
                    accent="text-brand-600"
                  />
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {serviceChargeReport.orders.map((o) => (
                    <li key={o.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {o.receiptNumber}
                        </p>
                        <p className="text-xs text-slate-400">
                          {formatDate(o.createdAt)} · {o.cashierName ?? 'Unknown cashier'}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrency(o.serviceChargeAmount, sym)}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
