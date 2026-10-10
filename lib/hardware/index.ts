// ═══════════════════════════════════════════════════════════════════
//  THE SWITCHES — one per device
//
//  This used to be a single NEXT_PUBLIC_HARDWARE_MODE for all four
//  devices, which cannot describe a real shop. Hardware does not
//  arrive in one box on one day: the scanner and the drawer turn up
//  on Tuesday and the printer on Wednesday. Flip one global switch
//  and the app starts talking to a printer that is not plugged in.
//
//  So: a default, and an override per device.
//
//      NEXT_PUBLIC_HARDWARE_MODE=mock      ← the default for all four
//      NEXT_PUBLIC_SCANNER_MODE=live       ← and the exceptions
//      NEXT_PUBLIC_PRINTER_MODE=live
//      NEXT_PUBLIC_DRAWER_MODE=live
//      NEXT_PUBLIC_READER_MODE=live
//
//  ── One wiring fact that decides the drawer ──────────────────────
//
//  A cash drawer has no brain and usually no cable to the PC. It
//  hangs off the RJ11 port on the BACK OF THE RECEIPT PRINTER, and it
//  opens when the printer is sent an ESC/POS kick (see
//  PrinterKickDrawer in ./live). So the drawer cannot go live before
//  the printer does, no matter how many drawers are on the counter.
//
//  If a drawer with its own USB/serial cable ever replaces it, write
//  a second CashDrawer implementation and switch on it here — the UI
//  never changes, which is the whole point of this file.
// ═══════════════════════════════════════════════════════════════════

import type { HardwareBundle, HardwareMode } from './types';
import { MockScanner, MockPrinter, MockDrawer, MockCardReader } from './mock';
import { KeyboardWedgeScanner, ThermalPrinter, PrinterKickDrawer, YocoCardReader } from './live';

export * from './types';

export type DeviceKind = 'scanner' | 'printer' | 'drawer' | 'reader';

const DEFAULT_MODE: HardwareMode =
  (process.env.NEXT_PUBLIC_HARDWARE_MODE as HardwareMode) === 'live' ? 'live' : 'mock';

// Read literally, never computed — Next inlines NEXT_PUBLIC_* at build
// time by matching the exact text, so process.env[name] returns
// undefined.
const OVERRIDES: Record<DeviceKind, string | undefined> = {
  scanner: process.env.NEXT_PUBLIC_SCANNER_MODE,
  printer: process.env.NEXT_PUBLIC_PRINTER_MODE,
  drawer: process.env.NEXT_PUBLIC_DRAWER_MODE,
  reader: process.env.NEXT_PUBLIC_READER_MODE,
};

const PRINT_BRIDGE = process.env.NEXT_PUBLIC_PRINT_BRIDGE_URL || '';
const PRINT_TOKEN = process.env.NEXT_PUBLIC_PRINT_BRIDGE_TOKEN || '';

function resolve(kind: DeviceKind): HardwareMode {
  const o = OVERRIDES[kind];
  if (o === 'live') return 'live';
  if (o === 'mock') return 'mock';
  return DEFAULT_MODE;
}

/** What this device is actually running on. */
export function deviceMode(kind: DeviceKind): HardwareMode {
  // A live drawer with a simulated printer is a drawer that silently
  // never opens: the kick is an ESC/POS command down the printer's
  // cable. Report the truth rather than letting a cashier wait for a
  // drawer that was never going to move.
  if (kind === 'drawer' && resolve('drawer') === 'live') {
    if (resolve('printer') !== 'live') return 'mock';
    // And with no bridge the printer falls back to the browser's
    // print dialog, which has no way to send the kick bytes at all.
    // A live drawer pointed at an empty URL would POST to the page
    // itself and report success, so it is mock until a bridge exists.
    if (!PRINT_BRIDGE) return 'mock';
  }
  return resolve(kind);
}

let bundle: HardwareBundle | null = null;

export function hardware(): HardwareBundle {
  if (bundle) return bundle;

  const printerLive = deviceMode('printer') === 'live';

  bundle = {
    // The bundle's own mode is 'live' only when everything is.
    mode: (['scanner', 'printer', 'drawer', 'reader'] as DeviceKind[])
      .every((k) => deviceMode(k) === 'live')
      ? 'live'
      : 'mock',
    scanner: deviceMode('scanner') === 'live' ? new KeyboardWedgeScanner() : new MockScanner(),
    printer: printerLive
      ? new ThermalPrinter({
          bridgeUrl: PRINT_BRIDGE || undefined,
          token: PRINT_TOKEN || undefined,
        })
      : new MockPrinter(),
    drawer:
      deviceMode('drawer') === 'live'
        ? new PrinterKickDrawer(PRINT_BRIDGE, PRINT_TOKEN || undefined)
        : new MockDrawer(),
    reader: deviceMode('reader') === 'live' ? new YocoCardReader() : new MockCardReader(),
  };

  return bundle;
}

/** True when ANY device is still simulated — drives the UI hints. */
export const isMock = () =>
  (['scanner', 'printer', 'drawer', 'reader'] as DeviceKind[])
    .some((k) => deviceMode(k) === 'mock');

/** Per-device, for a hint that should disappear as each one arrives. */
export const isMockDevice = (kind: DeviceKind) => deviceMode(kind) === 'mock';
