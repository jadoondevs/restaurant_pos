import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, KeyRound, UserCheck, UserX } from 'lucide-react';
import { api } from '@/services/api';
import { useToast } from '@/contexts/ToastContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { PageHeader, PageLoader, Badge } from '@/components/ui/Misc';
import type { UserRecord, UserRole } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'CASHIER'];

function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    ADMIN:
      'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300',
    MANAGER:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    CASHIER:
      'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[role] ?? styles.CASHIER
      }`}
    >
      {role.charAt(0) + role.slice(1).toLowerCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form state types
// ---------------------------------------------------------------------------

interface CreateForm {
  username: string;
  fullName: string;
  role: UserRole;
  initialPassword: string;
  confirmPassword: string;
}

interface EditForm {
  fullName: string;
  role: UserRole;
}

interface ResetForm {
  newPassword: string;
  confirmPassword: string;
}

const emptyCreate: CreateForm = {
  username: '',
  fullName: '',
  role: 'CASHIER',
  initialPassword: '',
  confirmPassword: '',
};

const emptyReset: ResetForm = { newPassword: '', confirmPassword: '' };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Users() {
  const { toast } = useToast();

  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [saving, setSaving] = useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate);

  // Edit dialog
  const [editTarget, setEditTarget] = useState<UserRecord | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ fullName: '', role: 'CASHIER' });

  // Reset password dialog
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
  const [resetForm, setResetForm] = useState<ResetForm>(emptyReset);

  // Deactivate confirmation
  const [deactivateTarget, setDeactivateTarget] = useState<UserRecord | null>(null);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------
  const load = useCallback(() => {
    api
      .listUsers()
      .then(setUsers)
      .catch((e) => toast(e instanceof Error ? e.message : 'Failed to load users.', 'error'));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  const openCreate = () => {
    setCreateForm(emptyCreate);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (!createForm.username.trim()) return toast('Username is required.', 'error');
    if (!createForm.fullName.trim()) return toast('Full name is required.', 'error');
    if (createForm.initialPassword.length < 6)
      return toast('Password must be at least 6 characters.', 'error');
    if (createForm.initialPassword !== createForm.confirmPassword)
      return toast('Passwords do not match.', 'error');

    setSaving(true);
    try {
      await api.createUser({
        username: createForm.username.trim(),
        fullName: createForm.fullName.trim(),
        role: createForm.role,
        initialPassword: createForm.initialPassword,
      });
      toast('User created.', 'success');
      setCreateOpen(false);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to create user.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Edit
  // ---------------------------------------------------------------------------
  const openEdit = (user: UserRecord) => {
    setEditTarget(user);
    setEditForm({ fullName: user.fullName, role: user.role });
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    if (!editForm.fullName.trim()) return toast('Full name is required.', 'error');

    setSaving(true);
    try {
      await api.updateUser({
        id: editTarget.id,
        fullName: editForm.fullName.trim(),
        role: editForm.role,
      });
      toast('User updated.', 'success');
      setEditTarget(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update user.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Reset password
  // ---------------------------------------------------------------------------
  const openReset = (user: UserRecord) => {
    setResetTarget(user);
    setResetForm(emptyReset);
  };

  const submitReset = async () => {
    if (!resetTarget) return;
    if (resetForm.newPassword.length < 6)
      return toast('Password must be at least 6 characters.', 'error');
    if (resetForm.newPassword !== resetForm.confirmPassword)
      return toast('Passwords do not match.', 'error');

    setSaving(true);
    try {
      await api.resetUserPassword(resetTarget.id, resetForm.newPassword);
      toast(`Password reset for ${resetTarget.fullName}.`, 'success');
      setResetTarget(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to reset password.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Activate / Deactivate
  // ---------------------------------------------------------------------------
  const toggleActive = async (user: UserRecord) => {
    if (!user.isActive) {
      // Reactivation — no confirmation needed.
      try {
        await api.setUserActive(user.id, true);
        toast(`${user.fullName} reactivated.`, 'success');
        load();
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Failed to reactivate user.', 'error');
      }
    } else {
      // Deactivation — show confirmation first.
      setDeactivateTarget(user);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await api.setUserActive(deactivateTarget.id, false);
      toast(`${deactivateTarget.fullName} deactivated.`, 'success');
      setDeactivateTarget(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to deactivate user.', 'error');
      setDeactivateTarget(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (!users) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Manage staff accounts"
        action={
          <Button onClick={openCreate}>
            <Plus size={18} /> New User
          </Button>
        }
      />

      <Card className="p-0">
        {users.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            No users found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 font-medium">Full Name</th>
                  <th className="px-4 py-3 font-medium">Username</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Password</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                      {u.fullName}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {u.username}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? (
                        <Badge tone="green">Active</Badge>
                      ) : (
                        <Badge tone="red">Inactive</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.mustChangePassword && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          Must change
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconBtn title="Edit" onClick={() => openEdit(u)}>
                          <Pencil size={15} />
                        </IconBtn>
                        <IconBtn title="Reset Password" onClick={() => openReset(u)}>
                          <KeyRound size={15} />
                        </IconBtn>
                        <IconBtn
                          title={u.isActive ? 'Deactivate' : 'Reactivate'}
                          danger={u.isActive}
                          onClick={() => toggleActive(u)}
                        >
                          {u.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create User dialog */}
      <Modal
        open={createOpen}
        title="New User"
        onClose={() => setCreateOpen(false)}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={saving}>Create User</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Username"
            value={createForm.username}
            onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
            autoFocus
            placeholder="e.g. john.doe"
          />
          <p className="-mt-2 text-xs text-slate-400">
            Username cannot be changed after creation.
          </p>
          <Input
            label="Full Name"
            value={createForm.fullName}
            onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
            placeholder="e.g. John Doe"
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Role
            </label>
            <select
              value={createForm.role}
              onChange={(e) =>
                setCreateForm({ ...createForm, role: e.target.value as UserRole })
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0) + r.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Initial Password"
            type="password"
            value={createForm.initialPassword}
            onChange={(e) => setCreateForm({ ...createForm, initialPassword: e.target.value })}
          />
          <Input
            label="Confirm Password"
            type="password"
            value={createForm.confirmPassword}
            onChange={(e) => setCreateForm({ ...createForm, confirmPassword: e.target.value })}
          />
          <p className="text-xs text-slate-400">
            The user will be required to change their password on first login.
          </p>
        </div>
      </Modal>

      {/* Edit User dialog */}
      <Modal
        open={!!editTarget}
        title="Edit User"
        onClose={() => setEditTarget(null)}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={submitEdit} disabled={saving}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">
              Username
            </p>
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
              {editTarget?.username}
            </p>
            <p className="mt-1 text-xs text-slate-400">Username cannot be changed.</p>
          </div>
          <Input
            label="Full Name"
            value={editForm.fullName}
            onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
            autoFocus
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Role
            </label>
            <select
              value={editForm.role}
              onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0) + r.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* Reset Password dialog */}
      <Modal
        open={!!resetTarget}
        title={`Reset Password — ${resetTarget?.fullName ?? ''}`}
        onClose={() => setResetTarget(null)}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button onClick={submitReset} disabled={saving}>Reset Password</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="New Password"
            type="password"
            value={resetForm.newPassword}
            onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })}
            autoFocus
          />
          <Input
            label="Confirm New Password"
            type="password"
            value={resetForm.confirmPassword}
            onChange={(e) => setResetForm({ ...resetForm, confirmPassword: e.target.value })}
          />
          <p className="text-xs text-slate-400">
            The user will be required to change their password on next login.
          </p>
        </div>
      </Modal>

      {/* Deactivate confirmation */}
      <ConfirmDialog
        open={!!deactivateTarget}
        title="Deactivate User"
        message={`Deactivate ${deactivateTarget?.fullName}? They will no longer be able to log in.`}
        onConfirm={confirmDeactivate}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small icon button — matches the pattern used in Orders.tsx and Menu.tsx
// ---------------------------------------------------------------------------
function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 ${
        danger ? 'text-slate-400 hover:text-red-500' : 'text-slate-500'
      }`}
    >
      {children}
    </button>
  );
}
