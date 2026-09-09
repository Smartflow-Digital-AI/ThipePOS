'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  CartLine, PaymentPart, Product, Sale, Staff, TillSession,
  Refund, RefundLine, RefundMethod, Surface, Override, CreditNote,
  StockMovement, MovementType, Delivery, DeliveryLine,
} from '@/lib/types';
import {
  cartTotals, effectiveUnitPrice, returnableQty,
  TILL_ROLES, OFFICE_ROLES, OVERRIDE_ROLES,
  makeVoucherCode, normaliseVoucherCode, voucherIsUsable, VOUCHER_VALID_YEARS,
} from '@/lib/types';
import { PRODUCTS, STORE, TILLS, STAFF } from '@/lib/data/seed';

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
}

const nowIso = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);

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

      // ─────────────────────────────────────────────────────────────
      tillLogin: (pin) => {
        const found = STAFF.find(
          (s) => s.pin === pin && s.is_active && TILL_ROLES.includes(s.role)
        );
        if (!found) return null;
        set({ staff: found, surface: 'till' });
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
        set({ staff: found, surface: 'office' });
        return found;
      },

      logout: () => set({ staff: null, surface: null, cart: [], saleEmail: '' }),

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

        void paid;

        set((st) => ({
          sales: [sale, ...sales],
          products: nextProducts,
          stockMovements: [...moved.movements, ...st.stockMovements],
          cart: [],
          saleEmail: '',
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

        set((st) => ({
          refunds: [refund, ...refunds],
          products: nextProducts,
          stockMovements: [...moved.movements, ...st.stockMovements],
          creditNotes: voucher ? [voucher, ...creditNotes] : creditNotes,
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

        set((st) => ({
          products: priced,
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

        set((st) => ({
          products: moved.products,
          stockMovements: [...moved.movements, ...st.stockMovements],
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

        set((st) => ({
          products: moved.products,
          stockMovements: [...moved.movements, ...st.stockMovements],
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
        get().deliveries.filter((d) => !d.synced).length,
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
      }),
    }
  )
);
