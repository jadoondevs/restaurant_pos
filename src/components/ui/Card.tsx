import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${className}`}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: ReactNode;
  accent?: string;
}

export function StatCard({ label, value, icon, accent = 'text-brand-600' }: StatCardProps) {
  return (
    <Card className="flex items-center gap-4">
      <div className={`rounded-lg bg-slate-100 p-3 dark:bg-slate-800 ${accent}`}>{icon}</div>
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      </div>
    </Card>
  );
}
