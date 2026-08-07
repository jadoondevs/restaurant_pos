import { Moon, Sun, LogOut, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';

export function Navbar() {
  const { user, logout } = useAuth();
  const { settings, update } = useSettings();
  const navigate = useNavigate();

  const toggleDark = () => update({ darkMode: !settings?.darkMode });

  return (
    <>
      {/* mustChangePassword warning — non-blocking, persistent until resolved */}
      {user?.mustChangePassword && (
        <div className="flex items-center justify-between bg-amber-50 px-6 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            You are using the default password. Please change it to secure your account.
          </span>
          <button
            onClick={() => navigate('/settings')}
            className="ml-4 shrink-0 rounded-md bg-amber-100 px-3 py-1 text-xs font-medium hover:bg-amber-200 dark:bg-amber-800/40 dark:hover:bg-amber-800/60"
          >
            Change Password
          </button>
        </div>
      )}

      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          {new Date().toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </div>

        <div className="flex items-center gap-3">
          {user?.role === 'ADMIN' && (
            <button
              onClick={toggleDark}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Toggle dark mode"
            >
              {settings?.darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          )}

          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {user?.fullName}
            </span>
            {user?.role === 'ADMIN' && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                Admin
              </span>
            )}
          </div>

          <button
            onClick={logout}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>
    </>
  );
}
