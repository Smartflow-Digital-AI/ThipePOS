'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { money } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════════
//  MONEY ENTRY — implied decimal, digits fill from the right
// ═══════════════════════════════════════════════════════════════════
//
//  Type 1 4 0 0 0  and you get R140.00. Not R14 000.
//
//  This is how every card machine, ATM and dedicated POS terminal on
//  earth takes an amount, and it is the ONLY safe way to do it at a
//  till. The alternative — a free-text field parsed as rands — lets a
//  cashier enter R14 000 when they meant R140 and hand over R12 000 in
//  change. There is no decimal point to miss, because there is no
//  decimal point.
//
//  It also matches the Yoco terminal sitting next to the screen, so
//  the cashier builds one piece of muscle memory instead of two.
// ═══════════════════════════════════════════════════════════════════

export function MoneyInput({
  valueCents,
  onChange,
  autoFocus,
  numpad = false,
  size = 'md',
  label,
  hint,
  tone,
}: {
  valueCents: number;
  onChange: (cents: number) => void;
  autoFocus?: boolean;
  /** Show the on-screen keypad. Use it anywhere a touchscreen is likely. */
  numpad?: boolean;
  size?: 'md' | 'lg';
  label?: string;
  hint?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  // The digit string is the source of truth; cents are derived. Keeping
  // it this way means leading zeros behave and backspace is exact.
  const [digits, setDigits] = useState(() =>
    valueCents ? String(Math.round(valueCents)) : ''
  );
  const boxRef = useRef<HTMLDivElement>(null);

  // Let a parent reset us (quick-tender buttons, a new sale).
  useEffect(() => {
    const asDigits = valueCents ? String(Math.round(valueCents)) : '';
    setDigits((d) => (Number(d || '0') === Math.round(valueCents) ? d : asDigits));
  }, [valueCents]);

  const push = useCallback(
    (d: string) => {
      setDigits((prev) => {
        // 9 digits is R9,999,999.99 — nobody is taking that in cash.
        const next = (prev + d).replace(/^0+/, '').slice(0, 9);
        onChange(Number(next || '0'));
        return next;
      });
    },
    [onChange]
  );

  const pop = useCallback(() => {
    setDigits((prev) => {
      const next = prev.slice(0, -1);
      onChange(Number(next || '0'));
      return next;
    });
  }, [onChange]);

  const clear = useCallback(() => {
    setDigits('');
    onChange(0);
  }, [onChange]);

  useEffect(() => {
    if (autoFocus) boxRef.current?.focus();
  }, [autoFocus]);

  const onKey = (e: React.KeyboardEvent) => {
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      push(e.key);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      pop();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clear();
    }
    // "." and "," are deliberately ignored — there is no decimal to type.
  };

  const toneClass =
    tone === 'ok' ? 'text-ok border-ok/40'
    : tone === 'warn' ? 'text-warn border-warn/40'
    : tone === 'bad' ? 'text-bad border-bad/40'
    : 'text-ink border-line';

  return (
    <div>
      {label && <label className="label">{label}</label>}

      {/* Not a real <input>: we control every keystroke, and a text
          field would let a paste or an IME slip a decimal in. */}
      <div
        ref={boxRef}
        role="textbox"
        aria-label={label ?? 'Amount'}
        aria-valuetext={money(valueCents)}
        tabIndex={0}
        onKeyDown={onKey}
        className={`w-full bg-panel border rounded-lg px-4 flex items-center justify-end
                    font-semibold num tabular-nums cursor-text transition
                    outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/60
                    ${toneClass}
                    ${size === 'lg' ? 'h-16 text-3xl' : 'h-12 text-xl'}`}
      >
        {digits ? money(Number(digits)) : <span className="text-faint">R0.00</span>}
      </div>

      {hint && <div className="text-2xs text-dim mt-1.5">{hint}</div>}

      {numpad && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          {['1','2','3','4','5','6','7','8','9'].map((d) => (
            <PadKey key={d} onClick={() => push(d)}>{d}</PadKey>
          ))}
          <PadKey onClick={() => push('00')}>00</PadKey>
          <PadKey onClick={() => push('0')}>0</PadKey>
          <PadKey onClick={pop} muted aria-label="Delete">
            <Delete size={18} />
          </PadKey>
        </div>
      )}
    </div>
  );
}

function PadKey({
  children, onClick, muted, ...rest
}: {
  children: React.ReactNode; onClick: () => void; muted?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-12 rounded-lg text-lg font-medium num transition-all active:scale-95
        flex items-center justify-center ${
          muted
            ? 'text-dim hover:text-ink hover:bg-raised'
            : 'bg-panel hover:bg-raised border border-line'
        }`}
      {...rest}
    >
      {children}
    </button>
  );
}
