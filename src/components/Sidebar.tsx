import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  ReceiptText,
  UtensilsCrossed,
  Tags,
  Users,
  BarChart3,
  Settings as SettingsIcon,
  ChefHat,
  UserCog,
} from 'lucide-react';
import type { UserRole } from '@/types';

const baseLinks = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/pos', label: 'POS', icon: ShoppingCart },
  { to: '/orders', label: 'Orders', icon: ReceiptText },
  { to: '/menu', label: 'Menu', icon: UtensilsCrossed },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

interface SidebarProps {
  restaurantName: string;
  userRole?: UserRole;
}

export function Sidebar({ restaurantName, userRole }: SidebarProps) {
  const links = [
    ...baseLinks.filter(({ to }) => to !== '/reports' || userRole !== 'CASHIER'),
    // Users link is only shown to ADMIN users.
    ...(userRole === 'ADMIN'
      ? [{ to: '/users', label: 'Users', icon: UserCog, end: false }]
      : []),
  ];

  return (
    <aside className="flex h-full w-60 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="rounded-lg bg-brand-600 p-2 text-white">
          <ChefHat size={22} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
            {restaurantName}
          </p>
          <p className="text-xs text-slate-400">Point of Sale</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`
            }
          >
            <Icon size={19} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
