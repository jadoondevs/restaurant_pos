import { useEffect, useState } from 'react';
import { Save, KeyRound, Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/contexts/ToastContext';
import { compressImage } from '@/utils/image';
import { BackupSection } from '@/components/BackupSection';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { PageHeader, PageLoader, Badge } from '@/components/ui/Misc';
import type { Settings as SettingsType, SocialLink, PaymentAccount, SocialPlatform, PaymentMethodType } from '@/types';

const SOCIAL_PLATFORMS: SocialPlatform[] = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'WHATSAPP', 'WEBSITE', 'OTHER'];
const PAYMENT_TYPES: PaymentMethodType[] = ['CASH', 'EASYPAISA', 'BANK'];

const emptySocialLink: Partial<SocialLink> = {
  platform: 'FACEBOOK',
  displayName: '',
  value: '',
  isEnabled: true,
  showOnReceipt: false,
  sortOrder: 0,
};

const emptyPaymentAccount: Partial<PaymentAccount> = {
  type: 'EASYPAISA',
  displayName: '',
  accountHolderName: '',
  phoneNumber: '',
  bankName: '',
  accountNumber: '',
  iban: '',
  isActive: true,
  printOnReceipt: false,
  sortOrder: 0,
};

export function Settings() {
  const { settings, update, refresh: refreshSettingsContext } = useSettings();
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();

  const [form, setForm] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);
  const [presetsInput, setPresetsInput] = useState('');

  // Password change modal state.
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const canEditSettings = user?.role === 'ADMIN';

  // Social links
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [socialModalOpen, setSocialModalOpen] = useState(false);
  const [editingSocial, setEditingSocial] = useState<SocialLink | null>(null);
  const [socialForm, setSocialForm] = useState<Partial<SocialLink>>(emptySocialLink);
  const [socialToDelete, setSocialToDelete] = useState<SocialLink | null>(null);

  // Payment accounts
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PaymentAccount | null>(null);
  const [accountForm, setAccountForm] = useState<Partial<PaymentAccount>>(emptyPaymentAccount);

  useEffect(() => {
    if (settings) {
      setForm(settings);
      setPresetsInput(
        settings.serviceChargePresets ? JSON.parse(settings.serviceChargePresets).join(', ') : ''
      );
    }
  }, [settings]);

  useEffect(() => {
    if (!canEditSettings) return;
    api.listSocialLinks().then(setSocialLinks).catch((e) => toast(e.message, 'error'));
    api.listPaymentAccounts().then(setPaymentAccounts).catch((e) => toast(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEditSettings]);

  if (!form) return <PageLoader />;

  const handleLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, 300, 0.85);
      setForm((f) => (f ? { ...f, logoPath: dataUrl } : f));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to process logo.', 'error');
    }
  };

  const saveSettings = async () => {
    if (form.taxPercentage < 0) return toast('Tax cannot be negative.', 'error');

    let serviceChargePresets: string | null = null;
    if (presetsInput.trim()) {
      const nums = presetsInput
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0);
      if (nums.length === 0) return toast('Service charge presets must be numbers.', 'error');
      serviceChargePresets = JSON.stringify(nums);
    }

    setSaving(true);
    try {
      await update({
        restaurantName: form.restaurantName,
        address: form.address,
        phone: form.phone,
        taxPercentage: form.taxPercentage,
        currencySymbol: form.currencySymbol,
        receiptFooter: form.receiptFooter,
        darkMode: form.darkMode,
        receiptPaperSize: form.receiptPaperSize,
        logoPath: form.logoPath,
        currencyCode: form.currencyCode,
        receiptShowLogo: form.receiptShowLogo,
        serviceChargePresets,
        googleReviewUrl: form.googleReviewUrl,
        googleReviewOnReceipt: form.googleReviewOnReceipt,
      });
      toast('Settings saved.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (!user) return;
    if (newPw.length < 6) return toast('New password must be at least 6 characters.', 'error');
    if (newPw !== confirmPw) return toast('Passwords do not match.', 'error');
    try {
      await api.changePassword(user.id, currentPw, newPw);
      const fresh = await api.currentUser(user.id);
      refreshUser(fresh);
      toast('Password changed.', 'success');
      setPwOpen(false);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to change password.', 'error');
    }
  };

  // --- Social links -----------------------------------------------------
  const openCreateSocial = () => {
    setEditingSocial(null);
    setSocialForm(emptySocialLink);
    setSocialModalOpen(true);
  };
  const openEditSocial = (link: SocialLink) => {
    setEditingSocial(link);
    setSocialForm(link);
    setSocialModalOpen(true);
  };
  const saveSocial = async () => {
    try {
      if (editingSocial) {
        const updated = await api.updateSocialLink(editingSocial.id, socialForm);
        setSocialLinks((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      } else {
        const created = await api.createSocialLink(socialForm);
        setSocialLinks((prev) => [...prev, created]);
      }
      setSocialModalOpen(false);
      toast('Social link saved.', 'success');
      refreshSettingsContext().catch(() => {});
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed.', 'error');
    }
  };
  const toggleSocial = async (link: SocialLink, field: 'isEnabled' | 'showOnReceipt') => {
    try {
      const updated = await api.updateSocialLink(link.id, { ...link, [field]: !link[field] });
      setSocialLinks((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      refreshSettingsContext().catch(() => {});
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed.', 'error');
    }
  };
  const confirmDeleteSocial = async () => {
    if (!socialToDelete) return;
    try {
      await api.deleteSocialLink(socialToDelete.id);
      setSocialLinks((prev) => prev.filter((l) => l.id !== socialToDelete.id));
      setSocialToDelete(null);
      toast('Social link removed.', 'success');
      refreshSettingsContext().catch(() => {});
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed.', 'error');
    }
  };

  // --- Payment accounts ---------------------------------------------------
  const openCreateAccount = () => {
    setEditingAccount(null);
    setAccountForm(emptyPaymentAccount);
    setAccountModalOpen(true);
  };
  const openEditAccount = (account: PaymentAccount) => {
    setEditingAccount(account);
    setAccountForm(account);
    setAccountModalOpen(true);
  };
  const saveAccount = async () => {
    if (!accountForm.displayName?.trim()) return toast('Display name is required.', 'error');
    try {
      if (editingAccount) {
        const updated = await api.updatePaymentAccount(editingAccount.id, accountForm);
        setPaymentAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      } else {
        const created = await api.createPaymentAccount(accountForm);
        setPaymentAccounts((prev) => [...prev, created]);
      }
      setAccountModalOpen(false);
      toast('Payment account saved.', 'success');
      refreshSettingsContext().catch(() => {});
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed.', 'error');
    }
  };
  const toggleAccount = async (account: PaymentAccount, field: 'isActive' | 'printOnReceipt') => {
    try {
      if (field === 'isActive') {
        const updated = await api.setPaymentAccountActive(account.id, !account.isActive);
        setPaymentAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      } else {
        const updated = await api.updatePaymentAccount(account.id, { ...account, printOnReceipt: !account.printOnReceipt });
        setPaymentAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      }
      refreshSettingsContext().catch(() => {});
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed.', 'error');
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        subtitle="Configure your restaurant"
        action={canEditSettings ? (
          <Button onClick={saveSettings} disabled={saving}>
            <Save size={18} /> {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        ) : undefined}
      />

      <div className="space-y-6">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Restaurant Details
          </h2>
          <div className="space-y-4">
            <Input
              label="Restaurant Name"
              value={form.restaurantName}
              disabled={!canEditSettings}
              onChange={(e) => setForm({ ...form, restaurantName: e.target.value })}
            />
            <Input
              label="Address"
              value={form.address}
              disabled={!canEditSettings}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <Input
              label="Phone Number"
              value={form.phone}
              disabled={!canEditSettings}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Logo (optional — used on receipts and reports)
              </span>
              <div className="flex items-center gap-3">
                {form.logoPath && (
                  <img src={form.logoPath} alt="" className="h-14 w-14 rounded-lg object-contain" />
                )}
                {canEditSettings && (
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleLogo(e.target.files?.[0])}
                    className="text-sm text-slate-500"
                  />
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Billing &amp; Receipt
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Tax Percentage (%)"
                type="number"
                min={0}
                step="0.1"
                value={form.taxPercentage}
                disabled={!canEditSettings}
                onChange={(e) =>
                  setForm({ ...form, taxPercentage: parseFloat(e.target.value) || 0 })
                }
              />
              <Input
                label="Currency Symbol"
                value={form.currencySymbol}
                disabled={!canEditSettings}
                onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Receipt Paper Size
              </label>
              <select
                value={form.receiptPaperSize}
                disabled={!canEditSettings}
                onChange={(e) => setForm({ ...form, receiptPaperSize: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              >
                <option value="80mm">80mm Thermal Printer</option>
                <option value="A4">A4 (Standard Printer)</option>
              </select>
            </div>
            <Textarea
              label="Receipt Footer"
              rows={2}
              value={form.receiptFooter}
              disabled={!canEditSettings}
              onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
            />
            <Input
              label="Service Charge Quick-Pick Presets (PKR, comma-separated, optional)"
              value={presetsInput}
              disabled={!canEditSettings}
              placeholder="e.g. 50, 100, 150"
              onChange={(e) => setPresetsInput(e.target.value)}
            />
            <label className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-800 dark:text-slate-200">Show Logo on Receipt</p>
              </div>
              <input
                type="checkbox"
                checked={form.receiptShowLogo}
                disabled={!canEditSettings}
                onChange={(e) => setForm({ ...form, receiptShowLogo: e.target.checked })}
                className="h-5 w-5 rounded border-slate-300"
              />
            </label>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Google Review QR
          </h2>
          <div className="space-y-4">
            <Input
              label="Google Review URL (optional)"
              value={form.googleReviewUrl ?? ''}
              disabled={!canEditSettings}
              placeholder="https://g.page/r/..."
              onChange={(e) => setForm({ ...form, googleReviewUrl: e.target.value })}
            />
            <label className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-800 dark:text-slate-200">Print QR on Receipt</p>
                <p className="text-sm text-slate-500">Generated locally — no external service required.</p>
              </div>
              <input
                type="checkbox"
                checked={form.googleReviewOnReceipt}
                disabled={!canEditSettings || !form.googleReviewUrl}
                onChange={(e) => setForm({ ...form, googleReviewOnReceipt: e.target.checked })}
                className="h-5 w-5 rounded border-slate-300"
              />
            </label>
          </div>
        </Card>

        {canEditSettings && (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Social Media
              </h2>
              <Button size="sm" onClick={openCreateSocial}>
                <Plus size={16} /> Add
              </Button>
            </div>
            {socialLinks.length === 0 ? (
              <p className="text-sm text-slate-400">No social links configured.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {socialLinks.map((link) => (
                  <li key={link.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {link.displayName} <span className="text-xs text-slate-400">({link.platform})</span>
                      </p>
                      <p className="text-xs text-slate-400">{link.value}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleSocial(link, 'isEnabled')}
                        title="Enabled"
                      >
                        <Badge tone={link.isEnabled ? 'green' : 'red'}>
                          {link.isEnabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </button>
                      <button onClick={() => toggleSocial(link, 'showOnReceipt')} title="Show on receipt">
                        <Badge tone={link.showOnReceipt ? 'green' : 'red'}>
                          {link.showOnReceipt ? 'On Receipt' : 'Not on Receipt'}
                        </Badge>
                      </button>
                      <button
                        onClick={() => openEditSocial(link)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setSocialToDelete(link)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-700"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {canEditSettings && (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Payment Accounts
              </h2>
              <Button size="sm" onClick={openCreateAccount}>
                <Plus size={16} /> Add
              </Button>
            </div>
            <p className="mb-3 text-xs text-slate-400">
              "Active" = selectable when recording an actual payment. "On Receipt" = printed as a
              payment option/instruction. These are independent — an account can be one, both, or
              neither.
            </p>
            {paymentAccounts.length === 0 ? (
              <p className="text-sm text-slate-400">No payment accounts configured.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {paymentAccounts.map((account) => (
                  <li key={account.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {account.displayName} <span className="text-xs text-slate-400">({account.type})</span>
                      </p>
                      <p className="text-xs text-slate-400">
                        {account.type === 'BANK'
                          ? `${account.bankName ?? ''} ${account.accountNumber ?? ''}`.trim()
                          : account.phoneNumber ?? ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleAccount(account, 'isActive')} title="Active">
                        <Badge tone={account.isActive ? 'green' : 'red'}>
                          {account.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </button>
                      <button onClick={() => toggleAccount(account, 'printOnReceipt')} title="Print on receipt">
                        <Badge tone={account.printOnReceipt ? 'green' : 'red'}>
                          {account.printOnReceipt ? 'On Receipt' : 'Not on Receipt'}
                        </Badge>
                      </button>
                      <button
                        onClick={() => openEditAccount(account)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Appearance
          </h2>
          <label className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-200">Dark Mode</p>
              <p className="text-sm text-slate-500">Use a dark color theme.</p>
            </div>
            <input
              type="checkbox"
              checked={form.darkMode}
              disabled={!canEditSettings}
              onChange={(e) => setForm({ ...form, darkMode: e.target.checked })}
              className="h-5 w-5 rounded border-slate-300"
            />
          </label>
        </Card>

        {canEditSettings && <BackupSection />}

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Security</h2>
              <p className="text-sm text-slate-500">
                Signed in as <span className="font-medium">{user?.fullName}</span>
                {user?.role === 'ADMIN' && (
                  <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                    Admin
                  </span>
                )}
              </p>
            </div>
            <Button variant="secondary" onClick={() => setPwOpen(true)}>
              <KeyRound size={18} /> Change Password
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={pwOpen}
        title="Change Password"
        onClose={() => setPwOpen(false)}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPwOpen(false)}>
              Cancel
            </Button>
            <Button onClick={changePassword}>Update Password</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Current Password"
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
          />
          <Input
            label="New Password"
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <Input
            label="Confirm New Password"
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={socialModalOpen}
        title={editingSocial ? 'Edit Social Link' : 'Add Social Link'}
        onClose={() => setSocialModalOpen(false)}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSocialModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveSocial}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Platform"
            value={socialForm.platform}
            onChange={(e) => setSocialForm({ ...socialForm, platform: e.target.value as SocialPlatform })}
          >
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Input
            label="Display Name"
            value={socialForm.displayName ?? ''}
            onChange={(e) => setSocialForm({ ...socialForm, displayName: e.target.value })}
          />
          <Input
            label="URL / Phone / Handle"
            value={socialForm.value ?? ''}
            onChange={(e) => setSocialForm({ ...socialForm, value: e.target.value })}
          />
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={socialForm.isEnabled ?? true}
                onChange={(e) => setSocialForm({ ...socialForm, isEnabled: e.target.checked })}
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={socialForm.showOnReceipt ?? false}
                onChange={(e) => setSocialForm({ ...socialForm, showOnReceipt: e.target.checked })}
              />
              Show on Receipt
            </label>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!socialToDelete}
        title="Remove Social Link"
        message={`Remove "${socialToDelete?.displayName}"?`}
        onConfirm={confirmDeleteSocial}
        onCancel={() => setSocialToDelete(null)}
      />

      <Modal
        open={accountModalOpen}
        title={editingAccount ? 'Edit Payment Account' : 'Add Payment Account'}
        onClose={() => setAccountModalOpen(false)}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAccountModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveAccount}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Type"
            value={accountForm.type}
            onChange={(e) => setAccountForm({ ...accountForm, type: e.target.value as PaymentMethodType })}
          >
            {PAYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Input
            label="Display Name"
            value={accountForm.displayName ?? ''}
            onChange={(e) => setAccountForm({ ...accountForm, displayName: e.target.value })}
          />
          <Input
            label="Account Holder Name (optional)"
            value={accountForm.accountHolderName ?? ''}
            onChange={(e) => setAccountForm({ ...accountForm, accountHolderName: e.target.value })}
          />
          {accountForm.type === 'BANK' ? (
            <>
              <Input
                label="Bank Name"
                value={accountForm.bankName ?? ''}
                onChange={(e) => setAccountForm({ ...accountForm, bankName: e.target.value })}
              />
              <Input
                label="Account Number"
                value={accountForm.accountNumber ?? ''}
                onChange={(e) => setAccountForm({ ...accountForm, accountNumber: e.target.value })}
              />
              <Input
                label="IBAN (optional)"
                value={accountForm.iban ?? ''}
                onChange={(e) => setAccountForm({ ...accountForm, iban: e.target.value })}
              />
            </>
          ) : (
            <Input
              label="Phone / Account Number"
              value={accountForm.phoneNumber ?? ''}
              onChange={(e) => setAccountForm({ ...accountForm, phoneNumber: e.target.value })}
            />
          )}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={accountForm.isActive ?? true}
                onChange={(e) => setAccountForm({ ...accountForm, isActive: e.target.checked })}
              />
              Active (selectable for payment)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={accountForm.printOnReceipt ?? false}
                onChange={(e) => setAccountForm({ ...accountForm, printOnReceipt: e.target.checked })}
              />
              Print on Receipt
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
