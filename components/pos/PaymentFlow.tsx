'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Banknote, CreditCard, SplitSquareHorizontal, Check, X, Printer,
  Loader2, Smartphone, ArrowLeft, ArchiveRestore, Ticket, Mail,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { receiptSender, looksLikeEmail } from '@/lib/notifications';
import { Receipt } from '@/components/pos/Receipt';
import { usePos } from '@/lib/store';
import { hardware, isMockDevice } from '@/lib/hardware';
import type { ReaderState, ReceiptData } from '@/lib/hardware/types';
import { cartTotals, money, receiptStamp, type PaymentPart, type Sale } from '@/lib/types';
import { STORE, TILLS } from '@/lib/data/seed';
import { publish } from '@/lib/customer-display';
import { holdPaidScreen } from '@/components/pos/CustomerDisplayBridge';

type Step = 'method' | 'voucher' | 'cash' | 'card' | 'split_card' | 'split_cash' | 'done';

export function PaymentFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = usePos((s) => s.cart);
  const completeSale = usePos((s) => s.completeSale);
  const tillId = usePos((s) => s.tillId);
  const staff = usePos((s) => s.staff);
  const findVoucher = usePos((s) => s.findVoucher);
  const redeemVoucher = usePos((s) => s.redeemVoucher);

  const totals = cartTotals(cart);
  const hw = hardware();

  const [step, setStep] = useState<Step>('method');
  const [cashCents, setCashCents] = useState(0);
  const [confirmOver, setConfirmOver] = useState(false);
  const [voucherInput, setVoucherInput] = useState('');
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherPart, setVoucherPart] = useState(0);
  const [voucherError, setVoucherError] = useState('');
  const [emailValue, setEmailValue] = useState('');
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [emailError, setEmailError] = useState('');
  const autoSent = useRef(false);
  const [cardPart, setCardPart] = useState(0);
  const [readerState, setReaderState] = useState<ReaderState>({ phase: 'idle' });
  const [sale, setSale] = useState<Sale | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');
  const [drawerError, setDrawerError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState('');

  // Reset whenever the modal is REOPENED — and only then.
  //
  // Deps are [open] alone, deliberately. Adding saleEmail here looked
  // harmless and was not: completing a sale clears saleEmail, the
  // effect re-ran while still open, and the cashier was thrown from
  // the "Sale complete" screen back to the payment buttons. Read the
  // value imperatively instead of subscribing to it.
  useEffect(() => {
    if (open) {
      setStep('method');
      setCashCents(0);
      setConfirmOver(false);
      setPrintError('');
      setDrawerError('');
      setVoucherInput('');
      setVoucherCode('');
      setVoucherPart(0);
      setVoucherError('');
      setCardPart(0);
      setSale(null);
      setError('');
      setDrawerOpen(false);
      setEmailValue(usePos.getState().saleEmail);
      setEmailState('idle');
      setEmailError('');
      autoSent.current = false;
    }
  }, [open]);

  useEffect(() => hw.reader.onState(setReaderState), [hw]);

  // ── finish: write sale, kick drawer if cash, print ──────────────
  const finish = useCallback(
    async (
      payments: PaymentPart[],
      cashReceived?: number,
      // Passed explicitly when a voucher was applied in THIS tick.
      // Reading it from state here would read the value from before
      // setVoucherPart — the sale would then complete with no payment
      // at all, which is exactly what happened the first time.
      justApplied?: { code: string; amount: number }
    ) => {
      const applied =
        justApplied ??
        (voucherPart > 0 && voucherCode ? { code: voucherCode, amount: voucherPart } : null);

      // Spend the voucher at the moment the sale completes, not when it
      // was keyed in — an abandoned payment must not burn someone's credit.
      const parts: PaymentPart[] = [...payments];
      if (applied) {
        const taken = redeemVoucher(applied.code, applied.amount);
        if (taken > 0) {
          parts.unshift({ method: 'voucher', amount: taken, voucher_code: applied.code });
        }
      }

      // A sale must never be recorded with nothing paid against it.
      if (parts.length === 0) {
        setError('Nothing was paid. Choose a payment method.');
        setStep('method');
        return;
      }

      const s = completeSale(parts, cashReceived);
      setSale(s);
      setStep('done');

      // The shopper's screen, before anything else. Change due is the
      // one number they are standing there waiting for, and they
      // should not have to read it upside down off the cashier's.
      // holdPaidScreen keeps it up after the cart empties, which
      // happens a few milliseconds from now.
      holdPaidScreen();
      publish({
        phase: 'paid',
        store_name: STORE.name,
        lines: s.lines.map((l) => ({
          name: `${l.name} ${l.variant}`.trim(),
          qty: l.qty,
          unit_price: l.unit_price,
          line_total: l.unit_price * l.qty - l.discount,
        })),
        subtotal: s.subtotal,
        discount_total: s.discount_total,
        tax_total: s.tax_total,
        total: s.total,
        sale_number: s.sale_number,
        cash_received: s.cash_received,
        change_given: s.change_given,
        points_earned: s.points_earned,
        points_balance: s.customer_phone
          ? usePos.getState().loyaltyMembers.find((m) => m.phone === s.customer_phone)?.points
          : undefined,
      });

      // Past this point the sale is recorded and the money has
      // changed hands. A drawer that jams or a printer that is off is
      // a hardware problem to report, never a reason to throw out of
      // this handler and leave the cashier on a blank screen.
      if (parts.some((p) => p.method === 'cash')) {
        try {
          await hw.drawer.open(`Sale ${s.sale_number}`);
          setDrawerOpen(true);
        } catch (e) {
          setDrawerError((e as Error).message);
        }
      }

      setPrinting(true);
      const printed = await hw.printer.print(toReceipt(s));
      setPrinting(false);
      setPrintError(printed.ok ? '' : printed.error ?? 'Receipt did not print.');
    },
    [completeSale, hw, voucherPart, voucherCode, redeemVoucher]
  );

  // ── card charge ─────────────────────────────────────────────────
  const runCard = useCallback(
    async (amount: number, thenCash: number) => {
      setError('');
      const result = await hw.reader.charge({
        amount,
        reference: 'SALE-' + Date.now().toString().slice(-6),
      });

      if (result.status !== 'approved') {
        setError(
          result.status === 'declined'
            ? 'Card declined. Try another card or take cash.'
            : result.message || 'Payment did not go through.'
        );
        setStep('method');
        return;
      }

      const cardPayment: PaymentPart = {
        method: 'card',
        amount,
        card_reference: result.reference,
        card_last4: result.last4,
      };

      if (thenCash > 0) {
        setCardPart(amount);
        setStep('split_cash');
        return;
      }
      await finish([cardPayment]);
    },
    [hw, finish]
  );

  const sendReceiptEmail = useCallback(
    async (to: string, forSale: Sale) => {
      setEmailState('sending');
      setEmailError('');
      const res = await receiptSender().send(to, toReceipt(forSale));
      if (res.ok) {
        setEmailState('sent');
      } else {
        setEmailState('failed');
        setEmailError(res.error ?? 'Could not send');
      }
    },
    // toReceipt is derived from props/state that are stable for a
    // completed sale, so it does not belong in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // If the cashier already took an address during the sale, send it the
  // moment the sale completes — once, and only once.
  useEffect(() => {
    if (step !== 'done' || !sale || autoSent.current) return;
    if (!sale.customer_email) return;
    autoSent.current = true;
    void sendReceiptEmail(sale.customer_email, sale);
  }, [step, sale, sendReceiptEmail]);

  const applyVoucher = () => {
    const v = findVoucher(voucherInput);
    if (!v) {
      setVoucherError('No voucher with that code. Check the slip.');
      return;
    }
    if (v.status === 'redeemed' || v.remaining <= 0) {
      setVoucherError('That voucher has already been fully used.');
      return;
    }
    if (new Date(v.expires_at) <= new Date()) {
      setVoucherError(
        `That voucher expired on ${new Date(v.expires_at).toLocaleDateString('en-ZA')}.`
      );
      return;
    }

    // Never take more off the voucher than the sale is worth — the
    // balance stays on the code for next time. Cash change from a
    // voucher would turn store credit into a cash-out.
    const applied = Math.min(v.remaining, totals.total);
    setVoucherCode(v.code);
    setVoucherPart(applied);
    setVoucherInput('');

    if (applied >= totals.total) {
      void finish([], undefined, { code: v.code, amount: applied });
      return;
    }
    setStep('method');
  };

  // A slip that did not print is the commonest hardware failure in a
  // shop, and the sale is already banked, so the fix is a retry — not
  // a voided sale and not a re-rung basket.
  const reprint = async () => {
    if (!sale) return;
    setPrinting(true);
    const r = await hardware().printer.print(toReceipt(sale));
    setPrinting(false);
    setPrintError(r.ok ? '' : r.error ?? 'Receipt did not print.');
  };

  const toReceipt = (s: Sale): ReceiptData => ({
    store_name: STORE.name,
    store_address: STORE.address,
    store_phone: STORE.phone,
    vat_number: STORE.vat_number,
    sale_number: s.sale_number,
    till_name: TILLS.find((t) => t.id === tillId)?.name ?? 'Till',
    cashier_name: s.cashier_name,
    datetime: receiptStamp(s.created_at),
    lines: s.lines.map((l) => ({
      name: `${l.name} ${l.variant}`.trim(),
      qty: l.qty,
      unit_price: l.unit_price,
      line_total: l.unit_price * l.qty - l.discount,
    })),
    subtotal: s.subtotal,
    discount_total: s.discount_total,
    tax_total: s.tax_total,
    total: s.total,
    payments: s.payments.map((p) => ({
      method: p.method, amount: p.amount, reference: p.card_reference,
    })),
    cash_received: s.cash_received,
    change_given: s.change_given,
    customer_email: s.customer_email,
    customer_phone: s.customer_phone,
    points_earned: s.points_earned,
    points_balance: s.loyalty_member_id
      ? usePos.getState().loyaltyMembers.find((m) => m.id === s.loyalty_member_id)?.points
      : undefined,
  });

  // A voucher is spent FIRST, then whatever is left is settled in cash
  // or card. Treating it as a pre-payment rather than a payment method
  // means part-value vouchers just work.
  const due = Math.max(0, totals.total - voucherPart);
  const outstanding = step === 'split_cash' ? due - cardPart : due;
  const change = cashCents - outstanding;

  // A cashier who means R140 and enters R14 000 must be stopped before
  // the drawer opens, not after. Anything wildly over what is due asks
  // for a second press.
  const wildlyOver = outstanding > 0 && cashCents > outstanding * 5 && change > 20000;

  return (
    <Modal
      open={open}
      onClose={step === 'done' ? undefined : onClose}
      dismissable={step === 'method'}
      width={step === 'done' ? 'max-w-md' : 'max-w-lg'}
      title={step === 'done' ? undefined : 'Payment'}
      subtitle={
        step === 'done'
          ? undefined
          : `${cart.length} item${cart.length === 1 ? '' : 's'}`
      }
    >
      {/* ══ STEP: choose method ══════════════════════════════════ */}
      {step === 'method' && (
        <div className="p-5">
          {voucherPart > 0 && (
            <div className="mb-4 flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-brand-soft border border-brand-line text-sm">
              <span className="flex items-center gap-2 text-brand">
                <Ticket size={14} /> Voucher {voucherCode}
              </span>
              <span className="flex items-center gap-2">
                <span className="num text-brand">-{money(voucherPart)}</span>
                <button
                  onClick={() => { setVoucherPart(0); setVoucherCode(''); }}
                  className="text-faint hover:text-bad"
                  aria-label="Remove voucher"
                >
                  <X size={14} />
                </button>
              </span>
            </div>
          )}

          <div className="text-center py-4 mb-5">
            <div className="text-2xs uppercase tracking-wider text-dim mb-1">
              {voucherPart > 0 ? 'Still to pay' : 'Amount due'}
            </div>
            <div className="text-5xl font-semibold num tracking-tight">{money(due)}</div>
            {voucherPart > 0 && (
              <div className="text-2xs text-dim mt-1 num">of {money(totals.total)}</div>
            )}
          </div>

          {error && (
            <div className="mb-4 px-3 py-2.5 rounded bg-bad-soft border border-bad/25 text-bad text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MethodButton icon={Banknote} label="Cash" onClick={() => setStep('cash')} />
            <MethodButton
              icon={CreditCard}
              label="Card"
              primary
              onClick={() => {
                setStep('card');
                runCard(due, 0);
              }}
            />
            <MethodButton
              icon={SplitSquareHorizontal}
              label="Split"
              onClick={() => setStep('split_card')}
            />
            <MethodButton
              icon={Ticket}
              label="Voucher"
              disabled={voucherPart > 0}
              onClick={() => { setVoucherInput(''); setVoucherError(''); setStep('voucher'); }}
            />
          </div>
        </div>
      )}

      {/* ══ STEP: voucher ════════════════════════════════════════ */}
      {step === 'voucher' && (
        <div className="p-5">
          <div className="text-center mb-5">
            <div className="w-12 h-12 rounded-xl bg-brand-soft border border-brand-line flex items-center justify-center mx-auto mb-3">
              <Ticket size={21} className="text-brand" />
            </div>
            <div className="font-medium">Store credit voucher</div>
            <div className="text-sm text-dim mt-1">
              Type the code from the customer’s slip
            </div>
          </div>

          <input
            autoFocus
            className="input h-14 text-xl num text-center tracking-[0.15em] uppercase mb-3"
            placeholder="GB-XXXX-XXXX"
            value={voucherInput}
            onChange={(e) => { setVoucherInput(e.target.value); setVoucherError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') applyVoucher(); }}
          />

          {voucherError && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-bad-soft border border-bad/25 text-bad text-sm">
              {voucherError}
            </div>
          )}

          <div className="flex gap-3 mt-5">
            <button
              className="btn-ghost flex-1"
              onClick={() => { setVoucherInput(''); setVoucherError(''); setStep('method'); }}
            >
              <ArrowLeft size={15} /> Back
            </button>
            <button
              className="btn-primary btn-lg flex-[2]"
              disabled={!voucherInput.trim()}
              onClick={applyVoucher}
            >
              Apply voucher
            </button>
          </div>
        </div>
      )}

      {/* ══ STEP: cash ═══════════════════════════════════════════ */}
      {(step === 'cash' || step === 'split_cash') && (
        <div className="p-5">
          {step === 'split_cash' && (
            <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded bg-ok-soft border border-ok/25 text-ok text-sm">
              <Check size={14} /> Card approved {money(cardPart)} — now take the balance in cash
            </div>
          )}

          <div className="text-center mb-5">
            <div className="text-2xs uppercase tracking-wider text-dim mb-1">
              {step === 'split_cash' ? 'Cash balance due' : 'Amount due'}
            </div>
            <div className="text-4xl font-semibold num">{money(outstanding)}</div>
          </div>

          <MoneyInput
            label="Cash received"
            valueCents={cashCents}
            onChange={(c) => { setCashCents(c); setConfirmOver(false); }}
            autoFocus
            numpad
            size="lg"
            hint="Type the digits — they fill from the right, like the card machine."
            tone={wildlyOver ? 'warn' : undefined}
          />

          {/* Quick tender — the notes a cashier actually receives */}
          <div className="grid grid-cols-4 gap-2 mt-3 mb-4">
            {quickTenders(outstanding).map((amt) => (
              <button
                key={amt}
                onClick={() => { setCashCents(amt); setConfirmOver(false); }}
                className="h-11 rounded-lg bg-raised border border-line hover:bg-hover text-sm num transition-colors"
              >
                {amt % 100 === 0 ? `R${amt / 100}` : money(amt)}
              </button>
            ))}
          </div>

          <div
            className={`flex items-center justify-between px-4 h-14 rounded-lg mb-3 border ${
              wildlyOver ? 'bg-warn-soft border-warn/30'
              : change >= 0 ? 'bg-ok-soft border-ok/25'
              : 'bg-raised border-line'
            }`}
          >
            <span className="text-sm text-dim">Change</span>
            <span className={`text-2xl font-semibold num ${
              wildlyOver ? 'text-warn' : change >= 0 ? 'text-ok' : 'text-faint'
            }`}>
              {change >= 0 ? money(change) : '—'}
            </span>
          </div>

          {wildlyOver && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-warn-soft border border-warn/30 text-warn text-sm">
              <div className="font-medium mb-0.5">That is a lot of change.</div>
              <div className="text-dim">
                {money(cashCents)} tendered against {money(outstanding)} due. Check you
                did not mean {money(Math.round(cashCents / 100))}.
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button className="btn-ghost flex-1" onClick={() => setStep('method')}>
              <ArrowLeft size={15} /> Back
            </button>
            <button
              className={`btn-lg flex-[2] ${wildlyOver && !confirmOver ? 'btn-danger' : 'btn-primary'}`}
              disabled={cashCents < outstanding}
              onClick={() => {
                if (wildlyOver && !confirmOver) { setConfirmOver(true); return; }
                const parts: PaymentPart[] =
                  step === 'split_cash'
                    ? [
                        { method: 'card', amount: cardPart },
                        { method: 'cash', amount: outstanding },
                      ]
                    : [{ method: 'cash', amount: outstanding }];
                finish(parts, cashCents);
              }}
            >
              {wildlyOver && !confirmOver
                ? `Give ${money(change)} change?`
                : 'Complete sale'}
            </button>
          </div>
        </div>
      )}

      {/* ══ STEP: split — how much on card ═══════════════════════ */}
      {step === 'split_card' && (
        <div className="p-5">
          <div className="text-center mb-5">
            <div className="text-2xs uppercase tracking-wider text-dim mb-1">To settle</div>
            <div className="text-4xl font-semibold num">{money(due)}</div>
          </div>

          <MoneyInput
            label="Put how much on the card?"
            valueCents={cashCents}
            onChange={setCashCents}
            autoFocus
            numpad
            size="lg"
          />

          <div className="flex justify-between text-sm text-dim mt-4 mb-5 px-1">
            <span>Remaining in cash</span>
            <span className="num text-ink">{money(Math.max(0, due - cashCents))}</span>
          </div>

          <div className="flex gap-3">
            <button className="btn-ghost flex-1" onClick={() => { setCashCents(0); setStep('method'); }}>
              <ArrowLeft size={15} /> Back
            </button>
            <button
              className="btn-primary btn-lg flex-[2]"
              disabled={cashCents <= 0 || cashCents >= due}
              onClick={() => {
                const card = cashCents;
                setCashCents(0);
                setStep('card');
                runCard(card, due - card);
              }}
            >
              Charge card {money(cashCents)}
            </button>
          </div>
        </div>
      )}

      {/* ══ STEP: card — the Yoco machine ════════════════════════ */}
      {step === 'card' && <CardStage state={readerState} onCancel={() => hw.reader.cancel()} />}

      {/* ══ STEP: done ═══════════════════════════════════════════ */}
      {step === 'done' && sale && (
        <div className="p-5">
          <div className="text-center py-3 mb-4">
            <div className="w-14 h-14 rounded-full bg-ok-soft border border-ok/30 flex items-center justify-center mx-auto mb-3">
              <Check size={26} className="text-ok" />
            </div>
            <div className="text-lg font-semibold">Sale complete</div>
            <div className="text-sm text-dim num mt-0.5">
              {sale.sale_number} · {money(sale.total)}
            </div>
            {sale.change_given != null && sale.change_given > 0 && (
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded bg-warn-soft border border-warn/25 text-warn text-sm">
                Give change {money(sale.change_given)}
              </div>
            )}
          </div>

          {drawerOpen && (
            <div className="mb-3 flex items-center justify-between px-3 py-2.5 rounded bg-raised border border-line text-sm">
              <span className="flex items-center gap-2 text-dim">
                <ArchiveRestore size={14} className="text-warn" /> Cash drawer open
              </span>
              <button
                className="text-2xs text-brand hover:underline"
                onClick={() => { hardware().drawer.close(); setDrawerOpen(false); }}
              >
                Mark closed
              </button>
            </div>
          )}

          {drawerError && (
            <div className="mb-3 px-3 py-2.5 rounded bg-warn-soft border border-warn/25 text-warn text-sm">
              <div className="font-medium">Cash drawer did not open</div>
              <div className="text-2xs mt-0.5 opacity-90">{drawerError}</div>
              <div className="text-2xs mt-1 opacity-90">
                The sale is recorded. Open the drawer with the key and carry on.
              </div>
            </div>
          )}

          <div className="mb-3">
            {printing ? (
              <div className="flex items-center gap-2 text-sm text-dim">
                <Loader2 size={14} className="animate-spin" /> Printing receipt…
              </div>
            ) : printError ? (
              <div className="px-3 py-2.5 rounded bg-bad-soft border border-bad/25 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-bad">Receipt did not print</span>
                  <button className="text-2xs text-brand hover:underline" onClick={() => void reprint()}>
                    Try again
                  </button>
                </div>
                <div className="text-2xs mt-0.5 text-bad/90">{printError}</div>
                <div className="text-2xs mt-1 text-dim">
                  The sale is recorded as {sale.sale_number}. Email the slip below, or
                  reprint it later from Sales.
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-dim">
                <Printer size={14} className="text-ok" /> Receipt printed
              </div>
            )}
          </div>

          {/* Email the slip. No account is created — the address is
              stored on this sale and used for this receipt. */}
          <div className="mb-4 p-3 rounded-lg bg-raised border border-line">
            {emailState === 'sent' ? (
              <div className="flex items-center gap-2 text-sm text-ok">
                <Check size={14} /> Receipt emailed to {emailValue}
              </div>
            ) : emailState === 'sending' ? (
              <div className="flex items-center gap-2 text-sm text-dim">
                <Loader2 size={14} className="animate-spin" /> Emailing receipt…
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2 text-2xs uppercase tracking-wider text-dim">
                  <Mail size={12} /> Email receipt (optional)
                </div>
                <div className="flex gap-2">
                  <input
                    type="email"
                    inputMode="email"
                    className="input flex-1"
                    placeholder="customer@email.com"
                    value={emailValue}
                    onChange={(e) => { setEmailValue(e.target.value); setEmailError(''); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && sale && looksLikeEmail(emailValue)) {
                        void sendReceiptEmail(emailValue, sale);
                      }
                    }}
                  />
                  <button
                    className="btn-ghost"
                    disabled={!looksLikeEmail(emailValue) || !sale}
                    onClick={() => sale && void sendReceiptEmail(emailValue, sale)}
                  >
                    {emailState === 'failed' ? 'Retry' : 'Send'}
                  </button>
                </div>
                {emailError && (
                  <div className="text-2xs text-bad mt-2">{emailError}</div>
                )}
              </>
            )}
          </div>

          <div className="rounded-lg overflow-hidden border border-line mb-4 max-h-64 overflow-y-auto scroll">
            <Receipt data={toReceipt(sale)} />
          </div>

          <div className="flex gap-3">
            <button className="btn-ghost flex-1" onClick={() => window.print()}>
              <Printer size={15} /> Reprint
            </button>
            <button className="btn-primary btn-lg flex-[2]" onClick={onClose}>
              New sale
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── The card machine stage ──────────────────────────────────────

function CardStage({ state, onCancel }: { state: ReaderState; onCancel: () => void }) {
  const hw = hardware();

  const copy: Record<string, string> = {
    connecting: 'Connecting to card machine…',
    waiting_for_card: 'Tap, insert or swipe on the Yoco machine',
    reading: 'Reading card…',
    authorising: 'Authorising with the bank…',
    idle: 'Preparing…',
    done: 'Done',
  };

  const waiting = state.phase === 'waiting_for_card';

  return (
    <div className="p-8 text-center">
      {/* Machine graphic with a live pulse while it waits */}
      <div className="relative w-24 h-24 mx-auto mb-6">
        {waiting && (
          <>
            <span className="absolute inset-0 rounded-2xl bg-brand/25 animate-ring" />
            <span
              className="absolute inset-0 rounded-2xl bg-brand/25 animate-ring"
              style={{ animationDelay: '0.7s' }}
            />
          </>
        )}
        <div className="relative w-24 h-24 rounded-2xl bg-raised border border-line flex items-center justify-center">
          {state.phase === 'authorising' || state.phase === 'reading' ? (
            <Loader2 size={34} className="text-brand animate-spin" />
          ) : (
            <Smartphone size={34} className={waiting ? 'text-brand' : 'text-dim'} />
          )}
        </div>
      </div>

      <div className="text-lg font-medium mb-1">{copy[state.phase] ?? ''}</div>
      {state.phase === 'waiting_for_card' && (
        <div className="text-3xl font-semibold num mt-3 mb-1">{money(state.amount)}</div>
      )}
      <div className="text-sm text-dim mb-8">Do not remove the card until it beeps</div>

      {/* Simulator controls — only ever rendered in mock mode.
          In live mode the customer's real card decides this. */}
      {isMockDevice('reader') && waiting && (
        <div className="mb-6 p-3 rounded-lg bg-raised border border-dashed border-line">
          <div className="text-2xs uppercase tracking-wider text-faint mb-2.5">
            Simulator — stands in for the Yoco machine
          </div>
          <div className="flex gap-2">
            <button
              className="btn-ghost flex-1 !text-ok !border-ok/30 hover:!bg-ok-soft"
              onClick={() => hw.reader.simulateOutcome('approved')}
            >
              <Check size={15} /> Approve
            </button>
            <button
              className="btn-ghost flex-1 !text-bad !border-bad/30 hover:!bg-bad-soft"
              onClick={() => hw.reader.simulateOutcome('declined')}
            >
              <X size={15} /> Decline
            </button>
          </div>
        </div>
      )}

      <button className="btn-quiet" onClick={onCancel}>
        Cancel payment
      </button>
    </div>
  );
}

function MethodButton({
  icon: Icon, label, onClick, primary, disabled,
}: {
  icon: typeof Banknote; label: string; onClick: () => void;
  primary?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-24 rounded-lg border flex flex-col items-center justify-center gap-2
        transition-all active:scale-[0.97] disabled:opacity-30 disabled:pointer-events-none ${
          primary
            ? 'bg-brand border-brand text-brand-fg hover:bg-brand-hover'
            : 'bg-raised border-line hover:bg-hover'
        }`}
    >
      <Icon size={22} />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

/** Note denominations a South African cashier is actually handed. */
function quickTenders(due: number): number[] {
  const notes = [5000, 10000, 20000, 50000, 100000, 200000];
  const out: number[] = [due]; // exact
  for (const n of notes) if (n > due && out.length < 4) out.push(n);
  // round up to the next R50 if we still have room
  const up = Math.ceil(due / 5000) * 5000;
  if (up !== due && !out.includes(up) && out.length < 4) out.splice(1, 0, up);
  return out.slice(0, 4);
}
