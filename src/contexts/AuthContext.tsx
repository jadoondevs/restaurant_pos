import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { api } from '@/services/api';
import type { Admin } from '@/types';

interface AuthContextValue {
  user: Admin | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = 'pos.session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Admin | null>(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Admin) : null;
  });

  const login = useCallback(async (username: string, password: string) => {
    const admin = await api.login(username, password);
    setUser(admin);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(admin));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
