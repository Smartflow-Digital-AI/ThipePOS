'use client';

// Fills a brand-new browser with a month of trading, once.
//
// Mounted in the root layout so it runs before anyone reaches a
// screen. It is a no-op if this browser already has sales, if a demo
// month was already generated here, or if Supabase is configured —
// see seedDemo() in the store.
//
// Turn it off for a real deployment with:
//     NEXT_PUBLIC_DEMO_MODE=off

import { useEffect } from 'react';
import { usePos } from '@/lib/store';

export const DEMO_DISABLED = process.env.NEXT_PUBLIC_DEMO_MODE === 'off';

export function DemoSeeder() {
  useEffect(() => {
    if (DEMO_DISABLED) return;
    const run = () => usePos.getState().seedDemo();
    // localStorage rehydrates synchronously, but not contractually so.
    if (usePos.persist.hasHydrated()) run();
    else return usePos.persist.onFinishHydration(run);
  }, []);

  return null;
}
