// ═══════════════════════════════════════════════════════════════════
//  THE SECOND SCREEN
//
//  The Hisense HK718 has a 10" customer-facing display beside the 14"
//  operator screen. Windows sees it as a second monitor, so it holds
//  a second browser window pointed at /customer.
//
//  The two windows talk over BroadcastChannel: same origin, same
//  machine, instant, and — the part that matters in a shop — it keeps
//  working with the internet down. Supabase realtime would add a
//  network round trip to something happening 30cm away, and polling
//  localStorage is visibly laggy when a cashier scans fast.
//
//  Why a shopper watching the screen matters: prices appearing one by
//  one is how a R2 000 basket avoids ending in "that is not what the
//  shelf said". The dispute happens at item three, not at the till.
// ═══════════════════════════════════════════════════════════════════

export const CHANNEL = 'beautypos-customer-display';

export interface DisplayLine {
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

export interface DisplayState {
  /** idle → nothing in the basket. selling → scanning. paid → the
   *  thank-you and change screen, which replaces the basket. */
  phase: 'idle' | 'selling' | 'paid';
  store_name: string;
  lines: DisplayLine[];
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  /** paid only */
  sale_number?: string;
  cash_received?: number;
  change_given?: number;
  points_earned?: number;
  points_balance?: number;
}

type Message =
  | { kind: 'state'; state: DisplayState }
  /** A display that opens after the till has nothing to show until
   *  the next scan. It asks, and the till answers. */
  | { kind: 'hello' };

function channel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (typeof BroadcastChannel === 'undefined') return null; // old WebView
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

/** Till side: push the current basket to the display. */
export function publish(state: DisplayState): void {
  const c = channel();
  if (!c) return;
  try {
    c.postMessage({ kind: 'state', state } satisfies Message);
  } finally {
    c.close();
  }
}

/** Display side: listen. Returns an unsubscribe. */
export function subscribe(onState: (s: DisplayState) => void): () => void {
  const c = channel();
  if (!c) return () => {};
  c.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.kind === 'state') onState(e.data.state);
  };
  // Ask whoever is already running for the current basket, so a
  // display that was opened second is not blank until someone scans.
  try {
    c.postMessage({ kind: 'hello' } satisfies Message);
  } catch {
    /* a closed channel is not worth a crash on a shop floor */
  }
  return () => c.close();
}

/** Till side: answer a display that just opened. */
export function onHello(reply: () => DisplayState): () => void {
  const c = channel();
  if (!c) return () => {};
  c.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.kind !== 'hello') return;
    try {
      c.postMessage({ kind: 'state', state: reply() } satisfies Message);
    } catch {
      /* ignore */
    }
  };
  return () => c.close();
}
