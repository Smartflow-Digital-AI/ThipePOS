'use client';

import { useState } from 'react';
import { Receipt as ReceiptIcon, Printer } from 'lucide-react';
import { usePos } from '@/lib/store';
import { money, saleStatus, sessionTotals, type Sale } from '@/lib/types';
import { Page, Table, Empty } from '@/components/ui/Page';
import { Modal } from '@/components/ui/Modal';
import { Receipt } from '@/components/pos/Receipt';
import { CloseTillButton } from '@/components/pos/CloseTill';
import { STORE, TILLS } from '@/lib/data/seed';

export default function SalesPage() {
  const sales = usePos((s) => s.sales);
  const refunds = usePos((s) => s.refunds);
  // Show the most recent shift, open or just closed, so the cashier can
  // still read their cash-up after closing rather than watching it vanish.
  const sessions = usePos((s) => s.sessions);
  const session = sessions[0] ?? null;
  const [viewing, setViewing] = useState<Sale | null>(null);

  const t = session ? sessionTotals(session, sales, refunds) : null;
  const cashTaken = t?.cashIn ?? 0;
  const cardTaken = t?.cardIn ?? 0;
  const cashRefunded = t?.cashOut ?? 0;

  const isOpen = session?.status === 'open';

  return (
    <Page
      title="Sales"
      subtitle={`${sales.length} transaction${sales.length === 1 ? '' : 's'} on this device`}
      actions={<CloseTillButton />}
    >
      {/* Current shift */}
      {session && (
        <div className="card p-4 sm:p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-medium">
                {session.till_name} · {session.opened_by_name}
              </div>
              <div className="text-2xs text-dim mt-0.5">
                Opened{' '}
                {new Date(session.opened_at).toLocaleString('en-ZA', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
            <span className={isOpen ? 'chip-ok' : 'chip-mute'}>
              {isOpen ? 'Open' : 'Closed'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
            <Cell label="Opening float" value={money(session.opening_float)} />
            <Cell label="Cash sales" value={money(cashTaken)} />
            <Cell label="Card sales" value={money(cardTaken)} />
            <Cell label="Cash refunds" value={cashRefunded ? '-' + money(cashRefunded) : money(0)} />
            <Cell
              label={isOpen ? 'Cash expected' : 'Variance'}
              value={
                isOpen
                  ? money(session.opening_float + cashTaken - cashRefunded)
                  : money(session.variance ?? 0)
              }
              tone={
                !isOpen && session.variance
                  ? session.variance < 0
                    ? 'bad'
                    : 'warn'
                  : undefined
              }
            />
          </div>
        </div>
      )}

      {sales.length === 0 ? (
        <Empty message="No sales yet. Head to the till." />
      ) : (
        <Table head={[
          'Receipt', 'Date',
          { l: 'Cashier',  cls: 'hidden lg:table-cell' },
          { l: 'Email', cls: 'hidden lg:table-cell' },
          { l: 'Items',    cls: 'hidden md:table-cell' },
          'Payment', 'Status', 'Total', '',
        ]}>
          {sales.map((s) => (
            <tr key={s.id} className="row">
              <td className="td num font-medium">{s.sale_number}</td>
              <td className="td text-dim">
                {new Date(s.created_at).toLocaleString('en-ZA', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </td>
              <td className="td text-dim hidden lg:table-cell">{s.cashier_name}</td>
              <td className="td text-dim hidden lg:table-cell truncate max-w-[200px]">{s.customer_email ?? '—'}</td>
              <td className="td num text-dim hidden md:table-cell">{s.lines.reduce((n, l) => n + l.qty, 0)}</td>
              <td className="td">
                <span className="chip-mute capitalize">
                  {s.payments.length > 1 ? 'split' : s.payments[0]?.method}
                </span>
              </td>
              <td className="td">
                {(() => {
                  const st = saleStatus(s, refunds);
                  if (st === 'refunded') return <span className="chip-bad">Returned</span>;
                  if (st === 'partially_refunded') return <span className="chip-warn">Part returned</span>;
                  return <span className="text-faint text-2xs">—</span>;
                })()}
              </td>
              <td className="td num font-medium">{money(s.total)}</td>
              <td className="td">
                <button
                  className="text-faint hover:text-brand transition-colors"
                  onClick={() => setViewing(s)}
                  title="View receipt"
                >
                  <ReceiptIcon size={15} />
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {/* ── Receipt viewer ── */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title="Receipt" width="max-w-sm">
        {viewing && (
          <div className="p-4">
            <div className="rounded-lg overflow-hidden border border-line mb-4">
              <Receipt
                data={{
                  store_name: STORE.name,
                  store_address: STORE.address,
                  store_phone: STORE.phone,
                  vat_number: STORE.vat_number,
                  sale_number: viewing.sale_number,
                  till_name: TILLS.find((t) => t.id === viewing.till_id)?.name ?? 'Till',
                  cashier_name: viewing.cashier_name,
                  datetime: new Date(viewing.created_at).toLocaleString('en-ZA'),
                  lines: viewing.lines.map((l) => ({
                    name: `${l.name} ${l.variant}`.trim(),
                    qty: l.qty,
                    unit_price: l.unit_price,
                    line_total: l.unit_price * l.qty - l.discount,
                  })),
                  subtotal: viewing.subtotal,
                  discount_total: viewing.discount_total,
                  tax_total: viewing.tax_total,
                  total: viewing.total,
                  payments: viewing.payments.map((p) => ({
                    method: p.method, amount: p.amount, reference: p.card_reference,
                  })),
                  cash_received: viewing.cash_received,
                  change_given: viewing.change_given,
                  customer_email: viewing.customer_email,
                }}
              />
            </div>
            <button className="btn-ghost w-full" onClick={() => window.print()}>
              <Printer size={15} /> Print
            </button>
          </div>
        )}
      </Modal>
    </Page>
  );
}

function Cell({
  label, value, tone,
}: {
  label: string; value: string; tone?: 'ok' | 'warn' | 'bad';
}) {
  const c = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : '';
  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-dim mb-1">{label}</div>
      <div className={`num font-medium ${c}`}>{value}</div>
    </div>
  );
}
