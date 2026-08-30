/**
 * Batch 11 hardening — sessionStore tests, focused on clearSessionsForUser
 * (immediate session invalidation on deactivate / role change / password
 * reset). electron/auth/sessionStore.ts has zero Electron/Prisma
 * dependency (a plain in-memory Map plus a type-only import), so it's
 * imported directly rather than mirrored.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setSession,
  getSession,
  clearSession,
  clearSessionsForUser,
  clearAll,
  hasRole,
} from '../electron/auth/sessionStore';
import type { AuthUser } from '../electron/types/authUser';

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    username: 'cashier1',
    fullName: 'Cash Ier',
    role: 'CASHIER',
    mustChangePassword: false,
    ...overrides,
  };
}

beforeEach(() => clearAll());

describe('clearSessionsForUser', () => {
  it('removes the session belonging to the given userId', () => {
    setSession(100, makeUser({ id: 5 }));
    clearSessionsForUser(5);
    expect(getSession(100)).toBeUndefined();
  });

  it('leaves other users\' sessions untouched', () => {
    setSession(100, makeUser({ id: 5 }));
    setSession(200, makeUser({ id: 6, username: 'other' }));
    clearSessionsForUser(5);
    expect(getSession(100)).toBeUndefined();
    expect(getSession(200)?.id).toBe(6);
  });

  it('clears every webContents session for a user logged in from more than one window', () => {
    setSession(100, makeUser({ id: 5 }));
    setSession(101, makeUser({ id: 5 }));
    clearSessionsForUser(5);
    expect(getSession(100)).toBeUndefined();
    expect(getSession(101)).toBeUndefined();
  });

  it('is a no-op when the user has no active session', () => {
    setSession(100, makeUser({ id: 5 }));
    expect(() => clearSessionsForUser(999)).not.toThrow();
    expect(getSession(100)?.id).toBe(5);
  });
});

describe('clearSession vs clearSessionsForUser', () => {
  it('clearSession only removes the exact webContents.id entry', () => {
    setSession(100, makeUser({ id: 5 }));
    setSession(101, makeUser({ id: 5 }));
    clearSession(100);
    expect(getSession(100)).toBeUndefined();
    expect(getSession(101)?.id).toBe(5); // the other window's session survives
  });
});

describe('hasRole (regression — unchanged by this batch)', () => {
  it('ADMIN meets every requirement', () => {
    expect(hasRole('ADMIN', 'CASHIER')).toBe(true);
    expect(hasRole('ADMIN', 'MANAGER')).toBe(true);
    expect(hasRole('ADMIN', 'ADMIN')).toBe(true);
  });

  it('CASHIER does not meet MANAGER or ADMIN', () => {
    expect(hasRole('CASHIER', 'MANAGER')).toBe(false);
    expect(hasRole('CASHIER', 'ADMIN')).toBe(false);
  });
});
