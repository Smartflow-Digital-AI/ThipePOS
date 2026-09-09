'use client';

import { useMemo, useState } from 'react';
import { ShieldCheck, Wallet, TrendingDown, TrendingUp } from 'lucide-react';
import { usePos } from '@/lib/store';
import { money, sessionTotals } from '@/lib/types';
import { Page, Stat, Table, Empty, Segmented } from '@/components/ui/Page';

// ═══════════════════════════════════════════════════════════════════
//  AUDIT
// ═══════════════════════════════════════════════════════════════════
//
//  Two questions a manager should be able to answer without asking
//  anybody:
//
//    1. Did the drawer balance? On which till, on whose shift?
//    2. Who authorised the exceptions, and for whom?
//
//  Neither of these lives in a sales report. A cash variance you
//  cannot look up a week later is not a control, it is a ritual.
// ═══════════════════════════════════════════════════════════════════

type Tab = 'shifts' | 'overrides';

const TABS: { key: Tab; label: string }[] = [
  { key: 'shifts', label: 'Till shifts' },
  { key: 'overrides', label: 'Overrides' },
];

export default function AuditPage() {
  const [tab, setTab] = useState<Tab>('shifts');

  return (
    <Page
      title="Audit"
      subtitle="Cash-ups and approved exceptions"
      actions={<Segmented value={tab} onChange={setTab} options={TABS} />}
    >
      {tab === 'shifts' ? <Shifts /> : <Overrides />}
    </Page>
  );
}

// ─── Till shifts ─────────────────────────────────────────────────

function Shifts() {
  const sessions = usePos((s) => s.sessions);
  const sales = usePos((s) => s.sales);
  const refunds = usePos((s) => s.refunds);

  const rows = useMemo(
    () =>
      sessions.map((session) => ({
        session,
        totals: sessionTotals(session, sales, refunds),
      })),
    [sessions, sales, refunds]
  );

  const closed = rows.filter((r) => r.session.status === 'closed');

  const summary = useMemo(() => {
    const variances = closed.map((r) => r.session.variance ?? 0);
    const short = variances.filter((v) => v < 0);
    const over = variances.filter((v) => v > 0);
    return {
      shifts: closed.length,
      balanced: variances.filter((v) => v === 0).length,
      shortTotal: short.reduce((n, v) => n + v, 0),
      overTotal: over.reduce((n, v) => n + v, 0),
      net: variances.reduce((n, v) => n + v, 0),
    };
  }, [closed]);

  if (sessions.length === 0) {
    return <Empty message="No shifts yet. One is recorded each time a till is opened." />;
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-5">
        <Stat label="Shifts closed" value={String(summary.shifts)} />
        <Stat
          label="Balanced"
          value={`${summary.balanced}/${summary.shifts || 0}`}
          tone={summary.shifts && summary.balanced === summary.shifts ? 'ok' : undefined}
        />
        <Stat
          label="Total short"
          value={summary.shortTotal ? money(summary.shortTotal) : money(0)}
          tone={summary.shortTotal < 0 ? 'bad' : undefined}
          hint="Cash missing across all shifts"
        />
        <Stat
          label="Total over"
          value={money(summary.overTotal)}
          tone={summary.overTotal > 0 ? 'warn' : undefined}
          hint="Usually a card sale rung up as cash"
        />
      </div>

      <Table head={[
        'Till',
        'Cashier',
        { l: 'Opened', cls: 'hidden lg:table-cell' },
        { l: 'Closed', cls: 'hidden lg:table-cell' },
        { l: 'Float', cls: 'hidden xl:table-cell' },
        { l: 'Cash in', cls: 'hidden md:table-cell' },
        { l: 'Refunds out', cls: 'hidden xl:table-cell' },
        'Expected',
        'Counted',
        'Variance',
      ]}>
        {rows.map(({ session, totals }) => {
          const v = session.variance ?? null;
          return (
            <tr key={session.id} className="row">
              <td className="td font-medium">{session.till_name}</td>
              <td className="td text-dim">{session.opened_by_name}</td>
              <td className="td text-dim hidden lg:table-cell">
                {new Date(session.opened_at).toLocaleString('en-ZA', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </td>
              <td className="td text-dim hidden lg:table-cell">
                {session.closed_at
                  ? new Date(session.closed_at).toLocaleString('en-ZA', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })
                  : '—'}
              </td>
              <td className="td num text-dim hidden xl:table-cell">
                {money(session.opening_float)}
              </td>
              <td className="td num text-dim hidden md:table-cell">{money(totals.cashIn)}</td>
              <td className="td num text-dim hidden xl:table-cell">
                {totals.cashOut ? '-' + money(totals.cashOut) : '—'}
              </td>
              <td className="td num">{money(session.expected_cash ?? totals.expected)}</td>
              <td className="td num">
                {session.counted_cash != null ? money(session.counted_cash) : '—'}
              </td>
              <td className="td">
                {session.status === 'open' ? (
                  <span className="chip-ok">Open</span>
                ) : v === 0 ? (
                  <span className="chip-ok">Balanced</span>
                ) : v == null ? (
                  <span className="chip-mute">—</span>
                ) : (
                  <span
                    className={`inline-flex items-center gap-1 num font-medium ${
                      v < 0 ? 'text-bad' : 'text-warn'
                    }`}
                  >
                    {v < 0 ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                    {money(v)}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </Table>

      <Note icon={Wallet}>
        A drawer that is <strong>short</strong> means cash left without a sale behind it.
        A drawer that is <strong>over</strong> is usually a card sale rung up as cash, not
        a windfall. One-off variances are noise; the same till or the same person short
        every week is the signal.
      </Note>
    </>
  );
}

// ─── Overrides ───────────────────────────────────────────────────

function Overrides() {
  const overrides = usePos((s) => s.overrides);

  const byApprover = useMemo(() => {
    const tally = new Map<string, number>();
    for (const o of overrides) {
      tally.set(o.approved_by_name, (tally.get(o.approved_by_name) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]);
  }, [overrides]);

  const byRequester = useMemo(() => {
    const tally = new Map<string, number>();
    for (const o of overrides) {
      tally.set(o.requested_by_name, (tally.get(o.requested_by_name) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]);
  }, [overrides]);

  if (overrides.length === 0) {
    return (
      <Empty message="No overrides yet. One is recorded every time a manager approves an exception." />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3 mb-5">
        <Stat label="Overrides" value={String(overrides.length)} />
        <Stat
          label="Most approvals"
          value={byApprover[0]?.[0] ?? '—'}
          hint={byApprover[0] ? `${byApprover[0][1]} approved` : undefined}
        />
        <Stat
          label="Most requests"
          value={byRequester[0]?.[0] ?? '—'}
          hint={byRequester[0] ? `${byRequester[0][1]} asked for` : undefined}
        />
      </div>

      <Table head={[
        'When',
        'What',
        'Requested by',
        'Approved by',
        { l: 'Detail', cls: 'hidden lg:table-cell' },
      ]}>
        {overrides.map((o) => (
          <tr key={o.id} className="row">
            <td className="td text-dim whitespace-nowrap">
              {new Date(o.created_at).toLocaleString('en-ZA', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </td>
            <td className="td">
              <span className="chip-warn">{o.action.replace(/_/g, ' ')}</span>
            </td>
            <td className="td">{o.requested_by_name}</td>
            <td className="td font-medium">{o.approved_by_name}</td>
            <td className="td text-dim hidden lg:table-cell">{o.detail}</td>
          </tr>
        ))}
      </Table>

      <Note icon={ShieldCheck}>
        Read this weekly. One override is a customer being looked after. The same cashier
        needing three a day is either training that did not land, or something else — and
        either way you want to know before the stocktake tells you.
      </Note>
    </>
  );
}

function Note({ icon: Icon, children }: { icon: typeof Wallet; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-raised border border-line text-2xs text-dim leading-relaxed">
      <Icon size={14} className="flex-none mt-0.5" />
      <span>{children}</span>
    </div>
  );
}
