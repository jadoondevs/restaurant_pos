import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Search, X, Upload } from 'lucide-react';
import { api } from '@/services/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrency } from '@/utils/format';
import { compressImage } from '@/utils/image';
import { parseCsvToObjects } from '@/utils/csv';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { PageHeader, EmptyState, PageLoader, Badge, Spinner } from '@/components/ui/Misc';
import type { Category, MenuItem, Partner, BulkImportRow, BulkImportResult } from '@/types';

interface OwnershipRow {
  partnerId: number | '';
  percentage: string;
}

interface ImportPreviewRow extends BulkImportRow {
  errors: string[];
}

/** Parses "Partner A:50,Partner B:50" into ownership pairs. Returns null on malformed input. */
function parseOwnershipSpec(spec: string): { partnerName: string; percentage: number }[] | null {
  if (!spec.trim()) return [];
  const pairs = spec.split(',').map((s) => s.trim()).filter(Boolean);
  const parsed: { partnerName: string; percentage: number }[] = [];
  for (const pair of pairs) {
    const [name, pct] = pair.split(':').map((s) => s.trim());
    const percentage = parseFloat(pct);
    if (!name || !Number.isFinite(percentage) || percentage <= 0) return null;
    parsed.push({ partnerName: name, percentage });
  }
  return parsed;
}

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
  const { user } = useAuth();
  const { toast } = useToast();
  const sym = settings?.currencySymbol ?? '$';
  const canManage = user?.role === 'ADMIN';

  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<number | ''>('');
  const debounced = useDebounce(search, 250);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [toDelete, setToDelete] = useState<MenuItem | null>(null);

  // Partner ownership — only meaningful once the item has an id (existing
  // item, or a brand-new one that was just created and stays open).
  const [partners, setPartners] = useState<Partner[]>([]);
  const [ownershipRows, setOwnershipRows] = useState<OwnershipRow[]>([]);
  const [savingOwnership, setSavingOwnership] = useState(false);
  const [newPartnerName, setNewPartnerName] = useState('');
  const [addingPartner, setAddingPartner] = useState(false);

  // Bulk import
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);

  const loadItems = () =>
    api
      .listMenu({ search: debounced, categoryId: filterCat || null })
      .then(setItems)
      .catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    Promise.all([api.listCategories(), api.listPartners(true)])
      .then(([cats, parts]) => {
        setCategories(cats);
        setPartners(parts);
      })
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  useEffect(() => {
    loadItems();
  }, [debounced, filterCat]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOwnership = (menuItemId: number) => {
    api
      .listPartnerOwnership(menuItemId)
      .then((rows) =>
        setOwnershipRows(rows.map((r) => ({ partnerId: r.partnerId, percentage: String(r.percentage) })))
      )
      .catch((e) => toast(e.message, 'error'));
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, categoryId: categories[0]?.id ?? '' });
    setOwnershipRows([]);
    setFormOpen(true);
  };

  const openEdit = (item: MenuItem) => {
    setEditing(item);
    loadOwnership(item.id);
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

  const handleImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      setForm((f) => ({ ...f, image: dataUrl }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to process image.', 'error');
    }
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
        setFormOpen(false);
      } else {
        const created = await api.createMenuItem(payload);
        toast('Item created — add partner ownership below if needed.', 'success');
        // Stay open, switched into edit mode, so ownership can be
        // configured immediately (it needs the item's id to exist first).
        setEditing(created);
      }
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

  // ---------------------------------------------------------------------------
  // Bulk import — CSV columns: name, category, price, description (optional),
  // partnerOwnership (optional, "Partner A:50,Partner B:50"). Header names
  // are matched case-insensitively; only structurally valid rows are sent
  // to the server, which re-validates and reports per-row results.
  // ---------------------------------------------------------------------------
  const openImport = () => {
    setImportRows([]);
    setImportResult(null);
    setImportOpen(true);
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const objects = parseCsvToObjects(text);
      if (objects.length === 0) {
        toast('The file has no data rows.', 'error');
        return;
      }

      const get = (row: Record<string, string>, key: string) =>
        Object.entries(row).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]?.trim() ?? '';

      const categoryNames = new Set(categories.map((c) => c.name.toLowerCase()));

      const rows: ImportPreviewRow[] = objects.map((row) => {
        const name = get(row, 'name');
        const categoryName = get(row, 'category');
        const priceStr = get(row, 'price');
        const description = get(row, 'description');
        const ownershipStr = get(row, 'partnerOwnership');

        const errors: string[] = [];
        if (!name) errors.push('Missing name');
        if (!categoryName) errors.push('Missing category');
        else if (!categoryNames.has(categoryName.toLowerCase())) errors.push(`Unknown category "${categoryName}"`);
        const price = parseFloat(priceStr);
        if (!priceStr || Number.isNaN(price) || price < 0) errors.push(`Invalid price "${priceStr}"`);

        const ownerships = ownershipStr ? parseOwnershipSpec(ownershipStr) : [];
        if (ownershipStr && ownerships === null) errors.push('Malformed partner ownership');

        return {
          name,
          categoryName,
          price: priceStr,
          description,
          ownerships: ownerships ?? [],
          errors,
        };
      });

      setImportRows(rows);
      setImportResult(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to read file.', 'error');
    }
  };

  const validImportRows = importRows.filter((r) => r.errors.length === 0);

  const confirmImport = async () => {
    if (validImportRows.length === 0) return;
    setImporting(true);
    try {
      const result = await api.bulkImportMenu(
        validImportRows.map((r) => ({
          name: r.name,
          categoryName: r.categoryName,
          price: parseFloat(String(r.price)),
          description: r.description,
          ownerships: r.ownerships,
        }))
      );
      setImportResult(result);
      setImportRows([]);
      loadItems();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed.', 'error');
    } finally {
      setImporting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Partner ownership — configures MenuItemPartner for the item being edited.
  // Only the LIVE configuration; it never touches past sales (see
  // OrderItemPartnerAllocation, snapshotted once at order time).
  // ---------------------------------------------------------------------------
  const ownershipTotal = ownershipRows.reduce((sum, r) => sum + (parseFloat(r.percentage) || 0), 0);

  const addOwnershipRow = () => {
    const used = new Set(ownershipRows.map((r) => r.partnerId));
    const next = partners.find((p) => !used.has(p.id));
    setOwnershipRows((prev) => [...prev, { partnerId: next?.id ?? '', percentage: '' }]);
  };

  const updateOwnershipRow = (index: number, field: keyof OwnershipRow, value: string) => {
    setOwnershipRows((prev) =>
      prev.map((row, i) =>
        i === index ? { ...row, [field]: field === 'partnerId' ? Number(value) : value } : row
      )
    );
  };

  const removeOwnershipRow = (index: number) => {
    setOwnershipRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddPartnerInline = async () => {
    const name = newPartnerName.trim();
    if (!name) return;
    try {
      const partner = await api.createPartner({ name });
      setPartners((prev) => [...prev, partner]);
      setOwnershipRows((prev) => [...prev, { partnerId: partner.id, percentage: '' }]);
      setNewPartnerName('');
      setAddingPartner(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to add partner.', 'error');
    }
  };

  const saveOwnership = async () => {
    if (!editing) return;
    const ownerships = ownershipRows
      .filter((r) => r.partnerId !== '')
      .map((r) => ({ partnerId: Number(r.partnerId), percentage: parseFloat(r.percentage) || 0 }));

    setSavingOwnership(true);
    try {
      const saved = await api.setPartnerOwnership(editing.id, ownerships);
      setOwnershipRows(saved.map((r) => ({ partnerId: r.partnerId, percentage: String(r.percentage) })));
      toast('Ownership saved.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to save ownership.', 'error');
    } finally {
      setSavingOwnership(false);
    }
  };

  if (!items) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Menu"
        subtitle="Manage your menu items"
        action={canManage ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={openImport}>
              <Upload size={18} /> Import CSV
            </Button>
            <Button onClick={openCreate} disabled={categories.length === 0}>
              <Plus size={18} /> New Item
            </Button>
          </div>
        ) : undefined}
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
                  {canManage && <th className="px-4 py-3 text-right font-medium">Actions</th>}
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
                    {canManage && <td className="px-4 py-3">
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
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage && <Modal
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

          {editing && (
            <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Partner Ownership (optional)
                </span>
                <span
                  className={`text-xs font-medium ${
                    ownershipRows.length > 0 && Math.abs(ownershipTotal - 100) > 0.5
                      ? 'text-red-500'
                      : 'text-slate-400'
                  }`}
                >
                  {ownershipRows.length > 0 ? `${ownershipTotal.toFixed(1)}% of 100%` : 'No partners'}
                </span>
              </div>

              {ownershipRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={row.partnerId}
                    onChange={(e) => updateOwnershipRow(i, 'partnerId', e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                  >
                    <option value="">Select partner...</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={row.percentage}
                    onChange={(e) => updateOwnershipRow(i, 'percentage', e.target.value)}
                    placeholder="%"
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                  <button
                    onClick={() => removeOwnershipRow(i)}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-700"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}

              {addingPartner ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={newPartnerName}
                    onChange={(e) => setNewPartnerName(e.target.value)}
                    placeholder="New partner name"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                  <Button size="sm" onClick={handleAddPartnerInline}>
                    Add
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setAddingPartner(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={addOwnershipRow} disabled={partners.length === 0}>
                    + Add Row
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setAddingPartner(true)}>
                    + New Partner
                  </Button>
                  <Button size="sm" onClick={saveOwnership} disabled={savingOwnership}>
                    Save Ownership
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>}

      {canManage && <ConfirmDialog
        open={!!toDelete}
        title="Delete Item"
        message={`Delete "${toDelete?.name}"?`}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />}

      {canManage && (
        <Modal
          open={importOpen}
          title="Bulk Import Menu Items"
          onClose={() => setImportOpen(false)}
          maxWidth="max-w-3xl"
          footer={
            <>
              <Button variant="secondary" onClick={() => setImportOpen(false)}>
                Close
              </Button>
              {importRows.length > 0 && (
                <Button onClick={confirmImport} disabled={importing || validImportRows.length === 0}>
                  {importing ? <Spinner className="h-5 w-5" /> : `Import ${validImportRows.length} Item(s)`}
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-4">
            {!importResult && (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  CSV columns: <code>name</code>, <code>category</code>, <code>price</code>,{' '}
                  <code>description</code> (optional), <code>partnerOwnership</code> (optional, e.g.{' '}
                  <code>Partner A:50,Partner B:50</code>). Category names must already exist.
                </p>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => handleImportFile(e.target.files?.[0])}
                  className="text-sm text-slate-500"
                />
              </>
            )}

            {importRows.length > 0 && (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {validImportRows.length} of {importRows.length} row(s) are valid and will be imported.
                </p>
                <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800">
                      <tr>
                        <th className="px-3 py-2 font-medium">Row</th>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Category</th>
                        <th className="px-3 py-2 font-medium">Price</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.map((r, i) => (
                        <tr
                          key={i}
                          className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                            r.errors.length ? 'bg-red-50 dark:bg-red-900/10' : ''
                          }`}
                        >
                          <td className="px-3 py-1.5 text-slate-400">{i + 2}</td>
                          <td className="px-3 py-1.5">{r.name || '—'}</td>
                          <td className="px-3 py-1.5">{r.categoryName || '—'}</td>
                          <td className="px-3 py-1.5">{r.price || '—'}</td>
                          <td className="px-3 py-1.5">
                            {r.errors.length ? (
                              <span className="text-xs text-red-600 dark:text-red-400">
                                {r.errors.join('; ')}
                              </span>
                            ) : (
                              <Badge tone="green">Ready</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {importResult && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  {importResult.created} item(s) created.
                </p>
                {importResult.skipped.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-red-600 dark:text-red-400">
                      {importResult.skipped.length} row(s) skipped:
                    </p>
                    <ul className="mt-1 max-h-32 overflow-auto text-xs text-slate-500">
                      {importResult.skipped.map((s, i) => (
                        <li key={i}>
                          Row {s.row} ({s.name || 'unnamed'}): {s.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {importResult.warnings.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Warnings:</p>
                    <ul className="mt-1 max-h-32 overflow-auto text-xs text-slate-500">
                      {importResult.warnings.map((w, i) => (
                        <li key={i}>
                          Row {w.row} ({w.name}): {w.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
