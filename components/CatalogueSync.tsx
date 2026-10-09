'use client';

// Pulls the shelf from Postgres whenever this browser is connected,
// and again when the window is refocused — a manager who changes a
// price on a laptop should not have to tell the till to reload.
//
// It does NOT block anything. If the fetch fails the app carries on
// with the last known catalogue, which is the point of keeping one.

import { useEffect } from 'react';
import { usePos } from '@/lib/store';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { fetchCatalogue } from '@/lib/supabase/catalogue';

const REFRESH_MS = 5 * 60 * 1000;

export function CatalogueSync() {
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let alive = true;
    const pull = async () => {
      const r = await fetchCatalogue();
      if (!alive || !r.ok || !r.products) return;
      // An empty catalogue is almost always a permissions problem,
      // never a shop with no products. Keep what we have.
      if (r.products.length === 0) return;
      usePos.getState().setCatalogue(r.products);
    };

    void pull();
    const timer = setInterval(() => void pull(), REFRESH_MS);
    const onFocus = () => void pull();
    window.addEventListener('focus', onFocus);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return null;
}
