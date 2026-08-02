import { useEffect, useState } from 'react';
import { Search, Printer, Trash2, Eye } from 'lucide-react';
import { api } from '@/services/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrency, formatTime } from '@/utils/format';
import { buildReceiptHtml, orderToReceiptData } from '@/utils/receipt';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { PageHeader, EmptyState, PageLoader, Badge } from '@/components/ui/Misc';
import type { Order } from '@/types';

export function Orders() {
  const { settings } = useSettings();
  const { toast } = useToast();
  const sym = settings?.currencySymbol ?? '$';

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 250);
  const [selected, setSelected] = useState<Order | null>(null);
  const [toDelete, setToDelete] = useState<Order | null>(null);

  const load = () => {
    api
      .listOrders({ search: debounced })
      .then(setOrders)
      .catch((e) => toast(e.message, 'error'));
  };

  useEffect(load, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const reprint = async (order: Order) => {
    if (!settings) return;
    try {
      const full = await api.getOrder(order.id);
      const receiptData = orderToReceiptData(full);
      const html = buildReceiptHtml(receiptData, settings);
      const result = await api.printReceipt(html);
      if (result.status === 'printed') {
        toast('Receipt sent to printer.', 'success');
      } else if (result.status === 'cancelled') {
        toast('Print cancelled.', 'error');
      } else {
        toast(result.error ?? 'Print failed.', 'error');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Print failed.', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await api.deleteOrder(toDelete.id);
      toast('Order deleted.', 'success');
      setToDelete(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed.', 'error');
    }
  };

  if (!orders) return <PageLoader />;

  return (
    <div>
      <PageHeader title="Orders" subtitle="Today's orders" />

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
        <Input
          placeholder="Search by receipt #, customer, table..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <Card className="p-0">
        {orders.length === 0 ? (
          <EmptyState title="No orders yet" subtitle="Completed sales will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 font-medium">Receipt</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Items</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                      {o.receiptNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatTime(o.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Badge>{o.items.reduce((s, i) => s + i.quantity, 0)} items</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {o.customer?.name ?? 'Walk-in'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrency(o.grandTotal, sym)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconBtn title="View" onClick={() => setSelected(o)}>
                          <Eye size={16} />
                        </IconBtn>
                        <IconBtn title="Reprint" onClick={() => reprint(o)}>
                          <Printer size={16} />
                        </IconBtn>
                        <IconBtn title="Delete" danger onClick={() => setToDelete(o)}>
                          <Trash2 size={16} />
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

      {/* Order details */}
      <Modal
        open={!!selected}
        title={selected ? `Order ${selected.receiptNumber}` : ''}
        onClose={() => setSelected(null)}
        footer={
          selected && (
            <Button onClick={() => reprint(selected)}>
              <Printer size={16} /> Reprint Receipt
            </Button>
          )
        }
      >
        {selected && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">{formatTime(selected.createdAt)}</p>
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {selected.items.map((it) => (
                <li key={it.id} className="flex justify-between py-2 text-sm">
                  <span>
                    {it.quantity} × {it.name}
                    {it.specialInstructions && (
                      <span className="block text-xs italic text-amber-600">
                        {it.specialInstructions}
                      </span>
                    )}
                  </span>
                  <span className="font-medium">{formatCurrency(it.lineTotal, sym)}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
              <Line label="Subtotal" value={formatCurrency(selected.subtotal, sym)} />
              {selected.discount > 0 && (
                <Line label="Discount" value={`-${formatCurrency(selected.discount, sym)}`} />
              )}
              <Line
                label={`Tax (${selected.taxRate}%)`}
                value={formatCurrency(selected.taxAmount, sym)}
              />
              <Line label="Total" value={formatCurrency(selected.grandTotal, sym)} bold />
              <Line label="Cash" value={formatCurrency(selected.cashReceived, sym)} />
              <Line label="Change" value={formatCurrency(selected.change, sym)} />
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete Order"
        message={`Delete order ${toDelete?.receiptNumber}? This cannot be undone.`}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

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

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span className={bold ? '' : 'text-slate-500'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
