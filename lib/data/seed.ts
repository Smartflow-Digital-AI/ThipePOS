import type { Product, Staff, Store, Till } from '@/lib/types';

// Mirrors supabase/migrations/0002_seed.sql exactly, so the app runs
// with zero setup and behaves identically once Supabase is connected.

// Real trading details, pending from the client. Deliberately blank
// rather than plausible-looking: '4180299301' was an invented VAT
// number, and it printed on slips headed TAX INVOICE. A fabricated
// VAT number on a tax invoice is a real problem, not a placeholder.
// Blank is honest — the slip downgrades itself to SALES RECEIPT and
// says "(not a tax invoice)" until these are filled in.
export const STORE: Store = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Thipe Blinggirl',
  address: '',
  phone: '',
  vat_number: '',
};

export const TILLS: Till[] = [
  { id: '22222222-2222-2222-2222-222222222201', store_id: STORE.id, name: 'Till 1', is_active: true },
  { id: '22222222-2222-2222-2222-222222222202', store_id: STORE.id, name: 'Till 2', is_active: true },
  { id: '22222222-2222-2222-2222-222222222203', store_id: STORE.id, name: 'Till 3', is_active: true },
];

export const STAFF: Staff[] = [
  { id: '33333333-3333-3333-3333-333333333301', store_id: STORE.id, full_name: 'Karabo Sithole',   role: 'admin',            pin: '9999', email: 'karabo@glowbeauty.co.za', password: 'admin123',   is_active: true },
  { id: '33333333-3333-3333-3333-333333333302', store_id: STORE.id, full_name: 'Kagiso Modise',    role: 'manager',          pin: '5555', email: 'kagiso@glowbeauty.co.za', password: 'manager123', is_active: true },
  { id: '33333333-3333-3333-3333-333333333303', store_id: STORE.id, full_name: 'Thandeka Mokoena', role: 'cashier',          pin: '1234', email: '',                        password: '',           is_active: true },
  { id: '33333333-3333-3333-3333-333333333304', store_id: STORE.id, full_name: 'Sipho Khumalo',    role: 'cashier',          pin: '4321', email: '',                        password: '',           is_active: true },
  { id: '33333333-3333-3333-3333-333333333305', store_id: STORE.id, full_name: 'Zanele Dube',      role: 'stock_controller', pin: '7777', email: 'zanele@glowbeauty.co.za', password: 'stock123',   is_active: true },
];

export const CATEGORIES = ['Hair', 'Nails', 'Cosmetics', 'Skincare', 'Tools'] as const;

// ─────────────────────────────────────────────────────────────
// PRODUCT IDS ARE THE DATABASE'S IDS.
//
// This used to be `id: sku`, which read nicely and quietly broke
// every sync: complete_sale() casts product_id to uuid, so the first
// push of a real sale would have failed with "invalid input syntax
// for type uuid: HR-DL-RLX" — on every line of every sale, forever,
// with the queue climbing and nothing explaining why.
//
// These must stay in step with supabase migration 05_seed_with_fixed_ids.
// Adding a product here without adding it there throws at import
// rather than failing later at the till.
// ─────────────────────────────────────────────────────────────
const DB_SKU_ORDER = [
  'HR-DL-RLX',  'HR-CN-LIC',  'HR-OR-MAY',  'HR-TC-FOOD', 'HR-LX-BW16',
  'HR-LX-FR13', 'HR-GN-EDGE', 'NL-CL-GP01', 'NL-CL-GP02', 'NL-NP-ACP',
  'NL-NP-MON',  'NL-NP-TIP',  'NL-NP-GLU',  'NL-GN-LAMP', 'CS-GS-LIP',
  'CS-GS-FND',  'CS-GS-MAS',  'CS-GS-PWD',  'CS-GS-EYE',  'SK-GS-VITC',
  'SK-NH-SHEA', 'SK-NH-SOAP', 'NL-TB-POL250',
] as const;

function productId(sku: string): string {
  const i = DB_SKU_ORDER.indexOf(sku as (typeof DB_SKU_ORDER)[number]);
  if (i === -1) {
    throw new Error(
      `Product ${sku} has no database id. Add it to supabase migration ` +
      `05_seed_with_fixed_ids and to DB_SKU_ORDER, or it will never sync.`
    );
  }
  return `44444444-4444-4444-4444-4444444444${String(i + 1).padStart(2, '0')}`;
}

const p = (
  sku: string, barcode: string, name: string, variant: string,
  category: string, brand: string, cost: number, sell: number,
  reorder: number, stock: number
): Product => ({
  id: productId(sku), sku, barcode, name, variant, category, brand,
  cost_price: cost, sell_price: sell, reorder_level: reorder, stock, is_active: true,
});

export const PRODUCTS: Product[] = [
  // Hair
  p('HR-DL-RLX',  '6001234500011', 'Relaxer Kit',               'Regular',         'Hair',      'Dark & Lovely',    7800,  12999, 10, 34),
  p('HR-CN-LIC',  '6001234500028', 'Shea Butter Leave-In',      '453g',            'Hair',      'Cantu',            9500,  15999,  8,  5),
  p('HR-OR-MAY',  '6001234500035', 'Olive Oil Hair Mayonnaise', '443ml',           'Hair',      'ORS',              7200,  11999,  8, 27),
  p('HR-TC-FOOD', '6001234500042', 'Hair Food',                 '250ml',           'Hair',      'TCB',              2800,   4999, 20, 52),
  p('HR-LX-BW16', '6001234500059', 'Body Wave Bundle',          'Brazilian 16"',   'Hair',      'LuxLocks',        52000,  89900,  4, 11),
  p('HR-LX-FR13', '6001234500066', 'Lace Frontal Closure',      '13x4 HD',         'Hair',      'LuxLocks',        78000, 129900,  3,  0),
  p('HR-GN-EDGE', '6001234500073', 'Edge Control Gel',          '120ml',           'Hair',      'Generic',          3200,   6499, 15, 41),
  // Nails
  p('NL-CL-GP01', '6001234500080', 'Gel Polish',                'Ruby Red 15ml',   'Nails',     'ColorLux',         4200,   8999, 15, 38),
  p('NL-CL-GP02', '6001234500097', 'Gel Polish',                'Nude Beige 15ml', 'Nails',     'ColorLux',         4200,   8999, 15, 29),
  p('NL-NP-ACP',  '6001234500103', 'Acrylic Powder',            'Clear 100g',      'Nails',     'NailPro',         12000,  21999, 10, 22),
  p('NL-NP-MON',  '6001234500110', 'Monomer Liquid',            '250ml',           'Nails',     'NailPro',         16500,  28999,  6, 18),
  p('NL-NP-TIP',  '6001234500127', 'Nail Tips',                 'Natural 500pk',   'Nails',     'NailPro',          6800,  12999, 10, 31),
  p('NL-NP-GLU',  '6001234500134', 'Nail Glue',                 '5g',              'Nails',     'NailPro',          1500,   3499, 30, 60),
  // Tools
  p('NL-GN-LAMP', '6001234500141', 'UV/LED Nail Lamp',          '48W',             'Tools',     'Generic',         38000,  64900,  4,  2),
  // Cosmetics
  p('CS-GS-LIP',  '6001234500158', 'Matte Liquid Lipstick',     'Brick',           'Cosmetics', 'GlowSkin',         4500,   9999, 12, 44),
  p('CS-GS-FND',  '6001234500165', 'Foundation Stick',          'Shade 4',         'Cosmetics', 'GlowSkin',        13500,  24999,  8,  3),
  p('CS-GS-MAS',  '6001234500172', 'Volumising Mascara',        'Black',           'Cosmetics', 'GlowSkin',         5800,  11999, 12, 36),
  p('CS-GS-PWD',  '6001234500189', 'Setting Powder',            'Translucent',     'Cosmetics', 'GlowSkin',         9500,  17999,  8, 19),
  p('CS-GS-EYE',  '6001234500196', 'Eyeshadow Palette',         '12 Shade',        'Cosmetics', 'GlowSkin',        12500,  22999,  6, 14),
  // Skincare
  p('SK-GS-VITC', '6001234500202', 'Vitamin C Serum',           '30ml',            'Skincare',  'GlowSkin',        16000,  29999,  6,  4),
  p('SK-NH-SHEA', '6001234500219', 'Shea Butter Body Cream',    '500ml',           'Skincare',  'Nubian Heritage',  5200,   9999, 12, 47),
  p('SK-NH-SOAP', '6001234500226', 'African Black Soap',        '150g bar',        'Skincare',  'Nubian Heritage',  2600,   5999, 20, 55),

  // ── Real test product ──────────────────────────────────────
  // Barcode 2112345678917 is a valid EAN-13. The "21" prefix is the
  // GS1 restricted-circulation range — the one shops use for labels
  // they print themselves — and the check digit 7 is correct, so a
  // hardware scanner accepts it instead of refusing to beep.
  // Prices are PLACEHOLDERS.
  p('NL-TB-POL250', '2112345678917', 'Nail Polish',               '250ml',           'Nails',     'Generic',          4200,   8999, 20, 24),
];


/** Free-text with suggestions — a small shop orders by phone and
 *  WhatsApp, and does not want supplier admin before it can receive. */
export const SUPPLIERS = [
  'Beauty Wholesale SA',
  'ColorLux Distributors',
  'NailPro Supplies',
  'LuxLocks Hair Imports',
  'GlowSkin Wholesale',
] as const;
