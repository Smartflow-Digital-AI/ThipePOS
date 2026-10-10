// ═══════════════════════════════════════════════════════════════════
//  LIVE DRIVERS — the real hardware
// ═══════════════════════════════════════════════════════════════════
//  These are the classes you finish when the equipment arrives.
//  The scanner one is already complete and will work as-is.
//  The printer/drawer/Yoco ones are written out with the real calls
//  in place and marked  >>> FINISH THIS  where a device-specific
//  detail (vendor id, IP, Yoco endpoint) has to be filled in.
//
//  You do NOT touch any screen to switch over. Set:
//      NEXT_PUBLIC_HARDWARE_MODE=live
// ═══════════════════════════════════════════════════════════════════

import type {
  BarcodeScanner,
  CardReader,
  CashDrawer,
  ChargeRequest,
  ChargeResult,
  RefundRequest,
  ReaderState,
  ReceiptData,
  ReceiptPrinter,
  PrintResult,
} from './types';

// ─── 1. SCANNER — this one is DONE ─────────────────────────────────
// USB barcode scanners emulate a keyboard. They type the digits far
// faster than a human can (<50ms apart) and finish with Enter.
// We buffer fast keystrokes and flush on Enter.

type Editable = HTMLInputElement | HTMLTextAreaElement;

function isEditable(t: EventTarget | null): t is Editable {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement
  );
}

// React owns the value of a controlled input, so assigning .value does
// nothing it notices. Going through the prototype setter and firing a
// bubbling 'input' event is what React's own onChange listens for.
function setNativeValue(el: Editable, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export class KeyboardWedgeScanner implements BarcodeScanner {
  readonly kind = 'scanner' as const;
  readonly mode = 'live' as const;

  private handlers = new Set<(b: string) => void>();
  private buffer = '';
  private lastKeyAt = 0;
  private bound = false;

  // Where the first character of a burst landed, so it can be taken
  // back out if the burst turns out to be a scan. See bind().
  private leak: { el: Editable; at: number; ch: string } | null = null;

  /** Max gap between keystrokes that still counts as "the scanner typing". */
  private static readonly BURST_MS = 50;
  private static readonly MIN_LENGTH = 4;

  private bind() {
    if (this.bound || typeof window === 'undefined') return;
    this.bound = true;

    // Capture phase: this runs before the focused field sees the key,
    // and preventDefault here stops the character being inserted at
    // all. Without it the scanner types its 13 digits straight into
    // whatever input has the cursor — scanning while a field is
    // focused filled the field instead of the cart.
    //
    // The first character of a burst is unavoidably ambiguous: at that
    // instant a scanner and a person are indistinguishable, so it is
    // allowed through and its position remembered. From the second
    // character on the gap gives the scanner away and the rest are
    // suppressed. If the burst completes as a scan, that one leaked
    // character is removed again, so the field ends up untouched.
    window.addEventListener(
      'keydown',
      (e) => {
        const now = Date.now();
        const fresh = now - this.lastKeyAt > KeyboardWedgeScanner.BURST_MS;
        if (fresh) {
          this.buffer = '';
          this.leak = null;
        }
        this.lastKeyAt = now;

        if (e.key === 'Enter') {
          const code = this.buffer.trim();
          this.buffer = '';
          if (code.length >= KeyboardWedgeScanner.MIN_LENGTH) {
            e.preventDefault(); // don't let it submit a form
            this.undoLeak();
            this.handlers.forEach((h) => h(code));
          }
          this.leak = null;
          return;
        }

        if (e.key.length !== 1) return;

        if (fresh) {
          if (isEditable(e.target)) {
            const el = e.target;
            this.leak = {
              el,
              at: el.selectionStart ?? el.value.length,
              ch: e.key,
            };
          }
        } else {
          e.preventDefault();
        }

        this.buffer += e.key;
      },
      { capture: true }
    );
  }

  /** Remove the one character that was let through before we knew. */
  private undoLeak() {
    const leak = this.leak;
    this.leak = null;
    if (!leak) return;
    const { el, at, ch } = leak;
    if (!el.isConnected) return;
    if (el.value[at] !== ch) return; // the field moved on; leave it alone
    setNativeValue(el, el.value.slice(0, at) + el.value.slice(at + 1));
    try {
      el.setSelectionRange(at, at);
    } catch {
      /* number inputs refuse setSelectionRange; harmless */
    }
  }

  onScan(handler: (barcode: string) => void) {
    this.bind();
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  simulate() {
    /* no-op when live */
  }
}

// ─── 2. PRINTER ────────────────────────────────────────────────────
// Two realistic options for a thermal printer (Epson TM-series,
// Xprinter, etc). Pick ONE:
//
//  (a) NETWORK printer  — printer has its own IP on the shop wifi.
//      You POST raw ESC/POS bytes to a tiny local print service, or
//      straight to port 9100. Cleanest for a web app.
//
//  (b) BROWSER print    — window.print() against a styled 80mm div.
//      Zero setup, works today, but the operator sees a print dialog.
//      Perfectly acceptable for go-live; swap to (a) later.
//
// The class below does (b) by default and has (a) sketched out.

export class ThermalPrinter implements ReceiptPrinter {
  readonly kind = 'printer' as const;
  readonly mode = 'live' as const;

  constructor(
    private opts: {
      /** e.g. http://localhost:8080/print — the local print bridge */
      bridgeUrl?: string;
      /** Must match the bridge's own token. */
      token?: string;
    } = {}
  ) {}

  async print(receipt: ReceiptData): Promise<PrintResult> {
    // ─ Option (a): the local print bridge ───────────────────────
    if (this.opts.bridgeUrl) {
      // A till cannot hang on a sale. If the bridge does not answer
      // the cashier needs the slip to fail fast and the sale to stand,
      // because the money has already changed hands.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch(this.opts.bridgeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.opts.token ? { 'X-Bridge-Token': this.opts.token } : {}),
          },
          body: JSON.stringify({ type: 'receipt', receipt }),
          signal: ctl.signal,
        });
        if (!res.ok) {
          // The bridge reports why in plain words. Pass that through
          // rather than a status code a cashier cannot act on.
          const said = await res.json().catch(() => null);
          return {
            ok: false,
            error: said?.error ?? `Printer service responded ${res.status}`,
          };
        }
        return { ok: true };
      } catch (e) {
        const err = e as Error;
        return {
          ok: false,
          error:
            err.name === 'AbortError'
              ? 'Printer did not respond in time.'
              : 'Print service is not running on this till.',
        };
      } finally {
        clearTimeout(timer);
      }
    }

    // ─ Option (b): browser print of the 80mm receipt node ────────
    // The receipt is already rendered off-screen by <ReceiptSheet/>
    // with id="receipt-print-root" and an @media print stylesheet.
    // Note this route cannot open the cash drawer — see index.ts.
    if (typeof window !== 'undefined') {
      window.print();
      return { ok: true };
    }
    return { ok: false, error: 'No printer transport available' };
  }

  history() {
    return [];
  }
}

// ─── 3. CASH DRAWER ────────────────────────────────────────────────
// The drawer is a dumb box with a solenoid, plugged into the RJ11
// port ON THE PRINTER. You open it by sending the ESC/POS kick
// sequence to the printer:  ESC p m t1 t2   →  0x1B 0x70 0x00 0x19 0xFA
//
// So: the drawer driver needs the printer bridge, not its own device.

export class PrinterKickDrawer implements CashDrawer {
  readonly kind = 'drawer' as const;
  readonly mode = 'live' as const;
  private _open = false;

  constructor(
    private bridgeUrl: string,
    private token?: string
  ) {}

  async open(reason: string) {
    // ESC p 0 25 250 — pin 2, 25ms on, 250ms off
    const kick = [0x1b, 0x70, 0x00, 0x19, 0xfa];
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const res = await fetch(this.bridgeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { 'X-Bridge-Token': this.token } : {}),
        },
        body: JSON.stringify({ type: 'raw', bytes: kick, reason }),
        signal: ctl.signal,
      });
      // This used to set _open unconditionally, so a drawer that never
      // moved was recorded as opened and the cashier was told to take
      // cash from a locked box. The flag now follows the hardware.
      this._open = res.ok;
      if (!res.ok) {
        const said = await res.json().catch(() => null);
        throw new Error(said?.error ?? `Drawer did not open (${res.status})`);
      }
    } catch (e) {
      this._open = false;
      const err = e as Error;
      throw new Error(
        err.name === 'AbortError'
          ? 'Drawer did not respond. Open it with the key.'
          : err.message.startsWith('Drawer did not open')
          ? err.message
          : 'Print service is not running, so the drawer cannot open. Use the key.'
      );
    } finally {
      clearTimeout(timer);
    }
  }

  isOpen() {
    return this._open;
  }

  close() {
    this._open = false;
  }
}

// ─── 4. YOCO CARD READER ───────────────────────────────────────────
//
//  IMPORTANT — how Yoco actually works, because this trips everyone up:
//
//  Your SECRET key must never reach the browser. So the flow is:
//
//    browser  ──POST /api/payments/charge──▶  your Next.js route
//                                              │ (has YOCO_SECRET_KEY)
//                                              ▼
//                                          Yoco API
//                                              │
//                                              ▼
//                                    the card machine beeps
//
//  Then you POLL your own route until the customer has tapped.
//  This class does exactly that — the polling loop is real; you only
//  fill in the endpoint names Yoco gives you for your account type
//  (Yoco has more than one product line: the online Payments API and
//  the in-person/terminal API — confirm which one your machine uses
//  in the Yoco developer portal before wiring this up).

export class YocoCardReader implements CardReader {
  readonly kind = 'reader' as const;
  readonly mode = 'live' as const;

  private stateHandlers = new Set<(s: ReaderState) => void>();
  private currentId: string | null = null;
  private cancelled = false;

  onState(handler: (s: ReaderState) => void) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private emit(s: ReaderState) {
    this.stateHandlers.forEach((h) => h(s));
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    this.cancelled = false;
    this.emit({ phase: 'connecting' });

    try {
      // 1. Ask OUR server to start a charge on the terminal.
      const start = await fetch('/api/payments/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: req.amount, reference: req.reference }),
      });

      if (!start.ok) {
        const result: ChargeResult = { status: 'error', message: `Gateway ${start.status}` };
        this.emit({ phase: 'done', result });
        return result;
      }

      const { paymentId } = (await start.json()) as { paymentId: string };
      this.currentId = paymentId;

      // 2. Machine is now lit up. Customer taps.
      this.emit({ phase: 'waiting_for_card', amount: req.amount });

      // 3. Poll until it resolves. 90s is a sane counter timeout.
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        if (this.cancelled) break;
        await new Promise((r) => setTimeout(r, 1200));

        const poll = await fetch(`/api/payments/charge?id=${paymentId}`);
        const data = (await poll.json()) as { status: string; result?: ChargeResult };

        if (data.status === 'reading') this.emit({ phase: 'reading' });
        if (data.status === 'authorising') this.emit({ phase: 'authorising' });

        if (data.status === 'settled' && data.result) {
          this.emit({ phase: 'done', result: data.result });
          this.currentId = null;
          return data.result;
        }
        if (data.status === 'failed') {
          const result: ChargeResult = data.result ?? { status: 'declined' };
          this.emit({ phase: 'done', result });
          this.currentId = null;
          return result;
        }
      }

      const timeout: ChargeResult = {
        status: this.cancelled ? 'cancelled' : 'error',
        message: this.cancelled ? 'Cancelled at till' : 'Timed out waiting for card',
      };
      this.emit({ phase: 'done', result: timeout });
      return timeout;
    } catch (e) {
      const result: ChargeResult = { status: 'error', message: (e as Error).message };
      this.emit({ phase: 'done', result });
      return result;
    }
  }

  async refund(req: RefundRequest): Promise<ChargeResult> {
    this.emit({ phase: 'connecting' });
    try {
      const res = await fetch('/api/payments/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: req.amount,
          reference: req.reference,
          originalReference: req.originalReference,
        }),
      });
      this.emit({ phase: 'authorising' });
      const data = (await res.json()) as { result?: ChargeResult; error?: string };
      const result: ChargeResult =
        res.ok && data.result
          ? data.result
          : { status: 'error', message: data.error ?? `Gateway ${res.status}` };
      this.emit({ phase: 'done', result });
      return result;
    } catch (e) {
      const result: ChargeResult = { status: 'error', message: (e as Error).message };
      this.emit({ phase: 'done', result });
      return result;
    }
  }

  async cancel() {
    this.cancelled = true;
    if (this.currentId) {
      await fetch('/api/payments/charge', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: this.currentId }),
      }).catch(() => {});
    }
  }

  simulateOutcome() {
    /* no-op when live */
  }
}
