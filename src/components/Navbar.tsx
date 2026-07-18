import { Moon, Sun, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';

export function Navbar() {
  const { user, logout } = useAuth();
  const { settings, update } = useSettings();

  const toggleDark = () => update({ darkMode: !settings?.darkMode });

  return (
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
        <button
          onClick={toggleDark}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          title="Toggle dark mode"
        >
          {settings?.darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {user?.username}
        </span>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <LogOut size={16} />
          Logout
        </button>
      </div>
    </header>
  );
}
