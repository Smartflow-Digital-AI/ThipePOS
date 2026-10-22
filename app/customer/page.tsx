'use client';

// ═══════════════════════════════════════════════════════════════════
//  CUSTOMER-FACING DISPLAY
//
//  Runs in a second browser window on the HK718's 10" front screen.
//  Launch it with:
//
//    chrome.exe --app=https://<your-app>/customer --kiosk
//               --window-position=1366,0
//
//  Read standing up, from about a metre, by someone not wearing their
//  glasses. So: very large type, no interactivity, no navigation, and
//  nothing that needs explaining. Everything here is one-way.
//
//  It deliberately does NOT read the store directly — it is a separate
//  browser window with its own copy of state, and the till is the only
//  thing that knows what is really in the basket.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { money } from '@/lib/types';
import { subscribe, type DisplayState } from '@/lib/customer-display';

const BLANK: DisplayState = {
  phase: 'idle',
  store_name: '',
  lines: [],
  subtotal: 0,
  discount_total: 0,
  tax_total: 0,
  total: 0,
};

export default function CustomerDisplay() {
  const [s, setS] = useState<DisplayState>(BLANK);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => subscribe(setS), []);

  // Keep the newest item in view. A shopper checks the thing that was
  // just scanned, not the one from four items ago.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.lines.length]);

  if (s.phase === 'paid') return <PaidScreen s={s} />;
  if (s.phase === 'idle' || s.lines.length === 0) return <IdleScreen s={s} />;

  return (
    <main className="fixed inset-0 bg-base text-ink flex flex-col select-none cursor-none">
      <header className="shrink-0 px-6 py-3 border-b border-line flex items-baseline justify-between">
        <span className="text-xl font-semibold tracking-tight">{s.store_name}</span>
        <span className="text-base text-dim">
          {s.lines.reduce((n, l) => n + l.qty, 0)} item
          {s.lines.reduce((n, l) => n + l.qty, 0) === 1 ? '' : 's'}
        </span>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-6 py-3">
        {s.lines.map((l, i) => {
          const newest = i === s.lines.length - 1;
          return (
            <div
              key={i}
              className={`flex items-baseline gap-4 py-2.5 border-b border-line/60 transition-colors ${
                newest ? 'text-ink' : 'text-dim'
              }`}
            >
              <span className="num text-2xl w-14 shrink-0 tabular-nums">{l.qty} ×</span>
              <span className="flex-1 text-2xl leading-tight">{l.name}</span>
              <span className="num text-2xl text-right tabular-nums">
                {money(l.line_total)}
              </span>
            </div>
          );
        })}
      </div>

      <footer className="shrink-0 border-t-2 border-line px-6 py-4 bg-panel">
        {s.discount_total > 0 && (
          <div className="flex justify-between text-xl text-ok mb-1">
            <span>You saved</span>
            <span className="num tabular-nums">{money(s.discount_total)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-2xl uppercase tracking-wide text-dim">Total</span>
          <span className="num text-6xl font-semibold tabular-nums tracking-tight">
            {money(s.total)}
          </span>
        </div>
      </footer>
    </main>
  );
}

function IdleScreen({ s }: { s: DisplayState }) {
  return (
    <main className="fixed inset-0 bg-base text-ink flex flex-col items-center justify-center select-none cursor-none">
      <div className="text-5xl font-semibold tracking-tight text-center px-8">
        {s.store_name || 'Welcome'}
      </div>
      <div className="mt-4 text-2xl text-dim">Welcome</div>
    </main>
  );
}

function PaidScreen({ s }: { s: DisplayState }) {
  const change = s.change_given ?? 0;
  return (
    <main className="fixed inset-0 bg-base text-ink flex flex-col items-center justify-center px-8 select-none cursor-none">
      <div className="text-4xl font-semibold tracking-tight">Thank you</div>

      <div className="mt-6 text-center">
        <div className="text-xl text-dim uppercase tracking-wide">Paid</div>
        <div className="num text-5xl font-semibold tabular-nums mt-1">{money(s.total)}</div>
      </div>

      {/* The one number a shopper is actually waiting for. */}
      {change > 0 && (
        <div className="mt-7 px-10 py-5 rounded-2xl bg-brand-soft border-2 border-brand-line text-center">
          <div className="text-xl uppercase tracking-wide text-brand">Your change</div>
          <div className="num text-6xl font-semibold tabular-nums text-brand mt-1">
            {money(change)}
          </div>
        </div>
      )}

      {typeof s.points_earned === 'number' && s.points_earned > 0 && (
        <div className="mt-7 text-center">
          <div className="text-2xl">
            +{s.points_earned} point{s.points_earned === 1 ? '' : 's'} earned
          </div>
          {typeof s.points_balance === 'number' && (
            <div className="text-lg text-dim mt-1">
              Balance: {s.points_balance}
            </div>
          )}
        </div>
      )}

      {s.sale_number && (
        <div className="absolute bottom-5 text-sm text-faint num">{s.sale_number}</div>
      )}
    </main>
  );
}
