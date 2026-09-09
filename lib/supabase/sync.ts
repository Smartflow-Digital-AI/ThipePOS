'use client';

import { supabase, isSupabaseConfigured } from './client';
import { usePos } from '@/lib/store';
import type { Delivery, Override, Refund, Sale, StockMovement } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════════
//  THE SYNC PUSHER
// ═══════════════════════════════════════════════════════════════════
//
//  Sales are written locally first and marked synced:false. This
//  drains that queue to Supabase whenever the network is up.
//
//  Two properties that matter:
//
//   1. IDEMPOTENT — a sale is pushed with its local id. If the same
//      sale is pushed twice (retry after a timeout that actually
//      succeeded), the database's unique constraint rejects the
//      duplicate rather than taking the money twice.
//
//   2. NON-BLOCKING — nothing in the selling path ever waits on this.
//      If Supabase is down the shop keeps trading.
// ═══════════════════════════════════════════════════════════════════

const STORE_ID = process.env.NEXT_PUBLIC_STORE_ID!;

export async function pushSale(sale: Sale): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;

  const { error } = await sb.rpc('complete_sale', {
    p_store_id: sale.store_id || STORE_ID,
    p_till_id: sale.till_id,
    p_till_session_id: sale.till_session_id || null,
    p_cashier_id: sale.cashier_id || null,
    p_customer_email: sale.customer_email || null,
    p_subtotal: sale.subtotal,
    p_discount_total: sale.discount_total,
    p_tax_total: sale.tax_total,
    p_total: sale.total,
    p_items: sale.lines.map((l) => ({
      product_id: l.product_id,
      name: l.name,
      sku: l.sku,
      unit_price: l.unit_price,
      qty: l.qty,
      discount: l.discount,
      line_total: l.unit_price * l.qty - l.discount,
    })),
    p_payments: sale.payments.map((p) => ({
      method: p.method,
      amount: p.amount,
      card_reference: p.card_reference ?? null,
      card_last4: p.card_last4 ?? null,
      card_brand: null,
    })),
  });

  if (error) {
    console.warn('[sync] sale failed, will retry:', sale.sale_number, error.message);
    return false;
  }
  return true;
}

export async function pushRefund(refund: Refund): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;

  const { error } = await sb.rpc('process_refund', {
    p_sale_id: refund.sale_id,
    p_store_id: refund.store_id || STORE_ID,
    p_till_id: refund.till_id,
    p_till_session_id: refund.till_session_id || null,
    p_staff_id: refund.staff_id || null,
    p_reason: refund.reason,
    p_method: refund.method,
    p_card_reference: null,
    // Pass the code that was PRINTED, so the slip in the customer's
    // hand and the row in the database can never disagree.
    p_voucher_code: refund.credit_note_code ?? null,
    p_items: refund.lines.map((l) => ({
      product_id: l.product_id,
      name: l.name,
      sku: l.sku,
      unit_price: l.unit_price,
      qty: l.qty,
      amount: l.amount,
      restock: l.restock,
    })),
  });

  if (error) {
    console.warn('[sync] refund failed, will retry:', refund.refund_number, error.message);
    return false;
  }
  return true;
}

export async function pushOverride(o: Override): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;

  const { error } = await sb.from('overrides').insert({
    store_id: o.store_id || STORE_ID,
    till_id: o.till_id,
    till_session_id: o.till_session_id || null,
    action: o.action,
    detail: o.detail,
    requested_by: o.requested_by || null,
    approved_by: o.approved_by,
  });

  if (error) {
    console.warn('[sync] override failed, will retry:', o.action, error.message);
    return false;
  }
  return true;
}

export async function pushDelivery(d: Delivery): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;

  // One RPC, one transaction. Half a delivery recorded is a shelf
  // count nobody can reconcile.
  const { error } = await sb.rpc('receive_delivery', {
    p_store_id: d.store_id || STORE_ID,
    p_supplier: d.supplier,
    p_invoice_ref: d.invoice_ref,
    p_received_by: d.received_by || null,
    // Costs were already decided at the till; do not re-apply them here
    // or a replayed sync would move prices a second time.
    p_update_costs: false,
    p_lines: d.lines.map((l) => ({
      product_id: l.product_id,
      name: l.name,
      sku: l.sku,
      qty: l.qty,
      qty_invoiced: l.qty_invoiced,
      unit_cost: l.unit_cost,
    })),
  });

  if (error) {
    console.warn('[sync] delivery failed, will retry:', d.delivery_number, error.message);
    return false;
  }
  return true;
}

/**
 * Movements that no other push already creates.
 *
 * Sales, refunds and deliveries each write their own movements
 * server-side inside their transaction. Pushing those again here would
 * double-count the stock. Only the ones a human made directly —
 * adjustments and write-offs — have no other route to the database.
 */
export async function pushMovement(m: StockMovement): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;

  const { error } = await sb.from('stock_movements').insert({
    product_id: m.product_id,
    store_id: m.store_id || STORE_ID,
    type: m.type,
    quantity: m.qty,
    balance_after: m.balance_after,
    reason: m.reason,
    reference: m.reference,
    staff_id: m.staff_id || null,
    unit_cost: m.unit_cost ?? null,
  });

  if (error) {
    console.warn('[sync] movement failed, will retry:', m.type, error.message);
    return false;
  }
  return true;
}

/** Drain everything unsynced. Safe to call as often as you like. */
export async function drainQueue(): Promise<number> {
  if (!isSupabaseConfigured || !navigator.onLine) return 0;

  const {
    sales, refunds, overrides, creditNotes, stockMovements, deliveries,
    markSynced, markRefundsSynced, markOverridesSynced, markVouchersSynced,
    markMovementsSynced, markDeliveriesSynced,
  } = usePos.getState();

  // Sales first, always. A refund references a sale, so pushing a
  // refund for a sale the server has never seen just fails.
  const pendingSales = sales.filter((s) => !s.synced);
  const done: string[] = [];
  for (const sale of pendingSales) {
    if (await pushSale(sale)) done.push(sale.id);
  }
  if (done.length) markSynced(done);

  const syncedSaleIds = new Set(
    usePos.getState().sales.filter((s) => s.synced).map((s) => s.id)
  );
  const pendingRefunds = refunds.filter(
    (r) => !r.synced && syncedSaleIds.has(r.sale_id)
  );
  const refundsDone: string[] = [];
  for (const refund of pendingRefunds) {
    if (await pushRefund(refund)) refundsDone.push(refund.id);
  }
  if (refundsDone.length) markRefundsSynced(refundsDone);

  // Vouchers are created server-side by process_refund, so once a
  // refund has landed its voucher has too — there is nothing separate
  // to push, only to mark.
  if (refundsDone.length) {
    const codes = new Set(
      refunds.filter((r) => refundsDone.includes(r.id)).map((r) => r.credit_note_code)
    );
    const settled = creditNotes
      .filter((v) => !v.synced && codes.has(v.code))
      .map((v) => v.id);
    if (settled.length) markVouchersSynced(settled);
  }

  // Overrides are independent of sales — push them regardless, because
  // an audit row that never leaves the till is not an audit row.
  const pendingOverrides = overrides.filter((o) => !o.synced);
  const overridesDone: string[] = [];
  for (const o of pendingOverrides) {
    if (await pushOverride(o)) overridesDone.push(o.id);
  }
  if (overridesDone.length) markOverridesSynced(overridesDone);

  // Deliveries carry their own movements, so they go before the loose ones.
  const pendingDeliveries = deliveries.filter((d) => !d.synced);
  const deliveriesDone: string[] = [];
  for (const d of pendingDeliveries) {
    if (await pushDelivery(d)) deliveriesDone.push(d.id);
  }
  if (deliveriesDone.length) markDeliveriesSynced(deliveriesDone);

  // Only hand-made movements. Everything else was written server-side
  // by the transaction that caused it — pushing those again would
  // double-count the stock.
  const HAND_MADE = new Set(['adjust', 'damage', 'stocktake']);
  const pendingMovements = stockMovements.filter(
    (m) => !m.synced && HAND_MADE.has(m.type) && m.reference === ''
  );
  const movementsDone: string[] = [];
  for (const m of pendingMovements) {
    if (await pushMovement(m)) movementsDone.push(m.id);
  }

  // The rest are already on the server via their parent document —
  // mark them so the "to sync" badge tells the truth.
  const carried = stockMovements
    .filter((m) => !m.synced && !(HAND_MADE.has(m.type) && m.reference === ''))
    .map((m) => m.id);
  if (movementsDone.length || carried.length) {
    markMovementsSynced([...movementsDone, ...carried]);
  }

  return done.length + refundsDone.length + overridesDone.length +
         deliveriesDone.length + movementsDone.length;
}

/** Call once from a client component to keep the queue moving. */
export function startSync(intervalMs = 30_000) {
  if (typeof window === 'undefined' || !isSupabaseConfigured) return () => {};

  void drainQueue();
  const timer = setInterval(() => void drainQueue(), intervalMs);
  const onOnline = () => void drainQueue();
  window.addEventListener('online', onOnline);

  return () => {
    clearInterval(timer);
    window.removeEventListener('online', onOnline);
  };
}
