/**
 * Batch 9 receipt configuration tests — exercises buildReceiptHtml and
 * buildQrCodeSvg directly (both are pure string-building functions with no
 * Electron/DOM dependency, so a real import is safe here unlike the
 * IPC-handler logic mirrored elsewhere in tests/).
 */
import { describe, it, expect } from 'vitest';
import { buildReceiptHtml, orderToReceiptData } from '../src/utils/receipt';
import { buildQrCodeSvg } from '../src/utils/qrcode';
import type { Settings, ReceiptData, PaymentAccount, SocialLink } from '../src/types';

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    id: 1,
    restaurantName: 'Test Restaurant',
    address: '123 Main St',
    phone: '0300-1234567',
    taxPercentage: 0,
    currencySymbol: 'Rs',
    receiptFooter: 'Thank you!',
    darkMode: false,
    receiptPaperSize: '80mm',
    backupSchedule: 'daily',
    backupOnExit: true,
    cloudBackupEnabled: false,
    logoPath: null,
    currencyCode: 'PKR',
    receiptShowLogo: true,
    serviceChargePresets: null,
    googleReviewUrl: null,
    googleReviewOnReceipt: false,
    ...overrides,
  };
}

function baseReceipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    receiptNumber: 'R-20260830-0001',
    createdAt: new Date().toISOString(),
    tableNumber: null,
    cashierName: 'Alice',
    customer: null,
    items: [{ name: 'Burger', price: 500, quantity: 2, specialInstructions: null, lineTotal: 1000 }],
    subtotal: 1000,
    discount: 0,
    taxRate: 0,
    taxAmount: 0,
    grandTotal: 1000,
    cashReceived: 1000,
    change: 0,
    serviceChargeType: 'NONE',
    serviceChargeValue: 0,
    serviceChargeAmount: 0,
    totalDue: 1000,
    paymentStatus: 'PAID',
    payments: [{ method: 'CASH', amount: 1000, accountDisplayName: null }],
    ...overrides,
  };
}

const account: PaymentAccount = {
  id: 1,
  type: 'EASYPAISA',
  displayName: 'Easypaisa',
  accountHolderName: null,
  phoneNumber: '0300-1111111',
  bankName: null,
  accountNumber: null,
  iban: null,
  isActive: true,
  printOnReceipt: true,
  sortOrder: 0,
};

const social: SocialLink = {
  id: 1,
  platform: 'FACEBOOK',
  displayName: 'Facebook',
  value: 'fb.com/testrestaurant',
  isEnabled: true,
  showOnReceipt: true,
  sortOrder: 0,
};

describe('buildReceiptHtml — baseline (no new config) unchanged behavior', () => {
  it('renders subtotal/total/cash/change and omits every new section when nothing is configured', () => {
    const html = buildReceiptHtml(baseReceipt(), baseSettings({ receiptShowLogo: true, logoPath: null }));
    expect(html).toContain('Subtotal');
    expect(html).toContain('TOTAL');
    expect(html).toContain('Cash');
    expect(html).toContain('Change');
    expect(html).not.toContain('Service Charge');
    expect(html).not.toContain('TOTAL DUE');
    expect(html).not.toContain('Ways to Pay');
    expect(html).not.toContain('class="social"');
    expect(html).not.toContain('class="logo"');
    expect(html).not.toContain('<div class="qr-wrap"');
    expect(html).not.toContain('Balance Due');
  });
});

describe('buildReceiptHtml — service charge', () => {
  it('shows Service Charge and TOTAL DUE lines when serviceChargeAmount > 0', () => {
    const html = buildReceiptHtml(
      baseReceipt({ serviceChargeType: 'PERCENTAGE', serviceChargeValue: 10, serviceChargeAmount: 100, totalDue: 1100 }),
      baseSettings()
    );
    expect(html).toContain('Service Charge (10%)');
    expect(html).toContain('TOTAL DUE');
  });

  it('omits Service Charge lines when serviceChargeAmount is 0', () => {
    const html = buildReceiptHtml(baseReceipt(), baseSettings());
    expect(html).not.toContain('Service Charge');
  });
});

describe('buildReceiptHtml — payment status', () => {
  it('shows Balance Due when paymentStatus is not PAID', () => {
    const html = buildReceiptHtml(
      baseReceipt({ paymentStatus: 'PARTIAL', payments: [{ method: 'CASH', amount: 400, accountDisplayName: null }], totalDue: 1000 }),
      baseSettings()
    );
    expect(html).toContain('Balance Due');
    expect(html).toContain('Rs600.00');
  });

  it('omits Balance Due when paymentStatus is PAID', () => {
    const html = buildReceiptHtml(baseReceipt(), baseSettings());
    expect(html).not.toContain('Balance Due');
  });
});

describe('buildReceiptHtml — logo', () => {
  it('renders the logo image when receiptShowLogo is true and logoPath is set', () => {
    const html = buildReceiptHtml(baseReceipt(), baseSettings({ receiptShowLogo: true, logoPath: 'data:image/jpeg;base64,AAAA' }));
    expect(html).toContain('class="logo"');
    expect(html).toContain('data:image/jpeg;base64,AAAA');
  });

  it('omits the logo when receiptShowLogo is false even if logoPath is set', () => {
    const html = buildReceiptHtml(baseReceipt(), baseSettings({ receiptShowLogo: false, logoPath: 'data:image/jpeg;base64,AAAA' }));
    expect(html).not.toContain('class="logo"');
  });
});

describe('buildReceiptHtml — payment options (live PaymentAccount list)', () => {
  it('lists only accounts that are both active and printOnReceipt', () => {
    const inactive = { ...account, id: 2, displayName: 'Old Account', isActive: false };
    const notPrintable = { ...account, id: 3, displayName: 'Hidden Account', printOnReceipt: false };
    const html = buildReceiptHtml(baseReceipt(), baseSettings(), [account, inactive, notPrintable], []);
    expect(html).toContain('Ways to Pay');
    expect(html).toContain('Easypaisa');
    expect(html).toContain('0300-1111111');
    expect(html).not.toContain('Old Account');
    expect(html).not.toContain('Hidden Account');
  });

  it('renders bank details (bank name, account number, IBAN) for BANK accounts', () => {
    const bank: PaymentAccount = {
      ...account,
      id: 4,
      type: 'BANK',
      displayName: 'Main Bank',
      phoneNumber: null,
      bankName: 'ABC Bank',
      accountNumber: '1234567890',
      iban: 'PK00ABCD0000001234567890',
    };
    const html = buildReceiptHtml(baseReceipt(), baseSettings(), [bank], []);
    expect(html).toContain('ABC Bank');
    expect(html).toContain('1234567890');
    expect(html).toContain('IBAN: PK00ABCD0000001234567890');
  });

  it('omits the Ways to Pay section when no account qualifies', () => {
    const html = buildReceiptHtml(baseReceipt(), baseSettings(), [{ ...account, isActive: false }], []);
    expect(html).not.toContain('Ways to Pay');
  });
});

describe('buildReceiptHtml — social links', () => {
  it('lists only enabled, receipt-visible social links, ordered by sortOrder', () => {
    const second = { ...social, id: 2, displayName: 'Instagram', value: '@testrestaurant', sortOrder: 1 };
    const disabled = { ...social, id: 3, displayName: 'Disabled', isEnabled: false };
    const hidden = { ...social, id: 4, displayName: 'Hidden', showOnReceipt: false };
    const html = buildReceiptHtml(baseReceipt(), baseSettings(), [], [second, social, disabled, hidden]);
    expect(html).toContain('Facebook');
    expect(html).toContain('Instagram');
    expect(html).not.toContain('Disabled');
    expect(html).not.toContain('Hidden');
    expect(html.indexOf('Facebook')).toBeLessThan(html.indexOf('Instagram'));
  });
});

describe('buildReceiptHtml — Google Review QR', () => {
  it('embeds an SVG QR code when googleReviewOnReceipt is true and a URL is set', () => {
    const html = buildReceiptHtml(
      baseReceipt(),
      baseSettings({ googleReviewOnReceipt: true, googleReviewUrl: 'https://g.page/r/test' }),
      [],
      []
    );
    expect(html).toContain('<div class="qr-wrap"');
    expect(html).toContain('<svg');
    expect(html).toContain('Scan to leave a review');
  });

  it('omits the QR block when googleReviewOnReceipt is false, even with a URL set', () => {
    const html = buildReceiptHtml(
      baseReceipt(),
      baseSettings({ googleReviewOnReceipt: false, googleReviewUrl: 'https://g.page/r/test' }),
      [],
      []
    );
    expect(html).not.toContain('<div class="qr-wrap"');
  });

  it('omits the QR block when no URL is configured, even if the toggle is on', () => {
    const html = buildReceiptHtml(
      baseReceipt(),
      baseSettings({ googleReviewOnReceipt: true, googleReviewUrl: null }),
      [],
      []
    );
    expect(html).not.toContain('<div class="qr-wrap"');
  });
});

describe('orderToReceiptData', () => {
  it('defaults service charge and payment fields when the order predates them', () => {
    const data = orderToReceiptData({
      receiptNumber: 'R-1',
      createdAt: new Date().toISOString(),
      tableNumber: null,
      items: [],
      subtotal: 500,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      grandTotal: 500,
      cashReceived: 500,
      change: 0,
    });
    expect(data.serviceChargeType).toBe('NONE');
    expect(data.serviceChargeAmount).toBe(0);
    expect(data.totalDue).toBe(500);
    expect(data.paymentStatus).toBe('PAID');
    expect(data.payments).toEqual([]);
  });

  it('computes totalDue as grandTotal + serviceChargeAmount and passes through payments', () => {
    const data = orderToReceiptData({
      receiptNumber: 'R-2',
      createdAt: new Date().toISOString(),
      tableNumber: null,
      items: [],
      subtotal: 1000,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      grandTotal: 1000,
      cashReceived: 1100,
      change: 0,
      serviceChargeType: 'FIXED',
      serviceChargeValue: 100,
      serviceChargeAmount: 100,
      paymentStatus: 'PAID',
      payments: [{ method: 'CASH', amount: 1100, accountDisplayName: null }],
    });
    expect(data.totalDue).toBe(1100);
    expect(data.payments).toHaveLength(1);
  });
});

describe('buildQrCodeSvg', () => {
  it('produces a scalable SVG tag for a URL', () => {
    const svg = buildQrCodeSvg('https://g.page/r/test');
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('viewBox');
  });

  it('produces different output for different input text', () => {
    const a = buildQrCodeSvg('https://example.com/a');
    const b = buildQrCodeSvg('https://example.com/b');
    expect(a).not.toBe(b);
  });
});
