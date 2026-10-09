'use client';

import { useMemo, useState } from 'react';
import { Search, Plus, Pencil, EyeOff, Eye } from 'lucide-react';
import { usePos } from '@/lib/store';
import { money, stockStatus } from '@/lib/types';
import { Page, Table, Segmented } from '@/components/ui/Page';
import { CATEGORIES } from '@/lib/data/seed';
import { ProductForm } from '@/components/pos/ProductForm';
import { setProductActive, fetchCatalogue } from '@/lib/supabase/catalogue';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import type { Product } from '@/lib/types';

export default function ProductsPage() {
  const products = usePos((s) => s.products);
  const setCatalogue = usePos((s) => s.setCatalogue);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [editing, setEditing] = useState<Product | null>(null);
  const [adding, setAdding] = useState(false);

  // Products are never deleted — a sold product has to stay joinable
  // to the receipt that sold it. Deactivating takes it off the till
  // and leaves the history intact.
  const toggleActive = async (p: Product) => {
    if (!(await setProductActive(p.id, !p.is_active))) return;
    const fresh = await fetchCatalogue();
    if (fresh.ok && fresh.products?.length) setCatalogue(fresh.products);
  };

  const rows = useMemo(
    () =>
      products.filter((p) => {
        if (cat !== 'All' && p.category !== cat) return false;
        const s = q.trim().toLowerCase();
        if (!s) return true;
        return (
          p.name.toLowerCase().includes(s) ||
          p.sku.toLowerCase().includes(s) ||
          p.brand.toLowerCase().includes(s) ||
          p.barcode.includes(s)
        );
      }),
    [products, q, cat]
  );

  return (
    <Page
      title="Products"
      subtitle={`${products.length} products in the catalogue`}
      actions={
        <button
          className="btn-primary"
          onClick={() => setAdding(true)}
          disabled={!isSupabaseConfigured}
          title={
            isSupabaseConfigured
              ? undefined
              : 'Connect Supabase first — there is nowhere to save a product to'
          }
        >
          <Plus size={15} /> Add product
        </button>
      }
    >
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="input pl-9"
            placeholder="Search name, SKU, brand or barcode"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Segmented
          value={cat}
          onChange={setCat}
          options={['All', ...CATEGORIES].map((c) => ({ key: c, label: c }))}
        />
      </div>

      <Table head={[
          'Product',
          { l: 'SKU',      cls: 'hidden lg:table-cell' },
          { l: 'Barcode',  cls: 'hidden xl:table-cell' },
          { l: 'Category', cls: 'hidden md:table-cell' },
          { l: 'Brand',    cls: 'hidden xl:table-cell' },
          { l: 'Cost',     cls: 'hidden lg:table-cell' },
          'Price',
          { l: 'Margin',   cls: 'hidden md:table-cell' },
          'Stock',
          '',
        ]}>
        {rows.map((p) => {
          const status = stockStatus(p);
          const marginPct = p.sell_price
            ? Math.round(((p.sell_price - p.cost_price) / p.sell_price) * 100)
            : 0;
          return (
            <tr key={p.id} className={`row ${p.is_active ? '' : 'opacity-50'}`}>
              <td className="td">
                <div className="font-medium">
                  {p.name}
                  {!p.is_active && <span className="chip-mute ml-2">Hidden</span>}
                </div>
                <div className="text-2xs text-dim">{p.variant}</div>
              </td>
              <td className="td num text-dim hidden lg:table-cell">{p.sku}</td>
              <td className="td num text-faint text-2xs hidden xl:table-cell">{p.barcode}</td>
              <td className="td text-dim hidden md:table-cell">{p.category}</td>
              <td className="td text-dim hidden xl:table-cell">{p.brand}</td>
              <td className="td num text-dim hidden lg:table-cell">{money(p.cost_price)}</td>
              <td className="td num font-medium">{money(p.sell_price)}</td>
              <td className="td num hidden md:table-cell">
                <span className={marginPct >= 40 ? 'text-ok' : marginPct >= 25 ? '' : 'text-warn'}>
                  {marginPct}%
                </span>
              </td>
              <td className="td">
                {status === 'out_of_stock' ? (
                  <span className="chip-bad">Out</span>
                ) : status === 'low_stock' ? (
                  <span className="chip-warn">{p.stock} left</span>
                ) : (
                  <span className="num text-dim">{p.stock}</span>
                )}
              </td>
              <td className="td">
                <div className="flex items-center gap-1 justify-end">
                  <button
                    className="text-faint hover:text-brand transition-colors p-1"
                    onClick={() => setEditing(p)}
                    title="Edit"
                    disabled={!isSupabaseConfigured}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="text-faint hover:text-ink transition-colors p-1"
                    onClick={() => void toggleActive(p)}
                    title={p.is_active ? 'Hide from the till' : 'Put back on the till'}
                    disabled={!isSupabaseConfigured}
                  >
                    {p.is_active ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </Table>

      <ProductForm open={adding} onClose={() => setAdding(false)} />
      <ProductForm
        open={editing !== null}
        product={editing}
        onClose={() => setEditing(null)}
      />
    </Page>
  );
}
