import { NextRequest, NextResponse } from 'next/server';

// ═══════════════════════════════════════════════════════════════════
//  YOCO REFUND ENDPOINT  (server-side only)
// ═══════════════════════════════════════════════════════════════════
//
//  A refund is NOT a negative charge. It is a separate API call made
//  against the ORIGINAL transaction id, which is why the customer's
//  card does not need to be present.
//
//  Two things to get right when you wire this up for real:
//
//   1. NEVER refund without an originalReference. A blind refund to a
//      card number is how fraud gets committed with your terminal.
//      Always look up the original payment first.
//
//   2. Refund AT MOST what was charged, minus anything already
//      refunded. Yoco will usually enforce this, but enforce it here
//      too — do not rely on someone else's validation for your money.
//
//  ── WHEN YOU GO LIVE ──────────────────────────────────────────────
//  Fill in the TODO block. Ask Yoco support for the exact refund
//  endpoint for your machine at the same time you ask about charges.
// ═══════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const { amount, reference, originalReference } = (await req.json()) as {
    amount: number;
    reference: string;
    originalReference?: string;
  };

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }

  // Refuse a refund that is not tied to a real original payment.
  if (!originalReference) {
    return NextResponse.json(
      { error: 'Refund requires the original transaction reference' },
      { status: 400 }
    );
  }

  // ── TODO (go-live): call Yoco's refund endpoint ─────────────────
  //
  //   const res = await fetch(`https://<yoco-endpoint>/${originalReference}/refund`, {
  //     method: 'POST',
  //     headers: {
  //       Authorization: `Bearer ${process.env.YOCO_SECRET_KEY}`,
  //       'Content-Type': 'application/json',
  //       // Yoco supports an idempotency key — USE IT. Without one a
  //       // retried request can refund the customer twice.
  //       'Idempotency-Key': reference,
  //     },
  //     body: JSON.stringify({ amount }),   // cents
  //   });
  //   const yoco = await res.json();
  //   return NextResponse.json({
  //     result: { status: 'approved', reference: yoco.id },
  //   });
  //
  // ─────────────────────────────────────────────────────────────────

  return NextResponse.json({
    result: {
      status: 'approved',
      reference: 'stub_' + reference,
      message: 'Stub — wire up the Yoco refund endpoint before go-live',
    },
  });
}
