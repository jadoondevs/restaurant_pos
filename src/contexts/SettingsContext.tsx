import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { api } from '@/services/api';
import type { Settings } from '@/types';

interface SettingsContextValue {
  settings: Settings | null;
  loading: boolean;
  refresh: () => Promise<void>;
  update: (data: Partial<Settings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const applyDarkMode = (dark: boolean) => {
    document.documentElement.classList.toggle('dark', dark);
  };

  const refresh = useCallback(async () => {
    const data = await api.getSettings();
    setSettings(data);
    applyDarkMode(data.darkMode);
  }, []);

  const update = useCallback(async (data: Partial<Settings>) => {
    const updated = await api.updateSettings(data);
    setSettings(updated);
    applyDarkMode(updated.darkMode);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <SettingsContext.Provider value={{ settings, loading, refresh, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}
