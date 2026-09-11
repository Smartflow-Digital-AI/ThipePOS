// ═══════════════════════════════════════════════════════════════════
// DEMO DATA
//
// A brand-new browser has products and nothing else, which means the
// entire back office — Overview, Reports, Audit, the stock ledger —
// renders as a set of empty cards. Technically correct, and it makes
// the system look broken to anyone seeing it for the first time.
//
// So this generates a month of plausible trading: sales with a real
// weekly rhythm, returns (some restocked, some not), two deliveries
// with one short, write-offs, closed shifts with small cash
// variances, a manager override and a live voucher.
//
// Three rules it follows, because a demo that contradicts itself is
// worse than an empty one:
//
//   1. DETERMINISTIC. Same data every time, so you can rehearse the
//      walkthrough and the numbers do not move under you.
//   2. STOCK ADDS UP. Every movement is chained so each product's
//      running balance ends exactly on its seeded stock level — the
//      out-of-stock frontal is out because it sold out, not because
//      a number was typed in.
//   3. NOTHING IN THE FUTURE. Today's sales stop at the current time.
//
// Everything is marked synced, so a demo never shows a sync backlog
// that isn't real. Seeding is refused outright once Supabase is
// configured — see seedDemo() in the store.
// ═══════════════════════════════════════════════════════════════════

import { PRODUCTS, STAFF, STORE, TILLS } from './seed';
import {
  makeVoucherCode, taxFromInclusive, VOUCHER_VALID_YEARS,
  pointsFor, POINTS_PER_VOUCHER, VOUCHER_RAND_PER_REDEMPTION,
  DEFAULT_LOW_STOCK_THRESHOLD, STOCK_ALERT_ROLES, alertThreshold,
  type CartLine, type CreditNote, type Delivery, type Override, type PaymentPart,
  type Product, type Refund, type RefundLine, type Sale, type StockMovement,
  type TillSession, type MovementType, type LoyaltyMember, type LoyaltyTxn,
  type StockAlert, type LoginEvent,
} from '@/lib/types';

export interface DemoData {
  products: Product[];
  sales: Sale[];
  refunds: Refund[];
  creditNotes: CreditNote[];
  sessions: TillSession[];
  session: TillSession | null;
  overrides: Override[];
  stockMovements: StockMovement[];
  deliveries: Delivery[];
  loyaltyMembers: LoyaltyMember[];
  loyaltyLedger: LoyaltyTxn[];
  alerts: StockAlert[];
  logins: LoginEvent[];
}

/** How much history to generate. A month reads as a business. */
export const DEMO_DAYS = 30;

// ─── Deterministic randomness ────────────────────────────────
// Not for security. For a demo that looks the same on Tuesday as it
// did when you rehearsed it on Monday.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CASHIERS = STAFF.filter((s) => s.role === 'cashier');
const MANAGER = STAFF.find((s) => s.role === 'manager')!;
const STOCK_CTRL = STAFF.find((s) => s.role === 'stock_controller')!;

export function buildDemo(now: Date = new Date()): DemoData {
  const rand = rng(20260101);
  const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const dayBack = (n: number) => {
    const x = startOfDay(now);
    x.setDate(x.getDate() - n);
    return x;
  };
  /** A moment on a given day, never later than right now. */
  const at = (daysAgo: number, hour: number, min: number): Date => {
    const d = dayBack(daysAgo);
    d.setHours(hour, min, Math.floor(rand() * 60), 0);
    return d > now ? new Date(now.getTime() - 60_000) : d;
  };

  const sales: Sale[] = [];
  const refunds: Refund[] = [];
  const sessions: TillSession[] = [];
  const overrides: Override[] = [];
  const creditNotes: CreditNote[] = [];
  const deliveries: Delivery[] = [];

  // Movements are collected unchained; balances are walked in at the
  // end so every product lands on its seeded stock level.
  type RawMove = Omit<StockMovement, 'balance_after'> & { _t: number };
  const raw: RawMove[] = [];
  let moveId = 0;
  const move = (
    p: Product, type: MovementType, qty: number, reason: string,
    reference: string, whoId: string, whoName: string, when: Date, unit_cost?: number
  ) => {
    raw.push({
      id: 'dmv-' + ++moveId,
      product_id: p.id, sku: p.sku, name: p.name, variant: p.variant,
      store_id: STORE.id, type, qty, reason, reference,
      staff_id: whoId, staff_name: whoName,
      unit_cost, created_at: when.toISOString(), synced: true,
      _t: when.getTime(),
    });
  };

  // Fast movers sell far more often than a R1 299 frontal. Weighting
  // by price keeps the best-seller list believable.
  const weighted: Product[] = [];
  for (const p of PRODUCTS) {
    const w = p.sell_price > 60000 ? 1 : p.sell_price > 20000 ? 3 : 7;
    for (let i = 0; i < w; i++) weighted.push(p);
  }

  let saleNo = 0;
  let refundNo = 0;

  // ── Loyalty members ─────────────────────────────────────────
  // Roughly one shopper in three gives a number. Regulars come back,
  // so the list has to be weighted towards a few frequent names rather
  // than 80 people who each shopped once.
  const FIRST = ['Nomsa', 'Lerato', 'Ayanda', 'Thabo', 'Zinhle', 'Palesa', 'Naledi',
    'Bongani', 'Refilwe', 'Katlego', 'Anele', 'Dimpho', 'Tshepo', 'Nandi', 'Mpho',
    'Lindiwe', 'Sibusiso', 'Kagiso', 'Boitumelo', 'Amahle'];
  const LAST = ['Nkosi', 'Dlamini', 'Mahlangu', 'Molefe', 'Ndlovu', 'Zwane', 'Maseko',
    'Mthembu', 'Sithole', 'Radebe'];

  const members: LoyaltyMember[] = [];
  const usedPhones = new Set<string>();
  for (let i = 0; i < 34; i++) {
    let phone = '';
    do {
      phone = '27' + pick(['6', '7', '8']) + String(int(10000000, 99999999));
    } while (usedPhones.has(phone));
    usedPhones.add(phone);

    members.push({
      id: 'dly-' + (i + 1),
      phone,
      // Not everyone gives a name. The number is the account.
      name: rand() < 0.62 ? `${pick(FIRST)} ${pick(LAST)}` : null,
      points: 0,
      lifetime_spend: 0,
      // POPIA: consent is the exception, not the default.
      marketing_opt_in: rand() < 0.35,
      joined_at: dayBack(DEMO_DAYS - 1).toISOString(),
      last_seen_at: dayBack(DEMO_DAYS - 1).toISOString(),
      synced: true,
    });
  }
  // A handful of regulars carry most of the visits.
  const regulars = members.slice(0, 9);

  // Today is special: the shop has only been trading for part of it.
  //
  // Opening the demo at 08:00 used to pile every one of today's sales
  // into the same minute, because each generated time was in the
  // future and got clamped back to now — the hourly chart then showed
  // one absurd spike. So today's shift opens no later than two and a
  // half hours ago, its sales spread evenly from then until now, and
  // the count scales with how much of the trading day has passed.
  const NOMINAL_OPEN = new Date(dayBack(0)).setHours(8, 30, 0, 0);
  const todayOpen = new Date(Math.min(NOMINAL_OPEN, now.getTime() - 150 * 60_000));
  const todayElapsedH = (now.getTime() - todayOpen.getTime()) / 3_600_000;
  const todayFraction = Math.min(1, Math.max(0.3, todayElapsedH / 8.5));

  for (let d = DEMO_DAYS - 1; d >= 0; d--) {
    const date = dayBack(d);
    const dow = date.getDay(); // 0 Sun … 6 Sat
    if (dow === 0 && d !== 0) continue; // closed Sundays

    // Saturday is the week. Month-end (payday) lifts the last days.
    const busy = dow === 6 ? 1.9 : dow === 5 ? 1.3 : 1;
    const payday = date.getDate() >= 25 || date.getDate() <= 2 ? 1.35 : 1;
    const full = Math.max(2, Math.round((int(5, 9) * busy * payday) / 1.2));
    const target = d === 0 ? Math.max(3, Math.round(full * todayFraction)) : full;

    // Till 2 only opens when there is enough trade to justify it, but
    // today it always does — an owner looking at the live floor should
    // see a floor, not one lonely till.
    const twoTills = d === 0 || full > 9;
    const openTills = twoTills ? [TILLS[0], TILLS[1]] : [TILLS[0]];

    const daySessions: TillSession[] = openTills.map((till, i) => {
      const who = CASHIERS[(d + i) % CASHIERS.length];
      return {
        id: `dsess-${d}-${i}`,
        till_id: till.id,
        till_name: till.name,
        store_id: STORE.id,
        opened_by: who.id,
        opened_by_name: who.full_name,
        opened_at: (d === 0
          ? new Date(todayOpen.getTime() + i * 12 * 60_000)
          : at(d, 8, 30)
        ).toISOString(),
        opening_float: 100000,
        status: 'open',
      };
    });

    // Today's sales run from just after opening to a few minutes ago.
    const todayFrom = todayOpen.getTime() + 20 * 60_000;
    const todayTo = now.getTime() - 4 * 60_000;

    for (let i = 0; i < target; i++) {
      const s = daySessions[i % daySessions.length];
      let when: Date;
      if (d === 0) {
        const span = Math.max(60_000, todayTo - todayFrom);
        when = new Date(todayFrom + ((i + 0.5) / target) * span + (rand() - 0.5) * span * 0.12);
        if (when.getTime() > todayTo) when = new Date(todayTo);
      } else {
        // Trading hours with a lunchtime and a late-afternoon bump.
        const hour = pick([9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 15, 15, 16, 16, 17]);
        when = at(d, hour, int(0, 59));
      }
      if (when > now) continue;

      const lines: CartLine[] = [];
      const n = rand() < 0.45 ? 1 : rand() < 0.8 ? 2 : int(3, 4);
      for (let k = 0; k < n; k++) {
        const p = pick(weighted);
        if (lines.some((l) => l.product_id === p.id)) continue;
        lines.push({
          product_id: p.id, sku: p.sku, name: p.name, variant: p.variant,
          unit_price: p.sell_price,
          qty: p.sell_price > 50000 ? 1 : int(1, 3),
          discount: 0,
        });
      }
      if (!lines.length) continue;

      const total = lines.reduce((t, l) => t + l.unit_price * l.qty, 0);
      const r = rand();
      const payments: PaymentPart[] =
        r < 0.38
          ? [{ method: 'cash', amount: total }]
          : r < 0.94
            ? [{ method: 'card', amount: total, card_reference: 'yoco_' + Math.floor(rand() * 1e9).toString(36), card_last4: String(1000 + int(0, 8999)) }]
            : [
                { method: 'cash', amount: Math.round(total / 2) },
                { method: 'card', amount: total - Math.round(total / 2), card_reference: 'yoco_' + Math.floor(rand() * 1e9).toString(36), card_last4: String(1000 + int(0, 8999)) },
              ];

      const cash = payments.find((p) => p.method === 'cash')?.amount ?? 0;
      const roundedCash = cash > 0 ? Math.ceil(cash / 5000) * 5000 : undefined;

      // Who is buying. Regulars are three times as likely to be the
      // one at the counter as a one-off shopper.
      const joined = rand();
      const member =
        joined < 0.22 ? pick(regulars)
        : joined < 0.38 ? pick(members)
        : null;

      saleNo += 1;
      const sale: Sale = {
        id: 'dsale-' + saleNo,
        sale_number: 'S-' + (1000 + saleNo),
        store_id: STORE.id,
        till_id: s.till_id,
        till_session_id: s.id,
        cashier_id: s.opened_by,
        cashier_name: s.opened_by_name,
        // The phone is the primary capture now; email is the fallback
        // for the few who ask for it.
        customer_email: !member && rand() < 0.12 ? `customer${int(1, 400)}@gmail.com` : null,
        customer_phone: member?.phone ?? null,
        loyalty_member_id: member?.id ?? null,
        lines,
        payments,
        subtotal: total,
        discount_total: 0,
        tax_total: taxFromInclusive(total),
        total,
        cash_received: roundedCash,
        change_given: roundedCash != null ? roundedCash - cash : undefined,
        status: 'completed',
        created_at: when.toISOString(),
        synced: true,
      };
      sales.push(sale);

      for (const l of lines) {
        const p = PRODUCTS.find((x) => x.id === l.product_id)!;
        move(p, 'sale', -l.qty, 'Sold', sale.sale_number, s.opened_by, s.opened_by_name, when);
      }
    }

    // ── Close the day's shifts ──────────────────────────────
    for (const s of daySessions) {
      const mine = sales.filter((x) => x.till_session_id === s.id);
      const cashIn = mine
        .flatMap((x) => x.payments)
        .filter((p) => p.method === 'cash')
        .reduce((t, p) => t + p.amount, 0);
      const expected = s.opening_float + cashIn;

      if (d === 0) {
        // Today: the first till is still trading, the second cashed up.
        if (s.till_id === TILLS[0].id) {
          sessions.push(s);
          continue;
        }
      }

      // Most days balance. A shop that never varies is a shop nobody
      // believes — but the variances stay small and mostly short.
      const roll = rand();
      const variance =
        roll < 0.62 ? 0 : roll < 0.88 ? -int(1, 12) * 500 : int(1, 8) * 500;

      sessions.push({
        ...s,
        status: 'closed',
        closed_at: (d === 0
          ? new Date(Math.max(todayOpen.getTime() + 30 * 60_000, now.getTime() - 25 * 60_000))
          : at(d, 17, 45)
        ).toISOString(),
        closed_by: s.opened_by,
        closed_by_name: s.opened_by_name,
        expected_cash: expected,
        counted_cash: expected + variance,
        variance,
      });
    }
  }

  // ── Returns ─────────────────────────────────────────────────
  // Roughly one sale in thirty comes back. Reasons vary, and a
  // faulty item does NOT go back on the shelf.
  const returnable = sales.filter((s) => s.lines.length > 0);
  const returnCount = Math.max(6, Math.round(returnable.length * 0.03));
  // The vouchers screen has to have something on it, so the first two
  // eligible returns always go out as store credit rather than
  // leaving it to chance on a small sample.
  let vouchersIssued = 0;

  for (let i = 0; i < returnCount; i++) {
    const sale = returnable[Math.floor(rand() * returnable.length)];
    if (refunds.some((r) => r.sale_id === sale.id)) continue;

    const saleAt = new Date(sale.created_at).getTime();
    // Returns land 1–5 days after the sale, and never in the future.
    const when = new Date(Math.min(saleAt + int(1, 5) * 86_400_000, now.getTime() - 3_600_000));
    if (when.getTime() <= saleAt) continue;

    const line = sale.lines[0];
    const faulty = rand() < 0.3;
    const reason = faulty
      ? pick(['Faulty or damaged', 'Allergic reaction'])
      : pick(['Changed mind', 'Wrong shade / variant', 'Wrong item']);

    const asVoucher = !faulty && (vouchersIssued < 2 || rand() < 0.2);
    const staff = CASHIERS[int(0, CASHIERS.length - 1)];
    const amount = line.unit_price;

    refundNo += 1;
    const refundNumber = 'R-' + (2000 + refundNo);

    let voucherCode: string | null = null;
    if (asVoucher) {
      vouchersIssued += 1;
      const expires = new Date(when);
      expires.setFullYear(expires.getFullYear() + VOUCHER_VALID_YEARS);
      voucherCode = makeVoucherCode();
      creditNotes.push({
        id: 'dcn-' + refundNo,
        code: voucherCode,
        amount,
        remaining: amount,
        issued_from_refund: refundNumber,
        issued_at: when.toISOString(),
        expires_at: expires.toISOString(),
        status: 'active',
        synced: true,
      });
    }

    const rline: RefundLine = {
      product_id: line.product_id, sku: line.sku, name: line.name,
      variant: line.variant, unit_price: line.unit_price, qty: 1,
      amount, restock: !faulty,
    };

    refunds.push({
      id: 'dref-' + refundNo,
      refund_number: refundNumber,
      sale_id: sale.id,
      sale_number: sale.sale_number,
      store_id: STORE.id,
      till_id: sale.till_id,
      till_session_id: sale.till_session_id,
      staff_id: staff.id,
      staff_name: staff.full_name,
      credit_note_code: voucherCode,
      lines: [rline],
      total: amount,
      reason,
      method: asVoucher ? 'store_credit' : sale.payments[0].method === 'cash' ? 'cash' : 'card',
      created_at: when.toISOString(),
      synced: true,
    });

    const p = PRODUCTS.find((x) => x.id === line.product_id)!;
    if (!faulty) {
      move(p, 'refund', 1, 'Returned to shelf', refundNumber, staff.id, staff.full_name, when);
    }

    // A return past the 7-day window needs a manager. Show one.
    if ((when.getTime() - saleAt) / 86_400_000 > 7) {
      overrides.push({
        id: 'dov-' + refundNo,
        store_id: STORE.id,
        till_id: sale.till_id,
        till_session_id: sale.till_session_id,
        action: 'refund_outside_window',
        detail: `${(amount / 100).toFixed(2)} on ${sale.sale_number}`,
        requested_by: staff.id,
        requested_by_name: staff.full_name,
        approved_by: MANAGER.id,
        approved_by_name: MANAGER.full_name,
        created_at: when.toISOString(),
        synced: true,
      });
    }
  }

  // One voucher has been partly spent already. A list where every
  // voucher is pristine reads as a list nobody has ever used.
  if (creditNotes.length > 1) {
    const v = creditNotes[1];
    v.remaining = Math.round(v.amount * 0.4);
  }

  // ── Goods in ────────────────────────────────────────────────
  const deliveryPlan: { daysAgo: number; supplier: string; invoice: string; short?: boolean }[] = [
    { daysAgo: 21, supplier: 'Beauty Wholesale SA', invoice: 'BW-40912' },
    { daysAgo: 12, supplier: 'NailPro Supplies', invoice: 'NP-7781', short: true },
    { daysAgo: 4, supplier: 'GlowSkin Wholesale', invoice: 'GS-2214' },
  ];

  deliveryPlan.forEach((plan, idx) => {
    const when = at(plan.daysAgo, 10, int(0, 45));
    const picks: Product[] = [];
    while (picks.length < 4) {
      const p = pick(PRODUCTS);
      if (!picks.some((x) => x.id === p.id)) picks.push(p);
    }

    const lines = picks.map((p, i) => {
      const counted = int(6, 24);
      // Exactly one line on one delivery arrives short of the invoice.
      const invoiced = plan.short && i === 0 ? counted + 2 : counted;
      return {
        product_id: p.id, sku: p.sku, name: p.name, variant: p.variant,
        qty: counted, qty_invoiced: invoiced, unit_cost: p.cost_price,
      };
    });

    const number = 'GRN-' + (500 + idx + 1);
    deliveries.push({
      id: 'ddel-' + (idx + 1),
      delivery_number: number,
      supplier: plan.supplier,
      invoice_ref: plan.invoice,
      store_id: STORE.id,
      received_by: STOCK_CTRL.id,
      received_by_name: STOCK_CTRL.full_name,
      lines,
      total_cost: lines.reduce((t, l) => t + l.qty * l.unit_cost, 0),
      discrepancy_units: lines.reduce((t, l) => t + (l.qty_invoiced - l.qty), 0),
      created_at: when.toISOString(),
      synced: true,
    });

    for (const l of lines) {
      const p = PRODUCTS.find((x) => x.id === l.product_id)!;
      move(p, 'receive', l.qty, `From ${plan.supplier}`, number, STOCK_CTRL.id, STOCK_CTRL.full_name, when, l.unit_cost);
    }
  });

  // ── Shrinkage ───────────────────────────────────────────────
  const damages: [number, string, number][] = [
    [18, 'Broken in store', 1],
    [15, 'Used as a tester', 2],
    [9, 'Expired', 3],
    [6, 'Leaking or spoiled', 1],
    [2, 'Used as a tester', 1],
  ];
  damages.forEach(([daysAgo, reason, qty], i) => {
    const p = pick(PRODUCTS);
    move(p, 'damage', -qty, reason, 'WO-' + (100 + i), STOCK_CTRL.id, STOCK_CTRL.full_name, at(daysAgo, 11, int(0, 50)));
  });

  move(
    PRODUCTS[3], 'adjust', 2, 'Stock take correction', 'ADJ-1',
    STOCK_CTRL.id, STOCK_CTRL.full_name, at(7, 16, 20)
  );

  // ── The points ledger ───────────────────────────────────────
  // Walked chronologically so every balance_after follows from the one
  // before it, exactly like the stock ledger. A points balance nobody
  // can explain is a balance a customer will argue with at the counter.
  const loyaltyLedger: LoyaltyTxn[] = [];
  const byMember = new Map(members.map((m) => [m.id, m]));

  type PointEvent = { at: number; kind: 'earn' | 'refund'; memberId: string; amount: number; ref: string; staff: { id: string; name: string } };
  const pointEvents: PointEvent[] = [];

  for (const sale of sales) {
    if (!sale.loyalty_member_id) continue;
    pointEvents.push({
      at: new Date(sale.created_at).getTime(),
      kind: 'earn',
      memberId: sale.loyalty_member_id,
      amount: sale.total,
      ref: sale.sale_number,
      staff: { id: sale.cashier_id, name: sale.cashier_name },
    });
  }
  for (const r of refunds) {
    const sale = sales.find((x) => x.id === r.sale_id);
    if (!sale?.loyalty_member_id) continue;
    pointEvents.push({
      at: new Date(r.created_at).getTime(),
      kind: 'refund',
      memberId: sale.loyalty_member_id,
      amount: r.total,
      ref: r.refund_number,
      staff: { id: r.staff_id, name: r.staff_name },
    });
  }
  pointEvents.sort((a, b) => a.at - b.at);

  let ltId = 0;
  for (const e of pointEvents) {
    const m = byMember.get(e.memberId);
    if (!m) continue;
    const when = new Date(e.at).toISOString();

    if (e.kind === 'earn') {
      const earned = pointsFor(e.amount);
      m.lifetime_spend += e.amount;
      m.last_seen_at = when;
      const sale = sales.find((x) => x.sale_number === e.ref);
      if (sale) sale.points_earned = earned;
      if (earned <= 0) continue;
      m.points += earned;
      loyaltyLedger.push({
        id: 'dlt-' + ++ltId, member_id: m.id, phone: m.phone,
        points: earned, balance_after: m.points, reason: 'earn',
        reference: e.ref, staff_id: e.staff.id, staff_name: e.staff.name,
        created_at: when, synced: true,
      });

      // Most regulars cash in as soon as they can. Some sit on it.
      if (m.points >= POINTS_PER_VOUCHER && rand() < 0.55) {
        const expires = new Date(e.at);
        expires.setFullYear(expires.getFullYear() + VOUCHER_VALID_YEARS);
        const code = makeVoucherCode();
        const amount = VOUCHER_RAND_PER_REDEMPTION * 100;
        m.points -= POINTS_PER_VOUCHER;
        creditNotes.push({
          id: 'dcnl-' + ltId, code, amount,
          // Some have already been spent against a later sale.
          remaining: rand() < 0.4 ? 0 : amount,
          issued_from_refund: 'LOYALTY',
          issued_at: when,
          expires_at: expires.toISOString(),
          status: rand() < 0.4 ? 'redeemed' : 'active',
          synced: true,
        });
        loyaltyLedger.push({
          id: 'dlt-' + ++ltId, member_id: m.id, phone: m.phone,
          points: -POINTS_PER_VOUCHER, balance_after: m.points, reason: 'redeem',
          reference: code, staff_id: e.staff.id, staff_name: e.staff.name,
          created_at: when, synced: true,
        });
      }
    } else {
      // Points earned on money handed back are points never owed.
      const clawback = Math.min(m.points, pointsFor(e.amount));
      if (clawback <= 0) continue;
      m.points -= clawback;
      loyaltyLedger.push({
        id: 'dlt-' + ++ltId, member_id: m.id, phone: m.phone,
        points: -clawback, balance_after: m.points, reason: 'refund',
        reference: e.ref, staff_id: e.staff.id, staff_name: e.staff.name,
        created_at: when, synced: true,
      });
    }
  }

  // Anyone who never actually shopped is not a member. A list padded
  // with zero-spend records makes the liability figure meaningless.
  const activeMembers = members.filter((m) => m.lifetime_spend > 0);

  // ── Who signed in ───────────────────────────────────────────
  const logins: LoginEvent[] = [];
  let lgId = 0;
  for (const sess of sessions) {
    const who = STAFF.find((x) => x.id === sess.opened_by)!;
    logins.push({
      id: 'dlg-' + ++lgId,
      staff_id: who.id, staff_name: who.full_name, role: who.role,
      surface: 'till', till_id: sess.till_id, till_name: sess.till_name,
      signed_in_at: new Date(new Date(sess.opened_at).getTime() - 60_000).toISOString(),
      signed_out_at: sess.closed_at ?? null,
      ended: sess.closed_at ? 'signed_out' : 'still_active',
      synced: true,
    });
  }
  // Back-office sessions: the stock controller most mornings, the
  // manager most evenings, and the owner at odd hours because owners do.
  for (let d = DEMO_DAYS - 1; d >= 0; d--) {
    if (dayBack(d).getDay() === 0) continue;
    const office: [typeof STOCK_CTRL, number, number][] = [];
    if (rand() < 0.8) office.push([STOCK_CTRL, 8, int(20, 70)]);
    if (rand() < 0.7) office.push([MANAGER, 17, int(15, 55)]);
    if (rand() < 0.22) office.push([STAFF.find((x) => x.role === 'admin')!, 21, int(10, 40)]);
    for (const [who, hour, mins] of office) {
      const inAt = at(d, hour, int(0, 45));
      if (inAt > now) continue;
      const outAt = new Date(Math.min(inAt.getTime() + mins * 60_000, now.getTime()));
      logins.push({
        id: 'dlg-' + ++lgId,
        staff_id: who.id, staff_name: who.full_name, role: who.role,
        surface: 'office', till_id: null, till_name: null,
        signed_in_at: inAt.toISOString(),
        signed_out_at: outAt.toISOString(),
        ended: 'signed_out',
        synced: true,
      });
    }
  }
  logins.sort((a, b) => +new Date(b.signed_in_at) - +new Date(a.signed_in_at));

  // ── Chain the ledger ────────────────────────────────────────
  // Walk each product's movements in order, choosing an opening
  // balance such that the final balance IS the seeded stock level.
  // That way the out-of-stock frontal is out because it sold out.
  raw.sort((a, b) => a._t - b._t);
  const stockMovements: StockMovement[] = [];
  const products: Product[] = PRODUCTS.map((p) => ({ ...p }));

  for (const p of products) {
    const mine = raw.filter((m) => m.product_id === p.id);
    const netDelta = mine.reduce((t, m) => t + m.qty, 0);
    let balance = Math.max(0, p.stock - netDelta);
    for (const m of mine) {
      balance = Math.max(0, balance + m.qty);
      const { _t, ...rest } = m;
      stockMovements.push({ ...rest, balance_after: balance });
    }
    // The walk lands on the seeded level by construction; assigning it
    // explicitly guards against the Math.max clamp above drifting.
    p.stock = mine.length ? balance : p.stock;
  }

  // ── Stock alerts ────────────────────────────────────────────
  // Raised from the final shelf levels, dated to the movement that
  // actually took each product under its line — so the bell shows the
  // sale that caused it, not "the demo loaded".
  const alerts: StockAlert[] = [];
  for (const p of products) {
    const line = alertThreshold(p, DEFAULT_LOW_STOCK_THRESHOLD);
    if (p.stock > line) continue;
    const last = stockMovements
      .filter((m) => m.product_id === p.id)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
    alerts.push({
      id: 'dalr-' + p.id,
      kind: p.stock <= 0 ? 'out_of_stock' : 'low_stock',
      product_id: p.id, sku: p.sku, name: p.name, variant: p.variant,
      level: p.stock,
      threshold: line,
      trigger: last?.reference || 'Stock take',
      roles: STOCK_ALERT_ROLES,
      created_at: last?.created_at ?? now.toISOString(),
      read_by: [],
      resolved_at: null,
      synced: true,
    });
  }
  alerts.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  stockMovements.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  sales.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  refunds.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  sessions.sort((a, b) => +new Date(b.opened_at) - +new Date(a.opened_at));
  overrides.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  deliveries.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  creditNotes.sort((a, b) => +new Date(b.issued_at) - +new Date(a.issued_at));

  return {
    products,
    sales,
    refunds,
    creditNotes,
    sessions,
    // The live slot: today's open shift on Till 1, if there is one.
    session: sessions.find((s) => s.status === 'open') ?? null,
    overrides,
    stockMovements,
    deliveries,
    loyaltyMembers: activeMembers.sort((a, b) => b.points - a.points),
    loyaltyLedger: loyaltyLedger.sort(
      (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
    ),
    alerts,
    logins,
  };
}
