import { NextRequest, NextResponse } from 'next/server';

// ═══════════════════════════════════════════════════════════════════
//  YOCO CHARGE ENDPOINT  (server-side only)
// ═══════════════════════════════════════════════════════════════════
//
//  Why this file exists: YOCO_SECRET_KEY must never reach the browser.
//  The browser asks this route to start a charge; this route talks to
//  Yoco; the browser then polls this route until the customer taps.
//
//  ── WHEN YOU GO LIVE ──────────────────────────────────────────────
//  1. Get your keys from the Yoco dashboard → Developers.
//  2. Confirm WHICH Yoco product your machine uses. Yoco has more
//     than one API surface (online Payments vs in-person terminal),
//     and the endpoint + payload differ. Ask Yoco support directly —
//     it is a five-minute email that saves a week of guessing.
//  3. Replace the two TODO blocks below with the real calls.
//  4. Set NEXT_PUBLIC_HARDWARE_MODE=live.
//
//  The in-memory Map below is fine for one till. If you run all three
//  tills off one server, move it to a Supabase table (or Redis) so a
//  restart doesn't lose an in-flight payment.
// ═══════════════════════════════════════════════════════════════════

type Phase = 'pending' | 'reading' | 'authorising' | 'settled' | 'failed';

interface Charge {
  id: string;
  amount: number;
  reference: string;
  phase: Phase;
  result?: {
    status: 'approved' | 'declined';
    reference?: string;
    last4?: string;
    cardBrand?: string;
    message?: string;
  };
  createdAt: number;
}

const charges = new Map<string, Charge>();

// ─── START a charge ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { amount, reference } = (await req.json()) as {
    amount: number;
    reference: string;
  };

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }

  const id = crypto.randomUUID();

  // ── TODO (go-live): tell the Yoco terminal to start a payment ────
  //
  //   const res = await fetch('https://<yoco-endpoint>', {
  //     method: 'POST',
  //     headers: {
  //       Authorization: `Bearer ${process.env.YOCO_SECRET_KEY}`,
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({
  //       amount,                  // cents
  //       currency: 'ZAR',
  //       reference,
  //       terminalId: process.env.YOCO_TERMINAL_ID,
  //     }),
  //   });
  //   const yoco = await res.json();
  //   charges.set(id, { ..., providerId: yoco.id });
  //
  // ─────────────────────────────────────────────────────────────────

  charges.set(id, {
    id,
    amount,
    reference,
    phase: 'pending',
    createdAt: Date.now(),
  });

  // Housekeeping: drop anything older than 10 minutes.
  for (const [key, c] of charges) {
    if (Date.now() - c.createdAt > 600_000) charges.delete(key);
  }

  return NextResponse.json({ paymentId: id });
}

// ─── POLL a charge ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const charge = charges.get(id);
  if (!charge) return NextResponse.json({ status: 'failed' });

  // ── TODO (go-live): ask Yoco where this payment is up to ────────
  //
  //   const res = await fetch(`https://<yoco-endpoint>/${charge.providerId}`, {
  //     headers: { Authorization: `Bearer ${process.env.YOCO_SECRET_KEY}` },
  //   });
  //   const yoco = await res.json();
  //   map yoco.status → phase, and on success fill charge.result with
  //   { status:'approved', reference: yoco.id, last4: yoco.card.last4 }
  //
  //  ALTERNATIVE, and better once you're stable: register a WEBHOOK
  //  with Yoco that POSTs the result to /api/payments/webhook, and
  //  have this route just read the row the webhook wrote. Polling is
  //  simpler to get working; webhooks are what you keep.
  // ─────────────────────────────────────────────────────────────────

  return NextResponse.json({ status: charge.phase, result: charge.result });
}

// ─── CANCEL a charge ───────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const { id } = (await req.json()) as { id: string };
  const charge = charges.get(id);
  if (charge) {
    // TODO (go-live): call Yoco's cancel endpoint so the machine
    // stops asking the customer for a card.
    charge.phase = 'failed';
    charge.result = { status: 'declined', message: 'Cancelled at till' };
  }
  return NextResponse.json({ ok: true });
}
