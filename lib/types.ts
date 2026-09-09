// ─────────────────────────────────────────────────────────────
// Domain types. These mirror the Supabase schema 1:1.
// ─────────────────────────────────────────────────────────────

export type Role = 'admin' | 'manager' | 'cashier' | 'stock_controller';

export interface Staff {
  id: string;
  store_id: string;
  full_name: string;
  role: Role;
  pin: string;      // demo only — bcrypt server-side in production
  email: string;
  password: string; // demo only — see SETUP.md, office auth must use Supabase Auth
  is_active: boolean;
}

// ─────────────────────────────────────────────────────────────
// TWO SURFACES, NOT ONE LADDER OF RANKS
//
// A 4-digit PIN is right for "can ring up a sale" and badly wrong
// for "can see my margins". Anyone in the queue can read a PIN off
// the counter. So the PIN does not grant your rank — it opens a
// TILL SESSION, and a till session can only do till things. Even
// for the owner.
//
// The back office (cost prices, reports, settings) is a separate
// surface behind a real password, used from a laptop, not a counter.
//
// When a cashier needs something above their level, a manager
// approves that ONE action and control returns immediately. Nobody
// swaps accounts and nobody stays logged in as the manager.
// ─────────────────────────────────────────────────────────────

export type Surface = 'till' | 'office';

/** Who may open a till session. Stock controllers never touch money. */
export const TILL_ROLES: Role[] = ['cashier', 'manager', 'admin'];

/** Who may sign in to the back office. */
export const OFFICE_ROLES: Role[] = ['manager', 'admin', 'stock_controller'];

/** Who may approve an override at the till. */
export const OVERRIDE_ROLES: Role[] = ['manager', 'admin'];

/** A manager-approved exception. Every one is recorded. */
export interface Override {
  id: string;
  store_id: string;
  till_id: string;
  till_session_id: string;
  action: string;   // 'refund_outside_window'
  detail: string;   // human-readable: what, how much, which receipt
  requested_by: string;
  requested_by_name: string;
  approved_by: string;
  approved_by_name: string;
  created_at: string;
  synced: boolean;
}

export interface Store {
  id: string;
  name: string;
  address: string;
  phone: string;
  vat_number: string;
}

export interface Till {
  id: string;
  store_id: string;
  name: string;
  is_active: boolean;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  variant: string;
  category: string;
  brand: string;
  cost_price: number;
  sell_price: number;
  reorder_level: number;
  stock: number;
  is_active: boolean;
}

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface CartLine {
  product_id: string;
  sku: string;
  name: string;
  variant: string;
  unit_price: number;
  qty: number;
  discount: number; // rand amount off the line
}

export type PaymentMethod = 'cash' | 'card' | 'split';

export interface PaymentPart {
  method: 'cash' | 'card' | 'voucher';
  amount: number;
  card_reference?: string;
  card_last4?: string;
  /** Which voucher was spent, when method is 'voucher'. */
  voucher_code?: string;
}

export interface Sale {
  id: string;
  sale_number: string;
  store_id: string;
  till_id: string;
  till_session_id: string;
  cashier_id: string;
  cashier_name: string;
  /** Captured at checkout only to send the receipt. Not an account.
   *  POPIA: one stated purpose, no profile built, no marketing. */
  customer_email?: string | null;
  lines: CartLine[];
  payments: PaymentPart[];
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  cash_received?: number;
  change_given?: number;
  status: 'completed' | 'partially_refunded' | 'refunded' | 'voided';
  created_at: string;
  synced: boolean;
}

export interface TillSession {
  id: string;
  till_id: string;
  till_name: string;
  store_id: string;
  opened_by: string;
  opened_by_name: string;
  opened_at: string;
  opening_float: number;
  closed_at?: string | null;
  closed_by?: string | null;
  closed_by_name?: string | null;
  counted_cash?: number | null;
  expected_cash?: number | null;
  variance?: number | null;
  status: 'open' | 'closed';
}

// ─────────────────────────────────────────────────────────────
// NO CUSTOMER ACCOUNTS
//
// This shop works like Mr Price: nobody is asked to register. The
// only thing captured is an email at checkout, to send that one
// receipt, and returns are identified by the slip — not the person.
//
// Which means store credit cannot live on an account. It lives on a
// PRINTED VOUCHER with a code, the way a real shop hands you one.
// ─────────────────────────────────────────────────────────────

export type CreditNoteStatus = 'active' | 'redeemed' | 'expired' | 'void';

export interface CreditNote {
  id: string;
  /** Printed on the slip and typed (or scanned) at the till. */
  code: string;
  amount: number;    // cents, as issued
  remaining: number; // cents still on it — vouchers can be part-spent
  issued_from_refund: string; // refund_number it came from
  issued_at: string;
  expires_at: string;
  status: CreditNoteStatus;
  synced: boolean;
}

/**
 * South Africa's Consumer Protection Act (s63) gives prepaid vouchers
 * three years before they may expire. A credit note from a return is
 * arguably a different instrument, but three years is the safe read
 * and it is not worth arguing with a customer over.
 */
export const VOUCHER_VALID_YEARS = 3;

/**
 * Codes get read off a curling till slip and typed by hand, so the
 * alphabet excludes everything that gets misread: no O/0, no I/1/L,
 * no S/5, no B/8, no Z/2.
 */
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';

export function makeVoucherCode(): string {
  const block = (n: number) =>
    Array.from({ length: n }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    ).join('');
  return `GB-${block(4)}-${block(4)}`;
}

/** Accepts what a cashier actually types: spaces, lowercase, no dashes. */
export function normaliseVoucherCode(input: string): string {
  const bare = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!bare.startsWith('GB')) return bare;
  const body = bare.slice(2);
  return `GB-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

export function voucherIsUsable(v: CreditNote): boolean {
  return v.status === 'active' && v.remaining > 0 && new Date(v.expires_at) > new Date();
}

// ─────────────────────────────────────────────────────────────
// Money. Everything is stored and calculated in CENTS as an
// integer to avoid floating point drift, and only formatted to
// rands at the edge. This is the single most important rule in
// a POS — never do arithmetic on a float you will print.
// ─────────────────────────────────────────────────────────────

export const VAT_RATE = 0.15; // South African VAT

/** Format cents as R1 234.50 */
export function money(cents: number): string {
  const neg = cents < 0;
  const v = Math.abs(Math.round(cents));
  const s = (v / 100).toFixed(2);
  const [whole, frac] = s.split('.');
  const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}R${spaced}.${frac}`;
}

/** VAT-inclusive pricing: back the tax out of the total. */
export function taxFromInclusive(totalCents: number): number {
  return Math.round(totalCents - totalCents / (1 + VAT_RATE));
}

export function lineTotal(l: CartLine): number {
  return Math.max(0, l.unit_price * l.qty - l.discount);
}

export function cartTotals(lines: CartLine[]) {
  const gross = lines.reduce((s, l) => s + l.unit_price * l.qty, 0);
  const discount_total = lines.reduce((s, l) => s + l.discount, 0);
  const total = Math.max(0, gross - discount_total);
  const tax_total = taxFromInclusive(total);
  return { subtotal: total - tax_total, discount_total, tax_total, total, gross };
}

export function stockStatus(p: Product): StockStatus {
  if (p.stock <= 0) return 'out_of_stock';
  if (p.stock <= p.reorder_level) return 'low_stock';
  return 'in_stock';
}

// ─────────────────────────────────────────────────────────────
// REFUNDS
//
// A refund is a separate document, never an edit to the original
// sale. The sale that happened, happened — you cannot un-print a
// receipt, and an auditor (or SARS) needs to see both halves.
//
// Returned quantities are therefore DERIVED by summing refund
// lines, not stored on the sale. That makes partial returns and
// multiple partial returns fall out for free.
// ─────────────────────────────────────────────────────────────

export type RefundMethod = 'cash' | 'card' | 'store_credit';

export interface RefundLine {
  product_id: string;
  sku: string;
  name: string;
  variant: string;
  unit_price: number; // effective price actually paid per unit
  qty: number;
  amount: number; // unit_price * qty
  restock: boolean; // false when the item comes back damaged
}

export interface Refund {
  id: string;
  refund_number: string;
  sale_id: string;
  sale_number: string;
  store_id: string;
  till_id: string;
  till_session_id: string;
  staff_id: string;
  staff_name: string;
  /** Set when the refund was issued as a voucher. */
  credit_note_code?: string | null;
  lines: RefundLine[];
  total: number;
  reason: string;
  method: RefundMethod;
  created_at: string;
  synced: boolean;
}

export const RETURN_REASONS = [
  'Changed mind',
  'Wrong item',
  'Wrong shade / variant',
  'Faulty or damaged',
  'Allergic reaction',
  'Duplicate purchase',
] as const;

/**
 * What one unit of this line actually cost after its share of the
 * line discount. Refunding the sticker price on a discounted line
 * is how a shop quietly loses money on returns.
 */
export function effectiveUnitPrice(l: CartLine): number {
  if (l.qty <= 0) return 0;
  return Math.round((l.unit_price * l.qty - l.discount) / l.qty);
}

/** How many units of a product have already been returned on a sale. */
export function refundedQty(
  saleId: string,
  productId: string,
  refunds: Refund[]
): number {
  return refunds
    .filter((r) => r.sale_id === saleId)
    .flatMap((r) => r.lines)
    .filter((l) => l.product_id === productId)
    .reduce((n, l) => n + l.qty, 0);
}

/** Units still returnable on a sale line. */
export function returnableQty(
  saleId: string,
  line: CartLine,
  refunds: Refund[]
): number {
  return Math.max(0, line.qty - refundedQty(saleId, line.product_id, refunds));
}

/** Derive a sale's status from the refunds recorded against it. */
export function saleStatus(
  sale: Sale,
  refunds: Refund[]
): 'completed' | 'partially_refunded' | 'refunded' {
  const soldUnits = sale.lines.reduce((n, l) => n + l.qty, 0);
  const returned = sale.lines.reduce(
    (n, l) => n + refundedQty(sale.id, l.product_id, refunds),
    0
  );
  if (returned <= 0) return 'completed';
  return returned >= soldUnits ? 'refunded' : 'partially_refunded';
}

/** Days since a sale — the return window is checked against this. */
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export const RETURN_WINDOW_DAYS = 7;

// ─────────────────────────────────────────────────────────────
// SHIFT TOTALS
//
// One definition, used by the till's cash-up AND by the manager's
// audit screen. Two implementations of "what should be in the
// drawer" is how a shop ends up arguing with its own software.
// ─────────────────────────────────────────────────────────────

export interface SessionTotals {
  saleCount: number;
  cashIn: number;
  cardIn: number;
  voucherIn: number;
  /** Cash handed back out of this drawer as refunds. */
  cashOut: number;
  /** float + cash taken − cash refunded. */
  expected: number;
  /** Everything rung up, however it was paid. */
  turnover: number;
}

export function sessionTotals(
  session: TillSession,
  sales: Sale[],
  refunds: Refund[]
): SessionTotals {
  const mine = sales.filter((s) => s.till_session_id === session.id && s.status !== 'voided');
  const payments = mine.flatMap((s) => s.payments);
  const sum = (m: PaymentPart['method']) =>
    payments.filter((p) => p.method === m).reduce((n, p) => n + p.amount, 0);

  const cashIn = sum('cash');
  const cashOut = refunds
    .filter((r) => r.till_session_id === session.id && r.method === 'cash')
    .reduce((n, r) => n + r.total, 0);

  return {
    saleCount: mine.length,
    cashIn,
    cardIn: sum('card'),
    voucherIn: sum('voucher'),
    cashOut,
    expected: session.opening_float + cashIn - cashOut,
    turnover: mine.reduce((n, s) => n + s.total, 0),
  };
}

// ─────────────────────────────────────────────────────────────
// THE STOCK LEDGER
//
// Before this existed, the number on the shelf card was the only
// record — nothing said WHY it was 14 and not 20. Sales and refunds
// moved stock silently and adjustments lived in component state that
// died on refresh.
//
// A stock figure you cannot explain is a stock figure nobody trusts,
// and it makes shrinkage unmeasurable: you cannot tell theft from a
// mis-key from a delivery that was two short.
//
// So: EVERY change to stock writes one of these. No exceptions.
// ─────────────────────────────────────────────────────────────

export type MovementType =
  | 'sale'        // sold at the till
  | 'refund'      // came back and went on the shelf
  | 'receive'     // delivered by a supplier
  | 'damage'      // broken, expired, used as a tester — written off
  | 'adjust'      // a human corrected the number
  | 'stocktake';  // counted, and the count won

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  sale: 'Sale',
  refund: 'Return',
  receive: 'Delivery',
  damage: 'Write-off',
  adjust: 'Adjustment',
  stocktake: 'Stocktake',
};

export interface StockMovement {
  id: string;
  product_id: string;
  // Snapshots, so history stays readable after a product is renamed.
  sku: string;
  name: string;
  variant: string;
  store_id: string;
  type: MovementType;
  /** Signed. Negative when stock leaves. */
  qty: number;
  /** Stock level after this movement — makes the history readable
   *  without recomputing the whole chain. */
  balance_after: number;
  reason: string;
  /** Sale number, delivery number, refund number. */
  reference: string;
  staff_id: string;
  staff_name: string;
  /** Receives only — what this delivery charged per unit. Enables
   *  spotting a supplier quietly raising prices. */
  unit_cost?: number;
  created_at: string;
  synced: boolean;
}

// ─── Goods in ────────────────────────────────────────────────

export interface DeliveryLine {
  product_id: string;
  sku: string;
  name: string;
  variant: string;
  /** What was actually counted into the shop. */
  qty: number;
  /** What the supplier's invoice claims they sent. Different numbers
   *  here are the whole point — that is a short delivery, and it is
   *  money if nobody notices. */
  qty_invoiced: number;
  unit_cost: number;
}

export interface Delivery {
  id: string;
  delivery_number: string;
  supplier: string;
  invoice_ref: string;
  store_id: string;
  received_by: string;
  received_by_name: string;
  lines: DeliveryLine[];
  total_cost: number;
  /** Sum of (invoiced − counted). Positive means you were short-shipped. */
  discrepancy_units: number;
  created_at: string;
  synced: boolean;
}

export const DAMAGE_REASONS = [
  'Broken in store',
  'Expired',
  'Leaking or spoiled',
  'Used as a tester',
  'Damaged in delivery',
  'Lost or unaccounted',
] as const;

export const ADJUST_REASONS = [
  'Stock take correction',
  'Mis-key at the till',
  'Supplier return',
  'Found stock',
] as const;

/** Was this delivery short, over, or exactly as invoiced? */
export function deliveryAccuracy(d: Delivery): 'exact' | 'short' | 'over' {
  if (d.discrepancy_units === 0) return 'exact';
  return d.discrepancy_units > 0 ? 'short' : 'over';
}
