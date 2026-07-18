import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { api } from '@/services/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrency } from '@/utils/format';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { PageHeader, EmptyState, PageLoader, Badge } from '@/components/ui/Misc';
import type { Category, MenuItem } from '@/types';

interface FormState {
  name: string;
  categoryId: number | '';
  price: string;
  description: string;
  available: boolean;
  image: string | null;
}

const emptyForm: FormState = {
  name: '',
  categoryId: '',
  price: '',
  description: '',
  available: true,
  image: null,
};

export function Menu() {
  const { settings } = useSettings();
  const { toast } = useToast();
  const sym = settings?.currencySymbol ?? '$';

  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<number | ''>('');
  const debounced = useDebounce(search, 250);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [toDelete, setToDelete] = useState<MenuItem | null>(null);

  const loadItems = () =>
    api
      .listMenu({ search: debounced, categoryId: filterCat || null })
      .then(setItems)
      .catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    api.listCategories().then(setCategories).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  useEffect(() => {
    loadItems();
  }, [debounced, filterCat]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, categoryId: categories[0]?.id ?? '' });
    setFormOpen(true);
  };

  const openEdit = (item: MenuItem) => {
    setEditing(item);
    setForm({
      name: item.name,
      categoryId: item.categoryId,
      price: String(item.price),
      description: item.description ?? '',
      available: item.available,
      image: item.image,
    });
    setFormOpen(true);
  };

  const handleImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, image: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    const price = parseFloat(form.price);
    if (!form.name.trim()) return toast('Name is required.', 'error');
    if (!form.categoryId) return toast('Select a category.', 'error');
    if (Number.isNaN(price) || price < 0) return toast('Enter a valid price.', 'error');

    const payload = {
      name: form.name,
      categoryId: Number(form.categoryId),
      price,
      description: form.description,
      available: form.available,
      image: form.image,
    };

    try {
      if (editing) {
        await api.updateMenuItem(editing.id, payload);
        toast('Item updated.', 'success');
      } else {
        await api.createMenuItem(payload);
        toast('Item created.', 'success');
      }
      setFormOpen(false);
      loadItems();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed.', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await api.deleteMenuItem(toDelete.id);
      toast('Item deleted.', 'success');
      setToDelete(null);
      loadItems();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed.', 'error');
    }
  };

  if (!items) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Menu"
        subtitle="Manage your menu items"
        action={
          <Button onClick={openCreate} disabled={categories.length === 0}>
            <Plus size={18} /> New Item
          </Button>
        }
      />

      {categories.length === 0 && (
        <Card className="mb-4 border-amber-300 bg-amber-50 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Create a category first before adding menu items.
        </Card>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
          <Input
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="sm:w-56">
          <Select value={filterCat} onChange={(e) => setFilterCat(e.target.value ? Number(e.target.value) : '')}>
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card className="p-0">
        {items.length === 0 ? (
          <EmptyState title="No menu items" subtitle="Add your first item to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{item.name}</p>
                      {item.description && (
                        <p className="text-xs text-slate-400">{item.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {item.category?.name}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrency(item.price, sym)}
                    </td>
                    <td className="px-4 py-3">
                      {item.available ? (
                        <Badge tone="green">Available</Badge>
                      ) : (
                        <Badge tone="red">Unavailable</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(item)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => setToDelete(item)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-700"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={formOpen}
        title={editing ? 'Edit Item' : 'New Item'}
        onClose={() => setFormOpen(false)}
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
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Category"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: Number(e.target.value) })}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input
              label="Price"
              type="number"
              min={0}
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </div>
          <Textarea
            label="Description (optional)"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Image (optional)
            </span>
            <div className="flex items-center gap-3">
              {form.image && (
                <img src={form.image} alt="" className="h-14 w-14 rounded-lg object-cover" />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleImage(e.target.files?.[0])}
                className="text-sm text-slate-500"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.available}
              onChange={(e) => setForm({ ...form, available: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            Available for sale
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete Item"
        message={`Delete "${toDelete?.name}"?`}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
