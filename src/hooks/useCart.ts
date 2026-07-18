import { useState, useMemo, useCallback } from 'react';
import type { CartItem, MenuItem } from '@/types';

export interface CartTotals {
  subtotal: number;
  discount: number;
  taxAmount: number;
  grandTotal: number;
}

/**
 * Encapsulates all POS cart logic: add/remove items, quantity changes,
 * special instructions, and live total calculation. Prevents invalid states
 * such as negative quantities.
 */
export function useCart(taxPercentage: number) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);

  const addItem = useCallback((menuItem: MenuItem) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.menuItemId === menuItem.id);
      if (existing) {
        return prev.map((i) =>
          i.menuItemId === menuItem.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        { menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: 1 },
      ];
    });
  }, []);

  const increment = useCallback((menuItemId: number) => {
    setItems((prev) =>
      prev.map((i) => (i.menuItemId === menuItemId ? { ...i, quantity: i.quantity + 1 } : i))
    );
  }, []);

  // Decrement never drops below 1 (removal is a separate explicit action).
  const decrement = useCallback((menuItemId: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.menuItemId === menuItemId ? { ...i, quantity: Math.max(1, i.quantity - 1) } : i
      )
    );
  }, []);

  const removeItem = useCallback((menuItemId: number) => {
    setItems((prev) => prev.filter((i) => i.menuItemId !== menuItemId));
  }, []);

  const setInstructions = useCallback((menuItemId: number, text: string) => {
    setItems((prev) =>
      prev.map((i) => (i.menuItemId === menuItemId ? { ...i, specialInstructions: text } : i))
    );
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setDiscount(0);
  }, []);

  const totals: CartTotals = useMemo(() => {
    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const safeDiscount = Math.min(Math.max(0, discount), subtotal);
    const taxable = subtotal - safeDiscount;
    const taxAmount = +(taxable * (taxPercentage / 100)).toFixed(2);
    const grandTotal = +(taxable + taxAmount).toFixed(2);
    return {
      subtotal: +subtotal.toFixed(2),
      discount: +safeDiscount.toFixed(2),
      taxAmount,
      grandTotal,
    };
  }, [items, discount, taxPercentage]);

  return {
    items,
    discount,
    setDiscount,
    addItem,
    increment,
    decrement,
    removeItem,
    setInstructions,
    clear,
    totals,
    isEmpty: items.length === 0,
  };
}
