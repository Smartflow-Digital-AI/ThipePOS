'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  CartLine, PaymentPart, Product, Sale, Staff, TillSession,
  Refund, RefundLine, RefundMethod, Surface, Override, CreditNote,
  StockMovement, MovementType, Delivery, DeliveryLine,
  StockAlert, LoyaltyMember, LoyaltyTxn, LoyaltyReason, LoginEvent, Role,
} from '@/lib/types';
import {
  cartTotals, effectiveUnitPrice, returnableQty,
  TILL_ROLES, OFFICE_ROLES, OVERRIDE_ROLES,
  makeVoucherCode, normaliseVoucherCode, voucherIsUsable, VOUCHER_VALID_YEARS,
  DEFAULT_LOW_STOCK_THRESHOLD, STOCK_ALERT_ROLES, alertThreshold,
  normalisePhone, pointsFor, POINTS_PER_VOUCHER, VOUCHER_RAND_PER_REDEMPTION,
} from '@/lib/types';
import { PRODUCTS, STORE, TILLS, STAFF } from '@/lib/data/seed';
import { buildDemo } from '@/lib/data/demo';
import { isSupabaseConfigured } from '@/lib/supabase/client';

// ═══════════════════════════════════════════════════════════════════
//  OFFLINE-FIRST BY DESIGN
//
//  Every sale is written to local state (persisted to localStorage)
//  FIRST and marked synced:false. A background pusher drains the
//  unsynced queue to Supabase whenever the network is up.
//
//  This is not a nice-to-have in South Africa. Load-shedding and
//  flaky shop wifi mean the till MUST keep selling with no internet.
//  The rule: never let a network call sit between the customer and
//  their receipt.
// ═══════════════════════════════════════════════════════════════════

interface PosState {
  // ── session ──
  staff: Staff | null;
  /** Which surface this sign-in opened. Permissions follow the SURFACE,
   *  not the person's rank — an admin signed in at the till gets till
   *  permissions and nothing more. */
  surface: Surface | null;
  tillId: string;
  /** The shift currently open on THIS till, if any. */
  session: TillSession | null;
  /**
   * Every shift ever opened on this device, newest first.
   *
   * This used to be a single slot, which quietly threw the previous
   * shift away every time a till was reopened — so a manager could
   * never see that Till 2 came up R50 short on Tuesday, which is the
   * entire point of doing a cash-up. A cash variance you cannot look
   * up later is not a control.
   */
  sessions: TillSession[];
  overrides: Override[];

  // ── data ──
  products: Product[];
  sales: Sale[];
  refunds: Refund[];
  creditNotes: CreditNote[];
  /** Every change to stock, ever. See lib/types.ts — a stock figure
   *  you cannot explain is a stock figure nobody trusts. */
  stockMovements: StockMovement[];
  deliveries: Delivery[];

  // ── current sale ──
  cart: CartLine[];
  /** Captured at checkout to email the receipt. Not an account. */
  saleEmail: string;

  // ── actions: auth & till ──
  /** PIN at the counter. Opens a TILL session only. */
  tillLogin: (pin: string) => Staff | null;
  /** Email + password from a laptop. Opens an OFFICE session only. */
  officeLogin: (email: string, password: string) => Staff | null;
  logout: () => void;

  /** A manager approves ONE action. Does NOT change who is signed in. */
  approveOverride: (pin: string, action: string, detail: string) => Override | null;
  markOverridesSynced: (ids: string[]) => void;
  setTill: (tillId: string) => void;
  openTill: (floatCents: number) => void;
  closeTill: (countedCents: number) => { expected: number; counted: number; variance: number };

  // ── actions: cart ──
  addByBarcode: (barcode: string) => Product | null;
  addProduct: (productId: string, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  removeLine: (productId: string) => void;
  setLineDiscount: (productId: string, cents: number) => void;
  clearCart: () => void;
  setSaleEmail: (email: string) => void;

  // ── actions: vouchers ──
  /** Look a voucher up by whatever the cashier typed. */
  findVoucher: (code: string) => CreditNote | null;
  /** Spend some or all of a voucher. Returns what was actually taken. */
  redeemVoucher: (code: string, amount: number) => number;

  // ── actions: sale ──
  completeSale: (payments: PaymentPart[], cashReceived?: number) => Sale;

  // ── actions: returns ──
  processRefund: (args: {
    saleId: string;
    items: { product_id: string; qty: number; restock: boolean }[];
    reason: string;
    method: RefundMethod;
    /** Who the store credit belongs to. Needed when the original sale
     *  was a guest checkout and a customer is attached at return time. */
  }) => { refund: Refund; voucher: CreditNote | null } | null;

  // ── sync ──
  markSynced: (saleIds: string[]) => void;
  markRefundsSynced: (refundIds: string[]) => void;
  markVouchersSynced: (ids: string[]) => void;
  markMovementsSynced: (ids: string[]) => void;
  markDeliveriesSynced: (ids: string[]) => void;

  // ── actions: stock ──
  /** Record goods arriving. Optionally updates cost prices. */
  receiveDelivery: (args: {
    supplier: string;
    invoice_ref: string;
    lines: { product_id: string; qty: number; qty_invoiced: number; unit_cost: number }[];
    updateCostPrices: boolean;
  }) => Delivery | null;
  /** Write stock off the books: broken, expired, tester, lost. */
  writeOffStock: (product_id: string, qty: number, reason: string) => StockMovement | null;
  /** A human corrects the number. Always needs a reason. */
  adjustStock: (product_id: string, delta: number, reason: string) => StockMovement | null;
  unsyncedCount: () => number;

  // ── alerts ──
  /** Shop-wide low-stock floor. Per-product reorder levels still win
   *  when they are higher. */
  lowStockThreshold: number;
  setLowStockThreshold: (n: number) => void;
  alerts: StockAlert[];
  /** Alerts this person should see, newest first. */
  alertsFor: (role: Role) => StockAlert[];
  unreadAlerts: (role: Role, staffId: string) => number;
  markAlertsRead: () => void;
  markAlertsSynced: (ids: string[]) => void;

  // ── loyalty ──
  loyaltyMembers: LoyaltyMember[];
  loyaltyLedger: LoyaltyTxn[];
  /** Phone typed at the till for the sale in progress. */
  salePhone: string;
  setSalePhone: (phone: string) => void;
  findMember: (phone: string) => LoyaltyMember | null;
  /** Find or create. Returns null if the number is not a valid mobile. */
  joinLoyalty: (phone: string, name?: string) => LoyaltyMember | null;
  setMarketingOptIn: (memberId: string, on: boolean) => void;
  /** Spend points on a voucher. Returns the voucher, or null. */
  redeemPoints: (memberId: string) => CreditNote | null;
  markLoyaltySynced: (ids: string[]) => void;

  // ── who signed in ──
  logins: LoginEvent[];
  markLoginsSynced: (ids: string[]) => void;

  // ── demo ──
  /** True once a demo month has been generated into this browser. */
  demoSeeded: boolean;
  /**
   * Fill an empty browser with a month of trading so the back office
   * has something to show. Refuses when Supabase is configured — the
   * moment there is a real backend, fabricated sales are a hazard,
   * not a convenience. Returns whether it actually seeded.
   */
  seedDemo: (force?: boolean) => boolean;
  /**
   * Back to a clean shop: seeded products, no history, still signed
   * in — and it STAYS clean, because clearing is a deliberate act and
   * the auto-seeder must not quietly refill it on the next reload.
   */
  resetAll: () => void;
}

const nowIso = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);

// ─── The sign-in log ─────────────────────────────────────────
// Till sessions say who had the drawer. They say nothing about who
// was in the back office at 22:40 reading cost prices.

function openLogin(who: Staff, surface: Surface, tillId: string | null): LoginEvent {
  const till = tillId ? TILLS.find((t) => t.id === tillId) : null;
  return {
    id: 'lg-' + uid(),
    staff_id: who.id,
    staff_name: who.full_name,
    role: who.role,
    surface,
    till_id: surface === 'till' ? (tillId ?? null) : null,
    till_name: surface === 'till' ? (till?.name ?? null) : null,
    signed_in_at: nowIso(),
    signed_out_at: null,
    ended: 'still_active',
    synced: false,
  };
}

/**
 * Close anything left open. A browser that is simply closed never
 * calls logout, so the previous session would otherwise sit "active"
 * forever and make the log useless. Signing in again is proof the
 * last one ended.
 */
function closeOpenLogins(logins: LoginEvent[]): LoginEvent[] {
  return logins.map((l) =>
    l.ended === 'still_active'
      ? { ...l, signed_out_at: nowIso(), ended: 'signed_out' as const, synced: false }
      : l
  );
}

/**
 * The ONLY place stock levels change.
 *
 * Every caller goes through here, so it is impossible to move stock
 * without leaving a movement behind — which was the whole problem
 * before: sales and refunds changed the number silently and nobody
 * could explain a shelf count afterwards.
 *
 * Returns the new product list and the movements to record; the
 * caller commits both in one `set`.
 */
function applyMovements(
  products: Product[],
  staff: Staff | null,
  entries: {
    product_id: string;
    type: MovementType;
    qty: number; // signed — negative when stock leaves
    reason: string;
    reference: string;
    unit_cost?: number;
  }[]
): { movements: StockMovement[]; products: Product[] } {
  let next = products;
  const movements: StockMovement[] = [];

  for (const e of entries) {
    const p = next.find((x) => x.id === e.product_id);
    if (!p || e.qty === 0) continue;

    const balance = Math.max(0, p.stock + e.qty);
    next = next.map((x) => (x.id === p.id ? { ...x, stock: balance } : x));

    movements.push({
      id: 'mv-' + uid(),
      product_id: p.id,
      sku: p.sku,
      name: p.name,
      variant: p.variant,
      store_id: STORE.id,
      type: e.type,
      qty: e.qty,
      balance_after: balance,
      reason: e.reason,
      reference: e.reference,
      staff_id: staff?.id ?? '',
      staff_name: staff?.full_name ?? 'Unknown',
      unit_cost: e.unit_cost,
      created_at: nowIso(),
      synced: false,
    });
  }

  return { movements, products: next };
}

/**
 * Turn a stock change into alerts.
 *
 * Only CROSSINGS count. Selling one unit of something that was
 * already below the line raises nothing — the alert for that product
 * is already sitting unread in somebody's bell, and a shop that gets
 * forty notifications for one low product stops reading notifications.
 *
 * Crossing back up resolves the open alert instead of leaving it for
 * someone to dismiss. Reordering the stock IS the dismissal.
 */
function reconcileAlerts(
  before: Product[],
  after: Product[],
  floor: number,
  trigger: string,
  existing: StockAlert[]
): StockAlert[] {
  let next = existing;
  const fresh: StockAlert[] = [];

  for (const p of after) {
    const was = before.find((x) => x.id === p.id);
    if (!was || was.stock === p.stock) continue;

    const line = alertThreshold(p, floor);
    const openFor = next.find((a) => a.product_id === p.id && !a.resolved_at);

    // Back above the line — close whatever was open.
    if (p.stock > line) {
      if (openFor) {
        next = next.map((a) =>
          a.id === openFor.id ? { ...a, resolved_at: nowIso(), synced: false } : a
        );
      }
      continue;
    }

    const kind = p.stock <= 0 ? 'out_of_stock' : 'low_stock';

    // Already flagged, and it has not got worse in kind. Say nothing.
    if (openFor && openFor.kind === kind) continue;

    // Low → out is a genuine escalation and deserves its own row, so
    // resolve the softer one first rather than stacking both.
    if (openFor) {
      next = next.map((a) =>
        a.id === openFor.id ? { ...a, resolved_at: nowIso(), synced: false } : a
      );
    }

    fresh.push({
      id: 'alr-' + uid(),
      kind,
      product_id: p.id,
      sku: p.sku,
      name: p.name,
      variant: p.variant,
      level: p.stock,
      threshold: line,
      trigger,
      roles: STOCK_ALERT_ROLES,
      created_at: nowIso(),
      read_by: [],
      resolved_at: null,
      synced: false,
    });
  }

  return fresh.length ? [...fresh, ...next] : next;
}

export const usePos = create<PosState>()(
  persist(
    (set, get) => ({
      staff: null,
      surface: null,
      tillId: TILLS[0].id,
      session: null,
      sessions: [],
      overrides: [],
      products: PRODUCTS,
      sales: [],
      refunds: [],
      creditNotes: [],
      stockMovements: [],
      deliveries: [],
      cart: [],
      saleEmail: '',
      salePhone: '',
      lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
      alerts: [],
      loyaltyMembers: [],
      loyaltyLedger: [],
      logins: [],
      demoSeeded: false,

      // ── ALERTS ───────────────────────────────────────────────
      setLowStockThreshold: (n) =>
        set({ lowStockThreshold: Math.max(0, Math.round(n)) }),

      alertsFor: (role) =>
        get().alerts.filter((a) => a.roles.includes(role)),

      unreadAlerts: (role, staffId) =>
        get().alerts.filter(
          (a) => a.roles.includes(role) && !a.resolved_at && !a.read_by.includes(staffId)
        ).length,

      // Opening the bell marks everything currently addressed to you as
      // read — for YOU. A manager reading it does not silence the stock
      // controller's copy, which is the entire point of routing by role.
      markAlertsRead: () => {
        const { staff, alerts } = get();
        if (!staff) return;
        set({
          alerts: alerts.map((a) =>
            a.roles.includes(staff.role) && !a.read_by.includes(staff.id)
              ? { ...a, read_by: [...a.read_by, staff.id], synced: false }
              : a
          ),
        });
      },

      markAlertsSynced: (ids) =>
        set((s) => ({
          alerts: s.alerts.map((a) => (ids.includes(a.id) ? { ...a, synced: true } : a)),
        })),

      // ── LOYALTY ──────────────────────────────────────────────
      setSalePhone: (phone) => set({ salePhone: phone }),

      findMember: (phone) => {
        const key = normalisePhone(phone);
        if (!key) return null;
        return get().loyaltyMembers.find((m) => m.phone === key) ?? null;
      },

      joinLoyalty: (phone, name) => {
        const key = normalisePhone(phone);
        // Guard here as well as in the UI: a member keyed on a broken
        // number is a member nobody can ever look up again.
        if (!/^27[6-8]\d{8}$/.test(key)) return null;

        const existing = get().loyaltyMembers.find((m) => m.phone === key);
        if (existing) {
          if (name && !existing.name) {
            const updated = { ...existing, name, synced: false };
            set((st) => ({
              loyaltyMembers: st.loyaltyMembers.map((m) => (m.id === existing.id ? updated : m)),
            }));
            return updated;
          }
          return existing;
        }

        const member: LoyaltyMember = {
          id: 'ly-' + uid(),
          phone: key,
          name: name ?? null,
          points: 0,
          lifetime_spend: 0,
          marketing_opt_in: false, // POPIA: opting in is a separate act
          joined_at: nowIso(),
          last_seen_at: nowIso(),
          synced: false,
        };
        set((st) => ({ loyaltyMembers: [member, ...st.loyaltyMembers] }));
        return member;
      },

      setMarketingOptIn: (memberId, on) =>
        set((st) => ({
          loyaltyMembers: st.loyaltyMembers.map((m) =>
            m.id === memberId ? { ...m, marketing_opt_in: on, synced: false } : m
          ),
        })),

      redeemPoints: (memberId) => {
        const { loyaltyMembers, staff } = get();
        const member = loyaltyMembers.find((m) => m.id === memberId);
        if (!member || member.points < POINTS_PER_VOUCHER) return null;

        const expires = new Date();
        expires.setFullYear(expires.getFullYear() + VOUCHER_VALID_YEARS);
        const amount = VOUCHER_RAND_PER_REDEMPTION * 100;

        const voucher: CreditNote = {
          id: 'cn-' + uid(),
          code: makeVoucherCode(),
          amount,
          remaining: amount,
          issued_from_refund: 'LOYALTY',
          issued_at: nowIso(),
          expires_at: expires.toISOString(),
          status: 'active',
          synced: false,
        };

        const balance = member.points - POINTS_PER_VOUCHER;
        const txn: LoyaltyTxn = {
          id: 'lt-' + uid(),
          member_id: member.id,
          phone: member.phone,
          points: -POINTS_PER_VOUCHER,
          balance_after: balance,
          reason: 'redeem',
          reference: voucher.code,
          staff_id: staff?.id ?? '',
          staff_name: staff?.full_name ?? 'Unknown',
          created_at: nowIso(),
          synced: false,
        };

        set((st) => ({
          creditNotes: [voucher, ...st.creditNotes],
          loyaltyLedger: [txn, ...st.loyaltyLedger],
          loyaltyMembers: st.loyaltyMembers.map((m) =>
            m.id === member.id
              ? { ...m, points: balance, last_seen_at: nowIso(), synced: false }
              : m
          ),
        }));

        return voucher;
      },

      markLoyaltySynced: (ids) =>
        set((s) => ({
          loyaltyMembers: s.loyaltyMembers.map((m) =>
            ids.includes(m.id) ? { ...m, synced: true } : m
          ),
          loyaltyLedger: s.loyaltyLedger.map((t) =>
            ids.includes(t.id) ? { ...t, synced: true } : t
          ),
        })),

      markLoginsSynced: (ids) =>
        set((s) => ({
          logins: s.logins.map((l) => (ids.includes(l.id) ? { ...l, synced: true } : l)),
        })),

      // ─────────────────────────────────────────────────────────────
      seedDemo: (force = false) => {
        // Never fabricate history against a live database.
        if (isSupabaseConfigured) return false;
        const st = get();
        if (!force && (st.demoSeeded || st.sales.length > 0)) return false;

        const d = buildDemo();
        set({
          products: d.products,
          sales: d.sales,
          refunds: d.refunds,
          creditNotes: d.creditNotes,
          sessions: d.sessions,
          // The live slot stays empty on purpose. Whoever is being
          // shown the system opens their own till, which is the first
          // thing a cashier does anyway — while the Overview already
          // shows a floor with history behind it.
          session: null,
          overrides: d.overrides,
          stockMovements: d.stockMovements,
          deliveries: d.deliveries,
          loyaltyMembers: d.loyaltyMembers,
          loyaltyLedger: d.loyaltyLedger,
          alerts: d.alerts,
          logins: d.logins,
          cart: [],
          saleEmail: '',
          salePhone: '',
          demoSeeded: true,
        });
        return true;
      },

      resetAll: () =>
        set({
          products: PRODUCTS.map((p) => ({ ...p })),
          sales: [],
          refunds: [],
          creditNotes: [],
          stockMovements: [],
          deliveries: [],
          sessions: [],
          session: null,
          overrides: [],
          loyaltyMembers: [],
          loyaltyLedger: [],
          alerts: [],
          logins: [],
          cart: [],
          saleEmail: '',
          salePhone: '',
          // Marks the auto-seeder as having had its turn here.
          demoSeeded: true,
        }),

      // ─────────────────────────────────────────────────────────────
      tillLogin: (pin) => {
        const found = STAFF.find(
          (s) => s.pin === pin && s.is_active && TILL_ROLES.includes(s.role)
        );
        if (!found) return null;
        set((st) => ({
          staff: found,
          surface: 'till',
          logins: [openLogin(found, 'till', st.tillId), ...closeOpenLogins(st.logins)],
        }));
        return found;
      },

      officeLogin: (email, password) => {
        const e = email.trim().toLowerCase();
        const found = STAFF.find(
          (s) =>
            s.is_active &&
            OFFICE_ROLES.includes(s.role) &&
            s.email.toLowerCase() === e &&
            s.password === password &&
            s.password !== ''
        );
        if (!found) return null;
        set((st) => ({
          staff: found,
          surface: 'office',
          logins: [openLogin(found, 'office', null), ...closeOpenLogins(st.logins)],
        }));
        return found;
      },

      logout: () =>
        set((st) => ({
          staff: null,
          surface: null,
          cart: [],
          saleEmail: '',
          salePhone: '',
          logins: closeOpenLogins(st.logins),
        })),

      // The approver never becomes the signed-in user. They lean over,
      // type their PIN, the one action goes through, and the cashier is
      // still the cashier. That is the whole point — and it is why the
      // override is written down.
      approveOverride: (pin, action, detail) => {
        const { staff, session, tillId, overrides } = get();
        const approver = STAFF.find(
          (s) => s.pin === pin && s.is_active && OVERRIDE_ROLES.includes(s.role)
        );
        if (!approver) return null;

        const record: Override = {
          id: 'ovr-' + uid(),
          store_id: STORE.id,
          till_id: tillId,
          till_session_id: session?.id ?? '',
          action,
          detail,
          requested_by: staff?.id ?? '',
          requested_by_name: staff?.full_name ?? 'Unknown',
          approved_by: approver.id,
          approved_by_name: approver.full_name,
          created_at: nowIso(),
          synced: false,
        };

        set({ overrides: [record, ...overrides] });
        return record;
      },

      markOverridesSynced: (ids) =>
        set((s) => ({
          overrides: s.overrides.map((o) =>
            ids.includes(o.id) ? { ...o, synced: true } : o
          ),
        })),

      setTill: (tillId) => set({ tillId }),

      openTill: (floatCents) => {
        const { staff, tillId } = get();
        if (!staff) return;
        const till = TILLS.find((t) => t.id === tillId)!;
        const opened: TillSession = {
          id: 'ts-' + uid(),
          till_id: tillId,
          till_name: till.name,
          store_id: STORE.id,
          opened_by: staff.id,
          opened_by_name: staff.full_name,
          opened_at: nowIso(),
          opening_float: floatCents,
          status: 'open',
        };
        set((st) => ({ session: opened, sessions: [opened, ...st.sessions] }));
      },

      closeTill: (countedCents) => {
        const { session, sales, refunds, staff } = get();
        if (!session || session.status === 'closed') {
          return { expected: 0, counted: countedCents, variance: countedCents };
        }

        const cashTaken = sales
          .filter((s) => s.till_session_id === session.id)
          .flatMap((s) => s.payments)
          .filter((p) => p.method === 'cash')
          .reduce((sum, p) => sum + p.amount, 0);

        // Cash paid back out of the drawer has to come off the expected
        // total, or every till with a refund on it reads as short.
        const cashRefunded = refunds
          .filter((r) => r.till_session_id === session.id && r.method === 'cash')
          .reduce((sum, r) => sum + r.total, 0);

        const expected = session.opening_float + cashTaken - cashRefunded;
        const variance = countedCents - expected;

        const closed: TillSession = {
          ...session,
          closed_at: nowIso(),
          closed_by: staff?.id ?? session.opened_by,
          closed_by_name: staff?.full_name ?? session.opened_by_name,
          counted_cash: countedCents,
          expected_cash: expected,
          variance,
          status: 'closed',
        };

        // The slot keeps the CLOSED shift rather than going null.
        //
        // Nulling it looked tidier and cost the cashier the one number
        // they close a till to see: every screen reading `session`
        // unmounted the instant the button was pressed, taking the
        // variance panel with it. Everything that gates selling checks
        // `status === 'open'`, never mere truthiness, and openTill
        // overwrites this slot — so a closed shift sitting here is
        // readable history, not an open drawer.
        set((st) => ({
          session: closed,
          sessions: st.sessions.map((x) => (x.id === closed.id ? closed : x)),
        }));

        return { expected, counted: countedCents, variance };
      },

      // ─────────────────────────────────────────────────────────────
      addByBarcode: (barcode) => {
        const product = get().products.find((p) => p.barcode === barcode);
        if (!product) return null;
        get().addProduct(product.id);
        return product;
      },

      addProduct: (productId, qty = 1) => {
        const product = get().products.find((p) => p.id === productId);
        if (!product) return;

        set((s) => {
          const existing = s.cart.find((l) => l.product_id === productId);
          if (existing) {
            return {
              cart: s.cart.map((l) =>
                l.product_id === productId ? { ...l, qty: l.qty + qty } : l
              ),
            };
          }
          const line: CartLine = {
            product_id: product.id,
            sku: product.sku,
            name: product.name,
            variant: product.variant,
            unit_price: product.sell_price,
            qty,
            discount: 0,
          };
          return { cart: [...s.cart, line] };
        });
      },

      setQty: (productId, qty) =>
        set((s) => ({
          cart:
            qty <= 0
              ? s.cart.filter((l) => l.product_id !== productId)
              : s.cart.map((l) => (l.product_id === productId ? { ...l, qty } : l)),
        })),

      removeLine: (productId) =>
        set((s) => ({ cart: s.cart.filter((l) => l.product_id !== productId) })),

      setLineDiscount: (productId, cents) =>
        set((s) => ({
          cart: s.cart.map((l) =>
            l.product_id === productId
              ? { ...l, discount: Math.max(0, Math.min(cents, l.unit_price * l.qty)) }
              : l
          ),
        })),

      clearCart: () => set({ cart: [], saleEmail: '' }),

      setSaleEmail: (email) => set({ saleEmail: email }),

      findVoucher: (code) => {
        const wanted = normaliseVoucherCode(code);
        return get().creditNotes.find((v) => v.code === wanted) ?? null;
      },

      // Vouchers can be part-spent: a R100 voucher against a R60 sale
      // leaves R40 on it. NEVER give change from a voucher in cash —
      // that turns a credit note into a cash-out and hands you the
      // fraud you issued it to avoid.
      redeemVoucher: (code, amount) => {
        const voucher = get().findVoucher(code);
        if (!voucher || !voucherIsUsable(voucher)) return 0;

        const taken = Math.min(voucher.remaining, amount);
        if (taken <= 0) return 0;

        set((st) => ({
          creditNotes: st.creditNotes.map((v) =>
            v.id === voucher.id
              ? {
                  ...v,
                  remaining: v.remaining - taken,
                  status: v.remaining - taken <= 0 ? 'redeemed' : v.status,
                  synced: false,
                }
              : v
          ),
        }));

        return taken;
      },

      // ─────────────────────────────────────────────────────────────
      completeSale: (payments, cashReceived) => {
        const { cart, staff, session, tillId, products, saleEmail, sales } = get();
        const totals = cartTotals(cart);

        // The slot holds the last shift even after it is closed, so a
        // sale must never inherit a session id from a shift that is
        // already cashed up — that money would land in a drawer count
        // somebody has already signed off.
        const open = session && session.status === 'open' ? session : null;

        const paid = payments.reduce((s, p) => s + p.amount, 0);
        const change = cashReceived != null ? Math.max(0, cashReceived - totals.total) : undefined;

        const sale: Sale = {
          id: 'sale-' + uid(),
          sale_number: 'S-' + String(1000 + sales.length + 1),
          store_id: STORE.id,
          till_id: tillId,
          till_session_id: open?.id ?? '',
          cashier_id: staff?.id ?? '',
          cashier_name: staff?.full_name ?? 'Unknown',
          customer_email: saleEmail.trim() || null,
          lines: cart,
          payments,
          subtotal: totals.subtotal,
          discount_total: totals.discount_total,
          tax_total: totals.tax_total,
          total: totals.total,
          cash_received: cashReceived,
          change_given: change,
          status: 'completed',
          created_at: nowIso(),
          synced: false, // ← the sync queue is just this flag
        };

        // Take stock down THROUGH THE LEDGER, so the shelf count can
        // always be explained back to a receipt.
        const moved = applyMovements(
          products,
          staff,
          cart.map((l) => ({
            product_id: l.product_id,
            type: 'sale' as MovementType,
            qty: -l.qty,
            reason: '',
            reference: 'S-' + String(1000 + sales.length + 1),
          }))
        );
        const nextProducts = moved.products;
        const nextAlerts = reconcileAlerts(
          products, nextProducts, get().lowStockThreshold, sale.sale_number, get().alerts
        );

        void paid;

        // ── Loyalty ──────────────────────────────────────────
        // Points are earned on what was actually paid for the goods.
        // A number typed at the till that is not a valid mobile earns
        // nothing rather than creating a member nobody can look up.
        const { salePhone, loyaltyMembers, loyaltyLedger } = get();
        let members = loyaltyMembers;
        let ledger = loyaltyLedger;
        const member = salePhone ? get().joinLoyalty(salePhone) : null;

        if (member) {
          // joinLoyalty may have inserted; re-read before updating.
          members = get().loyaltyMembers;
          const earned = pointsFor(sale.total);
          const balance = member.points + earned;
          sale.customer_phone = member.phone;
          sale.loyalty_member_id = member.id;
          sale.points_earned = earned;

          members = members.map((m) =>
            m.id === member.id
              ? {
                  ...m,
                  points: balance,
                  lifetime_spend: m.lifetime_spend + sale.total,
                  last_seen_at: nowIso(),
                  synced: false,
                }
              : m
          );

          if (earned > 0) {
            ledger = [
              {
                id: 'lt-' + uid(),
                member_id: member.id,
                phone: member.phone,
                points: earned,
                balance_after: balance,
                reason: 'earn' as LoyaltyReason,
                reference: sale.sale_number,
                staff_id: staff?.id ?? '',
                staff_name: staff?.full_name ?? 'Unknown',
                created_at: nowIso(),
                synced: false,
              },
              ...ledger,
            ];
          }
        }

        set((st) => ({
          sales: [sale, ...sales],
          products: nextProducts,
          stockMovements: [...moved.movements, ...st.stockMovements],
          alerts: nextAlerts,
          loyaltyMembers: members,
          loyaltyLedger: ledger,
          cart: [],
          saleEmail: '',
          salePhone: '',
        }));

        return sale;
      },


      // ─────────────────────────────────────────────
      // A refund never edits the original sale. It writes a second
      // document that points back at it. Stock only comes back for
      // lines marked sellable — damaged goods are written off, not
      // silently put back on the shelf.
      processRefund: ({ saleId, items, reason, method }) => {
        const { sales, refunds, products, creditNotes, staff, session, tillId } = get();
        const sale = sales.find((s) => s.id === saleId);
        if (!sale) return null;

        // Same rule as completeSale: never book money into a shift that
        // has already been cashed up.
        const open = session && session.status === 'open' ? session : null;

        const lines: RefundLine[] = [];

        for (const item of items) {
          if (item.qty <= 0) continue;
          const saleLine = sale.lines.find((l) => l.product_id === item.product_id);
          if (!saleLine) continue;

          // Never refund more than is still owed on this line.
          const allowed = returnableQty(saleId, saleLine, refunds);
          const qty = Math.min(item.qty, allowed);
          if (qty <= 0) continue;

          const unit = effectiveUnitPrice(saleLine);
          lines.push({
            product_id: saleLine.product_id,
            sku: saleLine.sku,
            name: saleLine.name,
            variant: saleLine.variant,
            unit_price: unit,
            qty,
            amount: unit * qty,
            restock: item.restock,
          });
        }

        if (lines.length === 0) return null;

        const total = lines.reduce((sum, l) => sum + l.amount, 0);

        // Store credit becomes a VOUCHER, because there is no account
        // to put it on. The customer walks out holding a printed slip
        // with a code, exactly as they would from any high-street shop.
        let voucher: CreditNote | null = null;
        if (method === 'store_credit') {
          const expires = new Date();
          expires.setFullYear(expires.getFullYear() + VOUCHER_VALID_YEARS);

          voucher = {
            id: 'cn-' + uid(),
            code: makeVoucherCode(),
            amount: total,
            remaining: total,
            issued_from_refund: 'R-' + String(2000 + refunds.length + 1),
            issued_at: nowIso(),
            expires_at: expires.toISOString(),
            status: 'active',
            synced: false,
          };
        }

        const refund: Refund = {
          id: 'ref-' + uid(),
          refund_number: 'R-' + String(2000 + refunds.length + 1),
          sale_id: sale.id,
          sale_number: sale.sale_number,
          store_id: sale.store_id,
          till_id: tillId,
          till_session_id: open?.id ?? '',
          staff_id: staff?.id ?? '',
          staff_name: staff?.full_name ?? 'Unknown',
          credit_note_code: voucher?.code ?? null,
          lines,
          total,
          reason,
          method,
          created_at: nowIso(),
          synced: false,
        };

        // Everything coming back goes on the books first, then damaged
        // goods are written off in a second movement. Net stock is the
        // same either way, but the ledger tells the true story: it came
        // back, AND it was scrapped. Without both halves, damage
        // reporting has nothing to count.
        const refundNumber = 'R-' + String(2000 + refunds.length + 1);
        const entries = lines.flatMap((l) => [
          {
            product_id: l.product_id,
            type: 'refund' as MovementType,
            qty: l.qty,
            reason,
            reference: refundNumber,
          },
          ...(l.restock
            ? []
            : [{
                product_id: l.product_id,
                type: 'damage' as MovementType,
                qty: -l.qty,
                reason: 'Returned damaged — not resaleable',
                reference: refundNumber,
              }]),
        ]);
        const moved = applyMovements(products, staff, entries);
        const nextProducts = moved.products;
        const nextAlerts = reconcileAlerts(
          products, nextProducts, get().lowStockThreshold, refundNumber, get().alerts
        );

        // Points earned on money that has been given back are points
        // the shop never owed. Clawed back, never below zero — a
        // customer must not end a return owing the shop loyalty.
        let members = get().loyaltyMembers;
        let ledger = get().loyaltyLedger;
        const member = sale.loyalty_member_id
          ? members.find((m) => m.id === sale.loyalty_member_id)
          : null;

        if (member) {
          const clawback = Math.min(member.points, pointsFor(total));
          if (clawback > 0) {
            const balance = member.points - clawback;
            members = members.map((m) =>
              m.id === member.id ? { ...m, points: balance, synced: false } : m
            );
            ledger = [
              {
                id: 'lt-' + uid(),
                member_id: member.id,
                phone: member.phone,
                points: -clawback,
                balance_after: balance,
                reason: 'refund' as LoyaltyReason,
                reference: refundNumber,
                staff_id: staff?.id ?? '',
                staff_name: staff?.full_name ?? 'Unknown',
                created_at: nowIso(),
                synced: false,
              },
              ...ledger,
            ];
          }
        }

        set((st) => ({
          refunds: [refund, ...refunds],
          products: nextProducts,
          stockMovements: [...moved.movements, ...st.stockMovements],
          creditNotes: voucher ? [voucher, ...creditNotes] : creditNotes,
          alerts: nextAlerts,
          loyaltyMembers: members,
          loyaltyLedger: ledger,
        }));

        return { refund, voucher };
      },

      markSynced: (saleIds) =>
        set((s) => ({
          sales: s.sales.map((sale) =>
            saleIds.includes(sale.id) ? { ...sale, synced: true } : sale
          ),
        })),

      markVouchersSynced: (ids) =>
        set((s) => ({
          creditNotes: s.creditNotes.map((v) =>
            ids.includes(v.id) ? { ...v, synced: true } : v
          ),
        })),

      // ── Goods in ───────────────────────────────────────────
      receiveDelivery: ({ supplier, invoice_ref, lines, updateCostPrices }) => {
        const { products, staff, deliveries } = get();
        const usable = lines.filter((l) => l.qty > 0);
        if (usable.length === 0) return null;

        const number = 'GRN-' + String(500 + deliveries.length + 1);

        const moved = applyMovements(
          products,
          staff,
          usable.map((l) => ({
            product_id: l.product_id,
            type: 'receive' as MovementType,
            qty: l.qty,
            reason: supplier,
            reference: number,
            unit_cost: l.unit_cost,
          }))
        );

        // What the invoice claimed minus what was actually counted in.
        // Positive means short-shipped, and it is money if nobody looks.
        const discrepancy = usable.reduce((n, l) => n + (l.qty_invoiced - l.qty), 0);

        const detailed: DeliveryLine[] = usable.map((l) => {
          const p = products.find((x) => x.id === l.product_id)!;
          return {
            product_id: l.product_id,
            sku: p.sku,
            name: p.name,
            variant: p.variant,
            qty: l.qty,
            qty_invoiced: l.qty_invoiced,
            unit_cost: l.unit_cost,
          };
        });

        const delivery: Delivery = {
          id: 'dlv-' + uid(),
          delivery_number: number,
          supplier: supplier.trim(),
          invoice_ref: invoice_ref.trim(),
          store_id: STORE.id,
          received_by: staff?.id ?? '',
          received_by_name: staff?.full_name ?? 'Unknown',
          lines: detailed,
          total_cost: detailed.reduce((n, l) => n + l.unit_cost * l.qty, 0),
          discrepancy_units: discrepancy,
          created_at: nowIso(),
          synced: false,
        };

        // Cost prices only change if the receiver says so. A supplier
        // raising a price should be a decision, not a side effect.
        const priced = updateCostPrices
          ? moved.products.map((p) => {
              const l = usable.find((x) => x.product_id === p.id);
              return l && l.unit_cost > 0 ? { ...p, cost_price: l.unit_cost } : p;
            })
          : moved.products;

        // Receiving is the one movement that RESOLVES alerts: stock
        // coming back above the line is exactly what the alert asked for.
        const nextAlerts = reconcileAlerts(
          products, priced, get().lowStockThreshold, number, get().alerts
        );

        set((st) => ({
          products: priced,
          alerts: nextAlerts,
          deliveries: [delivery, ...st.deliveries],
          stockMovements: [...moved.movements, ...st.stockMovements],
        }));

        return delivery;
      },

      writeOffStock: (product_id, qty, reason) => {
        const { products, staff } = get();
        if (qty <= 0) return null;

        const moved = applyMovements(products, staff, [
          { product_id, type: 'damage', qty: -qty, reason, reference: '' },
        ]);
        if (moved.movements.length === 0) return null;

        const nextAlerts = reconcileAlerts(
          products, moved.products, get().lowStockThreshold, 'Write-off', get().alerts
        );

        set((st) => ({
          products: moved.products,
          stockMovements: [...moved.movements, ...st.stockMovements],
          alerts: nextAlerts,
        }));

        return moved.movements[0];
      },

      adjustStock: (product_id, delta, reason) => {
        const { products, staff } = get();
        if (delta === 0) return null;

        const moved = applyMovements(products, staff, [
          { product_id, type: 'adjust', qty: delta, reason, reference: '' },
        ]);
        if (moved.movements.length === 0) return null;

        const nextAlerts = reconcileAlerts(
          products, moved.products, get().lowStockThreshold, 'Manual adjustment', get().alerts
        );

        set((st) => ({
          products: moved.products,
          stockMovements: [...moved.movements, ...st.stockMovements],
          alerts: nextAlerts,
        }));

        return moved.movements[0];
      },

      markMovementsSynced: (ids) =>
        set((s) => ({
          stockMovements: s.stockMovements.map((m) =>
            ids.includes(m.id) ? { ...m, synced: true } : m
          ),
        })),

      markDeliveriesSynced: (ids) =>
        set((s) => ({
          deliveries: s.deliveries.map((d) =>
            ids.includes(d.id) ? { ...d, synced: true } : d
          ),
        })),

      markRefundsSynced: (refundIds) =>
        set((s) => ({
          refunds: s.refunds.map((r) =>
            refundIds.includes(r.id) ? { ...r, synced: true } : r
          ),
        })),

      unsyncedCount: () =>
        get().sales.filter((s) => !s.synced).length +
        get().refunds.filter((r) => !r.synced).length +
        get().overrides.filter((o) => !o.synced).length +
        get().creditNotes.filter((v) => !v.synced).length +
        get().stockMovements.filter((m) => !m.synced).length +
        get().deliveries.filter((d) => !d.synced).length +
        get().alerts.filter((a) => !a.synced).length +
        get().loyaltyMembers.filter((m) => !m.synced).length +
        get().loyaltyLedger.filter((t) => !t.synced).length +
        get().logins.filter((l) => !l.synced).length,
    }),
    {
      name: 'beautypos-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        staff: s.staff,
        surface: s.surface,
        overrides: s.overrides,
        tillId: s.tillId,
        session: s.session,
        sessions: s.sessions,
        products: s.products,
        sales: s.sales,
        refunds: s.refunds,
        creditNotes: s.creditNotes,
        stockMovements: s.stockMovements,
        deliveries: s.deliveries,
        cart: s.cart,
        saleEmail: s.saleEmail,
        salePhone: s.salePhone,
        lowStockThreshold: s.lowStockThreshold,
        alerts: s.alerts,
        loyaltyMembers: s.loyaltyMembers,
        loyaltyLedger: s.loyaltyLedger,
        logins: s.logins,
        demoSeeded: s.demoSeeded,
      }),
    }
  )
);
