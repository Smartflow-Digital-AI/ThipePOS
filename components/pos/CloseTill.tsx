'use client';

// ═══════════════════════════════════════════════════════════════════
// CLOSING THE TILL
//
// This used to live inside the Sales page, which meant the only way to
// end a shift was to leave the screen you had been staring at all day
// and find a button on a tab you never open. Cashiers could not find
// it. That is a real cost: a till that is never closed is a till with
// no variance, and a shop with no variance figures cannot tell a
// mistake from theft.
//
// So it is one component now, dropped into BOTH the till toolbar and
// the Sales header. One implementation of "what should be in the
// drawer" — the moment there are two, the shop starts arguing with
// its own software.
// ═══════════════════════════════════════════════════════════════════

import { useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { usePos } from '@/lib/store';
import { money, sessionTotals } from '@/lib/types';
import { Modal } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';

export function CloseTillButton({
  className = 'btn-ghost',
  /** Icon only until sm — for the till's cramped toolbar. */
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const session = usePos((s) => s.session);
  const sales = usePos((s) => s.sales);
  const refunds = usePos((s) => s.refunds);
  const closeTill = usePos((s) => s.closeTill);

  const [open, setOpen] = useState(false);
  const [countedCents, setCountedCents] = useState(0);
  const [result, setResult] = useState<
    { expected: number; counted: number; variance: number } | null
  >(null);
  // Closing a shift writes a permanent row. It happens once, however
  // many times the button is pressed.
  const settling = useRef(false);

  // Closing clears the live session slot, so the component would
  // unmount mid-flow and take the variance screen with it — the one
  // number the cashier actually has to read. Stay mounted while a
  // result is on screen; only the trigger button goes away.
  if (!session && !result) return null;

  const t = session ? sessionTotals(session, sales, refunds) : null;
  const reset = () => {
    setOpen(false);
    setResult(null);
    setCountedCents(0);
    settling.current = false;
  };

  return (
    <>
      {session?.status === 'open' && (
        <button className={className} onClick={() => setOpen(true)}>
          <Lock size={15} />
          <span className={compact ? 'hidden sm:inline' : undefined}>Close till</span>
        </button>
      )}

      <Modal
        open={open}
        onClose={reset}
        title={result ? 'Till closed' : 'Close till'}
        subtitle={result ? undefined : 'Count everything in the drawer, including the float'}
      >
        <div className="p-5">
          {!result && session && t ? (
            <>
              <div className="space-y-2 text-sm mb-5">
                <Row label="Opening float" value={money(session.opening_float)} />
                <Row label="Cash sales" value={money(t.cashIn)} />
                {t.cashOut > 0 && (
                  <Row label="Cash refunds paid out" value={'-' + money(t.cashOut)} bad />
                )}
                <div className="flex justify-between font-medium pt-2 border-t border-line">
                  <span>System expects</span>
                  <span className="num">{money(t.expected)}</span>
                </div>
              </div>

              <MoneyInput
                label="Counted in drawer"
                valueCents={countedCents}
                onChange={setCountedCents}
                autoFocus
                numpad
                size="lg"
                hint="Count everything, including the opening float."
              />

              <button
                className="btn-primary btn-lg w-full mt-4"
                disabled={countedCents <= 0}
                onClick={() => {
                  if (settling.current) return;
                  settling.current = true;
                  setResult(closeTill(countedCents));
                }}
              >
                Close till
              </button>
            </>
          ) : result ? (
            <div className="text-center py-2">
              <div className="text-2xs uppercase tracking-wider text-dim mb-2">Variance</div>
              <div
                className={`text-4xl font-semibold num mb-1 ${
                  result.variance === 0
                    ? 'text-ok'
                    : result.variance < 0
                      ? 'text-bad'
                      : 'text-warn'
                }`}
              >
                {result.variance === 0 ? 'Balanced' : money(result.variance)}
              </div>
              <div className="text-sm text-dim mb-6">
                Expected {money(result.expected)} · counted {money(result.counted)}
              </div>
              {result.variance !== 0 && (
                <p className="text-sm text-dim mb-6">
                  {result.variance < 0
                    ? 'The drawer is short. Recount, then check for a missed cash sale or change given twice.'
                    : 'The drawer is over. Usually a sale rung up as card but paid in cash.'}
                </p>
              )}
              <button className="btn-primary w-full" onClick={reset}>
                Done
              </button>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex justify-between text-dim">
      <span>{label}</span>
      <span className={`num ${bad ? 'text-bad' : ''}`}>{value}</span>
    </div>
  );
}
