import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { api } from '@/services/api';
import type { AuthUser } from '@/types';

interface AuthContextValue {
  user: AuthUser | null;
  /** True while the initial session validation against the DB is in progress. */
  validating: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Replaces the in-memory user and updates sessionStorage. */
  refreshUser: (updated: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = 'pos.session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // validating is true while we are checking the stored session against the DB.
  const [validating, setValidating] = useState(true);

  // ---------------------------------------------------------------------------
  // On mount: read sessionStorage and validate the session against the DB.
  // This catches deactivated accounts and stale sessions.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setValidating(false);
      return;
    }

    let stored: AuthUser;
    try {
      stored = JSON.parse(raw) as AuthUser;
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
      setValidating(false);
      return;
    }

    // Validate the stored session against the live database.
    api
      .currentUser(stored.id)
      .then((fresh) => {
        // Session is valid — update state with the latest user data from DB.
        setUser(fresh);
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      })
      .catch(() => {
        // User no longer exists or is inactive — clear the session.
        sessionStorage.removeItem(STORAGE_KEY);
        setUser(null);
      })
      .finally(() => {
        setValidating(false);
      });
  }, []); // runs once on mount

  const login = useCallback(async (username: string, password: string) => {
    const authUser = await api.login(username, password);
    setUser(authUser);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
  }, []);

  const logout = useCallback(() => {
    // Clear the main-process session store (fire-and-forget).
    // An IPC failure here must never block the local logout — the renderer
    // clears its own state unconditionally regardless of the IPC result.
    api.logout().catch(() => {});
    setUser(null);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const refreshUser = useCallback((updated: AuthUser) => {
    setUser(updated);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  return (
    <AuthContext.Provider value={{ user, validating, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
