'use client';

// ═══════════════════════════════════════════════════════════════════
//  ADD / EDIT A PRODUCT
//
//  The "Add product" button was decorative for the whole build, which
//  meant the only way to take on a new line was to edit a TypeScript
//  file and redeploy. For a shop that takes deliveries every week
//  that is not a system, it is a hostage situation.
//
//  Two rules enforced here rather than left to the person:
//
//    Selling below cost is blocked. It is never intentional, and it
//    loses money quietly on every single scan.
//
//    A blank barcode is stored as NULL, not ''. The column is unique,
//    so the second product without a barcode would collide with the
//    first — a confusing error about a duplicate key on a field
//    nobody filled in.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { Package, AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { money, type Product } from '@/lib/types';
import { saveProduct, fetchCatalogue, type ProductDraft } from '@/lib/supabase/catalogue';
import { usePos } from '@/lib/store';
import { STORE } from '@/lib/data/seed';

export function ProductForm({
  open,
  product,
  onClose,
}: {
  open: boolean;
  /** Absent when adding. */
  product?: Product | null;
  onClose: () => void;
}) {
  const setCatalogue = usePos((s) => s.setCatalogue);
  const products = usePos((s) => s.products);

  const [draft, setDraft] = useState<ProductDraft>(blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function blank(): ProductDraft {
    return {
      sku: '', barcode: '', name: '', variant: '',
      category: '', brand: '',
      cost_price: 0, sell_price: 0, reorder_level: 20, opening_stock: 0,
    };
  }

  useEffect(() => {
    if (!open) return;
    setError('');
    setDraft(
      product
        ? {
            id: product.id,
            sku: product.sku,
            barcode: product.barcode,
            name: product.name,
            variant: product.variant,
            category: product.category,
            brand: product.brand,
            cost_price: product.cost_price,
            sell_price: product.sell_price,
            reorder_level: product.reorder_level,
            is_active: product.is_active,
          }
        : blank()
    );
  }, [open, product]);

  const set = <K extends keyof ProductDraft>(k: K, v: ProductDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const belowCost = draft.sell_price > 0 && draft.sell_price < draft.cost_price;
  const margin =
    draft.sell_price > 0
      ? ((draft.sell_price - draft.cost_price) / draft.sell_price) * 100
      : 0;

  const dupSku = products.some(
    (p) => p.id !== draft.id && p.sku.toLowerCase() === draft.sku.trim().toLowerCase()
  );
  const dupBarcode =
    draft.barcode.trim() !== '' &&
    products.some((p) => p.id !== draft.id && p.barcode === draft.barcode.trim());

  const valid =
    draft.name.trim() !== '' &&
    draft.sku.trim() !== '' &&
    draft.sell_price > 0 &&
    !belowCost &&
    !dupSku &&
    !dupBarcode;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    const r = await saveProduct(draft, STORE.id);
    if (!r.ok) {
      setBusy(false);
      setError(r.error ?? 'Could not save');
      return;
    }
    // Re-read rather than patching local state: the database may have
    // normalised something, and a catalogue that drifts from it is
    // how a till ends up selling a price nobody set.
    const fresh = await fetchCatalogue();
    if (fresh.ok && fresh.products?.length) setCatalogue(fresh.products);
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? 'Edit product' : 'Add product'}
      subtitle={product ? product.sku : 'Goes straight into the catalogue on every till'}
    >
      <div className="p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label" htmlFor="pf-name">Name</label>
            <input id="pf-name" className="input" value={draft.name}
              onChange={(e) => set('name', e.target.value)} autoFocus
              placeholder="Gel Polish" />
          </div>

          <div>
            <label className="label" htmlFor="pf-variant">Variant</label>
            <input id="pf-variant" className="input" value={draft.variant}
              onChange={(e) => set('variant', e.target.value)} placeholder="Ruby Red 15ml" />
          </div>

          <div>
            <label className="label" htmlFor="pf-sku">SKU</label>
            <input id="pf-sku" className="input num" value={draft.sku}
              onChange={(e) => set('sku', e.target.value.toUpperCase())}
              placeholder="NL-CL-GP03" />
            {dupSku && <div className="text-2xs text-bad mt-1">Already used</div>}
          </div>

          <div className="col-span-2">
            <label className="label" htmlFor="pf-barcode">Barcode</label>
            <input id="pf-barcode" className="input num" value={draft.barcode}
              inputMode="numeric"
              onChange={(e) => set('barcode', e.target.value.replace(/\s/g, ''))}
              placeholder="Scan it with the gun, or leave blank" />
            {dupBarcode
              ? <div className="text-2xs text-bad mt-1">Another product has this barcode</div>
              : <div className="text-2xs text-faint mt-1">
                  Click here and scan — the gun types the digits for you.
                </div>}
          </div>

          <div>
            <label className="label" htmlFor="pf-cat">Category</label>
            <input id="pf-cat" className="input" value={draft.category}
              onChange={(e) => set('category', e.target.value)} placeholder="Nails" list="pf-cats" />
            <datalist id="pf-cats">
              {[...new Set(products.map((p) => p.category))].map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>

          <div>
            <label className="label" htmlFor="pf-brand">Brand</label>
            <input id="pf-brand" className="input" value={draft.brand}
              onChange={(e) => set('brand', e.target.value)} placeholder="ColorLux" list="pf-brands" />
            <datalist id="pf-brands">
              {[...new Set(products.map((p) => p.brand))].filter(Boolean).map((b) => <option key={b} value={b} />)}
            </datalist>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <MoneyInput label="Cost price" valueCents={draft.cost_price}
            onChange={(v) => set('cost_price', v)} hint="what you pay" />
          <MoneyInput label="Selling price" valueCents={draft.sell_price}
            onChange={(v) => set('sell_price', v)} hint="incl VAT" />
        </div>

        {draft.sell_price > 0 && (
          <div className={`rounded-lg border px-3 py-2 text-2xs ${
            belowCost ? 'bg-bad-soft border-bad/25 text-bad' : 'bg-raised border-line text-dim'
          }`}>
            {belowCost ? (
              <span className="flex items-center gap-1.5">
                <AlertTriangle size={12} />
                This sells for less than it cost. Every scan loses{' '}
                {money(draft.cost_price - draft.sell_price)}.
              </span>
            ) : (
              <>Margin <span className="text-ink num">{margin.toFixed(0)}%</span> ·
                {' '}<span className="num">{money(draft.sell_price - draft.cost_price)}</span> a unit</>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="pf-reorder">Alert below</label>
            <input id="pf-reorder" type="number" min={0} className="input num"
              value={draft.reorder_level}
              onChange={(e) => set('reorder_level', Math.max(0, Number(e.target.value)))} />
          </div>
          {!product && (
            <div>
              <label className="label" htmlFor="pf-stock">Opening stock</label>
              <input id="pf-stock" type="number" min={0} className="input num"
                value={draft.opening_stock ?? 0}
                onChange={(e) => set('opening_stock', Math.max(0, Number(e.target.value)))} />
            </div>
          )}
        </div>

        <div className="h-5 text-2xs text-bad" role="status">{error}</div>

        <div className="flex gap-2">
          <button className="btn-primary btn-lg flex-1" disabled={!valid || busy} onClick={submit}>
            <Package size={15} />
            {busy ? 'Saving…' : product ? 'Save changes' : 'Add to catalogue'}
          </button>
          <button className="btn-quiet btn-lg" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
