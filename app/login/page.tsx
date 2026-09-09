'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Delete, Sparkles, Building2 } from 'lucide-react';
import { usePos } from '@/lib/store';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { TILLS, STORE, STAFF } from '@/lib/data/seed';
import { TILL_ROLES } from '@/lib/types';

// A cashier signs in dozens of times a day, often with wet or gloved
// hands. Big targets, no keyboard, no email field.
//
// This pad opens a TILL SESSION and nothing else. Even the owner's PIN
// here gets till permissions only — reports and cost prices live behind
// the office login, on a laptop, away from the counter. A PIN typed in
// front of a queue must never be worth more than one shift's sales.

export default function LoginPage() {
  const router = useRouter();
  const tillLogin = usePos((s) => s.tillLogin);
  const setTill = usePos((s) => s.setTill);
  const tillId = usePos((s) => s.tillId);

  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const settled = useRef(false);

  const press = useCallback((d: string) => {
    setError('');
    setPin((p) => (p.length < 4 ? p + d : p));
  }, []);

  useEffect(() => {
    if (pin.length !== 4 || settled.current) return;
    settled.current = true;
    const staff = tillLogin(pin);
    if (staff) {
      router.push('/till');
      return;
    }
    // A real PIN belonging to someone who simply cannot work a till
    // deserves a useful answer, not "not recognised".
    const known = STAFF.find((s) => s.pin === pin && s.is_active);
    setError(
      known && !TILL_ROLES.includes(known.role)
        ? 'Stock controllers sign in to the back office, not the till'
        : 'PIN not recognised'
    );
    setTimeout(() => {
      setPin('');
      settled.current = false;
    }, known ? 1600 : 500);
  }, [pin, tillLogin, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[340px]">
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand mb-4">
            <Sparkles size={22} className="text-brand-fg" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{STORE.name}</h1>
          <p className="text-sm text-dim mt-1">Enter your PIN to open the till</p>
        </div>

        <div className="flex gap-2 mb-7">
          {TILLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTill(t.id)}
              className={`flex-1 h-11 rounded-lg text-sm font-medium border transition-colors ${
                tillId === t.id
                  ? 'bg-brand-soft border-brand-line text-brand'
                  : 'bg-panel border-line text-dim hover:text-ink'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div className="flex justify-center gap-3 mb-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${
                error
                  ? 'border-bad bg-bad'
                  : i < pin.length
                    ? 'border-brand bg-brand scale-110'
                    : 'border-line'
              }`}
            />
          ))}
        </div>
        <div className="h-5 text-center text-2xs text-bad mb-5" role="status">
          {error}
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <Key key={d} onClick={() => press(d)}>{d}</Key>
          ))}
          <div />
          <Key onClick={() => press('0')}>0</Key>
          <Key onClick={() => setPin((p) => p.slice(0, -1))} muted>
            <Delete size={20} />
          </Key>
        </div>

        <Link
          href="/office/login"
          className="mt-7 flex items-center justify-center gap-2 text-sm text-dim hover:text-ink transition-colors"
        >
          <Building2 size={15} />
          Back office sign-in
        </Link>

        {/* Demo hint — delete this block before go-live. */}
        <div className="mt-5 card p-3">
          <div className="text-2xs uppercase tracking-wider text-faint mb-2">Demo till PINs</div>
          <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-2xs text-dim">
            <span>Thandeka · Cashier</span><span className="num text-ink">1234</span>
            <span>Sipho · Cashier</span><span className="num text-ink">4321</span>
            <span>Kagiso · Manager</span><span className="num text-ink">5555</span>
            <span>Karabo · Admin</span><span className="num text-ink">9999</span>
          </div>
          <div className="text-2xs text-faint mt-2 pt-2 border-t border-lineSoft">
            5555 and 9999 also approve overrides at the till.
          </div>
        </div>
      </div>
    </div>
  );
}

function Key({
  children, onClick, muted,
}: {
  children: React.ReactNode; onClick: () => void; muted?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-14 sm:h-16 rounded-lg text-xl font-medium num transition-all active:scale-95
        flex items-center justify-center ${
          muted
            ? 'text-dim hover:text-ink bg-transparent'
            : 'bg-panel hover:bg-raised border border-line shadow-card'
        }`}
    >
      {children}
    </button>
  );
}
