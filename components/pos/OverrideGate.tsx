'use client';

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Delete } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { usePos } from '@/lib/store';
import type { Override } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════════
//  MANAGER OVERRIDE
// ═══════════════════════════════════════════════════════════════════
//
//  A manager leans over, types their PIN, ONE action goes through, and
//  the cashier is still the cashier. Nobody swaps accounts.
//
//  That last part matters more than it sounds. The usual alternative —
//  the manager signs in to do the thing — ends with the manager's
//  session left open on a counter PC for the rest of the afternoon.
//  That is how small shops actually get robbed.
//
//  Every approval is written to the overrides table with who asked,
//  who approved, and what for. An override nobody can point at later
//  is not a control, it is a formality.
// ═══════════════════════════════════════════════════════════════════

export function OverrideGate({
  open,
  action,
  detail,
  title,
  because,
  onApproved,
  onCancel,
}: {
  open: boolean;
  /** Machine-readable, e.g. 'refund_outside_window'. Goes in the audit row. */
  action: string;
  /** Human-readable specifics: amounts, receipt number. Goes in the audit row. */
  detail: string;
  title: string;
  /** Why this needs approval, shown to the person holding the PIN. */
  because: string;
  onApproved: (override: Override) => void;
  onCancel: () => void;
}) {
  const approveOverride = usePos((s) => s.approveOverride);
  const cashier = usePos((s) => s.staff);

  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  // An approval must happen EXACTLY once per completed PIN.
  //
  // Without this latch the effect below re-runs on every render while
  // the PIN sits at four digits — and because onApproved is an inline
  // arrow from the parent, its identity changes every render, so the
  // effect re-fires, approves again, sets state, renders, approves...
  // The first run of this wrote 1143 override rows and refunded twice.
  //
  // Anything that spends money or writes an audit row needs a latch,
  // not just correct dependencies.
  const settled = useRef(false);

  useEffect(() => {
    if (open) {
      setPin('');
      setError('');
      settled.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (pin.length !== 4 || settled.current) return;
    settled.current = true;

    const result = approveOverride(pin, action, detail);
    if (result) {
      onApproved(result);
      return;
    }

    setError('Not a manager PIN');
    setTimeout(() => {
      setPin('');
      setError('');
      settled.current = false; // let them try again
    }, 900);
  }, [pin, approveOverride, action, detail, onApproved]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p));
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <Modal open={open} onClose={onCancel} width="max-w-sm">
      <div className="p-5 text-center">
        <div className="w-12 h-12 rounded-xl bg-warn-soft border border-warn/30 flex items-center justify-center mx-auto mb-4">
          <ShieldCheck size={21} className="text-warn" />
        </div>

        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-dim mt-1.5 mb-1">{because}</p>
        <p className="text-2xs text-faint mb-6">
          A manager or admin PIN approves this once. {cashier?.full_name} stays signed in.
        </p>

        <div className="flex justify-center gap-3 mb-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full border-2 transition-all ${
                error
                  ? 'border-bad bg-bad'
                  : i < pin.length
                    ? 'border-warn bg-warn scale-110'
                    : 'border-line'
              }`}
            />
          ))}
        </div>
        <div className="h-5 text-2xs text-bad mb-4" role="status">{error}</div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {['1','2','3','4','5','6','7','8','9'].map((d) => (
            <Key key={d} onClick={() => setPin((p) => (p.length < 4 ? p + d : p))}>{d}</Key>
          ))}
          <div />
          <Key onClick={() => setPin((p) => (p.length < 4 ? p + '0' : p))}>0</Key>
          <Key muted onClick={() => setPin((p) => p.slice(0, -1))}>
            <Delete size={17} />
          </Key>
        </div>

        <button className="btn-quiet w-full" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
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
      className={`h-12 rounded-lg text-lg font-medium num transition-all active:scale-95
        flex items-center justify-center ${
          muted
            ? 'text-dim hover:text-ink hover:bg-raised'
            : 'bg-panel hover:bg-raised border border-line'
        }`}
    >
      {children}
    </button>
  );
}
