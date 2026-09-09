'use client';

import { useMemo, useState } from 'react';
import { Download, TrendingUp, PackageSearch } from 'lucide-react';
import { usePos } from '@/lib/store';
import { money, deliveryAccuracy } from '@/lib/types';
import { Page, Stat, Table, Empty, Segmented } from '@/components/ui/Page';

type Tab = 'sales' | 'stock';
type Range = 'today' | 'week' | 'month' | 'all';

const TABS: { key: Tab; label: string }[] = [
  { key: 'sales', label: 'Sales' },
  { key: 'stock', label: 'Stock control' },
];

const RANGES: { key: Range; label: string; days: number }[] = [
  { key: 'today', label: 'Today', days: 0 },
  { key: 'week', label: 'Last 7 days', days: 7 },
  { key: 'month', label: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', days: 9999 },
];

function cutoffFor(range: Range) {
  const cfg = RANGES.find((r) => r.key === range)!;
  const c = new Date();
  if (cfg.days === 0) c.setHours(0, 0, 0, 0);
  else c.setDate(c.getDate() - cfg.days);
  return c;
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('sales');
  return (
    <Page
      title="Reports"
      subtitle="Where the money and the stock actually went"
      actions={<Segmented value={tab} onChange={setTab} options={TABS} />}
    >
      {tab === 'sales' ? <SalesReport /> : <StockReport />}
    </Page>
  );
}

// ═══ SALES ═════════════════════════════════════════════════════

function SalesReport() {
  const sales = usePos((s) => s.sales);
  const products = usePos((s) => s.products);
  const allRefunds = usePos((s) => s.refunds);
  const [range, setRange] = useState<Range>('week');

  const filtered = useMemo(
    () => sales.filter((s) => new Date(s.created_at) >= cutoffFor(range)),
    [sales, range]
  );
  const periodRefunds = useMemo(
    () => allRefunds.filter((r) => new Date(r.created_at) >= cutoffFor(range)),
    [allRefunds, range]
  );

  const totals = useMemo(() => {
    const refunded = periodRefunds.reduce((s, r) => s + r.total, 0);
    const revenue = filtered.reduce((s, x) => s + x.total, 0) - refunded;
    const vat = filtered.reduce((s, x) => s + x.tax_total, 0);
    const units = filtered.reduce((s, x) => s + x.lines.reduce((n, l) => n + l.qty, 0), 0);

    // Needs cost price, which is why cashiers cannot open this page.
    const cost = filtered.reduce(
      (s, x) =>
        s + x.lines.reduce((n, l) => {
          const p = products.find((pp) => pp.id === l.product_id);
          return n + (p?.cost_price ?? 0) * l.qty;
        }, 0),
      0
    );
    const exVat = revenue - vat;
    const profit = exVat - cost;

    return {
      revenue, vat, units, profit, refunded,
      margin: exVat ? Math.round((profit / exVat) * 100) : 0,
      avg: filtered.length ? Math.round(revenue / filtered.length) : 0,
    };
  }, [filtered, products, periodRefunds]);

  const byProduct = useMemo(() => {
    const tally = new Map<string, { name: string; units: number; revenue: number; profit: number }>();
    for (const s of filtered) {
      for (const l of s.lines) {
        const p = products.find((pp) => pp.id === l.product_id);
        const row = tally.get(l.product_id) ?? {
          name: `${l.name} ${l.variant}`.trim(), units: 0, revenue: 0, profit: 0,
        };
        const rev = l.unit_price * l.qty - l.discount;
        row.units += l.qty;
        row.revenue += rev;
        row.profit += rev - rev * 0.15 - (p?.cost_price ?? 0) * l.qty;
        tally.set(l.product_id, row);
      }
    }
    return [...tally.values()].sort((a, b) => b.revenue - a.revenue);
  }, [filtered, products]);

  const exportCsv = () => {
    const header = 'Receipt,Date,Cashier,Items,Payment,Subtotal,VAT,Total\n';
    const body = filtered.map((s) => [
      s.sale_number, new Date(s.created_at).toISOString(), s.cashier_name,
      s.lines.reduce((n, l) => n + l.qty, 0),
      s.payments.length > 1 ? 'split' : s.payments[0]?.method,
      (s.subtotal / 100).toFixed(2), (s.tax_total / 100).toFixed(2), (s.total / 100).toFixed(2),
    ].join(',')).join('\n');

    const url = URL.createObjectURL(new Blob([header + body], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <Segmented value={range} onChange={setRange} options={RANGES} />
        <button className="btn-ghost sm:ml-auto" onClick={exportCsv} disabled={!filtered.length}>
          <Download size={15} /> CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <Empty message="No sales in this period." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2.5 sm:gap-3 mb-5">
            <Stat label="Revenue" value={money(totals.revenue)} hint="net of returns" />
            <Stat label="Transactions" value={String(filtered.length)} />
            <Stat label="Avg basket" value={money(totals.avg)} />
            <Stat label="Units" value={String(totals.units)} />
            <Stat label="VAT collected" value={money(totals.vat)} hint="Owed to SARS" />
            <Stat label="Gross profit" value={money(totals.profit)} tone="ok" />
            <Stat label="Margin" value={`${totals.margin}%`}
                  tone={totals.margin >= 40 ? 'ok' : 'warn'} />
          </div>

          <div className="font-medium mb-3">Product performance</div>
          <Table head={[
            'Product',
            { l: 'Units', cls: 'hidden md:table-cell' },
            'Revenue',
            { l: 'Gross profit', cls: 'hidden lg:table-cell' },
          ]}>
            {byProduct.map((p) => (
              <tr key={p.name} className="row">
                <td className="td font-medium">{p.name}</td>
                <td className="td num text-dim hidden md:table-cell">{p.units}</td>
                <td className="td num">{money(p.revenue)}</td>
                <td className="td num text-ok hidden lg:table-cell">
                  {money(Math.round(p.profit))}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}

// ═══ STOCK CONTROL ═════════════════════════════════════════════
//
//  "Is stock being taken in correctly?" is three separate questions,
//  and none of them appear in a sales report:
//
//    1. Do deliveries match the invoice?   → short-shipping
//    2. Are costs creeping up?             → quiet price rises
//    3. What are we losing, and who is
//       correcting the numbers?            → shrinkage
//
//  All three are only answerable because every stock change now
//  writes a ledger row.

function StockReport() {
  const movements = usePos((s) => s.stockMovements);
  const deliveries = usePos((s) => s.deliveries);
  const products = usePos((s) => s.products);
  const [range, setRange] = useState<Range>('month');

  const since = cutoffFor(range);
  const mv = useMemo(
    () => movements.filter((m) => new Date(m.created_at) >= since),
    [movements, range] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const dl = useMemo(
    () => deliveries.filter((d) => new Date(d.created_at) >= since),
    [deliveries, range] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const costOf = (product_id: string) =>
    products.find((p) => p.id === product_id)?.cost_price ?? 0;

  const totals = useMemo(() => {
    const damage = mv.filter((m) => m.type === 'damage');
    const adjustDown = mv.filter((m) => m.type === 'adjust' && m.qty < 0);
    return {
      received: mv.filter((m) => m.type === 'receive').reduce((n, m) => n + m.qty, 0),
      spend: dl.reduce((n, d) => n + d.total_cost, 0),
      shortUnits: dl.reduce((n, d) => n + Math.max(0, d.discrepancy_units), 0),
      shortDeliveries: dl.filter((d) => deliveryAccuracy(d) === 'short').length,
      damageUnits: damage.reduce((n, m) => n + Math.abs(m.qty), 0),
      damageValue: damage.reduce((n, m) => n + costOf(m.product_id) * Math.abs(m.qty), 0),
      adjustCount: mv.filter((m) => m.type === 'adjust').length,
      adjustLossValue: adjustDown.reduce((n, m) => n + costOf(m.product_id) * Math.abs(m.qty), 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mv, dl, products]);

  // ── delivery accuracy by supplier ──
  const bySupplier = useMemo(() => {
    const t = new Map<string, { deliveries: number; units: number; short: number; spend: number }>();
    for (const d of dl) {
      const row = t.get(d.supplier) ?? { deliveries: 0, units: 0, short: 0, spend: 0 };
      row.deliveries += 1;
      row.units += d.lines.reduce((n, l) => n + l.qty, 0);
      row.short += Math.max(0, d.discrepancy_units);
      row.spend += d.total_cost;
      t.set(d.supplier, row);
    }
    return [...t.entries()]
      .map(([supplier, r]) => ({
        supplier, ...r,
        accuracy: r.units + r.short > 0
          ? Math.round((r.units / (r.units + r.short)) * 100)
          : 100,
      }))
      .sort((a, b) => a.accuracy - b.accuracy);
  }, [dl]);

  // ── cost creep: this delivery's unit cost vs the one before ──
  const costChanges = useMemo(() => {
    const byProduct = new Map<string, { name: string; variant: string; costs: number[] }>();
    for (const m of [...movements].reverse()) {
      if (m.type !== 'receive' || m.unit_cost == null) continue;
      const row = byProduct.get(m.product_id) ?? { name: m.name, variant: m.variant, costs: [] };
      row.costs.push(m.unit_cost);
      byProduct.set(m.product_id, row);
    }
    return [...byProduct.values()]
      .filter((r) => r.costs.length >= 2)
      .map((r) => {
        const latest = r.costs[r.costs.length - 1];
        const previous = r.costs[r.costs.length - 2];
        return {
          name: `${r.name} ${r.variant}`.trim(),
          previous, latest,
          change: latest - previous,
          pct: previous ? Math.round(((latest - previous) / previous) * 100) : 0,
        };
      })
      .filter((r) => r.change !== 0)
      .sort((a, b) => b.pct - a.pct);
  }, [movements]);

  // ── who is moving stock by hand ──
  const byPerson = useMemo(() => {
    const t = new Map<string, { adjust: number; damage: number; units: number }>();
    for (const m of mv) {
      if (m.type !== 'adjust' && m.type !== 'damage') continue;
      const row = t.get(m.staff_name) ?? { adjust: 0, damage: 0, units: 0 };
      if (m.type === 'adjust') row.adjust += 1;
      else row.damage += 1;
      row.units += Math.abs(m.qty);
      t.set(m.staff_name, row);
    }
    return [...t.entries()]
      .map(([name, r]) => ({ name, ...r }))
      .sort((a, b) => b.adjust + b.damage - (a.adjust + a.damage));
  }, [mv]);

  // ── what is being written off most ──
  const damageByProduct = useMemo(() => {
    const t = new Map<string, { name: string; units: number; value: number; reasons: Set<string> }>();
    for (const m of mv) {
      if (m.type !== 'damage') continue;
      const row = t.get(m.product_id) ?? {
        name: `${m.name} ${m.variant}`.trim(), units: 0, value: 0, reasons: new Set<string>(),
      };
      row.units += Math.abs(m.qty);
      row.value += costOf(m.product_id) * Math.abs(m.qty);
      if (m.reason) row.reasons.add(m.reason);
      t.set(m.product_id, row);
    }
    return [...t.values()].sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mv, products]);

  if (movements.length === 0) {
    return (
      <Empty message="No stock movements yet. Record a delivery or ring up a sale and this fills in." />
    );
  }

  return (
    <>
      <div className="mb-5">
        <Segmented value={range} onChange={setRange} options={RANGES} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3 mb-5">
        <Stat label="Units received" value={String(totals.received)} />
        <Stat label="Spent on stock" value={money(totals.spend)} />
        <Stat label="Short deliveries" value={String(totals.shortDeliveries)}
              tone={totals.shortDeliveries ? 'warn' : undefined} />
        <Stat label="Units never arrived" value={String(totals.shortUnits)}
              tone={totals.shortUnits ? 'bad' : undefined} hint="Invoiced but not delivered" />
        <Stat label="Written off" value={money(totals.damageValue)}
              tone={totals.damageValue ? 'bad' : undefined}
              hint={`${totals.damageUnits} units, at cost`} />
        <Stat label="Hand adjustments" value={String(totals.adjustCount)}
              tone={totals.adjustCount > 5 ? 'warn' : undefined}
              hint={totals.adjustLossValue ? `${money(totals.adjustLossValue)} written down` : undefined} />
      </div>

      {/* ── 1. Are deliveries honest? ── */}
      <div className="font-medium mb-3">Delivery accuracy by supplier</div>
      {bySupplier.length === 0 ? (
        <Empty message="No deliveries in this period." />
      ) : (
        <Table head={[
          'Supplier', 'Deliveries',
          { l: 'Units in', cls: 'hidden md:table-cell' },
          'Units short', { l: 'Spend', cls: 'hidden lg:table-cell' }, 'Accuracy',
        ]}>
          {bySupplier.map((s) => (
            <tr key={s.supplier} className="row">
              <td className="td font-medium">{s.supplier}</td>
              <td className="td num text-dim">{s.deliveries}</td>
              <td className="td num text-dim hidden md:table-cell">{s.units}</td>
              <td className={`td num ${s.short ? 'text-bad font-medium' : 'text-dim'}`}>
                {s.short || '—'}
              </td>
              <td className="td num text-dim hidden lg:table-cell">{money(s.spend)}</td>
              <td className="td">
                <span className={s.accuracy === 100 ? 'chip-ok' : s.accuracy >= 95 ? 'chip-warn' : 'chip-bad'}>
                  {s.accuracy}%
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Note icon={PackageSearch}>
        Anything under 100% means you paid for stock that never reached the shelf. One
        short delivery is a picking error; the same supplier short every month is a
        conversation, and it is worth having with the numbers in front of you.
      </Note>

      {/* ── 2. Are costs creeping? ── */}
      {costChanges.length > 0 && (
        <div className="mt-6">
          <div className="font-medium mb-3">Cost price changes</div>
          <Table head={['Product', 'Was', 'Now', 'Change', 'Move']}>
            {costChanges.map((c) => (
              <tr key={c.name} className="row">
                <td className="td font-medium">{c.name}</td>
                <td className="td num text-dim">{money(c.previous)}</td>
                <td className="td num">{money(c.latest)}</td>
                <td className={`td num font-medium ${c.change > 0 ? 'text-bad' : 'text-ok'}`}>
                  {c.change > 0 ? '+' : ''}{money(c.change)}
                </td>
                <td className="td">
                  <span className={c.pct > 0 ? 'chip-bad' : 'chip-ok'}>
                    {c.pct > 0 ? '+' : ''}{c.pct}%
                  </span>
                </td>
              </tr>
            ))}
          </Table>
          <Note icon={TrendingUp}>
            A cost rise you have not passed on is a margin cut you did not agree to.
            Check these against your selling prices on the Products page.
          </Note>
        </div>
      )}

      {/* ── 3. What are we losing? ── */}
      {damageByProduct.length > 0 && (
        <div className="mt-6">
          <div className="font-medium mb-3">Losses by product</div>
          <Table head={[
            'Product', 'Units', 'Value at cost',
            { l: 'Reasons', cls: 'hidden lg:table-cell' },
          ]}>
            {damageByProduct.map((d) => (
              <tr key={d.name} className="row">
                <td className="td font-medium">{d.name}</td>
                <td className="td num text-bad">{d.units}</td>
                <td className="td num">{money(d.value)}</td>
                <td className="td text-dim hidden lg:table-cell">
                  {[...d.reasons].join(', ')}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {/* ── 4. Who is moving stock by hand? ── */}
      {byPerson.length > 0 && (
        <div className="mt-6">
          <div className="font-medium mb-3">Manual stock changes by person</div>
          <Table head={['Person', 'Adjustments', 'Write-offs', 'Units moved']}>
            {byPerson.map((p) => (
              <tr key={p.name} className="row">
                <td className="td font-medium">{p.name}</td>
                <td className="td num">{p.adjust || '—'}</td>
                <td className="td num">{p.damage || '—'}</td>
                <td className="td num text-dim">{p.units}</td>
              </tr>
            ))}
          </Table>
          <Note icon={PackageSearch}>
            Deliveries and sales move stock on their own. Anything in this table is a
            human overriding the system. That is legitimate work — but one person doing
            far more of it than everyone else is worth a look, whether it turns out to be
            a training gap or something worse.
          </Note>
        </div>
      )}
    </>
  );
}

function Note({ icon: Icon, children }: { icon: typeof TrendingUp; children: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-raised border border-line text-2xs text-dim leading-relaxed">
      <Icon size={14} className="flex-none mt-0.5" />
      <span>{children}</span>
    </div>
  );
}
