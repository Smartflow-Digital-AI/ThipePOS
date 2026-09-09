import { NextRequest, NextResponse } from 'next/server';

// ═══════════════════════════════════════════════════════════════════
//  EMAIL A RECEIPT  (server-side only)
// ═══════════════════════════════════════════════════════════════════
//
//  The provider API key lives here and nowhere else.
//
//  ── WHEN YOU GO LIVE ──────────────────────────────────────────────
//  1. Pick a provider. Resend is the least painful; Postmark is more
//     reliable for transactional mail if you can afford it.
//  2. Verify a sending domain (SPF + DKIM). DNS takes hours to a day —
//     do this well before go-live, not on the morning.
//     Send from something like receipts@yourdomain.co.za, never gmail.
//  3. Fill in the TODO below and set:
//        NEXT_PUBLIC_RECEIPT_EMAIL_MODE=live
//        RECEIPT_EMAIL_API_KEY=...
//
//  Do NOT put marketing in this email. The customer gave the address
//  for a receipt; under POPIA that is the only thing it may be used
//  for without separate consent.
// ═══════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const { to, receipt } = (await req.json()) as { to: string; receipt: unknown };

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }
  if (!receipt) {
    return NextResponse.json({ error: 'Missing receipt' }, { status: 400 });
  }

  // ── TODO (go-live): hand it to the provider ──────────────────────
  //
  //   const res = await fetch('https://api.resend.com/emails', {
  //     method: 'POST',
  //     headers: {
  //       Authorization: `Bearer ${process.env.RECEIPT_EMAIL_API_KEY}`,
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({
  //       from: 'Glow Beauty Supply <receipts@glowbeauty.co.za>',
  //       to,
  //       subject: `Your receipt ${(receipt as { sale_number: string }).sale_number}`,
  //       html: renderReceiptHtml(receipt),   // reuse components/pos/Receipt
  //     }),
  //   });
  //   if (!res.ok) return NextResponse.json({ error: 'Send failed' }, { status: 502 });
  //
  // ─────────────────────────────────────────────────────────────────

  return NextResponse.json({
    ok: true,
    stub: true,
    note: 'Wire up a mail provider before go-live — see the TODO in this file.',
  });
}
