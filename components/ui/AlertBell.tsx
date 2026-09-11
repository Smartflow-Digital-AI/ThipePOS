'use client';

// ═══════════════════════════════════════════════════════════════════
// THE BELL
//
// A dashboard card saying "3 below reorder level" only exists while
// somebody is looking at the dashboard. The stock controller does not
// live there, and neither does a manager mid-shift.
//
// This follows them. It sits in the header on every back-office
// screen, it counts only what is addressed to THEIR role, and opening
// it marks things read for them alone — a manager clearing their bell
// does not silence the stock controller's copy.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, PackageX, TriangleAlert, Check } from 'lucide-react';
import { usePos } from '@/lib/store';
import { isUnread } from '@/lib/types';
import { ago } from '@/lib/analytics';

export function AlertBell() {
  const staff = usePos((s) => s.staff);
  const alerts = usePos((s) => s.alerts);
  const markAlertsRead = usePos((s) => s.markAlertsRead);

  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (!staff) return null;

  const mine = alerts.filter((a) => a.roles.includes(staff.role));
  const live = mine.filter((a) => !a.resolved_at);
  const unread = live.filter((a) => isUnread(a, staff.id)).length;

  // Nothing addressed to this role, ever. Do not show a dead bell.
  if (mine.length === 0) return null;

  return (
    <div className="relative" ref={wrap}>
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          // Reading it is opening it.
          if (next && unread > 0) markAlertsRead();
        }}
        aria-label={unread ? `${unread} unread stock alerts` : 'Stock alerts'}
        className={`relative h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
          open ? 'bg-raised text-ink' : 'text-faint hover:text-ink hover:bg-raised'
        }`}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full
                       bg-bad text-white text-[9px] font-semibold leading-[15px] text-center num"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 w-[320px] sm:w-[360px] card shadow-pop z-50
                     animate-in overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <div className="font-medium text-sm">Stock alerts</div>
            <span className="text-2xs text-faint">
              {live.length === 0 ? 'all clear' : `${live.length} open`}
            </span>
          </div>

          {live.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Check size={20} className="text-ok mx-auto mb-2" />
              <div className="text-sm text-dim">Nothing below the line</div>
              <div className="text-2xs text-faint mt-1">
                Alerts close themselves when stock is received.
              </div>
            </div>
          ) : (
            <div className="max-h-[340px] overflow-y-auto scroll divide-y divide-lineSoft">
              {live.map((a) => {
                const Icon = a.kind === 'out_of_stock' ? PackageX : TriangleAlert;
                return (
                  <Link
                    key={a.id}
                    href="/stock"
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-raised transition-colors"
                  >
                    <Icon
                      size={15}
                      className={`flex-none mt-0.5 ${
                        a.kind === 'out_of_stock' ? 'text-bad' : 'text-warn'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {a.name} {a.variant}
                      </div>
                      <div className="text-2xs text-dim mt-0.5">
                        {a.kind === 'out_of_stock'
                          ? 'Out of stock'
                          : `${a.level} left · alerts below ${a.threshold}`}
                      </div>
                      <div className="text-[10px] text-faint mt-0.5">
                        {ago(a.created_at)} · {a.trigger}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <Link
            href="/stock"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-2xs text-brand hover:bg-raised
                       transition-colors border-t border-line text-center"
          >
            Open stock
          </Link>
        </div>
      )}
    </div>
  );
}
