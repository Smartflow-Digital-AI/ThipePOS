'use client';

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW — the owner's screen
//
// Everything else in this app is a job: ring up, receive, refund.
// This is the only screen that exists to answer a question, and the
// question is always one of four:
//
//   Is the shop trading right now, and how?      → Live floor
//   Did we make money, and more than last week?  → Headline + trend
//   Is anything wrong?                           → Needs attention
//   What is making the money, and who?           → Products, people
//
// It refreshes itself every 20 seconds. An owner leaves this open on
// a laptop in the back and glances at it — if they have to press
// something to see the truth, they will stop looking.
//
// No number is computed in this file. All of it comes from
// lib/analytics.ts, so Reports and this screen can never disagree.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowRight, Banknote, Boxes, CircleAlert, CreditCard,
  Info, Package, Receipt, RotateCcw, ShieldCheck, Ticket, Truck, Trash2,
} from 'lucide-react';
import { usePos } from '@/lib/store';
import { money, stockStatus, MOVEMENT_LABEL } from '@/lib/types';
import { Page } from '@/components/ui/Page';
import { Bars, Delta, LiveDot, RankBars } from '@/components/ui/Chart';
import {
  RANGES, rangeBounds, metrics, delta, dailySeries, hourlySeries,
  productPerformance, byCategory, staffPerformance, tillCards, alerts,
  stockSummary, ago, addDays, startOfDay,
  type RangeKey, type ProductRow, type Alert,
} from '@/lib/analytics';
import { TILLS, STORE } from '@/lib/data/seed';

const REFRESH_MS = 20_000;

type SortKey = 'units' | 'revenue' | 'profit' | 'margin' | 'cover';

export default function OverviewPage() {
  const {
    sales, refunds, products, sessions, creditNotes,
    overrides, stockMovements, deliveries,
  } = usePos();
  const unsyncedCount = usePos((s) => s.unsyncedCount);

  const [range, setRange] = useState<RangeKey>('today');
  const [sort, setSort] = useState<SortKey>('profit');
  const [showAllProducts, setShowAllProducts] = useState(false);

  // The live pulse. Nothing here polls a server — the store is local
  // and Supabase pushes into it — so this only re-runs the maths so
  // that "4 min ago" and today's boundary stay honest.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const b = useMemo(() => rangeBounds(range, now), [range, now]);

  const cur = useMemo(
    () => metrics(sales, refunds, products, b.from, b.to),
    [sales, refunds, products, b]
  );
  const prev = useMemo(
    () => metrics(sales, refunds, products, b.prevFrom, b.prevTo),
    [sales, refunds, products, b]
  );

  // The trend is deliberately NOT tied to the range picker. A shop
  // owner looking at today still wants to know whether today is good.
  const trendDays = Math.max(b.days, 14);
  const trend = useMemo(
    () =>
      dailySeries(sales, refunds, products, {
        ...b,
        days: trendDays,
        from: startOfDay(addDays(now, -(trendDays - 1))),
      }),
    [sales, refunds, products, b, trendDays, now]
  );

  const hours = useMemo(() => hourlySeries(sales, b.from, b.to), [sales, b]);

  const rows = useMemo(
    () => productPerformance(sales, refunds, products, b),
    [sales, refunds, products, b]
  );
  const cats = useMemo(() => byCategory(rows), [rows]);
  const people = useMemo(
    () => staffPerformance(sales, refunds, sessions, overrides, b),
    [sales, refunds, sessions, overrides, b]
  );
  const tills = useMemo(
    () => tillCards(TILLS, sessions, sales, refunds, now.getTime()),
    [sessions, sales, refunds, now]
  );
  const stock = useMemo(() => stockSummary(products, rows), [products, rows]);

  const attention = useMemo(
    () =>
      alerts({
        products, sales, refunds, sessions,
        vouchers: creditNotes, overrides, movements: stockMovements,
        deliveries, tills, unsynced: unsyncedCount(), now,
      }),
    [products, sales, refunds, sessions, creditNotes, overrides,
     stockMovements, deliveries, tills, unsyncedCount, now]
  );

  const feed = useMemo(
    () => activityFeed({ sales, refunds, deliveries, stockMovements, overrides, sessions }),
    [sales, refunds, deliveries, stockMovements, overrides, sessions]
  );

  const sorted = useMemo(() => {
    const traded = rows.filter((r) => r.units !== 0 || r.returned !== 0);
    const cmp: Record<SortKey, (a: ProductRow, z: ProductRow) => number> = {
      units:   (a, z) => z.units - a.units,
      revenue: (a, z) => z.revenue - a.revenue,
      profit:  (a, z) => z.profit - a.profit,
      margin:  (a, z) => z.margin - a.margin,
      // Least cover first — that is the reorder list.
      cover:   (a, z) => (a.daysCover ?? 1e9) - (z.daysCover ?? 1e9),
    };
    return [...traded].sort(cmp[sort]);
  }, [rows, sort]);

  const openTills = tills.filter((t) => t.status === 'open');
  const inDrawers = openTills.reduce((n, t) => n + t.expectedCash, 0);

  return (
    <Page
      title="Overview"
      subtitle={`${STORE.name} · live at ${now.toLocaleTimeString('en-ZA', {
        hour: '2-digit', minute: '2-digit',
      })}`}
      actions={
        <>
          <span className="chip-mute" title={`Refreshes every ${REFRESH_MS / 1000}s`}>
            <LiveDot /> Live
          </span>
          <div className="seg">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={range === r.key ? 'seg-item seg-item-on' : 'seg-item'}
              >
                {r.label}
              </button>
            ))}
          </div>
        </>
      }
    >
      {/* ═══ LIVE FLOOR ═══════════════════════════════════════ */}
      <Section
        title="On the floor"
        note={
          openTills.length
            ? `${openTills.length} of ${tills.length} tills open · ${money(inDrawers)} in drawers`
            : 'All tills closed'
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
        {tills.map((t) => (
          <TillCardView key={t.id} t={t} />
        ))}
      </div>

      {/* ═══ HEADLINE ═════════════════════════════════════════ */}
      <Section
        title={b.label === 'Today' ? 'Today' : `Last ${b.label}`}
        note={`compared with the previous ${b.days === 1 ? 'day' : `${b.days} days`}`}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Kpi
          label="Net revenue"
          value={money(cur.revenue)}
          delta={delta(cur.revenue, prev.revenue)}
          hint={cur.refunded ? `${money(cur.gross)} sold, ${money(cur.refunded)} returned` : 'no returns'}
          big
        />
        <Kpi
          label="Gross profit"
          value={money(cur.profit)}
          delta={delta(cur.profit, prev.profit)}
          hint={`after ${money(cur.cost)} of stock`}
          big
        />
        <Kpi
          label="Margin"
          value={`${cur.margin.toFixed(1)}%`}
          // Percentage points, not percentage change — see Delta.
          delta={prev.saleCount ? cur.margin - prev.margin : null}
          deltaIsPoints
          hint={prev.saleCount ? `was ${prev.margin.toFixed(1)}%` : undefined}
          big
        />
        <Kpi
          label="Transactions"
          value={String(cur.saleCount)}
          delta={delta(cur.saleCount, prev.saleCount)}
          hint={`${cur.units} units`}
          big
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <Kpi label="Avg basket" value={money(cur.avgBasket)} delta={delta(cur.avgBasket, prev.avgBasket)} />
        <Kpi label="Cash taken" value={money(cur.cash)} icon={<Banknote size={13} />} />
        <Kpi label="Card taken" value={money(cur.card)} icon={<CreditCard size={13} />} />
        <Kpi label="Vouchers spent" value={money(cur.voucher)} icon={<Ticket size={13} />} />
        <Kpi
          label="Return rate"
          value={`${cur.returnRate.toFixed(1)}%`}
          delta={prev.saleCount ? cur.returnRate - prev.returnRate : null}
          deltaIsPoints
          invertDelta
          tone={cur.returnRate > 5 ? 'warn' : undefined}
          hint={cur.refundCount ? `${cur.refundCount} return${cur.refundCount === 1 ? '' : 's'}` : 'none'}
        />
      </div>

      {/* ═══ TREND + HOURS ════════════════════════════════════ */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-6">
        <div className="card p-5">
          <CardHead title="Revenue trend" note={`last ${trendDays} days`} />
          <Bars
            data={trend.map((p) => ({ key: p.key, label: p.label, value: p.revenue, sub: p.sales }))}
            format={money}
            formatSub={(n) => `${n} sale${n === 1 ? '' : 's'}`}
            emptyMessage="No trading recorded yet"
          />
        </div>
        <div className="card p-5">
          <CardHead
            title="Trading by hour"
            note={b.label === 'Today' ? 'today' : `across ${b.label.toLowerCase()}`}
          />
          <Bars
            data={hours.map((p) => ({ key: p.key, label: p.label, value: p.revenue, sub: p.sales }))}
            format={money}
            formatSub={(n) => `${n} sale${n === 1 ? '' : 's'}`}
            emptyMessage="No sales in this window"
          />
        </div>
      </div>

      {/* ═══ ATTENTION + FEED ═════════════════════════════════ */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-6">
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-line flex items-center justify-between">
            <div className="font-medium">Needs attention</div>
            {attention.length > 0 && (
              <span className={attention.some((a) => a.level === 'bad') ? 'chip-bad' : 'chip-warn'}>
                {attention.length}
              </span>
            )}
          </div>
          {attention.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-sm text-ok font-medium mb-1">Everything looks fine</div>
              <div className="text-2xs text-faint">
                No stock-outs, no cash variances, nothing waiting to sync.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-lineSoft max-h-[380px] overflow-y-auto scroll">
              {attention.map((a, i) => (
                <AlertRow key={i} a={a} />
              ))}
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-line flex items-center justify-between">
            <div className="font-medium">Activity</div>
            <span className="text-2xs text-faint inline-flex items-center gap-1.5">
              <LiveDot /> live
            </span>
          </div>
          {feed.length === 0 ? (
            <div className="p-10 text-center text-sm text-dim">Nothing has happened yet today</div>
          ) : (
            <div className="divide-y divide-lineSoft max-h-[380px] overflow-y-auto scroll">
              {feed.slice(0, 12).map((e) => (
                <div key={e.id} className="px-5 py-2.5 flex items-center gap-3">
                  <span className={`flex-none ${toneText(e.tone)}`}>{e.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{e.text}</div>
                    <div className="text-[10px] text-faint">{ago(e.at, now.getTime())}</div>
                  </div>
                  {e.amount !== undefined && (
                    <span className={`num text-sm flex-none ${toneText(e.tone)}`}>{e.amount}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══ STOCK MONEY ══════════════════════════════════════ */}
      <Section title="Money on the shelf" note={`${stock.units} units across ${stock.skus} products`} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Kpi label="Stock at cost" value={money(stock.atCost)} hint="what you paid" />
        <Kpi label="Stock at retail" value={money(stock.atRetail)} hint="if it all sells" />
        <Kpi label="Profit held" value={money(stock.potentialProfit)} hint="locked in the shelf" />
        <Kpi
          label="Low / out"
          value={`${stock.low} / ${stock.out}`}
          tone={stock.out ? 'bad' : stock.low ? 'warn' : undefined}
          hint="below reorder / nothing left"
        />
        <Kpi
          label="Dead stock"
          value={money(stock.deadValue)}
          tone={stock.deadValue > 0 ? 'warn' : undefined}
          hint={`${stock.deadSkus} product${stock.deadSkus === 1 ? '' : 's'} sold nothing in ${b.label.toLowerCase()}`}
        />
      </div>

      {/* ═══ WHERE THE MONEY COMES FROM ═══════════════════════ */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-6">
        <div className="card p-5">
          <CardHead title="Revenue by category" note={b.label.toLowerCase()} />
          <RankBars
            rows={cats.map((c) => ({
              label: c.label,
              value: c.revenue,
              note: `${c.share.toFixed(0)}%`,
            }))}
            format={money}
          />
        </div>
        <div className="card p-5">
          <CardHead title="Profit by category" note="what actually pays the rent" />
          <RankBars
            rows={cats
              .slice()
              .sort((a, z) => z.profit - a.profit)
              .map((c) => ({
                label: c.label,
                value: c.profit,
                note: c.revenue ? `${((c.profit / c.revenue) * 100).toFixed(0)}% margin` : undefined,
              }))}
            format={money}
            tone="ok"
          />
        </div>
      </div>

      {/* ═══ PRODUCTS ═════════════════════════════════════════ */}
      <div className="card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="font-medium">Product performance</div>
            <div className="text-2xs text-faint mt-0.5">
              {sorted.length} products traded in {b.label.toLowerCase()}
            </div>
          </div>
          <div className="seg self-start">
            {([
              ['profit', 'Profit'],
              ['revenue', 'Revenue'],
              ['units', 'Units'],
              ['margin', 'Margin'],
              ['cover', 'Cover'],
            ] as [SortKey, string][]).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={sort === k ? 'seg-item seg-item-on' : 'seg-item'}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="p-10 text-center text-sm text-dim">
            Nothing sold in this window. Try a wider range.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto scroll">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr>
                    <th className="th">Product</th>
                    <th className="th hidden md:table-cell">Category</th>
                    <th className="th text-right">Units</th>
                    <th className="th text-right">Revenue</th>
                    <th className="th text-right">Profit</th>
                    <th className="th text-right">Margin</th>
                    <th className="th text-right">On hand</th>
                    <th className="th text-right">Cover</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllProducts ? sorted : sorted.slice(0, 10)).map((r) => {
                    const p = products.find((x) => x.id === r.id);
                    const st = p ? stockStatus(p) : 'in_stock';
                    return (
                      <tr key={r.id} className="row">
                        <td className="td">
                          <div className="font-medium truncate max-w-[220px]">{r.name}</div>
                          <div className="text-[10px] text-faint num">
                            {r.sku}
                            {r.returned > 0 && (
                              <span className="text-bad"> · {r.returned} returned</span>
                            )}
                            {r.sellingAtLoss && (
                              <span className="text-bad"> · priced below cost</span>
                            )}
                          </div>
                        </td>
                        <td className="td text-dim hidden md:table-cell">{r.category}</td>
                        <td className="td text-right num">{r.units}</td>
                        <td className="td text-right num">{money(r.revenue)}</td>
                        <td className={`td text-right num ${r.profit < 0 ? 'text-bad' : ''}`}>
                          {money(r.profit)}
                        </td>
                        <td className="td text-right num text-dim">{r.margin.toFixed(0)}%</td>
                        <td className="td text-right">
                          <span
                            className={
                              st === 'out_of_stock'
                                ? 'chip-bad'
                                : st === 'low_stock'
                                ? 'chip-warn'
                                : 'num text-dim'
                            }
                          >
                            {r.stock}
                          </span>
                        </td>
                        <td className="td text-right num text-dim">
                          {r.daysCover === null
                            ? '—'
                            : r.daysCover < 1
                            ? '<1 day'
                            : `${Math.round(r.daysCover)}d`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sorted.length > 10 && (
              <button
                className="w-full py-3 text-2xs text-dim hover:text-ink hover:bg-raised transition-colors border-t border-lineSoft"
                onClick={() => setShowAllProducts((v) => !v)}
              >
                {showAllProducts ? 'Show top 10' : `Show all ${sorted.length}`}
              </button>
            )}
          </>
        )}
      </div>

      {/* ═══ PEOPLE ═══════════════════════════════════════════ */}
      <div className="card overflow-hidden mb-2">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-medium">People</div>
            <div className="text-2xs text-faint mt-0.5">
              Sold, returned, and how the drawer came out
            </div>
          </div>
          <Link href="/audit" className="text-2xs text-brand hover:underline inline-flex items-center gap-1">
            Full audit <ArrowRight size={12} />
          </Link>
        </div>
        {people.length === 0 ? (
          <div className="p-10 text-center text-sm text-dim">Nobody has traded in this window</div>
        ) : (
          <div className="overflow-x-auto scroll">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className="th">Staff</th>
                  <th className="th text-right">Sales</th>
                  <th className="th text-right">Turnover</th>
                  <th className="th text-right">Avg basket</th>
                  <th className="th text-right hidden md:table-cell">Returns</th>
                  <th className="th text-right hidden md:table-cell">Overrides</th>
                  <th className="th text-right">Worst variance</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="row">
                    <td className="td font-medium">{p.name}</td>
                    <td className="td text-right num">{p.sales}</td>
                    <td className="td text-right num">{money(p.turnover)}</td>
                    <td className="td text-right num text-dim">{money(p.avgBasket)}</td>
                    <td className="td text-right num text-dim hidden md:table-cell">
                      {p.refunds ? `${p.refunds} · ${money(p.refundValue)}` : '—'}
                    </td>
                    <td className="td text-right hidden md:table-cell">
                      {p.overrides ? (
                        <span className="chip-warn">{p.overrides}</span>
                      ) : (
                        <span className="text-faint text-2xs">—</span>
                      )}
                    </td>
                    <td className="td text-right">
                      {p.shifts === 0 ? (
                        <span className="text-faint text-2xs">no shift closed</span>
                      ) : p.worstVariance === 0 ? (
                        <span className="chip-ok">Balanced</span>
                      ) : (
                        <span className={`num ${p.worstVariance < 0 ? 'text-bad' : 'text-warn'}`}>
                          {money(p.worstVariance)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[10px] text-faint text-center py-4">
        Profit uses each product&apos;s current cost price. Returns that were not
        put back on the shelf are counted as a loss, not a reversal.
      </p>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────

function Section({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {note && <span className="text-2xs text-faint text-right">{note}</span>}
    </div>
  );
}

function CardHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-4">
      <div className="font-medium">{title}</div>
      {note && <span className="text-2xs text-faint">{note}</span>}
    </div>
  );
}

function Kpi({
  label, value, hint, delta: d, invertDelta, deltaIsPoints, tone, big, icon,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  invertDelta?: boolean;
  deltaIsPoints?: boolean;
  tone?: 'ok' | 'warn' | 'bad';
  big?: boolean;
  icon?: React.ReactNode;
}) {
  const toneClass = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : '';
  return (
    <div className="card p-3 sm:p-4">
      <div className="text-2xs uppercase tracking-wider text-dim mb-1.5 flex items-center gap-1.5 truncate">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={`font-semibold num tracking-tight ${
          big ? 'text-xl sm:text-2xl' : 'text-lg'
        } ${toneClass}`}
      >
        {value}
      </div>
      {d !== undefined && d !== null && (
        <div className="mt-1.5">
          <Delta pct={d} invert={invertDelta} pp={deltaIsPoints} suffix="" />
        </div>
      )}
      {hint && <div className="text-[10px] text-faint mt-1 line-clamp-2">{hint}</div>}
    </div>
  );
}

function TillCardView({ t }: { t: ReturnType<typeof tillCards>[number] }) {
  const open = t.status === 'open';
  return (
    <div className={`card p-4 ${t.stale ? 'border-warn/40' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <div className="font-medium">{t.name}</div>
          <div className="text-2xs text-dim truncate">
            {t.operator ?? 'Never opened'}
            {/* A till that last traded on Saturday must not read as
                if these are today's figures. */}
            {t.openedAt && !isToday(t.openedAt) && (
              <span className="text-faint">
                {' · '}
                {new Date(t.openedAt).toLocaleDateString('en-ZA', {
                  day: '2-digit', month: 'short',
                })}
              </span>
            )}
          </div>
        </div>
        {t.status === 'never' ? (
          <span className="chip-mute">Idle</span>
        ) : open ? (
          <span className={t.stale ? 'chip-warn' : 'chip-ok'}>
            <LiveDot on={!t.stale} /> {t.stale ? 'Not cashed up' : 'Open'}
          </span>
        ) : (
          <span className="chip-mute">Closed</span>
        )}
      </div>

      {t.status === 'never' ? (
        <div className="text-2xs text-faint py-2">No shift has been opened on this till.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Mini label="Sales" value={String(t.sales)} />
            <Mini label="Turnover" value={money(t.turnover)} />
            <Mini
              label={open ? 'In drawer' : 'Variance'}
              value={open ? money(t.expectedCash) : money(t.variance ?? 0)}
              tone={!open && t.variance ? (t.variance < 0 ? 'bad' : 'warn') : undefined}
            />
          </div>
          <div className="text-[10px] text-faint">
            {t.lastSaleAt ? `Last sale ${ago(t.lastSaleAt)}` : 'No sales on this shift'}
          </div>
        </>
      )}
    </div>
  );
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate();
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-faint mb-0.5">{label}</div>
      <div
        className={`num text-sm font-medium truncate ${
          tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function AlertRow({ a }: { a: Alert }) {
  const Icon = a.level === 'bad' ? CircleAlert : a.level === 'warn' ? AlertTriangle : Info;
  return (
    <div className="px-5 py-3 flex items-start gap-3">
      <Icon size={15} className={`flex-none mt-0.5 ${toneText(a.level)}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{a.title}</div>
        <div className="text-2xs text-dim mt-0.5 line-clamp-2">{a.detail}</div>
      </div>
      {a.href && (
        <Link
          href={a.href}
          className="text-2xs text-brand hover:underline flex-none inline-flex items-center gap-1 mt-0.5"
        >
          {a.action ?? 'Open'} <ArrowRight size={11} />
        </Link>
      )}
    </div>
  );
}

function toneText(t: string) {
  return t === 'bad' ? 'text-bad' : t === 'warn' ? 'text-warn' : t === 'ok' ? 'text-ok' : 'text-dim';
}

// ─── The activity feed ───────────────────────────────────────
// One merged stream, newest first. This is what makes the screen feel
// live: an owner at home sees the shop actually working.

interface FeedItem {
  id: string;
  at: string;
  text: string;
  amount?: string;
  tone: 'ok' | 'bad' | 'warn' | 'dim';
  icon: React.ReactNode;
}

function activityFeed(d: {
  sales: any[];
  refunds: any[];
  deliveries: any[];
  stockMovements: any[];
  overrides: any[];
  sessions: any[];
}): FeedItem[] {
  const items: FeedItem[] = [];

  for (const s of d.sales.slice(0, 25)) {
    items.push({
      id: 'S' + s.id,
      at: s.created_at,
      text: `${s.cashier_name} rang up ${s.sale_number}`,
      amount: money(s.total),
      tone: 'ok',
      icon: <Receipt size={14} />,
    });
  }
  for (const r of d.refunds.slice(0, 15)) {
    items.push({
      id: 'R' + r.id,
      at: r.created_at,
      text: `${r.staff_name} refunded ${r.sale_number} — ${r.reason}`,
      amount: '-' + money(r.total),
      tone: 'bad',
      icon: <RotateCcw size={14} />,
    });
  }
  for (const g of d.deliveries.slice(0, 10)) {
    items.push({
      id: 'D' + g.id,
      at: g.created_at,
      text: `${g.received_by_name} received ${g.delivery_number} from ${g.supplier}` +
        (g.discrepancy_units > 0 ? ` · ${g.discrepancy_units} short` : ''),
      amount: money(g.total_cost),
      tone: g.discrepancy_units > 0 ? 'warn' : 'dim',
      icon: <Truck size={14} />,
    });
  }
  for (const m of d.stockMovements.slice(0, 40)) {
    if (m.type !== 'damage' && m.type !== 'adjust') continue;
    items.push({
      id: 'M' + m.id,
      at: m.created_at,
      text: `${m.staff_name} · ${MOVEMENT_LABEL[m.type as keyof typeof MOVEMENT_LABEL]} ${Math.abs(m.qty)} × ${m.name} — ${m.reason}`,
      tone: m.type === 'damage' ? 'warn' : 'dim',
      icon: m.type === 'damage' ? <Trash2 size={14} /> : <Boxes size={14} />,
    });
  }
  for (const o of d.overrides.slice(0, 10)) {
    items.push({
      id: 'O' + o.id,
      at: o.created_at,
      text: `${o.approved_by_name} approved ${o.action.replace(/_/g, ' ')} for ${o.requested_by_name}`,
      tone: 'warn',
      icon: <ShieldCheck size={14} />,
    });
  }
  for (const s of d.sessions.slice(0, 10)) {
    items.push({
      id: 'T' + s.id + 'o',
      at: s.opened_at,
      text: `${s.opened_by_name} opened ${s.till_name}`,
      amount: money(s.opening_float),
      tone: 'dim',
      icon: <Package size={14} />,
    });
    if (s.closed_at) {
      items.push({
        id: 'T' + s.id + 'c',
        at: s.closed_at,
        text: `${s.closed_by_name ?? s.opened_by_name} closed ${s.till_name}`,
        amount: s.variance ? money(s.variance) : 'Balanced',
        tone: s.variance ? (s.variance < 0 ? 'bad' : 'warn') : 'ok',
        icon: <Package size={14} />,
      });
    }
  }

  return items.sort((a, z) => +new Date(z.at) - +new Date(a.at));
}
