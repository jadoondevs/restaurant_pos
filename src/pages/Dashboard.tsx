import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DollarSign, ShoppingBag, TrendingUp, Users, Plus, ReceiptText, BarChart3, HandCoins } from 'lucide-react';
import { api } from '@/services/api';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatDate } from '@/utils/format';
import { DateFilterBar, describeDateFilter, todayIso, type DateFilterValue } from '@/components/DateRangeControl';
import { StatCard, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader, PageLoader, EmptyState } from '@/components/ui/Misc';
import type { DashboardStats, PartnerReport } from '@/types';

export function Dashboard() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { user } = useAuth();
  const canSeePartnerShare = user?.role !== 'CASHIER'; // matches the existing Reports-button gate below
  const sym = settings?.currencySymbol ?? '$';

  // Priority 1 — historical date/date-range selector. Defaults to today,
  // exactly matching the Dashboard's original today-only behavior.
  const [range, setRange] = useState<DateFilterValue>({ from: todayIso(), to: todayIso() });
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [partnerReport, setPartnerReport] = useState<PartnerReport | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        api.dashboard(range),
        canSeePartnerShare ? api.partnerReport(range) : Promise.resolve(null),
      ]);
      setStats(s);
      setPartnerReport(p);
    } catch {
      setStats(null);
      setPartnerReport(null);
    } finally {
      setInitialLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, canSeePartnerShare]);

  useEffect(() => {
    load();
  }, [load]);

  if (initialLoading) return <PageLoader />;

  const tablesLabel = stats?.isToday ? 'Active Tables' : 'Tables Served';

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          stats?.isToday ? "Today's overview at a glance" : `Overview for ${describeDateFilter(range, formatDate)}`
        }
      />

      <div className="mb-4">
        <DateFilterBar value={range} onChange={setRange} />
      </div>

      {!stats ? (
        <EmptyState title="Could not load dashboard data" subtitle="Try selecting a different date." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={stats.isToday ? "Today's Sales" : 'Sales'}
              value={formatCurrency(stats.todaySales, sym)}
              icon={<DollarSign size={22} />}
              accent="text-emerald-600"
            />
            <StatCard
              label="Orders"
              value={String(stats.orderCount)}
              icon={<ShoppingBag size={22} />}
              accent="text-brand-600"
            />
            <StatCard
              label="Avg Order Value"
              value={formatCurrency(stats.averageOrderValue, sym)}
              icon={<TrendingUp size={22} />}
              accent="text-amber-600"
            />
            <StatCard
              label={tablesLabel}
              value={String(stats.activeTables)}
              icon={<Users size={22} />}
              accent="text-purple-600"
            />
          </div>

          {/* Priority 2 — Partner Share for the selected date/range. Every
              partner shown simultaneously, no dropdown required. */}
          {canSeePartnerShare && (
            <Card className="mt-6">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                <HandCoins size={18} /> Partner Share
              </h2>
              {!partnerReport || partnerReport.partners.length === 0 ? (
                <EmptyState
                  title="No partner-owned sales in this period"
                  subtitle="No order in this period contained an item with partner ownership configured at the time it was sold."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-400">
                      <tr>
                        <th className="pb-2 font-medium">Partner</th>
                        <th className="pb-2 text-right font-medium">Sales</th>
                        <th className="pb-2 text-right font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partnerReport.partners.map((p) => {
                        const sales = p.items.reduce((sum, i) => sum + i.sales, 0);
                        return (
                          <tr key={String(p.partnerId)} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="py-2 font-medium text-slate-900 dark:text-slate-100">{p.partnerName}</td>
                            <td className="py-2 text-right">{formatCurrency(sales, sym)}</td>
                            <td className="py-2 text-right font-semibold text-brand-600 dark:text-brand-400">
                              {formatCurrency(p.totalShare, sym)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 font-bold dark:border-slate-700">
                        <td className="pt-2">Grand Total</td>
                        <td></td>
                        <td className="pt-2 text-right">{formatCurrency(partnerReport.grandTotal, sym)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          )}

        </>
      )}

      {/* Quick Actions doesn't depend on dashboard stats — kept available
          even if the stats fetch fails, so navigation is never blocked. */}
      <Card className="mt-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button size="lg" onClick={() => navigate('/pos')}>
            <Plus size={18} /> New Sale
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate('/orders')}>
            <ReceiptText size={18} /> View Orders
          </Button>
          {user?.role !== 'CASHIER' && (
            <Button size="lg" variant="secondary" onClick={() => navigate('/reports')}>
              <BarChart3 size={18} /> Reports
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
