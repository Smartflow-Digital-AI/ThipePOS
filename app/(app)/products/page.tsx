'use client';

import { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { usePos } from '@/lib/store';
import { money, stockStatus } from '@/lib/types';
import { Page, Table, Segmented } from '@/components/ui/Page';
import { CATEGORIES } from '@/lib/data/seed';

export default function ProductsPage() {
  const products = usePos((s) => s.products);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');

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
        <button className="btn-primary">
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
        ]}>
        {rows.map((p) => {
          const status = stockStatus(p);
          const marginPct = p.sell_price
            ? Math.round(((p.sell_price - p.cost_price) / p.sell_price) * 100)
            : 0;
          return (
            <tr key={p.id} className="row">
              <td className="td">
                <div className="font-medium">{p.name}</div>
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
            </tr>
          );
        })}
      </Table>
    </Page>
  );
}
