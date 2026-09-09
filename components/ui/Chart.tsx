'use client';

// ═══════════════════════════════════════════════════════════════════
// CHARTS
//
// Hand-rolled, no charting library. Three reasons:
//
//   1. Recharts and friends are ~150kb for what a shop dashboard
//      needs, and this app has to start on a R6 000 mini PC.
//   2. Theme colours are CSS variables. A library that wants hex
//      strings fights all three themes.
//   3. There is nothing here that is hard.
//
// The readout pattern: hovering a bar does NOT float a tooltip over
// the chart. It changes the figure in the chart's header instead —
// which works with a finger on a tablet, where there is no hover and
// a tooltip would sit under the user's hand.
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

export interface Datum {
  key: string;
  label: string;
  value: number;
  /** Optional second figure shown in the readout, e.g. profit. */
  sub?: number;
}

/** Percentage-change chip. `null` means "no comparable period". */
export function Delta({
  pct,
  invert = false,
  suffix = 'vs previous',
  pp = false,
}: {
  pct: number | null;
  /** For figures where DOWN is good — returns, shrinkage. */
  invert?: boolean;
  suffix?: string;
  /**
   * The value is already a difference in PERCENTAGE POINTS, not a
   * percentage change. Margin going 40% → 42% is "+2pp", never "+5%":
   * the second reading is true but nobody means it.
   */
  pp?: boolean;
}) {
  // Nothing to compare against — say nothing rather than explain the
  // absence in every tile on a shop's first week.
  if (pct === null) return null;

  const flat = Math.abs(pct) < (pp ? 0.1 : 0.5);
  const good = invert ? pct < 0 : pct > 0;
  const cls = flat ? 'text-dim' : good ? 'text-ok' : 'text-bad';
  const Icon = flat ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight;
  const body = pp
    ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}pp`
    : `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
  return (
    <span className={`inline-flex items-center gap-1 text-2xs font-medium ${cls}`}>
      <Icon size={12} />
      <span className="num">{flat ? (pp ? 'flat' : '0%') : body}</span>
      {suffix && <span className="text-faint font-normal">{suffix}</span>}
    </span>
  );
}

/**
 * Vertical bars over time.
 *
 * `format` renders the readout; bars themselves carry no text, because
 * 30 days of labels is unreadable at any width worth having.
 */
export function Bars({
  data,
  format,
  formatSub,
  height = 140,
  emptyMessage = 'Nothing to show yet',
}: {
  data: Datum[];
  format: (n: number) => string;
  formatSub?: (n: number) => string;
  height?: number;
  emptyMessage?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-dim"
        style={{ height: height + 24 }}
      >
        {emptyMessage}
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((n, d) => n + d.value, 0);
  const active = hover !== null ? data[hover] : null;
  // Squeeze the gap as the series grows so 90 days still reads as bars.
  const gap = data.length > 45 ? 'gap-px' : data.length > 20 ? 'gap-0.5' : 'gap-1';

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3 min-h-[26px]">
        <div className="num text-lg font-semibold tracking-tight">
          {format(active ? active.value : total)}
        </div>
        <div className="text-2xs text-dim text-right">
          {active ? (
            <>
              <span className="text-ink">{active.label}</span>
              {formatSub && active.sub !== undefined && (
                <span className="text-faint"> · {formatSub(active.sub)}</span>
              )}
            </>
          ) : (
            <span className="text-faint">
              {data.length} {data.length === 1 ? 'period' : 'periods'} · hover for detail
            </span>
          )}
        </div>
      </div>

      <div
        className={`flex items-end ${gap}`}
        style={{ height }}
        onMouseLeave={() => setHover(null)}
      >
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          const on = hover === i;
          return (
            <button
              key={d.key}
              type="button"
              aria-label={`${d.label}: ${format(d.value)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => setHover(on ? null : i)}
              className="flex-1 h-full flex items-end min-w-[3px] group"
            >
              <span
                className={`w-full rounded-t-[3px] transition-[background-color,height] duration-200 ${
                  on ? 'bg-brand' : 'bg-brand/35 group-hover:bg-brand/60'
                }`}
                // A zero-value day still gets a hairline, so the eye
                // reads "closed / no sales" rather than "chart broken".
                style={{ height: `${Math.max(pct, d.value > 0 ? 2 : 1)}%` }}
              />
            </button>
          );
        })}
      </div>

      <div className="flex justify-between text-[10px] text-faint mt-2">
        <span>{data[0].label}</span>
        {data.length > 2 && <span>{data[data.length - 1].label}</span>}
      </div>
    </div>
  );
}

/** Ranked horizontal bars — categories, brands, anything compared. */
export function RankBars({
  rows,
  format,
  tone = 'brand',
}: {
  rows: { label: string; value: number; note?: string }[];
  format: (n: number) => string;
  tone?: 'brand' | 'ok' | 'bad';
}) {
  if (rows.length === 0) {
    return <div className="text-sm text-dim py-6 text-center">No data yet</div>;
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const bar = tone === 'ok' ? 'bg-ok' : tone === 'bad' ? 'bg-bad' : 'bg-brand';
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between gap-3 text-sm mb-1.5">
            <span className="truncate">{r.label}</span>
            <span className="num text-dim flex-none">
              {format(r.value)}
              {r.note && <span className="text-faint"> · {r.note}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-raised overflow-hidden">
            <div
              className={`h-full rounded-full ${bar} transition-all duration-300`}
              style={{ width: `${(Math.abs(r.value) / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A live dot. Present tense for anything that updates on its own. */
export function LiveDot({ on = true }: { on?: boolean }) {
  if (!on) return <span className="w-1.5 h-1.5 rounded-full bg-faint inline-block" />;
  return (
    <span className="relative inline-flex w-1.5 h-1.5">
      <span className="absolute inset-0 rounded-full bg-ok animate-ring" />
      <span className="relative w-1.5 h-1.5 rounded-full bg-ok" />
    </span>
  );
}
