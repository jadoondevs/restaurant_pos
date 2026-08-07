import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { PageHeader, EmptyState, PageLoader, Badge } from '@/components/ui/Misc';
import type { Category } from '@/types';

export function Categories() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN';
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [toDelete, setToDelete] = useState<Category | null>(null);

  const load = () =>
    api.listCategories().then(setCategories).catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setEditing(null);
    setName('');
    setFormOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setName(c.name);
    setFormOpen(true);
  };

  const save = async () => {
    try {
      if (editing) {
        await api.updateCategory(editing.id, { name });
        toast('Category updated.', 'success');
      } else {
        await api.createCategory({ name });
        toast('Category created.', 'success');
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
      await api.deleteCategory(toDelete.id);
      toast('Category deleted.', 'success');
      setToDelete(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed.', 'error');
    }
  };

  if (!categories) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Organize your menu"
        action={canManage ? (
          <Button onClick={openCreate}>
            <Plus size={18} /> New Category
          </Button>
        ) : undefined}
      />

      <Card className="p-0">
        {categories.length === 0 ? (
          <EmptyState title="No categories" subtitle="Create one to start building your menu." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{c.name}</span>
                  <Badge>{c._count?.items ?? 0} items</Badge>
                </div>
                {canManage && <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(c)}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => setToDelete(c)}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-700"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage && <Modal
        open={formOpen}
        title={editing ? 'Edit Category' : 'New Category'}
        onClose={() => setFormOpen(false)}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!name.trim()}>
              Save
            </Button>
          </>
        }
      >
        <Input
          label="Category Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Burgers"
          autoFocus
        />
      </Modal>}

      {canManage && <ConfirmDialog
        open={!!toDelete}
        title="Delete Category"
        message={`Delete "${toDelete?.name}"? All items in this category will also be removed.`}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />}
    </div>
  );
}
