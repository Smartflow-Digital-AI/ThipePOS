'use client';

// ═══════════════════════════════════════════════════════════════════
//  CONNECT THIS TILL
//
//  Shown once per machine, before the PIN pad, when the app is
//  pointed at a real database and this browser has no session.
//
//  An admin types the till's credentials here. They are never in the
//  bundle — a password compiled into NEXT_PUBLIC_* is served to every
//  visitor and is therefore not a password. What stays behind is a
//  refresh token in this browser's storage, which supabase-js keeps
//  alive indefinitely, including across nights with no internet.
//
//  Until this is done the till still SELLS: everything is written
//  locally first and the queue holds. It just has nowhere to drain.
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Link2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { connectTill } from '@/lib/supabase/auth';

export function ConnectTill({ onConnected }: { onConnected: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const r = await connectTill(email, password);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'Could not connect this till');
      return;
    }
    onConnected();
  };

  return (
    <div className="w-full max-w-[360px]">
      <div className="text-center mb-7">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-soft border border-brand-line mb-4">
          <Link2 size={21} className="text-brand" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Connect this till</h1>
        <p className="text-sm text-dim mt-1">
          Done once, by a manager, on this machine
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="till-email">Till account</label>
          <input
            id="till-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            className="input"
            placeholder="till1@…"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="label" htmlFor="till-pw">Password</label>
          <div className="relative">
            <input
              id="till-pw"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              className="input pr-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div className="h-5 text-2xs text-bad" role="status">{error}</div>

        <button className="btn-primary btn-lg w-full" disabled={busy || !email || !password}>
          {busy ? 'Connecting…' : 'Connect till'}
        </button>
      </form>

      <div className="mt-6 card p-3.5">
        <div className="flex items-start gap-2.5">
          <ShieldCheck size={15} className="text-dim flex-none mt-0.5" />
          <p className="text-2xs text-dim leading-relaxed">
            This signs in the <span className="text-ink">machine</span>, not a
            person. Cashiers still use their own 4-digit PIN, and a PIN never
            opens cost prices or reports.
          </p>
        </div>
      </div>
    </div>
  );
}
