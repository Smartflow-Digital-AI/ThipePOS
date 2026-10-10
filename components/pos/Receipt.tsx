'use client';

import { money, formatPhone, POINTS_PER_VOUCHER, VOUCHER_RAND_PER_REDEMPTION } from '@/lib/types';
import type { ReceiptData } from '@/lib/hardware/types';
import policy from '@/lib/receipt-policy.json';

// ─────────────────────────────────────────────────────────────
// An 80mm thermal receipt, rendered as HTML.
//
// Two jobs:
//  1. On screen it is the preview the cashier confirms.
//  2. In print it IS the receipt — the @media print rules below
//     make window.print() produce a correct 80mm slip, which is
//     the zero-hardware print path in ThermalPrinter (option b).
//
// A third renderer, bridge/escpos.mjs, drives the thermal printer.
// This file and that one must stay in step: the layout below is a
// line-for-line mirror of renderReceipt(), and what a slip SAYS
// lives in lib/receipt-policy.json so neither owns the wording.
// test/receipt-parity.mjs fails if they drift.
//
// The real printer is 42 characters wide (TM-T88V, Font A), which
// is why the columns are sized the way they are rather than filling
// the available screen width.
// ─────────────────────────────────────────────────────────────

// 'card' | 'cash' | 'voucher' | anything else. An earlier version
// tested for 'card' and called everything else Cash, so a
// voucher-paid sale printed a cash line and the slip disagreed with
// the day's takings.
function payLabel(method: string): string {
  if (method === 'card') return 'Card';
  if (method === 'cash') return 'Cash';
  if (method === 'voucher') return 'Voucher';
  return method.charAt(0).toUpperCase() + method.slice(1);
}

export function Receipt({ data }: { data: ReceiptData }) {
  const isCredit = data.doc_type === 'credit_note';
  // A tax invoice without a VAT number is one SARS will reject, so a
  // slip that cannot be one does not claim to be one.
  const hasVat = Boolean((data.vat_number ?? '').trim());
  const units = data.lines.reduce((n, l) => n + l.qty, 0);
  const withRef = data.payments.find((p) => p.reference);

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #receipt-print-root, #receipt-print-root * { visibility: visible !important; }
          #receipt-print-root {
            position: absolute; left: 0; top: 0;
            width: 80mm; padding: 4mm;
            background: #fff !important; color: #000 !important;
          }
          @page { size: 80mm auto; margin: 0; }
        }
      `}</style>

      <div
        id="receipt-print-root"
        className="bg-white text-black font-mono text-[11px] leading-[1.45] p-5 w-[302px] mx-auto"
      >
        {/* ── who is selling ──────────────────────────────── */}
        <div className="text-center">
          <div className="font-bold text-[14px] tracking-wide">{data.store_name}</div>
          {data.store_address && <div className="mt-0.5">{data.store_address}</div>}
          {data.store_phone && <div>Tel {data.store_phone}</div>}
          {hasVat && <div>VAT Reg No {data.vat_number}</div>}
        </div>

        <div className="text-center mt-2 font-bold tracking-widest text-[13px]">
          {isCredit ? 'CREDIT NOTE' : hasVat ? 'TAX INVOICE' : 'SALES RECEIPT'}
        </div>
        {!hasVat && !isCredit && (
          <div className="text-center text-[10px]">(not a tax invoice)</div>
        )}

        {/* ── which sale ──────────────────────────────────── */}
        <Rule double />
        <Row left={`${isCredit ? 'Credit' : 'Receipt'} ${data.sale_number}`} right={data.datetime} />
        <Row left={data.till_name} right={data.cashier_name} />
        {isCredit && data.original_sale_number && (
          <Row left="Against receipt" right={data.original_sale_number} />
        )}
        {data.customer_email && <Row left="Emailed to" right={data.customer_email} />}
        {data.customer_phone && <Row left="Loyalty" right={formatPhone(data.customer_phone)} />}

        {/* ── what was bought ─────────────────────────────── */}
        <Rule double />
        <Line qty="QTY" desc="DESCRIPTION" amount="AMOUNT" head />
        <Rule />
        {data.lines.map((l, i) => (
          <div key={i}>
            <Line qty={String(l.qty)} desc={l.name} amount="" />
            <Line qty="" desc={`@ ${money(l.unit_price)}`} amount={money(l.line_total)} />
          </div>
        ))}
        <Rule />
        <Row left="TOTAL ARTICLES" right={String(units)} />

        {/* ── the money ───────────────────────────────────── */}
        {data.discount_total > 0 && (
          <>
            <Rule />
            <Row left="Discount" right={'-' + money(data.discount_total)} />
          </>
        )}

        {/* subtotal is the VAT-EXCLUSIVE figure (cartTotals returns
            total - tax_total), so goods + VAT = total. */}
        {hasVat && (
          <>
            <div className="text-center font-bold mt-2">VAT SUMMARY</div>
            <div className="flex justify-between font-bold">
              <span className="w-[4ch]">RATE</span>
              <span className="flex-1 text-right">GOODS</span>
              <span className="flex-1 text-right">VAT</span>
            </div>
            <div className="flex justify-between">
              <span className="w-[4ch]">{policy.vatRatePct}%</span>
              <span className="flex-1 text-right">{money(data.subtotal)}</span>
              <span className="flex-1 text-right">{money(data.tax_total)}</span>
            </div>
          </>
        )}

        <Rule double />
        <div className="flex justify-between font-bold text-[15px] my-1">
          <span>{isCredit ? 'REFUNDED' : 'TOTAL'}</span>
          <span>{money(data.total)}</span>
        </div>
        <Rule double />

        {/* ── how it was settled ──────────────────────────── */}
        <div className="text-center font-bold mt-2">PAYMENT SUMMARY</div>
        <Row left="Amount due" right={money(data.total)} />
        {/* A bare "Cash" row directly above "Cash tendered" reads as
            two different cash amounts, so the tendered line speaks
            for itself when it is present. */}
        {!isCredit && data.payments
          .filter((p) => !(p.method === 'cash' && data.cash_received != null))
          .map((p, i) => (
            <Row key={i} left={payLabel(p.method)} right={money(p.amount)} />
          ))}
        {data.cash_received != null && (
          <>
            <Row left="Cash tendered" right={money(data.cash_received)} />
            <Row left="Change" right={money(data.change_given ?? 0)} />
          </>
        )}
        {withRef && <div className="text-[10px]">Ref {withRef.reference}</div>}

        {isCredit && (
          <>
            <Rule />
            <div>Reason</div>
            <div className="pl-2">{data.refund_reason ?? '—'}</div>
            <Row left="Refunded to" right={data.refund_method ?? '—'} />
          </>
        )}

        {/* ── store credit voucher ────────────────────────── */}
        {isCredit && data.voucher_code && (
          <div className="text-center mt-2">
            <div className="font-bold tracking-widest text-[11px]">STORE CREDIT VOUCHER</div>
            <div className="border-2 border-black my-1.5 py-2">
              <div className="text-[15px] font-bold tracking-[0.15em]">{data.voucher_code}</div>
            </div>
            <div className="text-[10px]">{policy.voucherRedeemNote}</div>
            {data.voucher_expires && (
              <div className="text-[10px]">Valid until {data.voucher_expires}</div>
            )}
            <div className="text-[10px] font-bold mt-1">{policy.voucherSafeNote}</div>
          </div>
        )}

        {/* Points, on the slip. A balance a shopper can only learn by
            asking a cashier is a balance they stop trusting. */}
        {data.points_earned != null && data.points_earned > 0 && (
          <>
            <Rule />
            <div className="text-center">
              <div className="font-bold">+{data.points_earned} POINTS EARNED</div>
              {data.points_balance != null && (
                <div className="text-[10px]">
                  Balance: {data.points_balance} points
                  {data.points_balance >= POINTS_PER_VOUCHER && (
                    <> — ask for your R{VOUCHER_RAND_PER_REDEMPTION} voucher</>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── footer ──────────────────────────────────────── */}
        <Rule />
        <div className="text-center">
          <div>{policy.thankYou}</div>
          <div className="font-bold">{data.store_name}</div>
          <div className="mt-1.5 text-[10px]">
            {isCredit ? (
              <>
                {policy.creditKeepNote}
                <br />
                {policy.cardRefundNote}
              </>
            ) : (
              <>
                {policy.returnLine.replace('{days}', String(policy.returnDays))}
                <br />
                {policy.returnNote}
              </>
            )}
          </div>
          {/* The thermal slip prints a real scannable CODE39 barcode
              here. HTML cannot cheaply, so this stands in for it. */}
          <div className="mt-2 tracking-[0.25em] text-[16px]">||| || |||| | ||</div>
          <div className="text-[9px] tracking-wider">{data.sale_number}</div>
        </div>
      </div>
    </>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="shrink-0">{left}</span>
      <span className="text-right">{right}</span>
    </div>
  );
}

/** One item row: qty, description, amount — the same three columns
 *  the thermal slip uses, so the preview matches the paper. */
function Line({
  qty, desc, amount, head = false,
}: { qty: string; desc: string; amount: string; head?: boolean }) {
  return (
    <div className={`flex gap-1 ${head ? 'font-bold' : ''}`}>
      <span className="w-[3ch] shrink-0">{qty}</span>
      <span className="flex-1 break-words">{desc}</span>
      <span className="shrink-0 text-right">{amount}</span>
    </div>
  );
}

function Rule({ double = false }: { double?: boolean }) {
  return (
    <div
      className={`my-1.5 border-t ${double ? 'border-double border-t-[3px] border-black/60' : 'border-dashed border-black/40'}`}
    />
  );
}
