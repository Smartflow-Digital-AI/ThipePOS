// ═══════════════════════════════════════════════════════════════════
// ANALYTICS
//
// Every number the owner sees is computed here, not inside a
// component. Two reasons:
//
//   1. A figure that appears on the Home screen and again in Reports
//      must be the SAME figure. One definition, imported twice.
//   2. This file is plain functions over plain arrays — it can be
//      unit-tested, and it will port to a Postgres view almost line
//      for line when the data outgrows the browser.
//
// The rules used throughout:
//
//   Revenue is NET.        Sold minus returned. Not "gross sales".
//   Cost uses cost_price.  The CURRENT cost of the product, not the
//                          cost on the day it sold. Good enough for a
//                          shop this size; when it isn't, the fix is
//                          to snapshot cost onto the sale line.
//   A non-restocked return costs you twice — you give the money back
//   AND the goods are gone. That is reflected below, because it is
//   exactly the leak an owner wants to see.
// ═══════════════════════════════════════════════════════════════════

import type {
  Sale, Refund, Product, TillSession, CreditNote,
  Override, StockMovement, Delivery, Staff,
} from './types';
import { effectiveUnitPrice, stockStatus, voucherIsUsable, sessionTotals } from './types';

// ─── Time ────────────────────────────────────────────────────

export type RangeKey = 'today' | '7d' | '30d' | '90d';

export const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: 'today', label: 'Today',    days: 1 },
  { key: '7d',    label: '7 days',   days: 7 },
  { key: '30d',   label: '30 days',  days: 30 },
  { key: '90d',   label: '90 days',  days: 90 },
];

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Local YYYY-MM-DD. Never use toISOString() for this — it is UTC,
 *  and a 01:00 sale in Johannesburg would land on yesterday. */
export function dayKey(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
    x.getDate()
  ).padStart(2, '0')}`;
}

export interface Bounds {
  from: Date;
  to: Date;
  /** The equal-length window immediately before, for comparison. */
  prevFrom: Date;
  prevTo: Date;
  days: number;
  label: string;
}

export function rangeBounds(key: RangeKey, now = new Date()): Bounds {
  const days = RANGES.find((r) => r.key === key)?.days ?? 1;
  const from = startOfDay(addDays(now, -(days - 1)));
  return {
    from,
    to: now,
    prevFrom: addDays(from, -days),
    prevTo: from,
    days,
    label: RANGES.find((r) => r.key === key)?.label ?? 'Today',
  };
}

const within = (iso: string, from: Date, to: Date) => {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t <= to.getTime();
};

/** Human "3 min ago". Shop staff read this faster than a timestamp. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Headline metrics ────────────────────────────────────────

export interface Metrics {
  /** Rung up, before returns. */
  gross: number;
  refunded: number;
  /** gross − refunded. The number that matters. */
  revenue: number;
  /** What the goods cost, net of restocked returns. */
  cost: number;
  /** revenue − cost. */
  profit: number;
  /** profit / revenue, 0–100. */
  margin: number;
  saleCount: number;
  refundCount: number;
  units: number;
  unitsReturned: number;
  avgBasket: number;
  cash: number;
  card: number;
  voucher: number;
  /** refunded / gross, 0–100. Creeping upward means a product problem. */
  returnRate: number;
  /** Value of returned goods that did NOT go back on the shelf. */
  writtenOffOnReturn: number;
}

export function metrics(
  sales: Sale[],
  refunds: Refund[],
  products: Product[],
  from: Date,
  to: Date
): Metrics {
  const costOf = (id: string) => products.find((p) => p.id === id)?.cost_price ?? 0;

  const S = sales.filter((s) => s.status !== 'voided' && within(s.created_at, from, to));
  const R = refunds.filter((r) => within(r.created_at, from, to));

  let gross = 0, cost = 0, units = 0;
  for (const s of S) {
    for (const l of s.lines) {
      gross += effectiveUnitPrice(l) * l.qty;
      cost += costOf(l.product_id) * l.qty;
      units += l.qty;
    }
  }

  let refunded = 0, unitsReturned = 0, restockedCost = 0, lostCost = 0;
  for (const r of R) {
    for (const l of r.lines) {
      refunded += l.amount;
      unitsReturned += l.qty;
      const c = costOf(l.product_id) * l.qty;
      // Restocked: you get the goods back, so the cost reverses.
      // Not restocked: the money went out AND the stock is gone.
      if (l.restock) restockedCost += c;
      else lostCost += c;
    }
  }

  const revenue = gross - refunded;
  const netCost = cost - restockedCost;
  const profit = revenue - netCost;

  const pay = (m: 'cash' | 'card' | 'voucher') =>
    S.flatMap((s) => s.payments).filter((p) => p.method === m).reduce((n, p) => n + p.amount, 0);

  const cashOut = R.filter((r) => r.method === 'cash').reduce((n, r) => n + r.total, 0);
  const cardOut = R.filter((r) => r.method === 'card').reduce((n, r) => n + r.total, 0);

  return {
    gross,
    refunded,
    revenue,
    cost: netCost,
    profit,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
    saleCount: S.length,
    refundCount: R.length,
    units,
    unitsReturned,
    avgBasket: S.length ? Math.round(gross / S.length) : 0,
    cash: pay('cash') - cashOut,
    card: pay('card') - cardOut,
    voucher: pay('voucher'),
    returnRate: gross > 0 ? (refunded / gross) * 100 : 0,
    writtenOffOnReturn: lostCost,
  };
}

/** Percentage change, guarding the divide-by-zero that makes a
 *  dashboard show "Infinity%" on a shop's first trading day. */
export function delta(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return ((now - before) / Math.abs(before)) * 100;
}

// ─── Series for charts ───────────────────────────────────────

export interface Point {
  key: string;
  label: string;
  revenue: number;
  profit: number;
  sales: number;
}

/** One point per day across the window, including days with no
 *  trading — a gap in a chart must read as "closed", not "missing". */
export function dailySeries(
  sales: Sale[],
  refunds: Refund[],
  products: Product[],
  b: Bounds
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < b.days; i++) {
    const day = addDays(b.from, i);
    const end = addDays(startOfDay(day), 1);
    const m = metrics(sales, refunds, products, startOfDay(day), end);
    out.push({
      key: dayKey(day),
      label: day.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }),
      revenue: m.revenue,
      profit: m.profit,
      sales: m.saleCount,
    });
  }
  return out;
}

/** Takings by hour of day. Answers "when do I actually need two
 *  cashiers on the floor". Only trading hours are returned. */
export function hourlySeries(sales: Sale[], from: Date, to: Date): Point[] {
  const buckets = new Array(24).fill(0).map(() => ({ revenue: 0, sales: 0 }));
  for (const s of sales) {
    if (s.status === 'voided' || !within(s.created_at, from, to)) continue;
    const h = new Date(s.created_at).getHours();
    buckets[h].revenue += s.total;
    buckets[h].sales += 1;
  }
  const first = buckets.findIndex((b) => b.sales > 0);
  const last = buckets.map((b) => b.sales > 0).lastIndexOf(true);
  if (first === -1) return [];
  // Pad to a sensible shop day so a quiet hour inside trading shows
  // as a dip rather than being cropped out of the chart.
  const lo = Math.min(first, 8);
  const hi = Math.max(last, 17);
  return buckets.slice(lo, hi + 1).map((b, i) => ({
    key: String(lo + i),
    label: `${String(lo + i).padStart(2, '0')}h`,
    revenue: b.revenue,
    profit: 0,
    sales: b.sales,
  }));
}

// ─── Product performance ─────────────────────────────────────

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  brand: string;
  units: number;
  returned: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  stock: number;
  stockValue: number;
  /** How many days the shelf lasts at the current rate. Infinity when
   *  nothing is selling — that is the dead-stock signal. */
  daysCover: number | null;
  /** Sell price below cost. Always a mistake, never intentional. */
  sellingAtLoss: boolean;
}

export function productPerformance(
  sales: Sale[],
  refunds: Refund[],
  products: Product[],
  b: Bounds
): ProductRow[] {
  const tally = new Map<string, { units: number; returned: number; revenue: number }>();
  const get = (id: string) =>
    tally.get(id) ?? { units: 0, returned: 0, revenue: 0 };

  for (const s of sales) {
    if (s.status === 'voided' || !within(s.created_at, b.from, b.to)) continue;
    for (const l of s.lines) {
      const t = get(l.product_id);
      t.units += l.qty;
      t.revenue += effectiveUnitPrice(l) * l.qty;
      tally.set(l.product_id, t);
    }
  }
  for (const r of refunds) {
    if (!within(r.created_at, b.from, b.to)) continue;
    for (const l of r.lines) {
      const t = get(l.product_id);
      t.returned += l.qty;
      t.units -= l.qty;
      t.revenue -= l.amount;
      tally.set(l.product_id, t);
    }
  }

  return products.map((p) => {
    const t = get(p.id);
    const cost = p.cost_price * t.units;
    const profit = t.revenue - cost;
    const perDay = t.units / b.days;
    return {
      id: p.id,
      sku: p.sku,
      name: `${p.name} ${p.variant}`.trim(),
      category: p.category,
      brand: p.brand,
      units: t.units,
      returned: t.returned,
      revenue: t.revenue,
      cost,
      profit,
      margin: t.revenue > 0 ? (profit / t.revenue) * 100 : 0,
      stock: p.stock,
      stockValue: p.stock * p.cost_price,
      daysCover: perDay > 0 ? p.stock / perDay : null,
      sellingAtLoss: p.sell_price < p.cost_price,
    };
  });
}

export interface CategoryRow {
  label: string;
  revenue: number;
  profit: number;
  units: number;
  share: number;
}

export function byCategory(rows: ProductRow[]): CategoryRow[] {
  const m = new Map<string, CategoryRow>();
  for (const r of rows) {
    const c = m.get(r.category) ?? { label: r.category, revenue: 0, profit: 0, units: 0, share: 0 };
    c.revenue += r.revenue;
    c.profit += r.profit;
    c.units += r.units;
    m.set(r.category, c);
  }
  const total = [...m.values()].reduce((n, c) => n + c.revenue, 0);
  return [...m.values()]
    .map((c) => ({ ...c, share: total > 0 ? (c.revenue / total) * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ─── People ──────────────────────────────────────────────────

export interface StaffRow {
  id: string;
  name: string;
  sales: number;
  turnover: number;
  avgBasket: number;
  units: number;
  refunds: number;
  refundValue: number;
  /** Overrides a manager had to approve for this person. */
  overrides: number;
  /** Shifts closed, and the worst variance among them. */
  shifts: number;
  worstVariance: number;
}

export function staffPerformance(
  sales: Sale[],
  refunds: Refund[],
  sessions: TillSession[],
  overrides: Override[],
  b: Bounds
): StaffRow[] {
  const m = new Map<string, StaffRow>();
  const row = (id: string, name: string) =>
    m.get(id) ?? {
      id, name, sales: 0, turnover: 0, avgBasket: 0, units: 0,
      refunds: 0, refundValue: 0, overrides: 0, shifts: 0, worstVariance: 0,
    };

  for (const s of sales) {
    if (s.status === 'voided' || !within(s.created_at, b.from, b.to)) continue;
    const r = row(s.cashier_id, s.cashier_name);
    r.sales += 1;
    r.turnover += s.total;
    r.units += s.lines.reduce((n, l) => n + l.qty, 0);
    m.set(s.cashier_id, r);
  }
  for (const f of refunds) {
    if (!within(f.created_at, b.from, b.to)) continue;
    const r = row(f.staff_id, f.staff_name);
    r.refunds += 1;
    r.refundValue += f.total;
    m.set(f.staff_id, r);
  }
  for (const o of overrides) {
    if (!within(o.created_at, b.from, b.to)) continue;
    const r = row(o.requested_by, o.requested_by_name);
    r.overrides += 1;
    m.set(o.requested_by, r);
  }
  for (const s of sessions) {
    if (s.status !== 'closed' || !s.closed_at || !within(s.closed_at, b.from, b.to)) continue;
    const r = row(s.opened_by, s.opened_by_name);
    r.shifts += 1;
    if (Math.abs(s.variance ?? 0) > Math.abs(r.worstVariance)) r.worstVariance = s.variance ?? 0;
    m.set(s.opened_by, r);
  }

  return [...m.values()]
    .map((r) => ({ ...r, avgBasket: r.sales ? Math.round(r.turnover / r.sales) : 0 }))
    .sort((a, b2) => b2.turnover - a.turnover);
}

// ─── Live floor ──────────────────────────────────────────────

export interface TillCard {
  id: string;
  name: string;
  status: 'open' | 'closed' | 'never';
  operator: string | null;
  openedAt: string | null;
  sales: number;
  turnover: number;
  /** What should physically be in that drawer right now. */
  expectedCash: number;
  lastSaleAt: string | null;
  /** Open for an unreasonably long time — nobody cashed up. */
  stale: boolean;
  variance: number | null;
}

/** A till left open longer than this almost certainly means the
 *  shift ended without a cash-up, not that they are still trading. */
export const STALE_SHIFT_HOURS = 14;

export function tillCards(
  tills: { id: string; name: string }[],
  sessions: TillSession[],
  sales: Sale[],
  refunds: Refund[],
  now = Date.now()
): TillCard[] {
  return tills.map((t) => {
    // Most recent session on this till, open or not.
    const s = sessions.find((x) => x.till_id === t.id) ?? null;
    if (!s) {
      return {
        id: t.id, name: t.name, status: 'never', operator: null, openedAt: null,
        sales: 0, turnover: 0, expectedCash: 0, lastSaleAt: null, stale: false, variance: null,
      };
    }
    const tot = sessionTotals(s, sales, refunds);
    const mine = sales
      .filter((x) => x.till_session_id === s.id)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    const openHours = (now - new Date(s.opened_at).getTime()) / 3_600_000;
    return {
      id: t.id,
      name: t.name,
      status: s.status,
      operator: s.opened_by_name,
      openedAt: s.opened_at,
      sales: tot.saleCount,
      turnover: tot.turnover,
      expectedCash: tot.expected,
      lastSaleAt: mine[0]?.created_at ?? null,
      stale: s.status === 'open' && openHours > STALE_SHIFT_HOURS,
      variance: s.status === 'closed' ? s.variance ?? 0 : null,
    };
  });
}

// ─── Things that need a human ────────────────────────────────

export type AlertLevel = 'bad' | 'warn' | 'info';

export interface Alert {
  level: AlertLevel;
  title: string;
  detail: string;
  /** Where the owner goes to deal with it. */
  href?: string;
  action?: string;
}

/** Cash variance beyond this on a single shift is worth a question. */
export const VARIANCE_THRESHOLD = 2000; // R20.00

export function alerts(input: {
  products: Product[];
  sales: Sale[];
  refunds: Refund[];
  sessions: TillSession[];
  vouchers: CreditNote[];
  overrides: Override[];
  movements: StockMovement[];
  deliveries: Delivery[];
  tills: TillCard[];
  unsynced: number;
  now?: Date;
}): Alert[] {
  const now = input.now ?? new Date();
  const out: Alert[] = [];
  const money0 = (c: number) => 'R' + (c / 100).toFixed(2);

  const out_ = input.products.filter((p) => stockStatus(p) === 'out_of_stock');
  if (out_.length) {
    out.push({
      level: 'bad',
      title: `${out_.length} product${out_.length === 1 ? '' : 's'} out of stock`,
      detail: out_.slice(0, 4).map((p) => p.name).join(', ') + (out_.length > 4 ? '…' : ''),
      href: '/stock', action: 'Reorder',
    });
  }

  const low = input.products.filter((p) => stockStatus(p) === 'low_stock');
  if (low.length) {
    out.push({
      level: 'warn',
      title: `${low.length} below reorder level`,
      detail: low.slice(0, 4).map((p) => p.name).join(', ') + (low.length > 4 ? '…' : ''),
      href: '/stock', action: 'View',
    });
  }

  const loss = input.products.filter((p) => p.sell_price < p.cost_price);
  if (loss.length) {
    out.push({
      level: 'bad',
      title: `${loss.length} priced below cost`,
      detail: loss.map((p) => `${p.name} sells for less than it cost`).slice(0, 3).join('; '),
      href: '/products', action: 'Fix pricing',
    });
  }

  const stale = input.tills.filter((t) => t.stale);
  if (stale.length) {
    out.push({
      level: 'warn',
      title: `${stale.length} till${stale.length === 1 ? '' : 's'} never cashed up`,
      detail: stale.map((t) => `${t.name} open since ${new Date(t.openedAt!).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`).join(', '),
      href: '/audit', action: 'Audit',
    });
  }

  const badShifts = input.sessions.filter(
    (s) => s.status === 'closed' && Math.abs(s.variance ?? 0) >= VARIANCE_THRESHOLD
  );
  if (badShifts.length) {
    const worst = badShifts.reduce((a, b) =>
      Math.abs(a.variance ?? 0) > Math.abs(b.variance ?? 0) ? a : b
    );
    out.push({
      level: 'warn',
      title: `${badShifts.length} shift${badShifts.length === 1 ? '' : 's'} out by more than ${money0(VARIANCE_THRESHOLD)}`,
      detail: `Worst: ${worst.opened_by_name} on ${worst.till_name}, ${money0(worst.variance ?? 0)}`,
      href: '/audit', action: 'Review',
    });
  }

  const liveVouchers = input.vouchers.filter(voucherIsUsable);
  const liability = liveVouchers.reduce((n, v) => n + v.remaining, 0);
  if (liability > 0) {
    const soon = liveVouchers.filter(
      (v) => new Date(v.expires_at).getTime() - now.getTime() < 90 * 86_400_000
    );
    out.push({
      level: 'info',
      title: `${money0(liability)} owed on vouchers`,
      detail: `${liveVouchers.length} live voucher${liveVouchers.length === 1 ? '' : 's'}` +
        (soon.length ? ` · ${soon.length} expiring within 90 days` : ''),
      href: '/vouchers', action: 'View',
    });
  }

  if (input.unsynced > 0) {
    out.push({
      level: 'warn',
      title: `${input.unsynced} record${input.unsynced === 1 ? '' : 's'} not yet in Supabase`,
      detail: 'Held on this device. They upload by themselves when the line comes back.',
    });
  }

  const shortDeliveries = input.deliveries.filter((d) => d.discrepancy_units > 0);
  if (shortDeliveries.length) {
    const units = shortDeliveries.reduce((n, d) => n + d.discrepancy_units, 0);
    out.push({
      level: 'warn',
      title: `${units} unit${units === 1 ? '' : 's'} short-shipped and unclaimed`,
      detail: `Across ${shortDeliveries.length} deliver${shortDeliveries.length === 1 ? 'y' : 'ies'} — you paid for stock that never arrived.`,
      href: '/reports', action: 'Suppliers',
    });
  }

  const thirty = addDays(now, -30);
  const damage = input.movements.filter(
    (m) => m.type === 'damage' && new Date(m.created_at) >= thirty
  );
  if (damage.length) {
    const units = damage.reduce((n, m) => n + Math.abs(m.qty), 0);
    const value = damage.reduce((n, m) => {
      const p = input.products.find((x) => x.id === m.product_id);
      return n + Math.abs(m.qty) * (p?.cost_price ?? 0);
    }, 0);
    out.push({
      level: units > 10 ? 'warn' : 'info',
      title: `${units} unit${units === 1 ? '' : 's'} written off this month`,
      detail: `${money0(value)} at cost. Damage, expiry and testers.`,
      href: '/stock', action: 'Write-offs',
    });
  }

  const order: Record<AlertLevel, number> = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// ─── Stock money ─────────────────────────────────────────────

export interface StockSummary {
  atCost: number;
  atRetail: number;
  /** What the shelf would earn if it all sold at today's prices. */
  potentialProfit: number;
  skus: number;
  units: number;
  low: number;
  out: number;
  /** Held value in products that sold nothing in the window. */
  deadValue: number;
  deadSkus: number;
}

export function stockSummary(products: Product[], rows: ProductRow[]): StockSummary {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let atCost = 0, atRetail = 0, units = 0, deadValue = 0, deadSkus = 0;
  for (const p of products) {
    atCost += p.cost_price * p.stock;
    atRetail += p.sell_price * p.stock;
    units += p.stock;
    const r = byId.get(p.id);
    if (p.stock > 0 && (!r || r.units <= 0)) {
      deadValue += p.cost_price * p.stock;
      deadSkus += 1;
    }
  }
  return {
    atCost,
    atRetail,
    potentialProfit: atRetail - atCost,
    skus: products.length,
    units,
    low: products.filter((p) => stockStatus(p) === 'low_stock').length,
    out: products.filter((p) => stockStatus(p) === 'out_of_stock').length,
    deadValue,
    deadSkus,
  };
}

/** Named so the intent is obvious at the call site. */
export function activeStaffCount(staff: Staff[]): number {
  return staff.filter((s) => s.is_active).length;
}
