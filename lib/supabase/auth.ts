'use client';

// ═══════════════════════════════════════════════════════════════════
//  WHO THIS BROWSER IS
//
//  One Supabase session per browser, and it is one of two things:
//
//    a TILL DEVICE  — the machine on the counter. Connected once, by
//                     an admin, when the till is set up. The cashier
//                     PIN sits on top of it and opens a shift; it is
//                     not a database identity.
//
//    an OFFICE USER — a named person on a laptop, with their own
//                     account, because a sign-in log where three
//                     people share one login tells you nothing.
//
//  Why a till is typed in by hand rather than read from an env var:
//  anything in NEXT_PUBLIC_* is compiled into the JavaScript bundle
//  and served to the public. A password there is not a password. The
//  refresh token that sign-in produces lives in this browser's
//  storage instead, and supabase-js keeps it alive.
//
//  store_id and pos_role come from app_metadata, which only the
//  service key can write. Never trust user_metadata for this: the
//  holder of the token can edit it and promote themselves.
// ═══════════════════════════════════════════════════════════════════

import { supabase, isSupabaseConfigured } from './client';
import type { Role } from '@/lib/types';

export type PosRole = 'till' | 'cashier' | 'stock_controller' | 'manager' | 'admin';

export interface Claims {
  userId: string;
  email: string | null;
  storeId: string | null;
  posRole: PosRole | null;
  /** Which counter this machine IS. Only till accounts carry it.
   *  A shop with three tills cannot leave this to a button on the
   *  login screen: one mistaken tap and a cashier's takings land on
   *  another till's cash-up, and nobody notices until the counts
   *  disagree at close. The account the machine was connected with
   *  decides it, once, at setup. */
  tillId: string | null;
}

function readClaims(session: { access_token: string; user: { id: string; email?: string | null } } | null): Claims | null {
  if (!session) return null;
  let meta: Record<string, unknown> = {};
  try {
    const part = session.access_token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    meta = (JSON.parse(json).app_metadata ?? {}) as Record<string, unknown>;
  } catch {
    // A token we cannot read is a token we do not trust.
    return null;
  }
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    storeId: (meta.store_id as string) ?? null,
    posRole: (meta.pos_role as PosRole) ?? null,
    tillId: (meta.till_id as string) ?? null,
  };
}

export async function currentClaims(): Promise<Claims | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return readClaims(data.session as never);
}

/** True when this browser can write to the database at all. */
export async function isConnected(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const c = await currentClaims();
  return Boolean(c?.storeId && c.posRole);
}

export interface SignInResult {
  ok: boolean;
  claims?: Claims;
  error?: string;
}

async function signIn(email: string, password: string): Promise<SignInResult> {
  const sb = supabase();
  if (!sb) return { ok: false, error: 'Supabase is not configured on this build' };

  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) return { ok: false, error: error.message };

  const claims = readClaims(data.session as never);
  if (!claims?.storeId || !claims.posRole) {
    // Signed in, but the account was never given its shop and role.
    // Refuse rather than half-work: every policy keys off these, so
    // the session would be able to do nothing and say nothing useful.
    await sb.auth.signOut();
    return {
      ok: false,
      error: 'That account has no store or role set. An admin must set store_id and pos_role in app_metadata.',
    };
  }
  return { ok: true, claims };
}

/** Connect this machine as a till. Done once, by an admin, on the till. */
export async function connectTill(email: string, password: string): Promise<SignInResult> {
  const r = await signIn(email, password);
  if (!r.ok) return r;
  if (r.claims!.posRole !== 'till') {
    await supabase()!.auth.signOut();
    return { ok: false, error: 'That is not a till account. Use the till credentials for this machine.' };
  }
  return r;
}

/** A named person signing in to the back office. */
export async function signInOffice(email: string, password: string): Promise<SignInResult> {
  const r = await signIn(email, password);
  if (!r.ok) return r;
  const allowed: PosRole[] = ['manager', 'admin', 'stock_controller'];
  if (!allowed.includes(r.claims!.posRole!)) {
    await supabase()!.auth.signOut();
    return { ok: false, error: 'That account does not have back-office access' };
  }
  return r;
}

export async function signOutDevice(): Promise<void> {
  await supabase()?.auth.signOut();
}

/** Map the JWT role onto the app's own Role union. */
export function posRoleToRole(p: PosRole | null): Role | null {
  if (p === 'admin' || p === 'manager' || p === 'stock_controller' || p === 'cashier') return p;
  return null;
}
