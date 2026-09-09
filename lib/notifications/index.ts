import type { ReceiptData } from '@/lib/hardware/types';

// ═══════════════════════════════════════════════════════════════════
//  RECEIPT DELIVERY
// ═══════════════════════════════════════════════════════════════════
//
//  Same shape as lib/hardware: the UI talks to an interface, never to
//  a provider. Today it is a mock that resolves after a beat. When you
//  pick a provider you write one class and flip an env var — no screen
//  changes.
//
//  Note what is NOT here: no customer record, no mailing list, no
//  marketing consent. The address is used once, for the receipt of
//  that sale, and stored on that sale. Under POPIA that is a single
//  stated purpose and it is the whole reason this stays simple.
// ═══════════════════════════════════════════════════════════════════

export type SenderMode = 'mock' | 'live';

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface SentReceipt {
  to: string;
  sale_number: string;
  at: string;
}

export interface ReceiptSender {
  readonly mode: SenderMode;
  send(to: string, receipt: ReceiptData): Promise<SendResult>;
  /** Mock only: what has been "sent" this session. */
  outbox(): SentReceipt[];
}

/** Good enough to stop obvious typos at the counter. Not RFC 5322. */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

// ─── Mock ──────────────────────────────────────────────────────────

class MockSender implements ReceiptSender {
  readonly mode = 'mock' as const;
  private sent: SentReceipt[] = [];

  async send(to: string, receipt: ReceiptData): Promise<SendResult> {
    await new Promise((r) => setTimeout(r, 700));
    if (!looksLikeEmail(to)) return { ok: false, error: 'That address does not look right' };
    this.sent.unshift({ to, sale_number: receipt.sale_number, at: new Date().toISOString() });
    return { ok: true };
  }

  outbox() {
    return this.sent;
  }
}

// ─── Live ──────────────────────────────────────────────────────────
//
//  The provider key must never reach the browser, so this posts to our
//  own route and that route talks to the provider.
//
//  >>> FINISH THIS when you pick a provider (Resend is the least
//      painful for a South African sender; Postmark and SendGrid also
//      fine). You will need a verified sending domain — budget a day
//      for DNS to propagate, and do it well before go-live.

class ApiSender implements ReceiptSender {
  readonly mode = 'live' as const;

  async send(to: string, receipt: ReceiptData): Promise<SendResult> {
    try {
      const res = await fetch('/api/receipts/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, receipt }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: body.error ?? `Mail service returned ${res.status}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  outbox() {
    return [];
  }
}

const MODE: SenderMode =
  (process.env.NEXT_PUBLIC_RECEIPT_EMAIL_MODE as SenderMode) === 'live' ? 'live' : 'mock';

let instance: ReceiptSender | null = null;

export function receiptSender(): ReceiptSender {
  if (!instance) instance = MODE === 'live' ? new ApiSender() : new MockSender();
  return instance;
}
