'use client';

import { money, formatPhone, POINTS_PER_VOUCHER, VOUCHER_RAND_PER_REDEMPTION } from '@/lib/types';
import type { ReceiptData } from '@/lib/hardware/types';

// ─────────────────────────────────────────────────────────────
// An 80mm thermal receipt, rendered as HTML.
//
// Two jobs:
//  1. On screen it is the preview the cashier confirms.
//  2. In print it IS the receipt — the @media print rules below
//     make window.print() produce a correct 80mm slip, which is
//     the zero-hardware print path in ThermalPrinter (option b).
// ─────────────────────────────────────────────────────────────

export function Receipt({ data }: { data: ReceiptData }) {
  const isCredit = data.doc_type === 'credit_note';
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
        {/* Header */}
        <div className="text-center">
          <div className="font-bold text-[13px] tracking-wide">{data.store_name}</div>
          <div className="mt-0.5">{data.store_address}</div>
          <div>Tel {data.store_phone}</div>
          <div>VAT {data.vat_number}</div>
        </div>

        {isCredit && (
          <div className="text-center mt-2 py-1 border-y-2 border-black font-bold tracking-widest text-[12px]">
            CREDIT NOTE
          </div>
        )}

        <Rule />

        <Row left={isCredit ? 'Credit note' : 'Receipt'} right={data.sale_number} />
        {isCredit && data.original_sale_number && (
          <Row left="Against receipt" right={data.original_sale_number} />
        )}
        <Row left="Date" right={data.datetime} />
        <Row left="Till" right={data.till_name} />
        <Row left="Served by" right={data.cashier_name} />
        {data.customer_email && <Row left="Emailed to" right={data.customer_email} />}
        {data.customer_phone && <Row left="Loyalty" right={formatPhone(data.customer_phone)} />}

        <Rule />

        {/* Lines */}
        {data.lines.map((l, i) => (
          <div key={i} className="mb-1">
            <div>{l.name}</div>
            <div className="flex justify-between">
              <span>
                {l.qty} x {money(l.unit_price)}
              </span>
              <span>{money(l.line_total)}</span>
            </div>
          </div>
        ))}

        <Rule />

        {data.discount_total > 0 && (
          <Row left="Discount" right={'-' + money(data.discount_total)} />
        )}
        <Row left="Subtotal (excl VAT)" right={money(data.subtotal)} />
        <Row left="VAT @ 15%" right={money(data.tax_total)} />

        <Rule />

        <div className="flex justify-between font-bold text-[14px] my-1">
          <span>{isCredit ? 'REFUNDED' : 'TOTAL'}</span>
          <span>{money(data.total)}</span>
        </div>

        {isCredit && (
          <>
            <Rule />
            <Row left="Reason" right={data.refund_reason ?? '—'} />
            <Row left="Refunded to" right={data.refund_method ?? '—'} />
          </>
        )}

        <Rule />

        {!isCredit && data.payments.map((p, i) => (
          <Row
            key={i}
            left={p.method === 'card' ? 'Card' : 'Cash'}
            right={money(p.amount)}
          />
        ))}
        {data.cash_received != null && (
          <>
            <Row left="Cash tendered" right={money(data.cash_received)} />
            <Row left="Change" right={money(data.change_given ?? 0)} />
          </>
        )}
        {data.payments.find((p) => p.reference) && (
          <div className="mt-1 text-[10px]">
            Ref {data.payments.find((p) => p.reference)?.reference}
          </div>
        )}

        <Rule />

        {isCredit && data.voucher_code && (
          <>
            <div className="text-center mt-2 mb-1">
              <div className="font-bold tracking-widest text-[11px]">STORE CREDIT VOUCHER</div>
              <div className="border-2 border-black my-1.5 py-2">
                <div className="text-[15px] font-bold tracking-[0.15em]">
                  {data.voucher_code}
                </div>
              </div>
              <div className="text-[10px]">
                Present this slip to redeem. Valid until {data.voucher_expires}.
              </div>
              <div className="text-[10px] font-bold mt-1">
                Keep it safe — it cannot be replaced if lost.
              </div>
            </div>
            <Rule />
          </>
        )}

        {/* Points, on the slip. A balance a shopper can only learn by
            asking a cashier is a balance they stop trusting. */}
        {data.points_earned != null && data.points_earned > 0 && (
          <>
            <div className="text-center mb-2">
              <div className="font-bold">
                +{data.points_earned} POINTS EARNED
              </div>
              {data.points_balance != null && (
                <div className="text-[10px]">
                  Balance: {data.points_balance} points
                  {data.points_balance >= POINTS_PER_VOUCHER && (
                    <> — ask for your R{VOUCHER_RAND_PER_REDEMPTION} voucher</>
                  )}
                </div>
              )}
            </div>
            <Rule />
          </>
        )}

        <div className="text-center mt-2">
          <div>Thank you for shopping at</div>
          <div className="font-bold">{data.store_name}</div>
          <div className="mt-1.5 text-[10px]">
            {isCredit ? (
              <>
                Keep this credit note as proof of refund.
                <br />
                Card refunds can take 3–5 working days to reflect.
              </>
            ) : (
              <>
                Returns accepted within 7 days with this slip.
                <br />
                Unopened products only.
              </>
            )}
          </div>
          <div className="mt-2 tracking-[0.25em] text-[16px]">||| || |||| | ||</div>
          <div className="text-[9px] tracking-wider">{data.sale_number}</div>
        </div>
      </div>
    </>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

function Rule() {
  return <div className="my-1.5 border-t border-dashed border-black/40" />;
}
