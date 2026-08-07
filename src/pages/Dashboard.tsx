import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DollarSign, ShoppingBag, TrendingUp, Users, Plus, ReceiptText, BarChart3 } from 'lucide-react';
import { api } from '@/services/api';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/utils/format';
import { StatCard, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader, PageLoader } from '@/components/ui/Misc';
import type { DashboardStats } from '@/types';

export function Dashboard() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const sym = settings?.currencySymbol ?? '$';

  useEffect(() => {
    api.dashboard().then(setStats).catch(() => setStats(null));
  }, []);

  if (!stats) return <PageLoader />;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Today's overview at a glance" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today's Sales"
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
          label="Active Tables"
          value={String(stats.activeTables)}
          icon={<Users size={22} />}
          accent="text-purple-600"
        />
      </div>

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
