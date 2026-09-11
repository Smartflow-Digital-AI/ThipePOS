'use client';

// ═══════════════════════════════════════════════════════════════════
// LOYALTY
//
// Points are a liability, not a marketing metric. Every unredeemed
// point is a discount the shop has already promised and not yet paid
// for, so this screen leads with what is owed — not with how many
// people signed up.
//
// The ledger tab exists for the same reason the stock ledger does: a
// balance nobody can explain is a balance a customer will argue with
// at the counter, in front of a queue.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Search, HeartHandshake, Ticket } from 'lucide-react';
import { usePos } from '@/lib/store';
import {
  formatPhone, money, redeemableVouchers, POINTS_PER_VOUCHER,
  RAND_PER_POINT, VOUCHER_RAND_PER_REDEMPTION,
} from '@/lib/types';
import { Page, Stat, Table, Empty, Segmented } from '@/components/ui/Page';
import { ago } from '@/lib/analytics';

type Tab = 'members' | 'ledger';

export default function LoyaltyPage() {
  const [tab, setTab] = useState<Tab>('members');

  return (
    <Page
      title="Loyalty"
      subtitle={`R${RAND_PER_POINT} spent earns 1 point · ${POINTS_PER_VOUCHER} points buys a R${VOUCHER_RAND_PER_REDEMPTION} voucher`}
      actions={
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { key: 'members', label: 'Members' },
            { key: 'ledger', label: 'Points ledger' },
          ]}
        />
      }
    >
      {tab === 'members' ? <Members /> : <Ledger />}
    </Page>
  );
}

// ─── Members ─────────────────────────────────────────────────────

function Members() {
  const members = usePos((s) => s.loyaltyMembers);
  const setMarketingOptIn = usePos((s) => s.setMarketingOptIn);
  const [q, setQ] = useState('');

  const summary = useMemo(() => {
    const points = members.reduce((n, m) => n + m.points, 0);
    // What those points will cost when they are spent. Points sitting
    // below a full voucher cost nothing yet — they are not redeemable.
    const owed = members.reduce(
      (n, m) => n + redeemableVouchers(m.points) * VOUCHER_RAND_PER_REDEMPTION * 100,
      0
    );
    const spend = members.reduce((n, m) => n + m.lifetime_spend, 0);
    const month = Date.now() - 30 * 86_400_000;
    return {
      count: members.length,
      points,
      owed,
      ready: members.filter((m) => m.points >= POINTS_PER_VOUCHER).length,
      active: members.filter((m) => new Date(m.last_seen_at).getTime() >= month).length,
      avg: members.length ? Math.round(spend / members.length) : 0,
      optedIn: members.filter((m) => m.marketing_opt_in).length,
    };
  }, [members]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/\s/g, '');
    const list = needle
      ? members.filter(
          (m) =>
            m.phone.includes(needle.replace(/^0/, '27')) ||
            m.phone.includes(needle) ||
            (m.name ?? '').toLowerCase().includes(needle)
        )
      : members;
    return [...list].sort((a, b) => b.points - a.points);
  }, [members, q]);

  if (members.length === 0) {
    return (
      <Empty message="Nobody has joined yet. Capture a cellphone number at the till and the first member appears here." />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 mb-5">
        <Stat label="Members" value={String(summary.count)} hint={`${summary.active} active this month`} />
        <Stat label="Points outstanding" value={String(summary.points)} />
        <Stat
          label="Owed on points"
          value={money(summary.owed)}
          tone={summary.owed > 0 ? 'warn' : undefined}
          hint="redeemable right now"
        />
        <Stat
          label="Ready to redeem"
          value={String(summary.ready)}
          hint={`members at ${POINTS_PER_VOUCHER}+ points`}
        />
        <Stat label="Avg lifetime spend" value={money(summary.avg)} />
      </div>

      <div className="relative mb-3 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          className="input pl-9"
          placeholder="Search by number or name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <Empty message={`Nobody matches “${q}”`} />
      ) : (
        <Table
          head={[
            'Cellphone',
            { l: 'Name', cls: 'hidden md:table-cell' },
            'Points',
            'Worth',
            { l: 'Lifetime spend', cls: 'hidden sm:table-cell' },
            { l: 'Last seen', cls: 'hidden lg:table-cell' },
            'Marketing',
          ]}
        >
          {rows.map((m) => {
            const vouchers = redeemableVouchers(m.points);
            return (
              <tr key={m.id} className="row">
                <td className="td num font-medium">{formatPhone(m.phone)}</td>
                <td className="td text-dim hidden md:table-cell">{m.name || '—'}</td>
                <td className="td">
                  <span className={vouchers > 0 ? 'chip-brand' : 'num text-dim'}>
                    {m.points}
                  </span>
                </td>
                <td className="td num">
                  {vouchers > 0 ? (
                    <span className="text-ok">
                      {money(vouchers * VOUCHER_RAND_PER_REDEMPTION * 100)}
                    </span>
                  ) : (
                    <span className="text-faint text-2xs">
                      {POINTS_PER_VOUCHER - m.points} to go
                    </span>
                  )}
                </td>
                <td className="td num text-dim hidden sm:table-cell">
                  {money(m.lifetime_spend)}
                </td>
                <td className="td text-dim hidden lg:table-cell text-2xs">
                  {ago(m.last_seen_at)}
                </td>
                <td className="td">
                  {/* POPIA: consent is recorded, reversible, and never
                      implied by having bought something. */}
                  <button
                    onClick={() => setMarketingOptIn(m.id, !m.marketing_opt_in)}
                    className={m.marketing_opt_in ? 'chip-ok' : 'chip-mute'}
                    title={
                      m.marketing_opt_in
                        ? 'Consented to marketing — click to withdraw'
                        : 'No marketing consent — click to record one'
                    }
                  >
                    {m.marketing_opt_in ? 'Opted in' : 'No'}
                  </button>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}

// ─── Ledger ──────────────────────────────────────────────────────

function Ledger() {
  const ledger = usePos((s) => s.loyaltyLedger);

  if (ledger.length === 0) {
    return <Empty message="No points have moved yet." />;
  }

  return (
    <Table
      head={[
        'When',
        'Cellphone',
        'Movement',
        'Points',
        'Balance',
        { l: 'Reference', cls: 'hidden md:table-cell' },
        { l: 'By', cls: 'hidden lg:table-cell' },
      ]}
    >
      {ledger.slice(0, 300).map((t) => (
        <tr key={t.id} className="row">
          <td className="td text-dim text-2xs whitespace-nowrap">
            {new Date(t.created_at).toLocaleString('en-ZA', {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </td>
          <td className="td num">{formatPhone(t.phone)}</td>
          <td className="td">
            {t.reason === 'earn' ? (
              <span className="chip-ok">
                <HeartHandshake size={11} /> Earned
              </span>
            ) : t.reason === 'redeem' ? (
              <span className="chip-brand">
                <Ticket size={11} /> Redeemed
              </span>
            ) : t.reason === 'refund' ? (
              <span className="chip-warn">Clawed back</span>
            ) : (
              <span className="chip-mute">Adjusted</span>
            )}
          </td>
          <td className={`td num font-medium ${t.points < 0 ? 'text-bad' : 'text-ok'}`}>
            {t.points > 0 ? '+' : ''}
            {t.points}
          </td>
          <td className="td num text-dim">{t.balance_after}</td>
          <td className="td num text-dim hidden md:table-cell">{t.reference}</td>
          <td className="td text-dim hidden lg:table-cell">{t.staff_name}</td>
        </tr>
      ))}
    </Table>
  );
}
