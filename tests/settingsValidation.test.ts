/**
 * Batch 8 settings validation tests — mirrors the exact validation logic in
 * electron/ipc/settings.ts's settings:update handler (serviceChargePresets
 * JSON shape and googleReviewUrl format), zero Electron/Prisma dependency.
 */
import { describe, it, expect } from 'vitest';

/** Mirrors the serviceChargePresets check in electron/ipc/settings.ts. */
function validateServiceChargePresets(presets: string | null | undefined): void {
  if (!presets) return;
  try {
    const parsed = JSON.parse(presets);
    if (!Array.isArray(parsed) || !parsed.every((n) => typeof n === 'number' && n >= 0)) {
      throw new Error();
    }
  } catch {
    throw new Error('Service charge presets must be a list of non-negative numbers.');
  }
}

/** Mirrors the googleReviewUrl check in electron/ipc/settings.ts. */
function validateGoogleReviewUrl(url: string | null | undefined): void {
  if (!url) return;
  if (!/^https?:\/\//i.test(url.trim())) {
    throw new Error('Google Review URL must start with http:// or https://');
  }
}

describe('settings:update — serviceChargePresets validation', () => {
  it('accepts a valid JSON array of non-negative numbers', () => {
    expect(() => validateServiceChargePresets('[50,100,150]')).not.toThrow();
    expect(() => validateServiceChargePresets('[]')).not.toThrow();
    expect(() => validateServiceChargePresets('[0]')).not.toThrow();
  });

  it('accepts null/undefined/empty (optional field)', () => {
    expect(() => validateServiceChargePresets(null)).not.toThrow();
    expect(() => validateServiceChargePresets(undefined)).not.toThrow();
    expect(() => validateServiceChargePresets('')).not.toThrow();
  });

  it('rejects malformed JSON', () => {
    expect(() => validateServiceChargePresets('not json')).toThrow(
      'Service charge presets must be a list of non-negative numbers.'
    );
  });

  it('rejects a JSON object instead of an array', () => {
    expect(() => validateServiceChargePresets('{"a":1}')).toThrow();
  });

  it('rejects negative numbers', () => {
    expect(() => validateServiceChargePresets('[50,-10]')).toThrow();
  });

  it('rejects non-numeric array entries', () => {
    expect(() => validateServiceChargePresets('[50,"abc"]')).toThrow();
  });
});

describe('settings:update — googleReviewUrl validation', () => {
  it('accepts http:// and https:// URLs', () => {
    expect(() => validateGoogleReviewUrl('https://g.page/r/abc')).not.toThrow();
    expect(() => validateGoogleReviewUrl('http://example.com')).not.toThrow();
  });

  it('accepts null/undefined/empty (optional field)', () => {
    expect(() => validateGoogleReviewUrl(null)).not.toThrow();
    expect(() => validateGoogleReviewUrl(undefined)).not.toThrow();
    expect(() => validateGoogleReviewUrl('')).not.toThrow();
  });

  it('rejects a URL missing the protocol', () => {
    expect(() => validateGoogleReviewUrl('g.page/r/abc')).toThrow(
      'Google Review URL must start with http:// or https://'
    );
  });

  it('rejects an arbitrary non-URL string', () => {
    expect(() => validateGoogleReviewUrl('not a url')).toThrow();
  });
});

describe('SocialLink platform validation', () => {
  const VALID_PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'WHATSAPP', 'WEBSITE', 'OTHER'];

  function validatePlatform(platform: string): void {
    if (!VALID_PLATFORMS.includes(platform)) {
      throw new Error(`Invalid platform. Must be one of: ${VALID_PLATFORMS.join(', ')}`);
    }
  }

  it('accepts every documented platform', () => {
    for (const p of VALID_PLATFORMS) {
      expect(() => validatePlatform(p)).not.toThrow();
    }
  });

  it('rejects an unknown platform', () => {
    expect(() => validatePlatform('SNAPCHAT')).toThrow();
  });
});

describe('PaymentAccount type validation', () => {
  const VALID_TYPES = ['CASH', 'EASYPAISA', 'BANK'];

  function validateType(type: string): void {
    if (!VALID_TYPES.includes(type)) {
      throw new Error(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
    }
  }

  it('accepts every documented type', () => {
    for (const t of VALID_TYPES) {
      expect(() => validateType(t)).not.toThrow();
    }
  });

  it('rejects an unknown type', () => {
    expect(() => validateType('CREDIT_CARD')).toThrow();
  });
});
