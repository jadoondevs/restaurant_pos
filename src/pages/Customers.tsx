import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { api } from '@/services/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { PageHeader, EmptyState, PageLoader } from '@/components/ui/Misc';
import type { Customer } from '@/types';

interface FormState {
  name: string;
  phone: string;
  notes: string;
}
const emptyForm: FormState = { name: '', phone: '', notes: '' };

export function Customers() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canDelete = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 250);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [toDelete, setToDelete] = useState<Customer | null>(null);

  const load = () =>
    api.listCustomers(debounced).then(setCustomers).catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    load();
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({ name: c.name, phone: c.phone ?? '', notes: c.notes ?? '' });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast('Name is required.', 'error');
    try {
      if (editing) {
        await api.updateCustomer(editing.id, form);
        toast('Customer updated.', 'success');
      } else {
        await api.createCustomer(form);
        toast('Customer created.', 'success');
      }
      setFormOpen(false);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed.', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await api.deleteCustomer(toDelete.id);
      toast('Customer deleted.', 'success');
      setToDelete(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed.', 'error');
    }
  };

  if (!customers) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Your customer database"
        action={
          <Button onClick={openCreate}>
            <Plus size={18} /> New Customer
          </Button>
        }
      />

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
        <Input
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <Card className="p-0">
        {customers.length === 0 ? (
          <EmptyState title="No customers" subtitle="Add customers to attach them to orders." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {customers.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{c.name}</p>
                  <p className="text-sm text-slate-500">
                    {c.phone || 'No phone'}
                    {c.notes ? ` • ${c.notes}` : ''}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(c)}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <Pencil size={16} />
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => setToDelete(c)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-700"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={formOpen}
        title={editing ? 'Edit Customer' : 'New Customer'}
        onClose={() => setFormOpen(false)}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
          <Input
            label="Phone (optional)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <Textarea
            label="Notes (optional)"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete Customer"
        message={`Delete "${toDelete?.name}"?`}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
