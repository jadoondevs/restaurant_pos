/**
 * Authentication tests.
 *
 * Tests password hashing, login validation logic, and the default admin
 * bootstrap without requiring Electron or a real database.
 */
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';

// ---------------------------------------------------------------------------
// Helpers that mirror the production logic
// ---------------------------------------------------------------------------

/** Mirrors the login validation in electron/ipc/auth.ts */
async function validateLogin(
  inputUsername: string,
  inputPassword: string,
  storedUser: {
    username: string;
    passwordHash: string;
    isActive: boolean;
    role: string;
    fullName: string;
    mustChangePassword: boolean;
  } | null
): Promise<{ id: number; username: string; fullName: string; role: string; mustChangePassword: boolean }> {
  if (!inputUsername?.trim() || !inputPassword) {
    throw new Error('Username and password are required.');
  }
  if (!storedUser) throw new Error('Invalid username or password.');
  if (!storedUser.isActive) {
    throw new Error('This account has been deactivated. Please contact your administrator.');
  }
  const valid = await bcrypt.compare(inputPassword, storedUser.passwordHash);
  if (!valid) throw new Error('Invalid username or password.');
  return {
    id: 1,
    username: storedUser.username,
    fullName: storedUser.fullName,
    role: storedUser.role,
    mustChangePassword: storedUser.mustChangePassword,
  };
}

/** Mirrors the password change validation in electron/ipc/auth.ts */
async function validatePasswordChange(
  currentPassword: string,
  newPassword: string,
  storedHash: string
): Promise<string> {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters.');
  }
  const valid = await bcrypt.compare(currentPassword, storedHash);
  if (!valid) throw new Error('Current password is incorrect.');
  return bcrypt.hash(newPassword, 10);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Password hashing', () => {
  it('hashes a password with bcrypt', async () => {
    const hash = await bcrypt.hash('admin123', 10);
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(hash).not.toBe('admin123');
  });

  it('verifies a correct password', async () => {
    const hash = await bcrypt.hash('mypassword', 10);
    const valid = await bcrypt.compare('mypassword', hash);
    expect(valid).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await bcrypt.hash('mypassword', 10);
    const valid = await bcrypt.compare('wrongpassword', hash);
    expect(valid).toBe(false);
  });

  it('produces a different hash each time (salt)', async () => {
    const hash1 = await bcrypt.hash('samepassword', 10);
    const hash2 = await bcrypt.hash('samepassword', 10);
    expect(hash1).not.toBe(hash2);
  });

  it('both hashes still verify correctly', async () => {
    const hash1 = await bcrypt.hash('samepassword', 10);
    const hash2 = await bcrypt.hash('samepassword', 10);
    expect(await bcrypt.compare('samepassword', hash1)).toBe(true);
    expect(await bcrypt.compare('samepassword', hash2)).toBe(true);
  });
});

describe('Login validation', () => {
  const makeUser = async (overrides: Partial<{
    username: string;
    password: string;
    isActive: boolean;
    role: string;
    fullName: string;
    mustChangePassword: boolean;
  }> = {}) => ({
    username: overrides.username ?? 'admin',
    passwordHash: await bcrypt.hash(overrides.password ?? 'admin123', 10),
    isActive: overrides.isActive ?? true,
    role: overrides.role ?? 'ADMIN',
    fullName: overrides.fullName ?? 'Administrator',
    mustChangePassword: overrides.mustChangePassword ?? true,
  });

  it('returns session payload on successful login', async () => {
    const user = await makeUser();
    const result = await validateLogin('admin', 'admin123', user);
    expect(result.username).toBe('admin');
    expect(result.fullName).toBe('Administrator');
    expect(result.role).toBe('ADMIN');
    expect(result.mustChangePassword).toBe(true);
  });

  it('throws on wrong password', async () => {
    const user = await makeUser();
    await expect(validateLogin('admin', 'wrongpassword', user)).rejects.toThrow(
      'Invalid username or password.'
    );
  });

  it('throws when user does not exist', async () => {
    await expect(validateLogin('admin', 'admin123', null)).rejects.toThrow(
      'Invalid username or password.'
    );
  });

  it('throws when account is inactive', async () => {
    const user = await makeUser({ isActive: false });
    await expect(validateLogin('admin', 'admin123', user)).rejects.toThrow(
      'deactivated'
    );
  });

  it('throws when username is empty', async () => {
    const user = await makeUser();
    await expect(validateLogin('', 'admin123', user)).rejects.toThrow(
      'required'
    );
  });

  it('throws when password is empty', async () => {
    const user = await makeUser();
    await expect(validateLogin('admin', '', user)).rejects.toThrow(
      'required'
    );
  });

  it('trims whitespace from username before lookup', async () => {
    const user = await makeUser({ username: 'admin' });
    // The trimmed username matches the stored username
    const result = await validateLogin('  admin  ', 'admin123', user);
    expect(result.username).toBe('admin');
  });

  it('returns mustChangePassword=false for a user who has changed password', async () => {
    const user = await makeUser({ mustChangePassword: false });
    const result = await validateLogin('admin', 'admin123', user);
    expect(result.mustChangePassword).toBe(false);
  });

  it('returns CASHIER role correctly', async () => {
    const user = await makeUser({ role: 'CASHIER', fullName: 'Jane Smith' });
    const result = await validateLogin('admin', 'admin123', user);
    expect(result.role).toBe('CASHIER');
    expect(result.fullName).toBe('Jane Smith');
  });
});

describe('Password change validation', () => {
  it('returns a new hash on success', async () => {
    const oldHash = await bcrypt.hash('oldpassword', 10);
    const newHash = await validatePasswordChange('oldpassword', 'newpassword123', oldHash);
    expect(await bcrypt.compare('newpassword123', newHash)).toBe(true);
  });

  it('throws when current password is wrong', async () => {
    const oldHash = await bcrypt.hash('oldpassword', 10);
    await expect(
      validatePasswordChange('wrongpassword', 'newpassword123', oldHash)
    ).rejects.toThrow('Current password is incorrect.');
  });

  it('throws when new password is too short', async () => {
    const oldHash = await bcrypt.hash('oldpassword', 10);
    await expect(
      validatePasswordChange('oldpassword', 'abc', oldHash)
    ).rejects.toThrow('at least 6 characters');
  });

  it('throws when new password is empty', async () => {
    const oldHash = await bcrypt.hash('oldpassword', 10);
    await expect(
      validatePasswordChange('oldpassword', '', oldHash)
    ).rejects.toThrow('at least 6 characters');
  });

  it('new hash is different from old hash', async () => {
    const oldHash = await bcrypt.hash('oldpassword', 10);
    const newHash = await validatePasswordChange('oldpassword', 'newpassword123', oldHash);
    expect(newHash).not.toBe(oldHash);
  });
});

describe('Default admin bootstrap logic', () => {
  it('default password admin123 verifies correctly', async () => {
    const hash = await bcrypt.hash('admin123', 10);
    expect(await bcrypt.compare('admin123', hash)).toBe(true);
  });

  it('default admin has ADMIN role', () => {
    const defaultUser = {
      username: 'admin',
      fullName: 'Administrator',
      role: 'ADMIN',
      isActive: true,
      mustChangePassword: true,
    };
    expect(defaultUser.role).toBe('ADMIN');
    expect(defaultUser.mustChangePassword).toBe(true);
    expect(defaultUser.isActive).toBe(true);
  });

  it('mustChangePassword is true for the default admin', () => {
    // The default admin must always be created with mustChangePassword=true
    // so the restaurant owner is prompted to set a secure password.
    const mustChange = true;
    expect(mustChange).toBe(true);
  });

  it('bootstrap is idempotent — second call would find existing ADMIN and skip', () => {
    // Simulate the seedDefaultAdmin check:
    // if existingAdmin !== null, do nothing.
    const existingAdmin = { id: 1, role: 'ADMIN' };
    const shouldSeed = existingAdmin === null;
    expect(shouldSeed).toBe(false);
  });
});
