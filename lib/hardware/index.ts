// ═══════════════════════════════════════════════════════════════════
//  THE SWITCH
// ═══════════════════════════════════════════════════════════════════
//  One env var decides whether the whole app is running on
//  simulated hardware or real hardware. Nothing else changes.
//
//      NEXT_PUBLIC_HARDWARE_MODE=mock   ← today
//      NEXT_PUBLIC_HARDWARE_MODE=live   ← when the boxes arrive
// ═══════════════════════════════════════════════════════════════════

import type { HardwareBundle, HardwareMode } from './types';
import { MockScanner, MockPrinter, MockDrawer, MockCardReader } from './mock';
import { KeyboardWedgeScanner, ThermalPrinter, PrinterKickDrawer, YocoCardReader } from './live';

export * from './types';

const MODE: HardwareMode =
  (process.env.NEXT_PUBLIC_HARDWARE_MODE as HardwareMode) === 'live' ? 'live' : 'mock';

const PRINT_BRIDGE = process.env.NEXT_PUBLIC_PRINT_BRIDGE_URL || '';

let bundle: HardwareBundle | null = null;

export function hardware(): HardwareBundle {
  if (bundle) return bundle;

  bundle =
    MODE === 'live'
      ? {
          mode: 'live',
          scanner: new KeyboardWedgeScanner(),
          printer: new ThermalPrinter({ bridgeUrl: PRINT_BRIDGE || undefined }),
          drawer: new PrinterKickDrawer(PRINT_BRIDGE),
          reader: new YocoCardReader(),
        }
      : {
          mode: 'mock',
          scanner: new MockScanner(),
          printer: new MockPrinter(),
          drawer: new MockDrawer(),
          reader: new MockCardReader(),
        };

  return bundle;
}

export const isMock = () => MODE === 'mock';
