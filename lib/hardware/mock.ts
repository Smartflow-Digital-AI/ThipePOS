// ═══════════════════════════════════════════════════════════════════
//  MOCK DRIVERS — no hardware required
// ═══════════════════════════════════════════════════════════════════
//  Everything here runs in the browser and is driven by clicks.
//  Deliberately includes realistic *delays* and *failure paths* so the
//  UI you build against it is the UI that survives real hardware.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Scanner ───────────────────────────────────────────────────────

export class MockScanner implements BarcodeScanner {
  readonly kind = 'scanner' as const;
  readonly mode = 'mock' as const;
  private handlers = new Set<(b: string) => void>();

  onScan(handler: (barcode: string) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  simulate(barcode: string) {
    // Real scanners take ~60-120ms to burst the characters through.
    setTimeout(() => this.handlers.forEach((h) => h(barcode)), 80);
  }
}

// ─── Printer ───────────────────────────────────────────────────────

export class MockPrinter implements ReceiptPrinter {
  readonly kind = 'printer' as const;
  readonly mode = 'mock' as const;
  private printed: ReceiptData[] = [];

  async print(receipt: ReceiptData): Promise<PrintResult> {
    await sleep(600); // thermal printers are not instant
    this.printed.unshift(receipt);
    return { ok: true };
  }

  history() {
    return this.printed;
  }
}

// ─── Cash drawer ───────────────────────────────────────────────────

export class MockDrawer implements CashDrawer {
  readonly kind = 'drawer' as const;
  readonly mode = 'mock' as const;
  private _open = false;
  private listeners = new Set<() => void>();

  async open(_reason: string) {
    await sleep(200);
    this._open = true;
    this.listeners.forEach((l) => l());
  }

  isOpen() {
    return this._open;
  }

  close() {
    this._open = false;
    this.listeners.forEach((l) => l());
  }

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

// ─── Card reader ───────────────────────────────────────────────────

export class MockCardReader implements CardReader {
  readonly kind = 'reader' as const;
  readonly mode = 'mock' as const;

  private stateHandlers = new Set<(s: ReaderState) => void>();
  private resolver: ((r: ChargeResult) => void) | null = null;
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
    await sleep(500); // waking the machine over bluetooth

    if (this.cancelled) return this.finish({ status: 'cancelled' });

    // Now we sit and wait for a human. The overlay in the UI shows
    // "Approve" / "Decline" buttons which call simulateOutcome().
    this.emit({ phase: 'waiting_for_card', amount: req.amount });

    return new Promise<ChargeResult>((resolve) => {
      this.resolver = resolve;
    });
  }

  async simulateOutcome(status: 'approved' | 'declined') {
    if (!this.resolver) return;

    this.emit({ phase: 'reading' });
    await sleep(700);
    this.emit({ phase: 'authorising' });
    await sleep(900);

    const result: ChargeResult =
      status === 'approved'
        ? {
            status: 'approved',
            reference: 'yoco_' + Math.random().toString(36).slice(2, 12),
            last4: String(Math.floor(1000 + Math.random() * 9000)),
            cardBrand: Math.random() > 0.5 ? 'Visa' : 'Mastercard',
          }
        : { status: 'declined', message: 'Card declined by issuer' };

    this.finish(result);
  }

  // A refund goes against the original transaction, so no card is
  // presented and there is nothing for the operator to approve —
  // it either succeeds at the gateway or it does not.
  async refund(req: RefundRequest): Promise<ChargeResult> {
    this.emit({ phase: 'connecting' });
    await sleep(600);
    this.emit({ phase: 'authorising' });
    await sleep(1100);
    const result: ChargeResult = {
      status: 'approved',
      reference: 'yoco_rf_' + Math.random().toString(36).slice(2, 10),
    };
    this.emit({ phase: 'done', result });
    setTimeout(() => this.emit({ phase: 'idle' }), 400);
    void req;
    return result;
  }

  async cancel() {
    this.cancelled = true;
    this.finish({ status: 'cancelled', message: 'Cancelled at till' });
  }

  private finish(result: ChargeResult): ChargeResult {
    this.emit({ phase: 'done', result });
    this.resolver?.(result);
    this.resolver = null;
    setTimeout(() => this.emit({ phase: 'idle' }), 400);
    return result;
  }
}
