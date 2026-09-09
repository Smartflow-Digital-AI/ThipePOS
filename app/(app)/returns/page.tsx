'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, ArrowLeft, Minus, Plus, Loader2, Check, Printer, ShieldCheck,
  AlertTriangle, Banknote, CreditCard, Wallet, RotateCcw, Ticket,
} from 'lucide-react';
import { usePos } from '@/lib/store';
import { hardware } from '@/lib/hardware';
import type { ReceiptData } from '@/lib/hardware/types';
import {
  money, effectiveUnitPrice, returnableQty, refundedQty, saleStatus,
  daysSince, RETURN_REASONS, RETURN_WINDOW_DAYS,
  type Refund, type RefundMethod, type Sale, type Override, type CreditNote,
} from '@/lib/types';
import { Page, Table, Empty } from '@/components/ui/Page';
import { Modal } from '@/components/ui/Modal';
import { Receipt } from '@/components/pos/Receipt';
import { OverrideGate } from '@/components/pos/OverrideGate';
import { STORE, TILLS } from '@/lib/data/seed';

type Condition = 'sellable' | 'damaged';

export default function ReturnsPage() {
  const sales = usePos((s) => s.sales);
  const refunds = usePos((s) => s.refunds);
  const [query, setQuery] = useState('');
  const [saleId, setSaleId] = useState<string | null>(null);

  const sale = sales.find((s) => s.id === saleId) ?? null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sales
      .filter((s) => {
        if (saleStatus(s, refunds) === 'refunded') return false;
        if (!q) return true;
        return (
          s.sale_number.toLowerCase().includes(q) ||
          (s.customer_email ?? '').toLowerCase().includes(q) ||
          s.cashier_name.toLowerCase().includes(q)
        );
      })
      .slice(0, 25);
  }, [sales, refunds, query]);

  if (sale) {
    return <ReturnBuilder key={sale.id} sale={sale} onBack={() => setSaleId(null)} />;
  }

  return (
    <Page title="Returns" subtitle="Find the receipt, then choose what is coming back">
      <div className="relative sm:max-w-md mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          autoFocus
          className="input pl-9"
          placeholder="Receipt number, email or cashier"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {results.length === 0 ? (
        <Empty
          message={
            sales.length === 0
              ? 'No sales on this device yet.'
              : 'No matching receipt. Check the number on the customer’s slip.'
          }
        />
      ) : (
        <Table head={[
          'Receipt', 'Date',
          { l: 'Email', cls: 'hidden lg:table-cell' },
          { l: 'Cashier',  cls: 'hidden xl:table-cell' },
          { l: 'Items',    cls: 'hidden md:table-cell' },
          'Total', 'Status', '',
        ]}>
          {results.map((s) => {
            const status = saleStatus(s, refunds);
            const age = daysSince(s.created_at);
            return (
              <tr key={s.id} className="row">
                <td className="td num font-medium">{s.sale_number}</td>
                <td className="td text-dim">
                  {new Date(s.created_at).toLocaleString('en-ZA', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                  {age > 0 && <span className="text-faint"> · {age}d ago</span>}
                </td>
                <td className="td text-dim hidden lg:table-cell truncate max-w-[200px]">{s.customer_email ?? '\u2014'}</td>
                <td className="td text-dim hidden xl:table-cell">{s.cashier_name}</td>
                <td className="td num text-dim hidden md:table-cell">
                  {s.lines.reduce((n, l) => n + l.qty, 0)}
                </td>
                <td className="td num font-medium">{money(s.total)}</td>
                <td className="td">
                  {status === 'partially_refunded' ? (
                    <span className="chip-warn">Part returned</span>
                  ) : age > RETURN_WINDOW_DAYS ? (
                    <span className="chip-mute">Outside window</span>
                  ) : (
                    <span className="chip-ok">Returnable</span>
                  )}
                </td>
                <td className="td">
                  <button className="btn-quiet !h-8 !px-2.5 text-2xs" onClick={() => setSaleId(s.id)}>
                    Return
                  </button>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════

function ReturnBuilder({ sale, onBack }: { sale: Sale; onBack: () => void }) {
  const refunds = usePos((s) => s.refunds);
  const processRefund = usePos((s) => s.processRefund);
  const hw = hardware();

  const [qty, setQty] = useState<Record<string, number>>({});
  const [cond, setCond] = useState<Record<string, Condition>>({});
  const [reason, setReason] = useState<string>(RETURN_REASONS[0]);
  const [method, setMethod] = useState<RefundMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ refund: Refund; voucher: CreditNote | null } | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [approval, setApproval] = useState<Override | null>(null);

  const running = useRef(false);

  const age = daysSince(sale.created_at);
  const outsideWindow = age > RETURN_WINDOW_DAYS;

  const cardPayment = sale.payments.find((p) => p.method === 'card');
  const canRefundCard = Boolean(cardPayment);
  // A voucher needs no account, so store credit is ALWAYS available.
  // That is what keeps a cashier alone in the shop able to help someone.
  const canStoreCredit = true;

  const selected = sale.lines
    .map((l) => ({ line: l, take: qty[l.product_id] ?? 0 }))
    .filter((x) => x.take > 0);

  const total = selected.reduce((sum, x) => sum + effectiveUnitPrice(x.line) * x.take, 0);

  // ── THE CONTROL ─────────────────────────────────────────────────
  // Store credit stays with the shop, so there is nothing to pocket and
  // a cashier alone can still look after a customer. Cash and card take
  // money out of the business, so a second person signs for it — every
  // time, not just past the window.
  //
  // The person who takes money must not be the one who gives it back.
  const moneyLeavesTheBusiness = method !== 'store_credit';
  const needsApproval = moneyLeavesTheBusiness || outsideWindow;

  // An approval covers ONE exact refund. Change the method, the amount
  // or the lines afterwards and it is void — otherwise a manager could
  // approve R35 and a cashier could pay out R1 299 under it.
  const basis = JSON.stringify({
    method,
    total,
    lines: selected.map((x) => [x.line.product_id, x.take]),
  });
  useEffect(() => {
    setApproval(null);
  }, [basis]);

  const overrideAction = outsideWindow
    ? 'refund_outside_window'
    : method === 'card'
      ? 'refund_card'
      : 'refund_cash';

  const overrideDetail = [
    `${money(total)} on ${sale.sale_number}`,
    `refunded to ${method === 'store_credit' ? 'store credit' : method}`,
    outsideWindow ? `${age} days old (window is ${RETURN_WINDOW_DAYS})` : null,
  ].filter(Boolean).join(', ');

  const bump = (pid: string, delta: number, max: number) =>
    setQty((q) => ({ ...q, [pid]: Math.max(0, Math.min(max, (q[pid] ?? 0) + delta)) }));

  const toReceipt = (r: Refund, v?: CreditNote | null): ReceiptData => ({
    doc_type: 'credit_note',
    original_sale_number: r.sale_number,
    refund_reason: r.reason,
    refund_method:
      r.method === 'store_credit' ? 'Store credit'
      : r.method === 'card' ? `Card ${cardPayment?.card_last4 ? '••••' + cardPayment.card_last4 : ''}`.trim()
      : 'Cash',
    store_name: STORE.name,
    store_address: STORE.address,
    store_phone: STORE.phone,
    vat_number: STORE.vat_number,
    sale_number: r.refund_number,
    till_name: TILLS.find((t) => t.id === r.till_id)?.name ?? 'Till',
    cashier_name: r.staff_name,
    datetime: new Date(r.created_at).toLocaleString('en-ZA', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }),
    lines: r.lines.map((l) => ({
      name: `${l.name} ${l.variant}`.trim(),
      qty: l.qty,
      unit_price: l.unit_price,
      line_total: l.amount,
    })),
    subtotal: r.total - Math.round(r.total - r.total / 1.15),
    discount_total: 0,
    tax_total: Math.round(r.total - r.total / 1.15),
    total: r.total,
    payments: [],
    voucher_code: v?.code ?? r.credit_note_code ?? null,
    voucher_expires: v?.expires_at
      ? new Date(v.expires_at).toLocaleDateString('en-ZA', {
          day: '2-digit', month: 'short', year: 'numeric',
        })
      : null,
  });

  const attempt = () => {
    if (needsApproval && !approval) {
      setGateOpen(true);
      return;
    }
    void run();
  };

  const run = async () => {
    if (running.current) return;
    running.current = true;
    setError('');
    setBusy(true);

    try {
      // Money first, record second. If the card refund fails there must
      // be nothing written — the other order leaves a credit note for
      // money that never moved.
      if (method === 'card') {
        const res = await hw.reader.refund({
          amount: total,
          reference: 'REF-' + Date.now().toString().slice(-6),
          originalReference: cardPayment?.card_reference,
        });
        if (res.status !== 'approved') {
          setError(res.message || 'The card refund did not go through. Try store credit or cash.');
          setBusy(false);
          return;
        }
      }

      const result = processRefund({
        saleId: sale.id,
        items: selected.map((x) => ({
          product_id: x.line.product_id,
          qty: x.take,
          restock: (cond[x.line.product_id] ?? 'sellable') === 'sellable',
        })),
        reason,
        method,
      });

      if (!result) {
        setError('Nothing to refund.');
        setBusy(false);
        return;
      }

      const { refund, voucher } = result;
      if (method === 'cash') await hw.drawer.open(`Refund ${refund.refund_number}`);
      await hw.printer.print(toReceipt(refund, voucher));
      setDone(result);
    } finally {
      setBusy(false);
      running.current = false;
    }
  };

  return (
    <Page
      title={`Return · ${sale.sale_number}`}
      subtitle={`${new Date(sale.created_at).toLocaleString('en-ZA', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })} · ${sale.cashier_name}`}
      actions={
        <button className="btn-ghost" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
      }
    >
      {outsideWindow && (
        <div className="mb-4 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-warn-soft border border-warn/25">
          <AlertTriangle size={16} className="text-warn flex-none mt-0.5" />
          <div className="text-sm">
            <span className="text-warn font-medium">
              {age} days old — past the {RETURN_WINDOW_DAYS} day return window.
            </span>
            <div className="text-dim mt-0.5">
              Policy says no. A manager can still allow it as a goodwill return, and it
              will be recorded against their name.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 items-start">
        {/* ── Lines ── */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto scroll">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <th className="th">Item</th>
                  <th className="th hidden md:table-cell">Paid</th>
                  <th className="th hidden md:table-cell">Sold</th>
                  <th className="th hidden lg:table-cell">Returned</th>
                  <th className="th">Return now</th>
                  <th className="th">Condition</th>
                </tr>
              </thead>
              <tbody>
                {sale.lines.map((l) => {
                  const unit = effectiveUnitPrice(l);
                  const already = refundedQty(sale.id, l.product_id, refunds);
                  const left = returnableQty(sale.id, l, refunds);
                  const take = qty[l.product_id] ?? 0;
                  const condition = cond[l.product_id] ?? 'sellable';

                  return (
                    <tr key={l.product_id} className={left === 0 ? 'opacity-45' : ''}>
                      <td className="td">
                        <div className="font-medium">{l.name}</div>
                        <div className="text-2xs text-dim">{l.variant}</div>
                      </td>
                      <td className="td num text-dim hidden md:table-cell">{money(unit)}</td>
                      <td className="td num text-dim hidden md:table-cell">{l.qty}</td>
                      <td className="td num text-dim hidden lg:table-cell">{already || '—'}</td>
                      <td className="td">
                        {left === 0 ? (
                          <span className="text-2xs text-faint">All returned</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              className="w-8 h-8 rounded-lg bg-raised border border-line hover:bg-hover flex items-center justify-center disabled:opacity-30"
                              disabled={take === 0}
                              onClick={() => bump(l.product_id, -1, left)}
                              aria-label="Fewer"
                            >
                              <Minus size={12} />
                            </button>
                            <span className="w-8 text-center num text-sm">{take}</span>
                            <button
                              className="w-8 h-8 rounded-lg bg-raised border border-line hover:bg-hover flex items-center justify-center disabled:opacity-30"
                              disabled={take >= left}
                              onClick={() => bump(l.product_id, 1, left)}
                              aria-label="More"
                            >
                              <Plus size={12} />
                            </button>
                            <button
                              className="ml-1 text-2xs text-brand hover:underline disabled:opacity-30"
                              disabled={take >= left}
                              onClick={() => setQty((q) => ({ ...q, [l.product_id]: left }))}
                            >
                              all {left}
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="td">
                        {take > 0 && (
                          <div className="flex gap-1">
                            {(['sellable', 'damaged'] as Condition[]).map((c) => (
                              <button
                                key={c}
                                onClick={() => setCond((s) => ({ ...s, [l.product_id]: c }))}
                                className={`h-7 px-2.5 rounded text-2xs border capitalize transition-colors ${
                                  condition === c
                                    ? c === 'sellable'
                                      ? 'bg-ok-soft border-ok/30 text-ok'
                                      : 'bg-bad-soft border-bad/30 text-bad'
                                    : 'bg-raised border-line text-dim hover:text-ink'
                                }`}
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2.5 border-t border-line text-2xs text-dim">
            Sellable goes back on the shelf. Damaged is written off — the stock never
            returns, and the loss shows up in your stock value.
          </div>
        </div>

        {/* ── Panel ── */}
        <div className="card p-4 xl:sticky xl:top-0">
          <div className="text-2xs uppercase tracking-wider text-dim mb-1">Refund total</div>
          <div className="text-3xl font-semibold num mb-5">{money(total)}</div>

          <label className="label">Reason</label>
          <select className="input mb-4" value={reason} onChange={(e) => setReason(e.target.value)}>
            {RETURN_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>

          <label className="label">Refund to</label>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <MethodTile
              icon={Banknote} label="Cash" active={method === 'cash'}
              needsManager onClick={() => setMethod('cash')}
            />
            <MethodTile
              icon={CreditCard} label="Card" active={method === 'card'}
              needsManager disabled={!canRefundCard} onClick={() => setMethod('card')}
            />
            <MethodTile
              icon={Wallet} label="Credit" active={method === 'store_credit'}
              disabled={!canStoreCredit} onClick={() => setMethod('store_credit')}
            />
          </div>

          <div className="text-2xs text-faint mb-4 leading-relaxed">
            {!canRefundCard && 'Card is off — this sale was not paid by card. '}
            {method === 'card' && canRefundCard && 'Goes back to the original card, 3–5 working days. '}
            {method === 'cash' && 'The drawer will open. '}
            {method === 'store_credit' &&
              'Prints a voucher with a code. The customer keeps the slip and spends it here.'}
          </div>

          {/* What this refund will require, said before they do the work */}
          <div
            className={`mb-4 flex items-start gap-2 px-3 py-2.5 rounded-lg border text-2xs ${
              needsApproval
                ? 'bg-warn-soft border-warn/25 text-warn'
                : 'bg-ok-soft border-ok/25 text-ok'
            }`}
          >
            <ShieldCheck size={13} className="flex-none mt-0.5" />
            <span>
              {needsApproval ? (
                outsideWindow
                  ? 'Past the return window — a manager must approve this.'
                  : 'Money leaving the business — a manager must approve this.'
              ) : (
                'Store credit stays with the shop. No approval needed.'
              )}
            </span>
          </div>

          {approval && (
            <div className="mb-3 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-ok-soft border border-ok/25 text-ok text-sm">
              <Check size={14} className="flex-none" />
              Approved by {approval.approved_by_name}
            </div>
          )}

          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-bad-soft border border-bad/25 text-bad text-sm">
              {error}
            </div>
          )}

          <button
            className="btn-primary btn-lg w-full"
            disabled={total === 0 || busy}
            onClick={attempt}
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {method === 'card' ? 'Refunding card…' : 'Processing…'}
              </>
            ) : needsApproval && !approval ? (
              <>
                <ShieldCheck size={16} /> Get approval · {money(total)}
              </>
            ) : (
              <>
                <RotateCcw size={16} /> Refund {money(total)}
              </>
            )}
          </button>
        </div>
      </div>

      <OverrideGate
        open={gateOpen}
        action={overrideAction}
        detail={overrideDetail}
        title={outsideWindow ? 'Outside the return window' : 'Money leaving the business'}
        because={
          outsideWindow
            ? `This receipt is ${age} days old. Policy allows ${RETURN_WINDOW_DAYS}.`
            : `${money(total)} is going back to the customer in ${method === 'card' ? 'card' : 'cash'}.`
        }
        onApproved={(o) => {
          setApproval(o);
          setGateOpen(false);
          void run();
        }}
        onCancel={() => setGateOpen(false)}
      />

      {/* ── Done ── */}
      <Modal open={!!done} dismissable={false} width="max-w-md">
        {done && (
          <div className="p-5">
            <div className="text-center py-3 mb-4">
              <div className="w-14 h-14 rounded-full bg-ok-soft border border-ok/30 flex items-center justify-center mx-auto mb-3">
                <Check size={26} className="text-ok" />
              </div>
              <div className="text-lg font-semibold">Refund processed</div>
              <div className="text-sm text-dim num mt-0.5">
                {done.refund.refund_number} · {money(done.refund.total)}
              </div>
              {done.refund.method === 'cash' && (
                <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded bg-warn-soft border border-warn/25 text-warn text-sm">
                  Give {money(done.refund.total)} from the drawer
                </div>
              )}
            </div>

            {/* The voucher IS the refund. Say the code out loud on screen
                so the cashier checks the slip printed before handing it over. */}
            {done.voucher && (
              <div className="mb-4 p-4 rounded-lg bg-brand-soft border border-brand-line text-center">
                <div className="flex items-center justify-center gap-1.5 text-2xs uppercase tracking-wider text-brand mb-2">
                  <Ticket size={13} /> Store credit voucher
                </div>
                <div className="text-xl font-semibold num tracking-[0.15em] mb-1">
                  {done.voucher.code}
                </div>
                <div className="text-sm num">{money(done.voucher.remaining)}</div>
                <div className="text-2xs text-dim mt-2">
                  Hand the customer the printed slip. Valid until{' '}
                  {new Date(done.voucher.expires_at).toLocaleDateString('en-ZA', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })}.
                </div>
              </div>
            )}

            <div className="rounded-lg overflow-hidden border border-line mb-4 max-h-64 overflow-y-auto scroll">
              <Receipt data={toReceipt(done.refund, done.voucher)} />
            </div>

            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => window.print()}>
                <Printer size={15} /> Reprint
              </button>
              <button className="btn-primary btn-lg flex-[2]" onClick={onBack}>
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Page>
  );
}

function MethodTile({
  icon: Icon, label, active, disabled, needsManager, onClick,
}: {
  icon: typeof Banknote; label: string; active: boolean;
  disabled?: boolean; needsManager?: boolean; onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`relative h-16 rounded-lg border flex flex-col items-center justify-center gap-1.5
        transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
          active ? 'bg-brand border-brand text-brand-fg' : 'bg-raised border-line hover:bg-hover'
        }`}
    >
      {needsManager && !disabled && (
        <ShieldCheck
          size={11}
          className={`absolute top-1.5 right-1.5 ${active ? 'text-brand-fg/70' : 'text-warn'}`}
        />
      )}
      <Icon size={17} />
      <span className="text-2xs font-medium">{label}</span>
    </button>
  );
}
