import { useEffect, useState } from 'react';
import { Save, KeyRound } from 'lucide-react';
import { api } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/contexts/ToastContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader, PageLoader } from '@/components/ui/Misc';
import { BackupSection } from '@/components/BackupSection';
import type { Settings as SettingsType } from '@/types';

export function Settings() {
  const { settings, update } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();

  const [form, setForm] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);

  // Password change modal state.
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  if (!form) return <PageLoader />;

  const saveSettings = async () => {
    if (form.taxPercentage < 0) return toast('Tax cannot be negative.', 'error');
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
      // Pass the authenticated user's id so the IPC handler knows which
      // User row to update. This replaces the old Admin-based approach.
      await api.changePassword(user.id, currentPw, newPw);
      toast('Password changed.', 'success');
      setPwOpen(false);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to change password.', 'error');
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        subtitle="Configure your restaurant"
        action={
          <Button onClick={saveSettings} disabled={saving}>
            <Save size={18} /> {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        }
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
              onChange={(e) => setForm({ ...form, restaurantName: e.target.value })}
            />
            <Input
              label="Address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <Input
              label="Phone Number"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
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
                onChange={(e) =>
                  setForm({ ...form, taxPercentage: parseFloat(e.target.value) || 0 })
                }
              />
              <Input
                label="Currency Symbol"
                value={form.currencySymbol}
                onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Receipt Paper Size
              </label>
              <select
                value={form.receiptPaperSize}
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
              onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
            />
          </div>
        </Card>

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
              onChange={(e) => setForm({ ...form, darkMode: e.target.checked })}
              className="h-5 w-5 rounded border-slate-300"
            />
          </label>
        </Card>

        <BackupSection />

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
    </div>
  );
}
