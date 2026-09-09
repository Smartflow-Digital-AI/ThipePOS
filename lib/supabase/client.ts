import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The app runs perfectly well with no Supabase configured — it uses
// local state only. Wire the env vars up and sync starts working.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && key && !url.includes('YOUR-PROJECT'));

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) client = createClient(url!, key!);
  return client;
}
