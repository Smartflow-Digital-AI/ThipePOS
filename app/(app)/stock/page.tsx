'use client';

import { useMemo, useState } from 'react';
import {
  Plus, Minus, Search, Truck, TriangleAlert, History, Boxes,
  PackagePlus, Trash2, Check, X,
} from 'lucide-react';
import { usePos } from '@/lib/store';
import {
  money, stockStatus, MOVEMENT_LABEL, DAMAGE_REASONS, ADJUST_REASONS,
  deliveryAccuracy, type MovementType, type Product,
} from '@/lib/types';
import { Page, Stat, Table, Empty, Segmented } from '@/components/ui/Page';
import { Modal } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { SUPPLIERS } from '@/lib/data/seed';

type Tab = 'onhand' | 'receiving' | 'damage' | 'history';

const TABS: { key: Tab; label: string }[] = [
  { key: 'onhand', label: 'On hand' },
  { key: 'receiving', label: 'Receiving' },
  { key: 'damage', label: 'Write-offs' },
  { key: 'history', label: 'History' },
];

export default function StockPage() {
  const [tab, setTab] = useState<Tab>('onhand');
  return (
    <Page
      title="Stock"
      subtitle="On-hand quantities, goods in, and every movement behind them"
      actions={<Segmented value={tab} onChange={setTab} options={TABS} />}
    >
      {tab === 'onhand' && <OnHand />}
      {tab === 'receiving' && <Receiving />}
      {tab === 'damage' && <Damage />}
      {tab === 'history' && <Ledger />}
    </Page>
  );
}

// ═══ ON HAND ═══════════════════════════════════════════════════

function OnHand() {
  const products = usePos((s) => s.products);
  const adjustStock = usePos((s) => s.adjustStock);

  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState<string>(ADJUST_REASONS[0]);
  const [q, setQ] = useState('');

  const product = products.find((p) => p.id === adjusting);

  const summary = useMemo(() => ({
    value: products.reduce((s, p) => s + p.cost_price * p.stock, 0),
    retail: products.reduce((s, p) => s + p.sell_price * p.stock, 0),
    units: products.reduce((s, p) => s + p.stock, 0),
    low: products.filter((p) => stockStatus(p) === 'low_stock').length,
    out: products.filter((p) => stockStatus(p) === 'out_of_stock').length,
  }), [products]);

  const rows = products.filter((p) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t);
  });

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 mb-5">
        <Stat label="Stock at cost" value={money(summary.value)} />
        <Stat label="Stock at retail" value={money(summary.retail)} />
        <Stat label="Units on hand" value={String(summary.units)} />
        <Stat label="Low stock" value={String(summary.low)} tone={summary.low ? 'warn' : undefined} />
        <Stat label="Out of stock" value={String(summary.out)} tone={summary.out ? 'bad' : undefined} />
      </div>

      <div className="relative sm:max-w-xs mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input pl-9" placeholder="Search product or SKU"
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Table head={[
        'Product',
        { l: 'Category', cls: 'hidden md:table-cell' },
        'On hand',
        { l: 'Reorder at', cls: 'hidden lg:table-cell' },
        'Status', '',
      ]}>
        {rows.map((p) => {
          const status = stockStatus(p);
          return (
            <tr key={p.id} className="row">
              <td className="td">
                <div className="font-medium">{p.name}</div>
                <div className="text-2xs text-dim">{p.variant}</div>
              </td>
              <td className="td text-dim hidden md:table-cell">{p.category}</td>
              <td className="td num font-medium">{p.stock}</td>
              <td className="td num text-dim hidden lg:table-cell">{p.reorder_level}</td>
              <td className="td">
                {status === 'out_of_stock' ? <span className="chip-bad">Out of stock</span>
                 : status === 'low_stock' ? <span className="chip-warn">Low</span>
                 : <span className="chip-ok">In stock</span>}
              </td>
              <td className="td">
                <button className="btn-quiet !h-8 !px-2.5 text-2xs"
                        onClick={() => { setAdjusting(p.id); setDelta(0); }}>
                  Adjust
                </button>
              </td>
            </tr>
          );
        })}
      </Table>

      <Modal open={!!adjusting} onClose={() => setAdjusting(null)} title="Adjust stock"
             subtitle={product ? `${product.name} ${product.variant}`.trim() : ''}>
        {product && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-5 px-4 h-16 rounded-lg bg-raised border border-line">
              <span className="text-sm text-dim">On hand now</span>
              <span className="text-2xl num font-semibold">{product.stock}</span>
            </div>

            <label className="label">Change by</label>
            <div className="flex items-center gap-3 mb-5">
              <button className="w-12 h-12 rounded-lg bg-raised border border-line hover:bg-hover flex items-center justify-center"
                      onClick={() => setDelta(delta - 1)} aria-label="Less">
                <Minus size={18} />
              </button>
              <input className="input h-12 text-center text-xl num flex-1"
                     value={delta > 0 ? `+${delta}` : String(delta)}
                     onChange={(e) => setDelta(parseInt(e.target.value.replace(/[^0-9-]/g, '')) || 0)} />
              <button className="w-12 h-12 rounded-lg bg-raised border border-line hover:bg-hover flex items-center justify-center"
                      onClick={() => setDelta(delta + 1)} aria-label="More">
                <Plus size={18} />
              </button>
            </div>

            <label className="label">Reason</label>
            <select className="input mb-5" value={reason} onChange={(e) => setReason(e.target.value)}>
              {ADJUST_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>

            <div className="flex items-center justify-between px-4 h-12 rounded-lg bg-brand-soft border border-brand-line mb-4">
              <span className="text-sm text-dim">New quantity</span>
              <span className="text-lg num font-semibold text-brand">
                {Math.max(0, product.stock + delta)}
              </span>
            </div>

            <p className="text-2xs text-dim mb-5">
              Recorded against your name in the stock history. Deliveries belong on the
              Receiving tab and breakages on Write-offs — an adjustment should be the
              last resort, not the habit.
            </p>

            <button className="btn-primary btn-lg w-full" disabled={delta === 0}
                    onClick={() => { adjustStock(product.id, delta, reason); setAdjusting(null); }}>
              <PackagePlus size={16} /> Apply adjustment
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}

// ═══ RECEIVING ═════════════════════════════════════════════════

interface DraftLine { product_id: string; qty: number; qty_invoiced: number; unit_cost: number }

function Receiving() {
  const products = usePos((s) => s.products);
  const deliveries = usePos((s) => s.deliveries);
  const receiveDelivery = usePos((s) => s.receiveDelivery);

  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [updateCosts, setUpdateCosts] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const reset = () => {
    setSupplier(''); setInvoiceRef(''); setLines([]); setUpdateCosts(true);
  };

  const addLine = (p: Product) => {
    if (lines.some((l) => l.product_id === p.id)) return;
    setLines([...lines, { product_id: p.id, qty: 1, qty_invoiced: 1, unit_cost: p.cost_price }]);
  };
  const setLine = (id: string, patch: Partial<DraftLine>) =>
    setLines(lines.map((l) => (l.product_id === id ? { ...l, ...patch } : l)));

  const totalCost = lines.reduce((n, l) => n + l.unit_cost * l.qty, 0);
  const discrepancy = lines.reduce((n, l) => n + (l.qty_invoiced - l.qty), 0);

  const summary = useMemo(() => {
    const short = deliveries.filter((d) => deliveryAccuracy(d) === 'short');
    return {
      count: deliveries.length,
      spend: deliveries.reduce((n, d) => n + d.total_cost, 0),
      short: short.length,
      shortUnits: short.reduce((n, d) => n + d.discrepancy_units, 0),
    };
  }, [deliveries]);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 flex-1">
          <Stat label="Deliveries" value={String(summary.count)} />
          <Stat label="Total spend" value={money(summary.spend)} />
          <Stat label="Short deliveries" value={String(summary.short)}
                tone={summary.short ? 'warn' : undefined} />
          <Stat label="Units short" value={String(summary.shortUnits)}
                tone={summary.shortUnits ? 'bad' : undefined}
                hint="Invoiced but never arrived" />
        </div>
      </div>

      <button className="btn-primary mb-4" onClick={() => { reset(); setOpen(true); }}>
        <Truck size={15} /> Record a delivery
      </button>

      {deliveries.length === 0 ? (
        <Empty message="No deliveries recorded yet." />
      ) : (
        <Table head={[
          'GRN', 'Supplier',
          { l: 'Invoice', cls: 'hidden lg:table-cell' },
          { l: 'Received by', cls: 'hidden xl:table-cell' },
          { l: 'Date', cls: 'hidden md:table-cell' },
          'Lines', 'Cost', 'Accuracy',
        ]}>
          {deliveries.map((d) => {
            const acc = deliveryAccuracy(d);
            return (
              <tr key={d.id} className="row">
                <td className="td num font-medium">{d.delivery_number}</td>
                <td className="td">{d.supplier}</td>
                <td className="td num text-dim hidden lg:table-cell">{d.invoice_ref || '—'}</td>
                <td className="td text-dim hidden xl:table-cell">{d.received_by_name}</td>
                <td className="td text-dim hidden md:table-cell">
                  {new Date(d.created_at).toLocaleDateString('en-ZA', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })}
                </td>
                <td className="td num text-dim">{d.lines.length}</td>
                <td className="td num">{money(d.total_cost)}</td>
                <td className="td">
                  {acc === 'exact' ? <span className="chip-ok">As invoiced</span>
                   : acc === 'short' ? <span className="chip-bad">{d.discrepancy_units} short</span>
                   : <span className="chip-warn">{-d.discrepancy_units} extra</span>}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <Note icon={Truck}>
        <strong>Count what is in the box, not what is on the invoice.</strong> The two
        columns exist so a short delivery is caught on the day — a supplier who bills for
        20 and sends 18 costs you money every single time until somebody notices.
      </Note>

      {/* ── Capture ── */}
      <Modal open={open} onClose={() => setOpen(false)} title="Record a delivery"
             subtitle="What actually arrived, counted against the invoice" width="max-w-3xl">
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <div>
              <label className="label">Supplier</label>
              <input className="input" list="suppliers" placeholder="Who delivered it"
                     value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              <datalist id="suppliers">
                {SUPPLIERS.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div>
              <label className="label">Invoice / delivery note</label>
              <input className="input num" placeholder="INV-12345"
                     value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
            </div>
          </div>

          <label className="label">Add a product</label>
          <select className="input mb-4" value=""
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    if (p) addLine(p);
                  }}>
            <option value="">Choose a product…</option>
            {products.filter((p) => !lines.some((l) => l.product_id === p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.variant} ({p.sku})</option>
            ))}
          </select>

          {lines.length === 0 ? (
            <div className="card p-8 text-center text-sm text-dim mb-5">
              Nothing added yet.
            </div>
          ) : (
            <div className="card overflow-hidden mb-4">
              <div className="overflow-x-auto scroll">
                <table className="w-full min-w-[560px]">
                  <thead>
                    <tr>
                      <th className="th">Product</th>
                      <th className="th">Counted in</th>
                      <th className="th">On invoice</th>
                      <th className="th">Unit cost</th>
                      <th className="th">Line</th>
                      <th className="th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const p = products.find((x) => x.id === l.product_id)!;
                      const off = l.qty_invoiced !== l.qty;
                      return (
                        <tr key={l.product_id}>
                          <td className="td">
                            <div className="font-medium">{p.name}</div>
                            <div className="text-2xs text-dim">{p.variant}</div>
                          </td>
                          <td className="td">
                            <input className="input w-20 num text-center" inputMode="numeric"
                                   value={l.qty}
                                   onChange={(e) => setLine(l.product_id, {
                                     qty: Math.max(0, parseInt(e.target.value.replace(/\D/g, '')) || 0),
                                   })} />
                          </td>
                          <td className="td">
                            <input className={`input w-20 num text-center ${off ? 'border-warn/50' : ''}`}
                                   inputMode="numeric" value={l.qty_invoiced}
                                   onChange={(e) => setLine(l.product_id, {
                                     qty_invoiced: Math.max(0, parseInt(e.target.value.replace(/\D/g, '')) || 0),
                                   })} />
                          </td>
                          <td className="td w-36">
                            <MoneyInput valueCents={l.unit_cost}
                                        onChange={(c) => setLine(l.product_id, { unit_cost: c })} />
                          </td>
                          <td className="td num">{money(l.unit_cost * l.qty)}</td>
                          <td className="td">
                            <button className="text-faint hover:text-bad"
                                    onClick={() => setLines(lines.filter((x) => x.product_id !== l.product_id))}
                                    aria-label="Remove line">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {discrepancy !== 0 && (
            <div className={`mb-4 flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-sm ${
              discrepancy > 0 ? 'bg-bad-soft border-bad/25 text-bad' : 'bg-warn-soft border-warn/25 text-warn'
            }`}>
              <TriangleAlert size={15} className="flex-none mt-0.5" />
              <span>
                {discrepancy > 0
                  ? `Invoiced for ${discrepancy} unit${discrepancy === 1 ? '' : 's'} more than arrived. Query it with ${supplier || 'the supplier'} before paying.`
                  : `${-discrepancy} more arrived than were invoiced. Worth telling them — it will be missed off their stock too.`}
              </span>
            </div>
          )}

          <label className="flex items-start gap-2.5 mb-5 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={updateCosts}
                   onChange={(e) => setUpdateCosts(e.target.checked)} />
            <span className="text-sm">
              Update cost prices from this delivery
              <span className="block text-2xs text-dim mt-0.5">
                Off means your margins keep using the old cost. On means a supplier
                price rise shows up in Reports straight away.
              </span>
            </span>
          </label>

          <div className="flex items-center justify-between mb-4 px-4 h-14 rounded-lg bg-raised border border-line">
            <span className="text-sm text-dim">Delivery total</span>
            <span className="text-xl num font-semibold">{money(totalCost)}</span>
          </div>

          <button className="btn-primary btn-lg w-full"
                  disabled={!supplier.trim() || lines.filter((l) => l.qty > 0).length === 0}
                  onClick={() => {
                    const d = receiveDelivery({
                      supplier, invoice_ref: invoiceRef, lines, updateCostPrices: updateCosts,
                    });
                    if (d) { setDone(d.delivery_number); setOpen(false); reset(); }
                  }}>
            <Check size={16} /> Add to stock
          </button>
        </div>
      </Modal>

      <Modal open={!!done} onClose={() => setDone(null)} width="max-w-sm">
        <div className="p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-ok-soft border border-ok/30 flex items-center justify-center mx-auto mb-3">
            <Check size={26} className="text-ok" />
          </div>
          <div className="text-lg font-semibold">Stock updated</div>
          <div className="text-sm text-dim num mt-0.5 mb-5">{done}</div>
          <button className="btn-primary w-full" onClick={() => setDone(null)}>Done</button>
        </div>
      </Modal>
    </>
  );
}

// ═══ WRITE-OFFS ════════════════════════════════════════════════

function Damage() {
  const products = usePos((s) => s.products);
  const movements = usePos((s) => s.stockMovements);
  const writeOffStock = usePos((s) => s.writeOffStock);

  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState<string>(DAMAGE_REASONS[0]);

  const writeOffs = movements.filter((m) => m.type === 'damage');
  const product = products.find((p) => p.id === productId);

  const summary = useMemo(() => {
    const units = writeOffs.reduce((n, m) => n + Math.abs(m.qty), 0);
    const cost = writeOffs.reduce((n, m) => {
      const p = products.find((x) => x.id === m.product_id);
      return n + (p?.cost_price ?? 0) * Math.abs(m.qty);
    }, 0);
    return { count: writeOffs.length, units, cost };
  }, [writeOffs, products]);

  return (
    <>
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3 mb-5">
        <Stat label="Write-offs" value={String(summary.count)} />
        <Stat label="Units lost" value={String(summary.units)}
              tone={summary.units ? 'warn' : undefined} />
        <Stat label="Value lost" value={money(summary.cost)}
              tone={summary.cost ? 'bad' : undefined} hint="At cost, not retail" />
      </div>

      <button className="btn-primary mb-4" onClick={() => { setProductId(''); setQty(1); setOpen(true); }}>
        <TriangleAlert size={15} /> Write off stock
      </button>

      {writeOffs.length === 0 ? (
        <Empty message="Nothing written off yet." />
      ) : (
        <Table head={[
          'Product', 'Units', 'Reason',
          { l: 'By', cls: 'hidden md:table-cell' },
          { l: 'When', cls: 'hidden lg:table-cell' },
          { l: 'Left after', cls: 'hidden xl:table-cell' },
        ]}>
          {writeOffs.map((m) => (
            <tr key={m.id} className="row">
              <td className="td">
                <div className="font-medium">{m.name}</div>
                <div className="text-2xs text-dim">{m.variant}</div>
              </td>
              <td className="td num text-bad font-medium">{m.qty}</td>
              <td className="td text-dim">{m.reason}</td>
              <td className="td text-dim hidden md:table-cell">{m.staff_name}</td>
              <td className="td text-dim hidden lg:table-cell">
                {new Date(m.created_at).toLocaleString('en-ZA', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </td>
              <td className="td num text-dim hidden xl:table-cell">{m.balance_after}</td>
            </tr>
          ))}
        </Table>
      )}

      <Note icon={TriangleAlert}>
        A write-off is a real loss at <strong>cost</strong> — it is money already spent
        that will never be sold. Expiries clustering on one product means you are ordering
        too much of it, not that the product is bad.
      </Note>

      <Modal open={open} onClose={() => setOpen(false)} title="Write off stock"
             subtitle="Broken, expired, testers, or lost">
        <div className="p-5">
          <label className="label">Product</label>
          <select className="input mb-4" value={productId}
                  onChange={(e) => setProductId(e.target.value)}>
            <option value="">Choose a product…</option>
            {products.filter((p) => p.stock > 0).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.variant} ({p.stock} on hand)
              </option>
            ))}
          </select>

          {product && (
            <>
              <label className="label">How many</label>
              <div className="flex items-center gap-3 mb-4">
                <button className="w-12 h-12 rounded-lg bg-raised border border-line hover:bg-hover flex items-center justify-center disabled:opacity-30"
                        disabled={qty <= 1} onClick={() => setQty(qty - 1)} aria-label="Fewer">
                  <Minus size={18} />
                </button>
                <input className="input h-12 text-center text-xl num flex-1" inputMode="numeric"
                       value={qty}
                       onChange={(e) => setQty(Math.max(1, Math.min(product.stock,
                         parseInt(e.target.value.replace(/\D/g, '')) || 1)))} />
                <button className="w-12 h-12 rounded-lg bg-raised border border-line hover:bg-hover flex items-center justify-center disabled:opacity-30"
                        disabled={qty >= product.stock} onClick={() => setQty(qty + 1)} aria-label="More">
                  <Plus size={18} />
                </button>
              </div>

              <label className="label">Reason</label>
              <select className="input mb-4" value={reason} onChange={(e) => setReason(e.target.value)}>
                {DAMAGE_REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>

              <div className="flex items-center justify-between px-4 h-14 rounded-lg bg-bad-soft border border-bad/25 mb-5">
                <span className="text-sm text-dim">Value written off</span>
                <span className="text-xl num font-semibold text-bad">
                  {money(product.cost_price * qty)}
                </span>
              </div>
            </>
          )}

          <button className="btn-danger btn-lg w-full" disabled={!product || qty <= 0}
                  onClick={() => {
                    if (!product) return;
                    writeOffStock(product.id, qty, reason);
                    setOpen(false);
                  }}>
            <TriangleAlert size={16} /> Write off {qty} unit{qty === 1 ? '' : 's'}
          </button>
        </div>
      </Modal>
    </>
  );
}

// ═══ HISTORY ═══════════════════════════════════════════════════

const FILTERS: { key: MovementType | 'all'; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'sale', label: 'Sales' },
  { key: 'receive', label: 'Deliveries' },
  { key: 'refund', label: 'Returns' },
  { key: 'damage', label: 'Write-offs' },
  { key: 'adjust', label: 'Adjustments' },
];

function Ledger() {
  const movements = usePos((s) => s.stockMovements);
  const [filter, setFilter] = useState<MovementType | 'all'>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => movements.filter((m) => {
    if (filter !== 'all' && m.type !== filter) return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return (
      m.name.toLowerCase().includes(t) ||
      m.sku.toLowerCase().includes(t) ||
      m.staff_name.toLowerCase().includes(t) ||
      m.reference.toLowerCase().includes(t)
    );
  }), [movements, filter, q]);

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-2 mb-4">
        <div className="relative lg:max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Product, SKU, person or reference"
                 value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented value={filter} onChange={setFilter} options={FILTERS} />
      </div>

      {rows.length === 0 ? (
        <Empty message={movements.length === 0
          ? 'No movements yet. Every sale, delivery, return and write-off lands here.'
          : 'Nothing matches that.'} />
      ) : (
        <Table head={[
          'When', 'Product', 'Type', 'Change',
          { l: 'Left after', cls: 'hidden md:table-cell' },
          { l: 'Reason', cls: 'hidden lg:table-cell' },
          { l: 'Reference', cls: 'hidden xl:table-cell' },
          { l: 'By', cls: 'hidden lg:table-cell' },
        ]}>
          {rows.map((m) => (
            <tr key={m.id} className="row">
              <td className="td text-dim whitespace-nowrap">
                {new Date(m.created_at).toLocaleString('en-ZA', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </td>
              <td className="td">
                <div className="font-medium">{m.name}</div>
                <div className="text-2xs text-dim">{m.variant}</div>
              </td>
              <td className="td">
                <span className={
                  m.type === 'receive' ? 'chip-ok'
                  : m.type === 'damage' ? 'chip-bad'
                  : m.type === 'adjust' ? 'chip-warn'
                  : 'chip-mute'
                }>
                  {MOVEMENT_LABEL[m.type]}
                </span>
              </td>
              <td className={`td num font-medium ${m.qty > 0 ? 'text-ok' : 'text-bad'}`}>
                {m.qty > 0 ? '+' : ''}{m.qty}
              </td>
              <td className="td num text-dim hidden md:table-cell">{m.balance_after}</td>
              <td className="td text-dim hidden lg:table-cell">{m.reason || '—'}</td>
              <td className="td num text-dim hidden xl:table-cell">{m.reference || '—'}</td>
              <td className="td text-dim hidden lg:table-cell">{m.staff_name}</td>
            </tr>
          ))}
        </Table>
      )}

      <Note icon={History}>
        Every row is one change with the person and the reason attached. This is what
        makes a shelf count answerable — <strong>&ldquo;it says 14 because six sold on
        Tuesday&rdquo;</strong> instead of a shrug.
      </Note>
    </>
  );
}

function Note({ icon: Icon, children }: { icon: typeof Boxes; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-raised border border-line text-2xs text-dim leading-relaxed">
      <Icon size={14} className="flex-none mt-0.5" />
      <span>{children}</span>
    </div>
  );
}
