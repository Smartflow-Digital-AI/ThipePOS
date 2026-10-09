'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, ScanLine, Plus, Minus, Trash2, X, Lock,
  ShoppingCart, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { usePos } from '@/lib/store';
import { hardware, isMockDevice } from '@/lib/hardware';
import { cartTotals, money, stockStatus, type Product } from '@/lib/types';
import { CATEGORIES } from '@/lib/data/seed';
import { PaymentFlow } from '@/components/pos/PaymentFlow';
import { Modal } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { CloseTillButton } from '@/components/pos/CloseTill';
import { LoyaltyCapture } from '@/components/pos/LoyaltyCapture';

export default function TillPage() {
  const products = usePos((s) => s.products);
  const cart = usePos((s) => s.cart);
  const session = usePos((s) => s.session);
  const { addProduct, addByBarcode, setQty, removeLine, clearCart, openTill } = usePos();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [payOpen, setPayOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false); // tablet slide-over
  const [floatCents, setFloatCents] = useState(100000); // R1 000
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const totals = cartTotals(cart);
  const units = cart.reduce((n, l) => n + l.qty, 0);
  const hw = hardware();

  // The scanner. Mock mode fires this from the tile buttons; live mode
  // from the real USB scanner. Identical handler either way.
  useEffect(() => {
    return hw.scanner.onScan((barcode) => {
      const found = addByBarcode(barcode);
      // A failed scan says what actually arrived and how many digits,
      // because the usual causes are invisible otherwise: a scanner
      // adding a prefix, a scanner set to Code-39 so it drops the
      // leading digit, or a shelf that never loaded. The shelf count
      // separates "wrong code" from "no catalogue" at a glance.
      const text = found
        ? `Added ${found.name}`
        : `Unknown barcode ${barcode} · ${barcode.length} digits · ${products.length} on shelf`;
      setToast({ text, ok: Boolean(found) });
      setTimeout(() => setToast(null), found ? 1600 : 4000);
    });
  }, [hw, addByBarcode]);

  // "/" focuses search, like every fast retail system.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== 'All' && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.variant.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.barcode.includes(q)
      );
    });
  }, [products, query, category]);

  // ── Till must be opened before anything can be sold ──────────────
  if (!session || session.status === 'closed') {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="card p-6 w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-xl bg-raised border border-line flex items-center justify-center mx-auto mb-4">
            <Lock size={20} className="text-dim" />
          </div>
          <h2 className="font-semibold mb-1">Till is closed</h2>
          <p className="text-sm text-dim mb-5">
            Count the opening float and enter it to start the shift.
          </p>

          {/* The cash-up result lands HERE, not in a modal.
              Closing a shift replaces this whole screen, so a modal
              would take the variance with it — and the variance is the
              only reason a till gets closed properly at all. */}
          {session?.status === 'closed' && session.variance != null && (
            <div className="rounded-lg border border-line bg-raised p-4 mb-5 text-left">
              <div className="text-2xs uppercase tracking-wider text-dim mb-2">
                Last shift · {session.opened_by_name}
              </div>
              <div
                className={`text-2xl font-semibold num mb-1 ${
                  session.variance === 0
                    ? 'text-ok'
                    : session.variance < 0
                      ? 'text-bad'
                      : 'text-warn'
                }`}
              >
                {session.variance === 0 ? 'Balanced' : money(session.variance)}
              </div>
              <div className="text-2xs text-dim">
                Expected {money(session.expected_cash ?? 0)} · counted{' '}
                {money(session.counted_cash ?? 0)}
              </div>
              {session.variance !== 0 && (
                <p className="text-2xs text-faint mt-2 leading-relaxed">
                  {session.variance < 0
                    ? 'Drawer short. Recount, then look for a missed cash sale or change given twice.'
                    : 'Drawer over. Usually a sale rung up as card but paid in cash.'}
                </p>
              )}
            </div>
          )}

          <div className="text-left mb-5">
            <MoneyInput
              label="Opening float"
              valueCents={floatCents}
              onChange={setFloatCents}
              numpad
              autoFocus
            />
          </div>

          <button className="btn-primary btn-lg w-full" onClick={() => openTill(floatCents)}>
            Open till
          </button>
        </div>
      </div>
    );
  }

  // ── The sale panel, shared by the desktop aside and the tablet sheet
  const cartPanel = (
    <>
      {/* Still no accounts — a phone number, a points balance, and a
          receipt. See components/pos/LoyaltyCapture. */}
      <LoyaltyCapture cartTotal={totals.total} />

      <div className="flex-1 overflow-y-auto scroll min-h-0">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 py-12">
            <ShoppingCart size={28} className="text-faint mb-3" />
            <div className="text-sm text-dim">Scan or tap a product to start</div>
          </div>
        ) : (
          <div className="p-2">
            {cart.map((l) => {
              const product = products.find((p) => p.id === l.product_id);
              const over = product ? l.qty > product.stock : false;
              return (
                <div key={l.product_id} className="group p-2.5 rounded-lg hover:bg-raised transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-tight">{l.name}</div>
                      <div className="text-2xs text-dim mt-0.5">
                        {l.variant} · {money(l.unit_price)}
                      </div>
                      {over && (
                        <div className="text-2xs text-warn mt-1 flex items-center gap-1">
                          <AlertTriangle size={11} /> Only {product?.stock} in stock
                        </div>
                      )}
                    </div>
                    <div className="text-sm font-semibold num whitespace-nowrap">
                      {money(l.unit_price * l.qty - l.discount)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setQty(l.product_id, l.qty - 1)}
                      className="w-8 h-8 rounded-lg bg-raised border border-line hover:bg-hover flex items-center justify-center"
                      aria-label="Decrease quantity"
                    >
                      <Minus size={13} />
                    </button>
                    <span className="w-9 text-center text-sm num">{l.qty}</span>
                    <button
                      onClick={() => setQty(l.product_id, l.qty + 1)}
                      className="w-8 h-8 rounded-lg bg-raised border border-line hover:bg-hover flex items-center justify-center"
                      aria-label="Increase quantity"
                    >
                      <Plus size={13} />
                    </button>
                    <button
                      onClick={() => removeLine(l.product_id)}
                      className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center
                                 text-faint hover:text-bad hover:bg-bad-soft transition-colors"
                      aria-label="Remove line"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-none border-t border-line p-4">
        <div className="space-y-1.5 mb-4 text-sm">
          <Row label="Subtotal" value={money(totals.subtotal)} muted />
          {totals.discount_total > 0 && (
            <Row label="Discount" value={'-' + money(totals.discount_total)} accent="text-ok" />
          )}
          <Row label="VAT (15%)" value={money(totals.tax_total)} muted />
          <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-line">
            <span className="font-medium">Total</span>
            <span className="text-2xl font-semibold num">{money(totals.total)}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            className="btn-ghost px-3"
            disabled={cart.length === 0}
            onClick={() => clearCart()}
            title="Clear sale"
            aria-label="Clear sale"
          >
            <Trash2 size={15} />
          </button>
          <button
            className="btn-primary btn-lg flex-1"
            disabled={cart.length === 0}
            onClick={() => {
              setCartOpen(false);
              setPayOpen(true);
            }}
          >
            Pay {money(totals.total)}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="h-full flex">
      {/* ══ Catalogue ═══════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-none px-3 sm:px-5 pt-3 sm:pt-4 pb-3 flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={searchRef}
              className="input pl-9 h-11"
              placeholder="Search products, SKU or barcode"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {isMockDevice('scanner') && (
            <div className="hidden xl:flex items-center gap-2 px-3 h-11 rounded-lg border border-dashed border-line text-2xs text-faint whitespace-nowrap">
              <ScanLine size={14} />
              Scanner simulated — hover a product
            </div>
          )}

          {/* Ending the shift belongs where the shift is worked, not on
              a tab the cashier never opens. */}
          <CloseTillButton className="btn-ghost h-11 flex-none" compact />
        </div>

        <div className="flex-none px-3 sm:px-5 pb-3 flex gap-1.5 overflow-x-auto scroll">
          {['All', ...CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`h-8 px-3.5 rounded-full text-sm font-medium whitespace-nowrap border transition-colors flex-none ${
                category === c
                  ? 'bg-ink text-base border-ink'
                  : 'bg-panel border-line text-dim hover:text-ink'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto scroll px-3 sm:px-5 pb-24 lg:pb-5">
          <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
            {filtered.map((p) => (
              <ProductTile
                key={p.id}
                product={p}
                onAdd={() => addProduct(p.id)}
                onScan={() => hw.scanner.simulate(p.barcode)}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-16 text-dim text-sm">
              No products match “{query}”
            </div>
          )}
        </div>
      </div>

      {/* ══ Sale — desktop ══════════════════════════════════════ */}
      <aside className="hidden lg:flex w-[336px] xl:w-[380px] flex-none border-l border-line bg-panel flex-col">
        {cartPanel}
      </aside>

      {/* ══ Sale — tablet: sticky bar + slide-over ══════════════ */}
      <div className="lg:hidden fixed bottom-0 left-[58px] right-0 z-30 p-3 bg-panel border-t border-line">
        <button
          className="btn-primary btn-lg w-full justify-between"
          disabled={cart.length === 0}
          onClick={() => setCartOpen(true)}
        >
          <span className="flex items-center gap-2">
            <ShoppingCart size={17} />
            {units} item{units === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1.5 num">
            {money(totals.total)}
            <ChevronRight size={17} />
          </span>
        </button>
      </div>

      {cartOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 overlay animate-fadeIn" onClick={() => setCartOpen(false)} />
          <div className="relative w-full max-w-sm bg-panel border-l border-line flex flex-col animate-slideIn">
            <div className="flex-none flex items-center justify-between px-4 h-12 border-b border-line">
              <span className="font-semibold text-sm">Current sale</span>
              <button
                onClick={() => setCartOpen(false)}
                className="text-faint hover:text-ink p-1"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            {cartPanel}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in px-4">
          <div
            className={`px-4 h-11 rounded-lg border shadow-pop flex items-center gap-2 text-sm ${
              toast.ok ? 'bg-panel border-line' : 'bg-bad-soft border-bad/30 text-bad'
            }`}
          >
            <ScanLine size={15} className={toast.ok ? 'text-brand' : 'text-bad'} />
            {toast.text}
          </div>
        </div>
      )}

      <PaymentFlow open={payOpen} onClose={() => setPayOpen(false)} />

    </div>
  );
}

// ─── Product tile ────────────────────────────────────────────────
// A thin category bar instead of a big image block: still scannable at
// arm's length, far less noise, and it reads correctly on white.

function ProductTile({
  product, onAdd, onScan,
}: {
  product: Product; onAdd: () => void; onScan: () => void;
}) {
  const status = stockStatus(product);
  const out = status === 'out_of_stock';

  return (
    <div
      role="button"
      tabIndex={out ? -1 : 0}
      onClick={out ? undefined : onAdd}
      onKeyDown={(e) => {
        if (!out && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onAdd();
        }
      }}
      className={`group relative rounded-lg border bg-panel overflow-hidden shadow-card transition-all ${
        out
          ? 'border-line opacity-50'
          : 'border-line hover:border-brand/40 hover:bg-raised cursor-pointer active:scale-[0.98]'
      }`}
    >
      <div className="h-1" style={{ background: categoryColor(product.category) }} />

      <div className="p-3">
        <div className="text-2xs text-dim mb-1 truncate">{product.brand}</div>
        <div className="text-[13px] font-medium leading-snug line-clamp-2 min-h-[34px]">
          {product.name}
        </div>
        <div className="text-2xs text-faint truncate mb-2">{product.variant}</div>

        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-semibold num">{money(product.sell_price)}</span>
          {status === 'low_stock' && <span className="chip-warn">{product.stock}</span>}
          {status === 'in_stock' && <span className="text-2xs text-faint num">{product.stock}</span>}
          {out && <span className="chip-mute">Out</span>}
        </div>
      </div>

      {isMockDevice('scanner') && !out && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onScan();
          }}
          title={`Simulate scanning ${product.barcode}`}
          className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-base/90 backdrop-blur border border-line
                     flex items-center justify-center text-dim hover:text-brand
                     opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        >
          <ScanLine size={13} />
        </button>
      )}
    </div>
  );
}

function Row({
  label, value, muted, accent,
}: {
  label: string; value: string; muted?: boolean; accent?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className={muted ? 'text-dim' : ''}>{label}</span>
      <span className={`num ${accent ?? ''}`}>{value}</span>
    </div>
  );
}

/** Category accent. Single flat colours — they read on any theme. */
function categoryColor(category: string): string {
  const map: Record<string, string> = {
    Hair: '#8B5CF6',
    Nails: '#EC4899',
    Cosmetics: '#F59E0B',
    Skincare: '#10B981',
    Tools: '#3B82F6',
  };
  return map[category] ?? '#94A3B8';
}
