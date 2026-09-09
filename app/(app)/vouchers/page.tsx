'use client';

import { useMemo, useState } from 'react';
import { Search, Ticket } from 'lucide-react';
import { usePos } from '@/lib/store';
import { money, voucherIsUsable, normaliseVoucherCode } from '@/lib/types';
import { Page, Stat, Table, Empty } from '@/components/ui/Page';

// Outstanding vouchers are a LIABILITY. Every active one is money the
// shop already owes somebody and will have to hand over in goods. It
// belongs on this page, not buried in a refunds list.

export default function VouchersPage() {
  const creditNotes = usePos((s) => s.creditNotes);
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const wanted = q.trim();
    if (!wanted) return creditNotes;
    const code = normaliseVoucherCode(wanted);
    return creditNotes.filter(
      (v) => v.code.includes(code) || v.issued_from_refund.toLowerCase().includes(wanted.toLowerCase())
    );
  }, [creditNotes, q]);

  const totals = useMemo(() => {
    const active = creditNotes.filter(voucherIsUsable);
    return {
      outstanding: active.reduce((s, v) => s + v.remaining, 0),
      activeCount: active.length,
      issued: creditNotes.reduce((s, v) => s + v.amount, 0),
      redeemed: creditNotes.reduce((s, v) => s + (v.amount - v.remaining), 0),
    };
  }, [creditNotes]);

  return (
    <Page title="Vouchers" subtitle="Store credit issued on returns">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-5">
        <Stat
          label="Outstanding"
          value={money(totals.outstanding)}
          hint="Money the shop still owes"
          tone={totals.outstanding > 0 ? 'warn' : undefined}
        />
        <Stat label="Active vouchers" value={String(totals.activeCount)} />
        <Stat label="Total issued" value={money(totals.issued)} />
        <Stat label="Redeemed" value={money(totals.redeemed)} tone="ok" />
      </div>

      <div className="relative sm:max-w-xs mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          className="input pl-9"
          placeholder="Voucher code or refund number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <Empty
          message={
            creditNotes.length === 0
              ? 'No vouchers issued yet. They are created when a return is refunded to store credit.'
              : 'No voucher matches that.'
          }
        />
      ) : (
        <Table head={[
          'Code',
          { l: 'From refund', cls: 'hidden md:table-cell' },
          { l: 'Issued', cls: 'hidden lg:table-cell' },
          'Value',
          'Remaining',
          { l: 'Expires', cls: 'hidden lg:table-cell' },
          'Status',
        ]}>
          {rows.map((v) => {
            const usable = voucherIsUsable(v);
            const expired = new Date(v.expires_at) <= new Date();
            return (
              <tr key={v.id} className="row">
                <td className="td num font-medium tracking-wider">{v.code}</td>
                <td className="td num text-dim hidden md:table-cell">{v.issued_from_refund}</td>
                <td className="td text-dim hidden lg:table-cell">
                  {new Date(v.issued_at).toLocaleDateString('en-ZA', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })}
                </td>
                <td className="td num text-dim">{money(v.amount)}</td>
                <td className="td num font-medium">{money(v.remaining)}</td>
                <td className="td text-dim hidden lg:table-cell">
                  {new Date(v.expires_at).toLocaleDateString('en-ZA', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })}
                </td>
                <td className="td">
                  {v.status === 'redeemed' ? (
                    <span className="chip-mute">Redeemed</span>
                  ) : expired ? (
                    <span className="chip-bad">Expired</span>
                  ) : v.remaining < v.amount ? (
                    <span className="chip-warn">Part used</span>
                  ) : usable ? (
                    <span className="chip-ok">Active</span>
                  ) : (
                    <span className="chip-mute">{v.status}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <div className="mt-4 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-raised border border-line text-2xs text-dim">
        <Ticket size={14} className="flex-none mt-0.5" />
        <span>
          Vouchers are valid for three years — the Consumer Protection Act (s63) gives
          prepaid vouchers that long, and it is not worth arguing with a customer over.
          A voucher can be spent in parts; whatever is left stays on the same code.
        </span>
      </div>
    </Page>
  );
}
