'use client';

// ═══════════════════════════════════════════════════════════════════
// CAPTURE AT THE COUNTER
//
// One field, and it is the cellphone number. Not a form, not a
// sign-up, not a password — the most a shopper will give you with a
// queue behind them is ten digits read off the top of their head.
//
// What the cashier sees changes as they type, because the cashier has
// to say something out loud:
//
//   nothing yet   → "Cellphone for points"
//   half a number → quiet, no nagging
//   valid, new    → "New — will join on payment"
//   valid, known  → the name, the balance, and what it is worth
//   ≥100 points   → a Redeem button, right there
//
// Email is still available behind a link. It was the old primary and
// some customers do want the slip emailed; it just is not what gets
// asked first any more.
//
// POPIA: the purpose is printed under the field. Marketing is a
// separate opt-in on the member record, not a consequence of buying
// something.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Mail, Phone, Sparkles, Ticket, X } from 'lucide-react';
import { usePos } from '@/lib/store';
import {
  formatPhone, isValidPhone, money, normalisePhone, pointsFor,
  POINTS_PER_VOUCHER, RAND_PER_POINT, VOUCHER_RAND_PER_REDEMPTION,
} from '@/lib/types';

export function LoyaltyCapture({ cartTotal }: { cartTotal: number }) {
  const salePhone = usePos((s) => s.salePhone);
  const setSalePhone = usePos((s) => s.setSalePhone);
  const saleEmail = usePos((s) => s.saleEmail);
  const setSaleEmail = usePos((s) => s.setSaleEmail);
  const members = usePos((s) => s.loyaltyMembers);
  const redeemPoints = usePos((s) => s.redeemPoints);

  const [showEmail, setShowEmail] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  const valid = isValidPhone(salePhone);
  const member = useMemo(() => {
    if (!valid) return null;
    const key = normalisePhone(salePhone);
    return members.find((m) => m.phone === key) ?? null;
  }, [valid, salePhone, members]);

  const willEarn = pointsFor(cartTotal);
  const canRedeem = (member?.points ?? 0) >= POINTS_PER_VOUCHER;

  return (
    <div className="flex-none px-4 py-3 border-b border-line space-y-2">
      <div className="relative">
        <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          className="input pl-9 h-10"
          placeholder="Cellphone for points (optional)"
          value={salePhone}
          onChange={(e) => {
            setSalePhone(e.target.value);
            setIssued(null);
          }}
        />
        {salePhone && (
          <button
            onClick={() => {
              setSalePhone('');
              setIssued(null);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
            aria-label="Clear number"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Stay quiet while they are still typing. Only speak once the
          number is complete enough to mean something. */}
      {valid && (
        <div className="rounded-lg border border-line bg-raised px-3 py-2.5">
          {member ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium truncate">
                  {member.name || formatPhone(member.phone)}
                </span>
                <span className="num text-sm font-semibold text-brand flex-none">
                  {member.points} pts
                </span>
              </div>
              <div className="text-2xs text-dim mt-0.5">
                {willEarn > 0
                  ? `Earns ${willEarn} more on this sale`
                  : `Spend R${RAND_PER_POINT} to earn a point`}
                {member.lifetime_spend > 0 && (
                  <> · {money(member.lifetime_spend)} lifetime</>
                )}
              </div>

              {canRedeem && !issued && (
                <button
                  className="btn-primary h-9 w-full mt-2.5 text-2xs"
                  onClick={() => {
                    const v = redeemPoints(member.id);
                    if (v) setIssued(v.code);
                  }}
                >
                  <Ticket size={14} />
                  Redeem {POINTS_PER_VOUCHER} pts for a R{VOUCHER_RAND_PER_REDEMPTION} voucher
                </button>
              )}

              {issued && (
                <div className="mt-2.5 rounded-lg bg-ok-soft border border-ok/25 px-2.5 py-2">
                  <div className="text-2xs text-ok font-medium">
                    Voucher issued — print it and hand it over
                  </div>
                  <div className="num text-sm font-semibold tracking-wider mt-0.5">
                    {issued}
                  </div>
                  <div className="text-[10px] text-dim mt-0.5">
                    Apply it under Voucher at payment.
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-brand flex-none" />
              <div className="min-w-0">
                <div className="text-sm">New customer</div>
                <div className="text-2xs text-dim">
                  Joins on payment{willEarn > 0 && ` · earns ${willEarn} pts`}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!showEmail ? (
        <button
          className="text-2xs text-faint hover:text-ink transition-colors inline-flex items-center gap-1.5"
          onClick={() => setShowEmail(true)}
        >
          <Mail size={12} /> Email the slip instead
        </button>
      ) : (
        <div className="relative">
          <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="email"
            inputMode="email"
            className="input pl-9 h-10"
            placeholder="Email receipt (optional)"
            value={saleEmail}
            onChange={(e) => setSaleEmail(e.target.value)}
            autoFocus
          />
          <button
            onClick={() => {
              setSaleEmail('');
              setShowEmail(false);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
            aria-label="Hide email"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* The stated purpose, on screen, where the number is typed. */}
      <p className="text-[10px] text-faint leading-relaxed">
        Used for the receipt and points only. No marketing without asking.
      </p>
    </div>
  );
}
