'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, ScanLine, Eye, EyeOff } from 'lucide-react';
import { usePos } from '@/lib/store';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { signInOffice } from '@/lib/supabase/auth';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { STORE } from '@/lib/data/seed';

// ─────────────────────────────────────────────────────────────
// BACK OFFICE SIGN-IN
//
// Separate from the till on purpose. This is where cost prices,
// margins, stock value and settings live, so it takes a real
// password and is meant for a laptop in the back — not the
// counter PC that stays signed in all day in front of customers.
//
// Authentication is Supabase Auth when a database is configured.
// It used to string-compare the password against lib/data/seed.ts,
// which ships inside the JavaScript bundle — anyone who opened
// devtools on the deployed site could read the owner's password and
// sign in to cost prices, margins and every report.
//
// The local compare survives ONLY for a build with no Supabase
// configured, which is the offline demo and holds nothing real.
// ─────────────────────────────────────────────────────────────

export default function OfficeLoginPage() {
  const router = useRouter();
  const officeLogin = usePos((s) => s.officeLogin);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');

  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (isSupabaseConfigured) {
      setBusy(true);
      const r = await signInOffice(email, password);
      setBusy(false);
      if (!r.ok) {
        setError(r.error ?? 'Those details do not match an account with office access');
        return;
      }
      // The Supabase session is the authority on who this is. The
      // local store still needs a staff record for the UI — match it
      // on the email that just authenticated, never on the password.
      const staff = officeLogin(email, password, { trusted: true });
      if (!staff) {
        setError('Signed in, but no staff record matches that address on this device');
        return;
      }
      router.push(staff.role === 'stock_controller' ? '/products' : '/dashboard');
      return;
    }

    const staff = officeLogin(email, password);
    if (!staff) {
      setError('Those details do not match an account with office access');
      return;
    }
    router.push(staff.role === 'stock_controller' ? '/products' : '/dashboard');
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[360px]">
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-raised border border-line mb-4">
            <Building2 size={21} className="text-dim" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Back office</h1>
          <p className="text-sm text-dim mt-1">{STORE.name}</p>
        </div>

        <form onSubmit={submit} className="card p-5">
          <label className="label">Email</label>
          <input
            autoFocus
            type="email"
            autoComplete="username"
            className="input mb-4"
            placeholder="you@glowbeauty.co.za"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label className="label">Password</label>
          <div className="relative mb-4">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              className="input pr-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-bad-soft border border-bad/25 text-bad text-sm">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary btn-lg w-full" disabled={!email || !password}>
            Sign in
          </button>
        </form>

        <Link
          href="/login"
          className="mt-5 flex items-center justify-center gap-2 text-sm text-dim hover:text-ink transition-colors"
        >
          <ScanLine size={15} />
          Till sign-in
        </Link>

        {/* Demo hint — delete this block before go-live. */}
        <div className="mt-5 card p-3">
          <div className="text-2xs uppercase tracking-wider text-faint mb-2">Demo accounts</div>
          <div className="space-y-1 text-2xs text-dim">
            <div>karabo@glowbeauty.co.za · <span className="text-ink num">admin123</span> — admin</div>
            <div>kagiso@glowbeauty.co.za · <span className="text-ink num">manager123</span> — manager</div>
            <div>zanele@glowbeauty.co.za · <span className="text-ink num">stock123</span> — stock only</div>
          </div>
        </div>
      </div>
    </div>
  );
}
