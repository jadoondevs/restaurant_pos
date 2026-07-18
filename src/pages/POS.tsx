import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Minus, Trash2, MessageSquarePlus } from 'lucide-react';
import { api } from '@/services/api';
import { useCart } from '@/hooks/useCart';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrency } from '@/utils/format';
import { buildReceiptHtml } from '@/utils/receipt';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, Spinner } from '@/components/ui/Misc';
import type { Category, MenuItem, Customer, Order } from '@/types';

export function POS() {
  const { settings } = useSettings();
  const { toast } = useToast();
  const sym = settings?.currencySymbol ?? '$';
  const taxPct = settings?.taxPercentage ?? 0;

  const cart = useCart(taxPct);

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const debouncedSearch = useDebounce(search, 200);

  const [tableNumber, setTableNumber] = useState('');
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [cashReceived, setCashReceived] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [instructionFor, setInstructionFor] = useState<number | null>(null);
  const [instructionText, setInstructionText] = useState('');

  // Load categories + customers once.
  useEffect(() => {
    Promise.all([api.listCategories(), api.listCustomers()])
      .then(([cats, custs]) => {
        setCategories(cats);
        setCustomers(custs);
      })
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  // Load menu items when category or search changes.
  useEffect(() => {
    setLoading(true);
    api
      .listMenu({ categoryId: activeCat, search: debouncedSearch, availableOnly: true })
      .then(setItems)
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [activeCat, debouncedSearch, toast]);

  const change = useMemo(() => {
    const cash = parseFloat(cashReceived) || 0;
    return Math.max(0, cash - cart.totals.grandTotal);
  }, [cashReceived, cart.totals.grandTotal]);

  const openInstructions = (menuItemId: number, current?: string) => {
    setInstructionFor(menuItemId);
    setInstructionText(current ?? '');
  };

  const saveInstructions = () => {
    if (instructionFor != null) cart.setInstructions(instructionFor, instructionText.trim());
    setInstructionFor(null);
    setInstructionText('');
  };

  const completeSale = async () => {
    if (cart.isEmpty) {
      toast('Cannot complete an empty order.', 'error');
      return;
    }
    setSaving(true);
    try {
      const order: Order = await api.createOrder({
        items: cart.items,
        discount: cart.totals.discount,
        taxRate: taxPct,
        cashReceived: parseFloat(cashReceived) || cart.totals.grandTotal,
        tableNumber: tableNumber || null,
        customerId,
      });

      // Print the receipt.
      if (settings) {
        await api.printReceipt(buildReceiptHtml({ ...order, customer: order.customer }, settings));
      }

      toast(`Sale complete — ${order.receiptNumber}`, 'success');
      cart.clear();
      setCashReceived('');
      setTableNumber('');
      setCustomerId(null);
      setPayOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to complete sale.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-6.5rem)] gap-4">
      {/* Category rail */}
      <div className="w-40 shrink-0 space-y-1 overflow-y-auto">
        <button
          onClick={() => setActiveCat(null)}
          className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
            activeCat === null
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
          }`}
        >
          All Items
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
              activeCat === c.id
                ? 'bg-brand-600 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Item grid */}
      <div className="flex flex-1 flex-col">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
          <Input
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12 text-slate-400">
              <Spinner className="h-7 w-7" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="No items found" subtitle="Try a different category or search." />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => cart.addItem(item)}
                  className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
                >
                  <span className="line-clamp-2 font-medium text-slate-900 dark:text-slate-100">
                    {item.name}
                  </span>
                  <span className="mt-2 text-lg font-bold text-brand-600 dark:text-brand-400">
                    {formatCurrency(item.price, sym)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cart panel */}
      <div className="flex w-80 shrink-0 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Current Order</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {cart.isEmpty ? (
            <EmptyState title="Cart is empty" subtitle="Tap items to add them." />
          ) : (
            <ul className="space-y-2">
              {cart.items.map((item) => (
                <li
                  key={item.menuItemId}
                  className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {item.name}
                      </p>
                      <p className="text-xs text-slate-500">{formatCurrency(item.price, sym)}</p>
                      {item.specialInstructions && (
                        <p className="mt-1 text-xs italic text-amber-600 dark:text-amber-400">
                          {item.specialInstructions}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => cart.removeItem(item.menuItemId)}
                      className="text-slate-400 hover:text-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => cart.decrement(item.menuItemId)}
                        className="rounded-md bg-slate-100 p-1 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => cart.increment(item.menuItemId)}
                        className="rounded-md bg-slate-100 p-1 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        onClick={() => openInstructions(item.menuItemId, item.specialInstructions)}
                        className="ml-1 rounded-md p-1 text-slate-400 hover:text-brand-500"
                        title="Special instructions"
                      >
                        <MessageSquarePlus size={16} />
                      </button>
                    </div>
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrency(item.price * item.quantity, sym)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Totals */}
        <div className="space-y-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Discount</span>
            <input
              type="number"
              min={0}
              value={cart.discount || ''}
              onChange={(e) => cart.setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
              placeholder="0.00"
              className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <Row label="Subtotal" value={formatCurrency(cart.totals.subtotal, sym)} />
          <Row label={`Tax (${taxPct}%)`} value={formatCurrency(cart.totals.taxAmount, sym)} />
          <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-base font-bold dark:border-slate-700">
            <span>Total</span>
            <span className="text-brand-600 dark:text-brand-400">
              {formatCurrency(cart.totals.grandTotal, sym)}
            </span>
          </div>
          <Button
            size="lg"
            variant="success"
            className="w-full"
            disabled={cart.isEmpty}
            onClick={() => {
              setCashReceived(cart.totals.grandTotal.toFixed(2));
              setPayOpen(true);
            }}
          >
            Complete Sale
          </Button>
        </div>
      </div>

      {/* Payment modal */}
      <Modal
        open={payOpen}
        title="Payment"
        onClose={() => setPayOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button variant="success" onClick={completeSale} disabled={saving}>
              {saving ? <Spinner className="h-5 w-5" /> : 'Confirm & Print'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Table (optional)"
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              placeholder="e.g. 5"
            />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Customer (optional)
              </span>
              <select
                value={customerId ?? ''}
                onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              >
                <option value="">Walk-in</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
            <Row label="Total Due" value={formatCurrency(cart.totals.grandTotal, sym)} bold />
          </div>

          <Input
            label="Cash Received"
            type="number"
            min={0}
            value={cashReceived}
            onChange={(e) => setCashReceived(e.target.value)}
          />

          <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3 dark:bg-emerald-900/20">
            <span className="font-medium text-emerald-700 dark:text-emerald-300">Change</span>
            <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
              {formatCurrency(change, sym)}
            </span>
          </div>
        </div>
      </Modal>

      {/* Special instructions modal */}
      <Modal
        open={instructionFor != null}
        title="Special Instructions"
        onClose={() => setInstructionFor(null)}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setInstructionFor(null)}>
              Cancel
            </Button>
            <Button onClick={saveInstructions}>Save</Button>
          </>
        }
      >
        <textarea
          value={instructionText}
          onChange={(e) => setInstructionText(e.target.value)}
          rows={3}
          placeholder="e.g. No onions, extra spicy"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          autoFocus
        />
      </Modal>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-sm ${bold ? 'font-bold text-base' : ''}`}>
      <span className={bold ? '' : 'text-slate-500'}>{label}</span>
      <span className={bold ? '' : 'font-medium text-slate-900 dark:text-slate-100'}>{value}</span>
    </div>
  );
}
