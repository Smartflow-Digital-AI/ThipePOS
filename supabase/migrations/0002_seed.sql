-- ═══════════════════════════════════════════════════════════════════
--  BeautyPOS — seed data
--  Run this SECOND. Safe to re-run (it clears first).
--
--  Prices are in CENTS and VAT-inclusive, at realistic SA retail.
--  Barcodes use the 600–601 prefix (South Africa's GS1 range).
-- ═══════════════════════════════════════════════════════════════════

truncate stock_movements, sale_items, payments, refund_items, refunds,
         sales, till_sessions, inventory, purchase_order_items,
         purchase_orders, products, categories, brands, customers,
         suppliers, staff, tills, stores restart identity cascade;

-- ─── Store + 3 tills ───────────────────────────────────────────────

insert into stores (id, name, address, phone, vat_number) values
  ('11111111-1111-1111-1111-111111111111',
   'Glow Beauty Supply',
   'Shop 14, Maponya Mall, Soweto, 1804',
   '011 938 4400',
   '4180299301');

insert into tills (id, store_id, name) values
  ('22222222-2222-2222-2222-222222222201','11111111-1111-1111-1111-111111111111','Till 1'),
  ('22222222-2222-2222-2222-222222222202','11111111-1111-1111-1111-111111111111','Till 2'),
  ('22222222-2222-2222-2222-222222222203','11111111-1111-1111-1111-111111111111','Till 3');

-- ─── Staff. Demo PINs are in the comment; only hashes are stored. ──
--   Karabo  (admin)            9999
--   Kagiso  (manager)          5555
--   Thandeka(cashier)          1234
--   Sipho   (cashier)          4321
--   Zanele  (stock controller) 7777

insert into staff (store_id, full_name, role, pin_hash) values
  ('11111111-1111-1111-1111-111111111111','Karabo Sithole',   'admin',            crypt('9999', gen_salt('bf'))),
  ('11111111-1111-1111-1111-111111111111','Kagiso Modise',    'manager',          crypt('5555', gen_salt('bf'))),
  ('11111111-1111-1111-1111-111111111111','Thandeka Mokoena', 'cashier',          crypt('1234', gen_salt('bf'))),
  ('11111111-1111-1111-1111-111111111111','Sipho Khumalo',    'cashier',          crypt('4321', gen_salt('bf'))),
  ('11111111-1111-1111-1111-111111111111','Zanele Dube',      'stock_controller', crypt('7777', gen_salt('bf')));

-- ─── Categories & brands ───────────────────────────────────────────

insert into categories (name, sort_order) values
  ('Hair', 1), ('Nails', 2), ('Cosmetics', 3), ('Skincare', 4), ('Tools', 5);

insert into brands (name) values
  ('Dark & Lovely'), ('Cantu'), ('ORS'), ('TCB'), ('LuxLocks'),
  ('NailPro'), ('ColorLux'), ('GlowSkin'), ('Nubian Heritage'), ('Generic');

-- ─── 20 products ───────────────────────────────────────────────────

insert into products (sku, barcode, name, variant, category_id, brand_id,
                      cost_price, sell_price, reorder_level)
select v.sku, v.barcode, v.name, v.variant,
       (select id from categories where name = v.cat),
       (select id from brands     where name = v.brand),
       v.cost, v.sell, v.reorder
from (values
  -- HAIR
  ('HR-DL-RLX',  '6001234500011','Relaxer Kit',              'Regular',        'Hair',     'Dark & Lovely',  7800, 12999, 10),
  ('HR-CN-LIC',  '6001234500028','Shea Butter Leave-In',     '453g',           'Hair',     'Cantu',          9500, 15999, 8),
  ('HR-OR-MAY',  '6001234500035','Olive Oil Hair Mayonnaise','443ml',          'Hair',     'ORS',            7200, 11999, 8),
  ('HR-TC-FOOD', '6001234500042','Hair Food',                '250ml',          'Hair',     'TCB',            2800,  4999, 20),
  ('HR-LX-BW16', '6001234500059','Body Wave Bundle',         'Brazilian 16"',  'Hair',     'LuxLocks',      52000, 89900, 4),
  ('HR-LX-FR13', '6001234500066','Lace Frontal Closure',     '13x4 HD',        'Hair',     'LuxLocks',      78000,129900, 3),
  ('HR-GN-EDGE', '6001234500073','Edge Control Gel',         '120ml',          'Hair',     'Generic',        3200,  6499, 15),

  -- NAILS
  ('NL-CL-GP01', '6001234500080','Gel Polish',               'Ruby Red 15ml',  'Nails',    'ColorLux',       4200,  8999, 15),
  ('NL-CL-GP02', '6001234500097','Gel Polish',               'Nude Beige 15ml','Nails',    'ColorLux',       4200,  8999, 15),
  ('NL-NP-ACP',  '6001234500103','Acrylic Powder',           'Clear 100g',     'Nails',    'NailPro',       12000, 21999, 10),
  ('NL-NP-MON',  '6001234500110','Monomer Liquid',           '250ml',          'Nails',    'NailPro',       16500, 28999, 6),
  ('NL-NP-TIP',  '6001234500127','Nail Tips',                'Natural 500pk',  'Nails',    'NailPro',        6800, 12999, 10),
  ('NL-NP-GLU',  '6001234500134','Nail Glue',                '5g',             'Nails',    'NailPro',        1500,  3499, 30),
  ('NL-GN-LAMP', '6001234500141','UV/LED Nail Lamp',         '48W',            'Tools',    'Generic',       38000, 64900, 4),

  -- COSMETICS
  ('CS-GS-LIP',  '6001234500158','Matte Liquid Lipstick',    'Brick',          'Cosmetics','GlowSkin',       4500,  9999, 12),
  ('CS-GS-FND',  '6001234500165','Foundation Stick',         'Shade 4',        'Cosmetics','GlowSkin',      13500, 24999, 8),
  ('CS-GS-MAS',  '6001234500172','Volumising Mascara',       'Black',          'Cosmetics','GlowSkin',       5800, 11999, 12),
  ('CS-GS-PWD',  '6001234500189','Setting Powder',           'Translucent',    'Cosmetics','GlowSkin',       9500, 17999, 8),
  ('CS-GS-EYE',  '6001234500196','Eyeshadow Palette',        '12 Shade',       'Cosmetics','GlowSkin',      12500, 22999, 6),

  -- SKINCARE
  ('SK-GS-VITC', '6001234500202','Vitamin C Serum',          '30ml',           'Skincare', 'GlowSkin',      16000, 29999, 6),
  ('SK-NH-SHEA', '6001234500219','Shea Butter Body Cream',   '500ml',          'Skincare', 'Nubian Heritage',5200,  9999, 12),
  ('SK-NH-SOAP', '6001234500226','African Black Soap',       '150g bar',       'Skincare', 'Nubian Heritage',2600,  5999, 20)
) as v(sku, barcode, name, variant, cat, brand, cost, sell, reorder);

-- ─── Opening stock ─────────────────────────────────────────────────
-- Deliberately mixed so you can see in-stock / low / out-of-stock
-- states in the UI straight away.

insert into inventory (product_id, store_id, quantity)
select p.id, '11111111-1111-1111-1111-111111111111',
  case p.sku
    when 'HR-LX-FR13' then 0    -- out of stock
    when 'CS-GS-FND'  then 3    -- low
    when 'HR-CN-LIC'  then 5    -- low
    when 'NL-GN-LAMP' then 2    -- low
    when 'SK-GS-VITC' then 4    -- low
    else 15 + (abs(hashtext(p.sku)) % 45)
  end
from products p;

-- ─── Customers ─────────────────────────────────────────────────────

insert into customers (full_name, phone, email, store_credit, loyalty_points, total_spent) values
  ('Nomvula Khumalo','082 555 1234','nomvula@email.com',      0, 142, 1420000),
  ('Sarah Jacobs',   '083 555 5678','sarah.j@email.com',  12000,  38,  380000),
  ('Thandi Mabaso',  '084 555 9012','thandi.m@email.com',     0, 221, 2210000),
  ('Aisha Patel',    '071 555 3456','aisha.p@email.com',   4500,  12,  120000),
  ('Lerato Nkosi',   '076 555 7788','lerato.n@email.com',     0,  65,  650000);

-- ─── Suppliers ─────────────────────────────────────────────────────

insert into suppliers (name, contact_name, phone, email) values
  ('Beauty Wholesale SA','R. Naidoo',  '011 555 0142','orders@beautywholesale.co.za'),
  ('ColorLux Distributors','A. Patel', '011 555 0198','sales@colorlux.co.za'),
  ('NailPro Supplies',   'M. Dlamini', '011 555 0177','info@nailpro.co.za'),
  ('LuxLocks Hair Imports','F. van Wyk','011 555 0203','hello@luxlocks.co.za');

-- ─── Settings ──────────────────────────────────────────────────────

insert into settings (key, value) values
  ('tax',      '{"rate": 0.15, "inclusive": true, "label": "VAT"}'),
  ('receipt',  '{"footer": "Thank you for shopping at Glow Beauty Supply!", "return_days": 7}'),
  ('currency', '{"code": "ZAR", "symbol": "R"}');


-- ═══════════════════════════════════════════════════════════════════
--  PIN login helper.
--  Returns the staff row when the PIN matches, nothing when it does not.
--  Called from the server only (see app/api/auth/pin/route.ts).
-- ═══════════════════════════════════════════════════════════════════

create or replace function verify_staff_pin(p_store_id uuid, p_pin text)
returns table (id uuid, full_name text, role staff_role)
language sql
security definer
as $$
  select s.id, s.full_name, s.role
    from staff s
   where s.store_id = p_store_id
     and s.is_active
     and s.pin_hash = crypt(p_pin, s.pin_hash)
   limit 1;
$$;
