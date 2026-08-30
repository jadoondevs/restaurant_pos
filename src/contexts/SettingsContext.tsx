import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { api } from '@/services/api';
import type { Settings, PaymentAccount, SocialLink } from '@/types';

interface SettingsContextValue {
  settings: Settings | null;
  loading: boolean;
  refresh: () => Promise<void>;
  update: (data: Partial<Settings>) => Promise<void>;
  /**
   * Live payment accounts / social links, loaded alongside settings and
   * refreshed together with it. Any page that prints a receipt (POS, Orders)
   * reads these here rather than fetching separately, so they're always the
   * copy the receipt-config Settings page just wrote. Settings.tsx's own
   * CRUD calls refresh() afterward to keep this copy current too.
   */
  paymentAccounts: PaymentAccount[];
  socialLinks: SocialLink[];
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [loading, setLoading] = useState(true);

  const applyDarkMode = (dark: boolean) => {
    document.documentElement.classList.toggle('dark', dark);
  };

  const refresh = useCallback(async () => {
    const [data, accounts, links] = await Promise.all([
      api.getSettings(),
      api.listPaymentAccounts(),
      api.listSocialLinks(),
    ]);
    setSettings(data);
    setPaymentAccounts(accounts);
    setSocialLinks(links);
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
    <SettingsContext.Provider value={{ settings, loading, refresh, update, paymentAccounts, socialLinks }}>
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
