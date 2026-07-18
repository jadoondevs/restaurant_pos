import { useEffect, useState, useCallback } from 'react';
import { Download, DollarSign, ShoppingBag, TrendingUp } from 'lucide-react';
import { api } from '@/services/api';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrency, rangeFor, formatDate } from '@/utils/format';
import { downloadCsv } from '@/utils/csv';
import { Card, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader, EmptyState, Spinner } from '@/components/ui/Misc';
import type { ReportSummary, TopItem } from '@/types';

type Period = 'today' | 'week' | 'month';
const periodLabels: Record<Period, string> = {
  today: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
};

export function Reports() {
  const { settings } = useSettings();
  const { toast } = useToast();
  const sym = settings?.currencySymbol ?? '$';

  const [period, setPeriod] = useState<Period>('today');
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: Period) => {
      setLoading(true);
      try {
        const range = rangeFor(p);
        const [sum, tops] = await Promise.all([api.reportSummary(range), api.topItems(range)]);
        setSummary(sum);
        setTopItems(tops);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Failed to load reports.', 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    load(period);
  }, [period, load]);

  const exportSales = () => {
    if (!summary?.daily.length) return toast('Nothing to export.', 'info');
    downloadCsv(
      `sales-${period}-${new Date().toISOString().slice(0, 10)}.csv`,
      summary.daily.map((d) => ({
        Date: d.date,
        Orders: d.orders,
        Revenue: d.revenue.toFixed(2),
      }))
    );
  };

  const exportTopItems = () => {
    if (!topItems.length) return toast('Nothing to export.', 'info');
    downloadCsv(
      `top-items-${period}-${new Date().toISOString().slice(0, 10)}.csv`,
      topItems.map((t) => ({ Item: t.name, Quantity: t.quantity, Revenue: t.revenue.toFixed(2) }))
    );
  };

  const maxRevenue = Math.max(1, ...(summary?.daily.map((d) => d.revenue) ?? [1]));

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Sales performance and insights"
        action={
          <Button variant="secondary" onClick={exportSales}>
            <Download size={18} /> Export CSV
          </Button>
        }
      />

      {/* Period selector */}
      <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
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
        </>
      )}
    </div>
  );
}
