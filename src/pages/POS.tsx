import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Minus, Trash2, MessageSquarePlus } from 'lucide-react';
import { api } from '@/services/api';
import { useCart } from '@/hooks/useCart';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/utils/format';
import { buildReceiptHtml } from '@/utils/receipt';
import { calculateServiceCharge, calculateTotalDue } from '@/utils/billing';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, Spinner } from '@/components/ui/Misc';
import type {
  Category,
  MenuItem,
  Customer,
  ReceiptData,
  OrderType,
  ConsumptionPerson,
  ServiceChargeType,
} from '@/types';

type CheckoutIssue =
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: string };

export function POS() {
  const { settings } = useSettings();
  const { toast } = useToast();
  const { user } = useAuth();
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

  // Order classification — normal sale vs. owner/employee consumption.
  const [orderType, setOrderType] = useState<OrderType>('SALE');
  const [consumptionPersons, setConsumptionPersons] = useState<ConsumptionPerson[]>([]);
  const [consumptionPersonId, setConsumptionPersonId] = useState<number | null>(null);
  const [consumptionNotes, setConsumptionNotes] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [addingPerson, setAddingPerson] = useState(false);

  // Service charge — optional, entered at checkout.
  const [serviceChargeType, setServiceChargeType] = useState<ServiceChargeType>('NONE');
  const [serviceChargeValue, setServiceChargeValue] = useState('');

  // Print-first checkout state.
  const [checkoutIssue, setCheckoutIssue] = useState<CheckoutIssue | null>(null);
  // Holds the draft receipt while waiting for user decision after cancel/fail.
  const [pendingReceipt, setPendingReceipt] = useState<ReceiptData | null>(null);

  // Load categories + customers + consumption persons once.
  useEffect(() => {
    Promise.all([api.listCategories(), api.listCustomers(), api.listConsumptionPersons()])
      .then(([cats, custs, persons]) => {
        setCategories(cats);
        setCustomers(custs);
        setConsumptionPersons(persons);
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

  // Service charge amount and the resulting total due — mirrors the exact
  // calculation orders:create performs server-side (electron/utils/billing.ts)
  // so the total shown here matches what actually gets persisted.
  const serviceChargeAmount = useMemo(
    () =>
      calculateServiceCharge(serviceChargeType, parseFloat(serviceChargeValue) || 0, cart.totals.grandTotal),
    [serviceChargeType, serviceChargeValue, cart.totals.grandTotal]
  );
  const totalDue = useMemo(
    () => calculateTotalDue(cart.totals.grandTotal, serviceChargeAmount),
    [cart.totals.grandTotal, serviceChargeAmount]
  );

  const change = useMemo(() => {
    const cash = parseFloat(cashReceived) || 0;
    return Math.max(0, cash - totalDue);
  }, [cashReceived, totalDue]);

  // Keep "Cash Received" in sync with the total whenever the service charge
  // changes, the same way it's set when the payment modal first opens — the
  // cashier can still overtype it afterward. Deliberately depends only on
  // the service charge inputs, not totalDue/payOpen themselves, so this
  // doesn't fight the cashier's own edits to Cash Received on every render.
  useEffect(() => {
    if (payOpen) setCashReceived(totalDue.toFixed(2));
  }, [serviceChargeType, serviceChargeValue]);

  const filteredConsumptionPersons = useMemo(
    () =>
      consumptionPersons.filter(
        (p) => p.type === (orderType === 'OWNER_CONSUMPTION' ? 'OWNER' : 'EMPLOYEE')
      ),
    [consumptionPersons, orderType]
  );

  const resetConsumptionState = () => {
    setOrderType('SALE');
    setConsumptionPersonId(null);
    setConsumptionNotes('');
    setNewPersonName('');
    setAddingPerson(false);
  };

  const handleAddPerson = async () => {
    const name = newPersonName.trim();
    if (!name) return;
    try {
      const person = await api.createConsumptionPerson({
        name,
        type: orderType === 'OWNER_CONSUMPTION' ? 'OWNER' : 'EMPLOYEE',
      });
      setConsumptionPersons((prev) => [...prev, person]);
      setConsumptionPersonId(person.id);
      setNewPersonName('');
      setAddingPerson(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to add person.', 'error');
    }
  };

  const openInstructions = (menuItemId: number, current?: string) => {
    setInstructionFor(menuItemId);
    setInstructionText(current ?? '');
  };

  const saveInstructions = () => {
    if (instructionFor != null) cart.setInstructions(instructionFor, instructionText.trim());
    setInstructionFor(null);
    setInstructionText('');
  };

  // ---------------------------------------------------------------------------
  // Saves the order to the database and clears the cart.
  // ---------------------------------------------------------------------------
  const commitSale = async (receiptData: ReceiptData) => {
    const order = await api.createOrder({
      items: receiptData.items.map((i) => ({
        menuItemId: cart.items.find((c) => c.name === i.name)?.menuItemId ?? null,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        specialInstructions: i.specialInstructions,
      })),
      discount: receiptData.discount,
      taxRate: receiptData.taxRate,
      cashReceived: receiptData.cashReceived,
      tableNumber: receiptData.tableNumber,
      customerId,
      cashierName: receiptData.cashierName,
      serviceChargeType,
      serviceChargeValue: parseFloat(serviceChargeValue) || 0,
      orderType,
      consumptionPersonId: orderType === 'SALE' ? null : consumptionPersonId,
      consumptionNotes: orderType === 'SALE' ? null : consumptionNotes.trim() || null,
    });
    toast(`Sale complete — ${order.receiptNumber}`, 'success');
    cart.clear();
    setCashReceived('');
    setTableNumber('');
    setCustomerId(null);
    setServiceChargeType('NONE');
    setServiceChargeValue('');
    resetConsumptionState();
    setPayOpen(false);
    setCheckoutIssue(null);
    setPendingReceipt(null);
  };

  // ---------------------------------------------------------------------------
  // Main checkout handler: print first, then decide.
  // ---------------------------------------------------------------------------
  const completeSale = async () => {
    if (cart.isEmpty) {
      toast('Cannot complete an empty order.', 'error');
      return;
    }
    if (!settings) return;
    if (orderType !== 'SALE' && !consumptionPersonId) {
      toast('Select the owner or employee for this order.', 'error');
      return;
    }

    setSaving(true);
    try {
      // 1. Peek the next receipt number (no DB write yet).
      const receiptNumber = await api.peekReceiptNumber();

      // 2. Build the draft receipt.
      // cashierName comes from the authenticated user's fullName.
      // This is the only place cashierName is set — never from arbitrary input.
      // Measured against totalDue (grandTotal + serviceChargeAmount), same
      // as orders:create, so cashReceived/change stay correct once a
      // service charge is present.
      const cashAmt = parseFloat(cashReceived) || totalDue;
      const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

      const receiptData: ReceiptData = {
        receiptNumber,
        createdAt: new Date().toISOString(),
        tableNumber: tableNumber || null,
        cashierName: user?.fullName ?? null,
        customer: selectedCustomer,
        items: cart.items.map((i) => ({
          name: i.name,
          price: i.price,
          quantity: i.quantity,
          specialInstructions: i.specialInstructions ?? null,
          lineTotal: +(i.price * i.quantity).toFixed(2),
        })),
        subtotal: cart.totals.subtotal,
        discount: cart.totals.discount,
        taxRate: taxPct,
        taxAmount: cart.totals.taxAmount,
        grandTotal: cart.totals.grandTotal,
        cashReceived: cashAmt,
        change: Math.max(0, cashAmt - totalDue),
      };

      // 3. Print the receipt.
      const html = buildReceiptHtml(receiptData, settings);
      const printResult = await api.printReceipt(html);

      if (printResult.status === 'printed') {
        await commitSale(receiptData);
      } else if (printResult.status === 'cancelled') {
        setPendingReceipt(receiptData);
        setCheckoutIssue({ kind: 'cancelled' });
      } else {
        setPendingReceipt(receiptData);
        setCheckoutIssue({ kind: 'failed', error: printResult.error ?? 'Unknown print error.' });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to complete sale.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const retryPrint = async () => {
    if (!pendingReceipt || !settings) return;
    setSaving(true);
    try {
      const html = buildReceiptHtml(pendingReceipt, settings);
      const printResult = await api.printReceipt(html);
      if (printResult.status === 'printed') {
        await commitSale(pendingReceipt);
      } else if (printResult.status === 'cancelled') {
        setCheckoutIssue({ kind: 'cancelled' });
      } else {
        setCheckoutIssue({ kind: 'failed', error: printResult.error ?? 'Unknown print error.' });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Retry failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const completeWithoutPrinting = async () => {
    if (!pendingReceipt) return;
    setSaving(true);
    try {
      await commitSale(pendingReceipt);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to complete sale.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelSale = () => {
    setCheckoutIssue(null);
    setPendingReceipt(null);
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
              setCashReceived(totalDue.toFixed(2));
              setPayOpen(true);
            }}
          >
            Complete Sale
          </Button>
        </div>
      </div>

      {/* Payment modal */}
      <Modal
        open={payOpen && checkoutIssue === null}
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

          {/* Order type — normal sale vs. owner/employee consumption */}
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Order Type
            </span>
            <div className="inline-flex w-full rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
              {(
                [
                  ['SALE', 'Customer Sale'],
                  ['OWNER_CONSUMPTION', 'Owner'],
                  ['EMPLOYEE_CONSUMPTION', 'Employee'],
                ] as [OrderType, string][]
              ).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setOrderType(type);
                    setConsumptionPersonId(null);
                    setAddingPerson(false);
                  }}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    orderType === type
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {orderType !== 'SALE' && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/10">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {orderType === 'OWNER_CONSUMPTION' ? 'Owner' : 'Employee'}
                </span>
                {addingPerson ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={newPersonName}
                      onChange={(e) => setNewPersonName(e.target.value)}
                      placeholder="Name"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                    />
                    <Button size="sm" onClick={handleAddPerson}>
                      Add
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setAddingPerson(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={consumptionPersonId ?? ''}
                      onChange={(e) =>
                        setConsumptionPersonId(e.target.value ? Number(e.target.value) : null)
                      }
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                    >
                      <option value="">Select...</option>
                      {filteredConsumptionPersons.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="secondary" onClick={() => setAddingPerson(true)}>
                      + New
                    </Button>
                  </div>
                )}
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Notes (optional)
                </span>
                <textarea
                  value={consumptionNotes}
                  onChange={(e) => setConsumptionNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. staff meal, family visit"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
            </div>
          )}

          <div className="space-y-2 rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
            <Row label="Food Total" value={formatCurrency(cart.totals.grandTotal, sym)} />

            <div className="flex items-center gap-2">
              <select
                value={serviceChargeType}
                onChange={(e) => setServiceChargeType(e.target.value as ServiceChargeType)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
              >
                <option value="NONE">No Service Charge</option>
                <option value="FIXED">Service Charge (PKR)</option>
                <option value="PERCENTAGE">Service Charge (%)</option>
              </select>
              {serviceChargeType !== 'NONE' && (
                <input
                  type="number"
                  min={0}
                  value={serviceChargeValue}
                  onChange={(e) => setServiceChargeValue(e.target.value)}
                  placeholder={serviceChargeType === 'PERCENTAGE' ? '%' : sym}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              )}
              {serviceChargeAmount > 0 && (
                <span className="text-sm text-slate-500">
                  = {formatCurrency(serviceChargeAmount, sym)}
                </span>
              )}
            </div>

            <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
              <Row label="Total Due" value={formatCurrency(totalDue, sym)} bold />
            </div>
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

      {/* Print cancelled dialog */}
      <Modal
        open={checkoutIssue?.kind === 'cancelled'}
        title="Printing Cancelled"
        onClose={cancelSale}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={cancelSale}>
              Cancel Sale
            </Button>
            <Button variant="success" onClick={completeWithoutPrinting} disabled={saving}>
              {saving ? <Spinner className="h-5 w-5" /> : 'Complete Sale'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Printing was cancelled. Do you still want to complete this sale?
        </p>
      </Modal>

      {/* Print failed dialog */}
      <Modal
        open={checkoutIssue?.kind === 'failed'}
        title="Printing Failed"
        onClose={cancelSale}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={cancelSale}>
              Cancel Sale
            </Button>
            <Button variant="secondary" onClick={completeWithoutPrinting} disabled={saving}>
              Complete Without Printing
            </Button>
            <Button variant="primary" onClick={retryPrint} disabled={saving}>
              {saving ? <Spinner className="h-5 w-5" /> : 'Retry Print'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {checkoutIssue?.kind === 'failed' ? checkoutIssue.error : ''}
        </p>
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
