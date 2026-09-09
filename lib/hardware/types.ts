// ═══════════════════════════════════════════════════════════════════
//  HARDWARE CONTRACTS
// ═══════════════════════════════════════════════════════════════════
//
//  THE WHOLE POINT OF THIS FILE:
//  The UI never talks to a scanner, a printer, a drawer or a card
//  machine directly. It only ever talks to these four interfaces.
//
//  Today every one of them is backed by a *mock* that runs in the
//  browser (you click "Scan", you click "Approve"). The day the Yoco
//  machine and the printer land on the counter, you write the real
//  class, flip NEXT_PUBLIC_HARDWARE_MODE=live, and CHANGE NOTHING
//  in any screen.
//
//  Rule: if you ever find yourself importing a driver inside a
//  component, stop — it belongs behind one of these interfaces.
// ═══════════════════════════════════════════════════════════════════

export type HardwareMode = 'mock' | 'live';

// ─── 1. BARCODE SCANNER ────────────────────────────────────────────
// Real scanners are "keyboard wedge" devices: they type the barcode
// very fast and press Enter. The live driver listens for that burst.
// The mock driver fires when you click a product's scan button.

export interface BarcodeScanner {
  readonly kind: 'scanner';
  readonly mode: HardwareMode;
  /** Subscribe to scans. Returns an unsubscribe function. */
  onScan(handler: (barcode: string) => void): () => void;
  /** Mock only: pretend a barcode was scanned. No-op when live. */
  simulate(barcode: string): void;
}

// ─── 2. RECEIPT PRINTER ────────────────────────────────────────────

export interface ReceiptLine {
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

export interface ReceiptData {
  /** A refund prints a CREDIT NOTE, not a receipt. Same paper, different document. */
  doc_type?: 'receipt' | 'credit_note';
  /** Credit notes only: the receipt this reverses. */
  original_sale_number?: string;
  refund_reason?: string;
  refund_method?: string;
  /** Credit notes issued as a voucher: the code the customer redeems. */
  voucher_code?: string | null;
  voucher_expires?: string | null;
  store_name: string;
  store_address: string;
  store_phone: string;
  vat_number: string;
  sale_number: string;
  till_name: string;
  cashier_name: string;
  datetime: string;
  lines: ReceiptLine[];
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  payments: { method: string; amount: number; reference?: string }[];
  cash_received?: number;
  change_given?: number;
  /** Captured at checkout to email this receipt. Not an account. */
  customer_email?: string | null;
}

export interface PrintResult {
  ok: boolean;
  error?: string;
}

export interface ReceiptPrinter {
  readonly kind: 'printer';
  readonly mode: HardwareMode;
  print(receipt: ReceiptData): Promise<PrintResult>;
  /** Mock only: the receipts "printed" this session, for the preview drawer. */
  history(): ReceiptData[];
}

// ─── 3. CASH DRAWER ────────────────────────────────────────────────
// Almost every real drawer is opened by the *printer*, not the PC:
// you send an ESC/POS "kick" byte sequence down the printer cable.
// That is why the live drawer driver takes a printer handle.

export interface CashDrawer {
  readonly kind: 'drawer';
  readonly mode: HardwareMode;
  open(reason: string): Promise<void>;
  isOpen(): boolean;
  /** Mock only: the operator "pushes the drawer closed". */
  close(): void;
}

// ─── 4. CARD READER (Yoco) ─────────────────────────────────────────

export interface ChargeRequest {
  amount: number; // cents
  reference: string; // your sale number — shows on the Yoco slip
}

export type ChargeStatus = 'approved' | 'declined' | 'cancelled' | 'error';

export interface ChargeResult {
  status: ChargeStatus;
  reference?: string; // Yoco's transaction id
  last4?: string;
  cardBrand?: string;
  message?: string;
}

/** Progress the reader reports while the customer is at the machine. */
export type ReaderState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'waiting_for_card'; amount: number }
  | { phase: 'reading' }
  | { phase: 'authorising' }
  | { phase: 'done'; result: ChargeResult };

export interface RefundRequest extends ChargeRequest {
  /** Yoco's id for the ORIGINAL payment. A refund is made against it,
   *  which is why the card does not need to be present. */
  originalReference?: string;
}

export interface CardReader {
  readonly kind: 'reader';
  readonly mode: HardwareMode;
  charge(req: ChargeRequest): Promise<ChargeResult>;
  /** Money going the other way. Different API call, same contract. */
  refund(req: RefundRequest): Promise<ChargeResult>;
  cancel(): Promise<void>;
  onState(handler: (s: ReaderState) => void): () => void;
  /** Mock only: the buttons the demo overlay shows. */
  simulateOutcome(status: 'approved' | 'declined'): void;
}

export interface HardwareBundle {
  mode: HardwareMode;
  scanner: BarcodeScanner;
  printer: ReceiptPrinter;
  drawer: CashDrawer;
  reader: CardReader;
}
