'use client';

// ═══════════════════════════════════════════════════════════════════
//  THE CATALOGUE COMES FROM THE DATABASE
//
//  Until now the shelf lived in lib/data/seed.ts — a TypeScript array
//  compiled into the bundle. That made Postgres a write-only mirror:
//  change a price in Supabase and the till never heard about it, and
//  adding a product meant editing code and redeploying.
//
//  Two different reads, because the two surfaces are allowed to know
//  different things:
//
//    till   → till_catalogue, which has NO cost_price column at all.
//             Not hidden in the UI, not filtered in the client —
//             there is nothing to leak.
//    office → products + inventory, cost price included.
//
//  The local copy stays. It is the offline cache: the till keeps
//  selling through a dead line, and this refreshes it when there is
//  one. Stock here is a last-known figure, not an authority — the
//  authority is inventory.quantity, and complete_sale decrements it
//  inside the same transaction as the sale.
// ═══════════════════════════════════════════════════════════════════

import { supabase } from './client';
import { currentClaims } from './auth';
import type { Product } from '@/lib/types';

interface TillRow {
  id: string; sku: string; barcode: string | null; name: string; variant: string;
  category: string; brand: string; sell_price: number; reorder_level: number;
  is_active: boolean; stock: number | null;
}

interface OfficeRow {
  id: string; sku: string; barcode: string | null; name: string; variant: string;
  cost_price: number; sell_price: number; reorder_level: number; is_active: boolean;
  categories: { name: string } | null;
  brands: { name: string } | null;
  inventory: { quantity: number }[] | null;
}

export interface CatalogueResult {
  ok: boolean;
  products?: Product[];
  /** True when cost prices are absent because a till asked. */
  partial?: boolean;
  error?: string;
}

export async function fetchCatalogue(): Promise<CatalogueResult> {
  const sb = supabase();
  if (!sb) return { ok: false, error: 'not configured' };

  const claims = await currentClaims();
  if (!claims?.posRole) return { ok: false, error: 'not signed in' };

  if (claims.posRole === 'till') {
    const { data, error } = await sb
      .from('till_catalogue')
      .select('id,sku,barcode,name,variant,category,brand,sell_price,reorder_level,is_active,stock')
      .order('name');
    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      partial: true,
      products: (data as TillRow[]).map((r) => ({
        id: r.id,
        sku: r.sku,
        barcode: r.barcode ?? '',
        name: r.name,
        variant: r.variant,
        category: r.category,
        brand: r.brand,
        // A till is not told what anything cost. Zero is the honest
        // placeholder; every margin figure lives in the back office.
        cost_price: 0,
        sell_price: r.sell_price,
        reorder_level: r.reorder_level,
        stock: r.stock ?? 0,
        is_active: r.is_active,
      })),
    };
  }

  const { data, error } = await sb
    .from('products')
    .select(
      'id,sku,barcode,name,variant,cost_price,sell_price,reorder_level,is_active,' +
      'categories(name),brands(name),inventory(quantity)'
    )
    .order('name');
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    products: (data as unknown as OfficeRow[]).map((r) => ({
      id: r.id,
      sku: r.sku,
      barcode: r.barcode ?? '',
      name: r.name,
      variant: r.variant,
      category: r.categories?.name ?? 'Uncategorised',
      brand: r.brands?.name ?? '',
      cost_price: r.cost_price,
      sell_price: r.sell_price,
      reorder_level: r.reorder_level,
      stock: r.inventory?.[0]?.quantity ?? 0,
      is_active: r.is_active,
    })),
  };
}

// ─── Writing the catalogue (office only) ─────────────────────

export interface ProductDraft {
  id?: string;
  sku: string;
  barcode: string;
  name: string;
  variant: string;
  category: string;
  brand: string;
  cost_price: number;
  sell_price: number;
  reorder_level: number;
  /** Only read when creating. Stock afterwards moves through the ledger. */
  opening_stock?: number;
  is_active?: boolean;
}

/** Find a category or brand by name, creating it if it is new. */
async function lookupOrCreate(table: 'categories' | 'brands', name: string): Promise<string | null> {
  const sb = supabase();
  if (!sb || !name.trim()) return null;
  const clean = name.trim();

  const { data: found } = await sb.from(table).select('id').ilike('name', clean).maybeSingle();
  if (found) return (found as { id: string }).id;

  const { data: made, error } = await sb.from(table).insert({ name: clean }).select('id').single();
  if (error) return null;
  return (made as { id: string }).id;
}

export async function saveProduct(
  draft: ProductDraft,
  storeId: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const sb = supabase();
  if (!sb) return { ok: false, error: 'not configured' };

  if (draft.sell_price < draft.cost_price) {
    // Caught here as well as in the form: a product that sells for
    // less than it cost loses money on every single scan, quietly.
    return { ok: false, error: 'Selling price is below cost price' };
  }

  const [category_id, brand_id] = await Promise.all([
    lookupOrCreate('categories', draft.category),
    lookupOrCreate('brands', draft.brand),
  ]);

  const row = {
    sku: draft.sku.trim(),
    // A blank barcode must be NULL, not '': the column is unique, and
    // the second product without a barcode would collide with the first.
    barcode: draft.barcode.trim() || null,
    name: draft.name.trim(),
    variant: draft.variant.trim(),
    category_id,
    brand_id,
    cost_price: draft.cost_price,
    sell_price: draft.sell_price,
    reorder_level: draft.reorder_level,
    is_active: draft.is_active ?? true,
    updated_at: new Date().toISOString(),
  };

  if (draft.id) {
    const { error } = await sb.from('products').update(row).eq('id', draft.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: draft.id };
  }

  const { data, error } = await sb.from('products').insert(row).select('id').single();
  if (error) return { ok: false, error: error.message };
  const id = (data as { id: string }).id;

  // Opening stock goes in as a stocktake movement, not a bare number,
  // so the very first figure on the shelf card can be explained like
  // every one after it.
  const qty = Math.max(0, draft.opening_stock ?? 0);
  await sb.from('inventory').insert({ product_id: id, store_id: storeId, quantity: qty });
  if (qty > 0) {
    await sb.from('stock_movements').insert({
      product_id: id,
      store_id: storeId,
      type: 'stocktake',
      quantity: qty,
      balance_after: qty,
      reason: 'Opening stock',
      reference: 'NEW-PRODUCT',
    });
  }

  return { ok: true, id };
}

/** Products are never deleted — a sold product must stay joinable. */
export async function setProductActive(id: string, active: boolean): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  const { error } = await sb
    .from('products')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('id', id);
  return !error;
}
