'use client';

// Publishes the basket to the customer-facing screen.
//
// Mounted on the till only. Mounting it in the office would mean a
// manager opening the Sales screen quietly redrawing the shopper's
// display at the counter.

import { useEffect, useRef } from 'react';
import { usePos } from '@/lib/store';
import { cartTotals, effectiveUnitPrice } from '@/lib/types';
import { STORE } from '@/lib/data/seed';
import { publish, onHello, type DisplayState } from '@/lib/customer-display';

/** After a sale the cart empties immediately. Without this the
 *  shopper's "thank you, here is your change" screen would be wiped
 *  a few milliseconds after it appeared — exactly while they are
 *  reading the change figure. */
let holdPaidUntil = 0;
export const PAID_HOLD_MS = 25_000;
export function holdPaidScreen(): void {
  holdPaidUntil = Date.now() + PAID_HOLD_MS;
}
export function releasePaidScreen(): void {
  holdPaidUntil = 0;
}

export function CustomerDisplayBridge() {
  const cart = usePos((s) => s.cart);
  const latest = useRef<DisplayState | null>(null);

  useEffect(() => {
    const totals = cartTotals(cart);

    if (cart.length === 0 && Date.now() < holdPaidUntil) {
      // Still showing the thank-you screen. Leave it alone.
      return;
    }
    if (cart.length > 0) holdPaidUntil = 0; // next customer has started

    const state: DisplayState = {
      phase: cart.length === 0 ? 'idle' : 'selling',
      store_name: STORE.name,
      lines: cart.map((l) => ({
        name: `${l.name} ${l.variant}`.trim(),
        qty: l.qty,
        unit_price: effectiveUnitPrice(l),
        line_total: l.unit_price * l.qty - l.discount,
      })),
      subtotal: totals.subtotal,
      discount_total: totals.discount_total,
      tax_total: totals.tax_total,
      total: totals.total,
    };

    latest.current = state;
    publish(state);
  }, [cart]);

  // A display window opened after the till has nothing to show until
  // the next scan. It asks on startup; this answers.
  useEffect(() => onHello(() => latest.current ?? {
    phase: 'idle',
    store_name: STORE.name,
    lines: [],
    subtotal: 0,
    discount_total: 0,
    tax_total: 0,
    total: 0,
  }), []);

  return null;
}
