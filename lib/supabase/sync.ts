'use client';

import { supabase, isSupabaseConfigured } from './client';
import { isConnected } from './auth';
import { usePos } from '@/lib/store';
import type {
  Delivery, Override, Refund, Sale, StockMovement,
  TillSession, LoyaltyMember, LoyaltyTxn, StockAlert, LoginEvent,
} from '@/lib/types';

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

  const { error } = await sb.rpc('complete_sale_v2', {
    // The till's own id and the number PRINTED on the slip. The id is
    // the primary key server-side, so a retry of a push that already
    // landed is a no-op rather than a second sale.
    p_sale_id: sale.id,
    p_sale_number: sale.sale_number,
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

  const { error } = await sb.rpc('process_refund_v2', {
    p_refund_id: refund.id,
    p_refund_number: refund.refund_number,
    // Now meaningful: the sale carries the till's id as its primary
    // key server-side, so the local sale_id IS the server's sale id.
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
/**
 * Till sessions, which nothing pushed before.
 *
 * A sale carries till_session_id. If the session has never reached
 * the server the sale fails its foreign key — so sessions go first,
 * every cycle, before anything that references them.
 *
 * Upserted rather than queued: a shift is opened once and then
 * mutated once (at cash-up), there are only a handful a day, and an
 * upsert is self-healing if either write was missed.
 */
export async function pushSession(session: TillSession): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;

  const { error } = await sb.from('till_sessions').upsert(
    {
      id: session.id,
      till_id: session.till_id,
      store_id: session.store_id || STORE_ID,
      opened_by: session.opened_by,
      opened_at: session.opened_at,
      opening_float: session.opening_float,
      closed_by: session.closed_by ?? null,
      closed_at: session.closed_at ?? null,
      counted_cash: session.counted_cash ?? null,
      // The cash-up was performed at the till, on paper money, by a
      // person. These are its numbers — the server does not get to
      // recompute them and disagree.
      expected_cash: session.expected_cash ?? null,
      variance: session.variance ?? null,
      status: session.status,
    },
    { onConflict: 'id' }
  );

  if (error) {
    console.warn('[sync] session failed, will retry:', session.till_name, error.message);
    return false;
  }
  return true;
}

export async function pushLoyaltyMember(m: LoyaltyMember): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;

  const { error } = await sb.from('loyalty_members').upsert(
    {
      id: m.id,
      store_id: STORE_ID,
      phone: m.phone,
      name: m.name ?? null,
      points: m.points,
      lifetime_spend: m.lifetime_spend,
      marketing_opt_in: m.marketing_opt_in,
      joined_at: m.joined_at,
      last_seen_at: m.last_seen_at,
    },
    { onConflict: 'id' }
  );

  if (error) {
    console.warn('[sync] loyalty member failed, will retry:', m.phone, error.message);
    return false;
  }
  return true;
}

export async function pushLoyaltyTxn(t: LoyaltyTxn): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;

  const { error } = await sb.from('loyalty_ledger').upsert(
    {
      id: t.id,
      member_id: t.member_id,
      store_id: STORE_ID,
      points: t.points,
      balance_after: t.balance_after,
      reason: t.reason,
      reference: t.reference,
      staff_id: t.staff_id || null,
      created_at: t.created_at,
    },
    { onConflict: 'id' }
  );

  if (error) {
    console.warn('[sync] points ledger failed, will retry:', t.reference, error.message);
    return false;
  }
  return true;
}

export async function pushAlert(a: StockAlert): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;

  const { error } = await sb.from('stock_alerts').upsert(
    {
      id: a.id,
      store_id: STORE_ID,
      product_id: a.product_id,
      kind: a.kind,
      level: a.level,
      threshold: a.threshold,
      trigger: a.trigger,
      roles: a.roles,
      created_at: a.created_at,
      // Upsert, not insert: an alert raised offline and resolved
      // offline must land in its resolved state, not as a fresh one.
      resolved_at: a.resolved_at ?? null,
    },
    { onConflict: 'id' }
  );

  if (error) {
    console.warn('[sync] stock alert failed, will retry:', a.sku, error.message);
    return false;
  }
  return true;
}

export async function pushLogin(l: LoginEvent): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;

  const { error } = await sb.from('login_events').upsert(
    {
      id: l.id,
      store_id: STORE_ID,
      staff_id: l.staff_id,
      role: l.role,
      surface: l.surface,
      till_id: l.till_id ?? null,
      signed_in_at: l.signed_in_at,
      signed_out_at: l.signed_out_at ?? null,
      ended: l.ended,
    },
    { onConflict: 'id' }
  );

  if (error) {
    console.warn('[sync] sign-in failed, will retry:', l.staff_name, error.message);
    return false;
  }
  return true;
}

/**
 * Anything minted before ids became uuids can never be pushed —
 * Postgres rejects the cast. Skip it rather than retrying it every
 * thirty seconds forever behind a badge that never clears.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let warnedLegacy = false;
function syncable<T extends { id: string }>(rows: T[]): T[] {
  const ok = rows.filter((r) => UUID.test(r.id));
  if (ok.length !== rows.length && !warnedLegacy) {
    warnedLegacy = true;
    console.warn(
      `[sync] ${rows.length - ok.length} record(s) predate uuid ids and cannot be ` +
      `pushed. Settings -> Local data -> Clear everything to drop them.`
    );
  }
  return ok;
}

export async function drainQueue(): Promise<number> {
  if (!isSupabaseConfigured || !navigator.onLine) return 0;

  // No session, no pushing. Under RLS an unauthenticated write is
  // rejected anyway; checking here means the queue HOLDS instead of
  // burning through every row against a wall every thirty seconds.
  // Nothing is lost — it drains the moment the device is connected.
  if (!(await isConnected())) return 0;

  const {
    sales, refunds, overrides, creditNotes, stockMovements, deliveries,
    sessions, loyaltyMembers, loyaltyLedger, alerts, logins,
    markSynced, markRefundsSynced, markOverridesSynced, markVouchersSynced,
    markMovementsSynced, markDeliveriesSynced,
    markLoyaltySynced, markAlertsSynced, markLoginsSynced,
  } = usePos.getState();

  // SESSIONS FIRST. Every sale carries a till_session_id, so a sale
  // pushed before its shift exists fails its foreign key. Only the
  // live one and anything closed in the last day — older shifts are
  // already up and never change again.
  const DAY = 24 * 60 * 60 * 1000;
  const recentSessions = syncable(
    sessions.filter(
      (x) =>
        x.status === 'open' ||
        (x.closed_at ? Date.now() - new Date(x.closed_at).getTime() < DAY : false)
    )
  );
  for (const session of recentSessions) await pushSession(session);

  // Then sales. A refund references a sale, so pushing a refund for a
  // sale the server has never seen just fails.
  const pendingSales = syncable(sales.filter((s) => !s.synced));
  const done: string[] = [];
  for (const sale of pendingSales) {
    if (await pushSale(sale)) done.push(sale.id);
  }
  if (done.length) markSynced(done);

  const syncedSaleIds = new Set(
    usePos.getState().sales.filter((s) => s.synced).map((s) => s.id)
  );
  const pendingRefunds = syncable(
    refunds.filter((r) => !r.synced && syncedSaleIds.has(r.sale_id))
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

  // ── Loyalty ───────────────────────────────────────────────
  // Members before the ledger: a points row references a member.
  const membersDone: string[] = [];
  for (const m of syncable(loyaltyMembers.filter((x) => !x.synced))) {
    if (await pushLoyaltyMember(m)) membersDone.push(m.id);
  }
  const syncedMembers = new Set([
    ...loyaltyMembers.filter((m) => m.synced).map((m) => m.id),
    ...membersDone,
  ]);
  const txnsDone: string[] = [];
  for (const t of syncable(
    loyaltyLedger.filter((x) => !x.synced && syncedMembers.has(x.member_id))
  )) {
    if (await pushLoyaltyTxn(t)) txnsDone.push(t.id);
  }
  if (membersDone.length || txnsDone.length) {
    markLoyaltySynced([...membersDone, ...txnsDone]);
  }

  // ── Stock alerts ──────────────────────────────────────────
  const alertsDone: string[] = [];
  for (const a of syncable(alerts.filter((x) => !x.synced))) {
    if (await pushAlert(a)) alertsDone.push(a.id);
  }
  if (alertsDone.length) markAlertsSynced(alertsDone);

  // ── Sign-ins ──────────────────────────────────────────────
  const loginsDone: string[] = [];
  for (const l of syncable(logins.filter((x) => !x.synced))) {
    if (await pushLogin(l)) loginsDone.push(l.id);
  }
  if (loginsDone.length) markLoginsSynced(loginsDone);

  return done.length + refundsDone.length + overridesDone.length +
         deliveriesDone.length + movementsDone.length +
         membersDone.length + txnsDone.length +
         alertsDone.length + loginsDone.length;
}

/** Call once from a client component to keep the queue moving. */
export function startSync(intervalMs = 30_000) {
  if (typeof window === 'undefined' || !isSupabaseConfigured) return () => {};

  void drainQueue();
  const timer = setInterval(() => void drainQueue(), intervalMs);
  // Connecting the till should drain immediately, not after the next
  // tick — the person who just typed the password is watching.
  const auth = supabase()?.auth.onAuthStateChange(() => void drainQueue());
  const onOnline = () => void drainQueue();
  window.addEventListener('online', onOnline);

  return () => {
    clearInterval(timer);
    auth?.data.subscription.unsubscribe();
    window.removeEventListener('online', onOnline);
  };
}
