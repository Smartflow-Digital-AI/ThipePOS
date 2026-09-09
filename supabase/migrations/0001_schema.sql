-- ═══════════════════════════════════════════════════════════════════
--  BeautyPOS — schema
--  Run this FIRST in Supabase → SQL Editor.
--
--  MONEY RULE: every amount is an INTEGER in CENTS.
--  R89.50 is stored as 8950. Never use float/numeric for money.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ─── Stores & tills ────────────────────────────────────────────────

create table stores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text default '',
  phone       text default '',
  vat_number  text default '',
  created_at  timestamptz not null default now()
);

create table tills (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references stores(id) on delete cascade,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─── Staff ─────────────────────────────────────────────────────────
-- pin_hash: never store a bare PIN. We hash with pgcrypto below.

create type staff_role as enum ('admin', 'manager', 'cashier', 'stock_controller');

create table staff (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,                      -- links to auth.users if you use Supabase Auth
  store_id     uuid not null references stores(id) on delete cascade,
  full_name    text not null,
  role         staff_role not null default 'cashier',
  pin_hash     text not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create index on staff (store_id) where is_active;

-- ─── Catalogue ─────────────────────────────────────────────────────

create table categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int  not null default 0
);

create table brands (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table products (
  id            uuid primary key default gen_random_uuid(),
  sku           text not null unique,
  barcode       text unique,
  name          text not null,
  variant       text default '',
  category_id   uuid references categories(id) on delete set null,
  brand_id      uuid references brands(id)     on delete set null,
  cost_price    int  not null default 0,   -- cents
  sell_price    int  not null default 0,   -- cents, VAT INCLUSIVE
  reorder_level int  not null default 10,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on products (barcode);
create index on products (category_id);
create index products_search_idx on products
  using gin (to_tsvector('simple', name || ' ' || coalesce(variant,'') || ' ' || sku));

-- ─── Inventory (quantity is PER STORE) ─────────────────────────────

create table inventory (
  product_id uuid not null references products(id) on delete cascade,
  store_id   uuid not null references stores(id)   on delete cascade,
  quantity   int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (product_id, store_id)
);

create type movement_type as enum
  ('sale','refund','receive','adjust','damage','transfer_in','transfer_out','stocktake');

create table stock_movements (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  store_id   uuid not null references stores(id)   on delete cascade,
  type       movement_type not null,
  quantity   int  not null,            -- negative for stock going out
  reason     text default '',
  reference  text default '',          -- sale number, PO number, etc.
  staff_id   uuid references staff(id) on delete set null,
  created_at timestamptz not null default now()
);

create index on stock_movements (product_id, created_at desc);

-- ─── Customers ─────────────────────────────────────────────────────

create table customers (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null,
  phone          text,
  email          text,
  store_credit   int  not null default 0,   -- cents
  loyalty_points int  not null default 0,
  total_spent    int  not null default 0,   -- cents
  created_at     timestamptz not null default now()
);

create index on customers (phone);

-- ─── Till sessions (a cashier's shift on one till) ─────────────────

create table till_sessions (
  id             uuid primary key default gen_random_uuid(),
  till_id        uuid not null references tills(id)  on delete cascade,
  store_id       uuid not null references stores(id) on delete cascade,
  opened_by      uuid not null references staff(id),
  opened_at      timestamptz not null default now(),
  opening_float  int  not null default 0,
  closed_by      uuid references staff(id),
  closed_at      timestamptz,
  counted_cash   int,
  expected_cash  int,
  variance       int,
  status         text not null default 'open' check (status in ('open','closed'))
);

-- Only one open session per till, enforced by the database.
create unique index one_open_session_per_till
  on till_sessions (till_id) where status = 'open';

-- ─── Sales ─────────────────────────────────────────────────────────

create sequence sale_number_seq start 1000;

create table sales (
  id              uuid primary key default gen_random_uuid(),
  sale_number     text not null unique default 'S-' || nextval('sale_number_seq'),
  store_id        uuid not null references stores(id),
  till_id         uuid not null references tills(id),
  till_session_id uuid references till_sessions(id) on delete set null,
  cashier_id      uuid references staff(id),
  customer_id     uuid references customers(id) on delete set null,
  subtotal        int  not null,   -- excl VAT
  discount_total  int  not null default 0,
  tax_total       int  not null,
  total           int  not null,   -- incl VAT, what the customer paid
  status          text not null default 'completed'
                    check (status in ('completed','refunded','voided')),
  created_at      timestamptz not null default now()
);

create index on sales (created_at desc);
create index on sales (till_session_id);

create table sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references sales(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  -- Snapshots: if the product is renamed or repriced later, the old
  -- receipt must still read exactly as it did on the day.
  name        text not null,
  sku         text not null,
  unit_price  int  not null,
  qty         int  not null,
  discount    int  not null default 0,
  line_total  int  not null
);

create index on sale_items (sale_id);

create table payments (
  id             uuid primary key default gen_random_uuid(),
  sale_id        uuid not null references sales(id) on delete cascade,
  method         text not null check (method in ('cash','card','store_credit')),
  amount         int  not null,
  card_reference text,          -- Yoco transaction id
  card_last4     text,
  card_brand     text,
  created_at     timestamptz not null default now()
);

create index on payments (sale_id);

-- ─── Refunds ───────────────────────────────────────────────────────

create table refunds (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references sales(id),
  refund_number text not null unique default 'R-' || nextval('sale_number_seq'),
  total         int  not null,
  reason        text default '',
  method        text not null check (method in ('cash','card','store_credit')),
  staff_id      uuid references staff(id),
  created_at    timestamptz not null default now()
);

create table refund_items (
  id         uuid primary key default gen_random_uuid(),
  refund_id  uuid not null references refunds(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  name       text not null,
  qty        int  not null,
  amount     int  not null,
  restock    boolean not null default true
);

-- ─── Suppliers & purchase orders (light) ───────────────────────────

create table suppliers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  contact_name text default '',
  phone        text default '',
  email        text default '',
  created_at   timestamptz not null default now()
);

create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  po_number     text not null unique,
  supplier_id   uuid references suppliers(id) on delete set null,
  store_id      uuid not null references stores(id),
  status        text not null default 'pending'
                  check (status in ('pending','partial','received','cancelled')),
  expected_date date,
  total         int not null default 0,
  created_at    timestamptz not null default now()
);

create table purchase_order_items (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references purchase_orders(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  qty_ordered  int not null,
  qty_received int not null default 0,
  unit_cost    int not null default 0
);

-- ─── Settings ──────────────────────────────────────────────────────

create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);


-- ═══════════════════════════════════════════════════════════════════
--  THE ONE FUNCTION THAT MATTERS
--
--  Completing a sale has to be ATOMIC: write the sale, write the
--  lines, write the payments and decrement stock — all of it, or none
--  of it. Doing that from the client in four round-trips will
--  eventually leave you with a sale that took money and never moved
--  stock. So it lives in one transaction, here.
-- ═══════════════════════════════════════════════════════════════════

create or replace function complete_sale(
  p_store_id        uuid,
  p_till_id         uuid,
  p_till_session_id uuid,
  p_cashier_id      uuid,
  p_customer_id     uuid,
  p_subtotal        int,
  p_discount_total  int,
  p_tax_total       int,
  p_total           int,
  p_items           jsonb,   -- [{product_id,name,sku,unit_price,qty,discount,line_total}]
  p_payments        jsonb    -- [{method,amount,card_reference,card_last4,card_brand}]
)
returns table (sale_id uuid, sale_number text)
language plpgsql
security definer
as $$
declare
  v_sale_id  uuid;
  v_number   text;
  v_item     jsonb;
  v_payment  jsonb;
begin
  insert into sales (store_id, till_id, till_session_id, cashier_id, customer_id,
                     subtotal, discount_total, tax_total, total)
  values (p_store_id, p_till_id, p_till_session_id, p_cashier_id, p_customer_id,
          p_subtotal, p_discount_total, p_tax_total, p_total)
  returning sales.id, sales.sale_number into v_sale_id, v_number;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into sale_items (sale_id, product_id, name, sku, unit_price, qty, discount, line_total)
    values (
      v_sale_id,
      (v_item->>'product_id')::uuid,
      v_item->>'name',
      v_item->>'sku',
      (v_item->>'unit_price')::int,
      (v_item->>'qty')::int,
      coalesce((v_item->>'discount')::int, 0),
      (v_item->>'line_total')::int
    );

    -- Take the stock down
    update inventory
       set quantity = quantity - (v_item->>'qty')::int,
           updated_at = now()
     where product_id = (v_item->>'product_id')::uuid
       and store_id   = p_store_id;

    -- Leave an audit trail
    insert into stock_movements (product_id, store_id, type, quantity, reference, staff_id)
    values ((v_item->>'product_id')::uuid, p_store_id, 'sale',
            -(v_item->>'qty')::int, v_number, p_cashier_id);
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    insert into payments (sale_id, method, amount, card_reference, card_last4, card_brand)
    values (
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::int,
      v_payment->>'card_reference',
      v_payment->>'card_last4',
      v_payment->>'card_brand'
    );
  end loop;

  if p_customer_id is not null then
    update customers
       set total_spent    = total_spent + p_total,
           loyalty_points = loyalty_points + (p_total / 1000)  -- 1 point per R10
     where id = p_customer_id;
  end if;

  return query select v_sale_id, v_number;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════
--  Close a till: work out what SHOULD be in the drawer and compare.
-- ═══════════════════════════════════════════════════════════════════

create or replace function close_till_session(
  p_session_id   uuid,
  p_counted_cash int,
  p_closed_by    uuid
)
returns table (expected int, counted int, variance int)
language plpgsql
security definer
as $$
declare
  v_float    int;
  v_cash_in  int;
  v_expected int;
begin
  select opening_float into v_float from till_sessions where id = p_session_id;

  select coalesce(sum(pay.amount), 0) into v_cash_in
    from payments pay
    join sales s on s.id = pay.sale_id
   where s.till_session_id = p_session_id
     and pay.method = 'cash';

  v_expected := v_float + v_cash_in;

  update till_sessions
     set closed_at     = now(),
         closed_by     = p_closed_by,
         counted_cash  = p_counted_cash,
         expected_cash = v_expected,
         variance      = p_counted_cash - v_expected,
         status        = 'closed'
   where id = p_session_id;

  return query select v_expected, p_counted_cash, p_counted_cash - v_expected;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════
--  Handy view: product + its stock at a store, ready for the grid.
-- ═══════════════════════════════════════════════════════════════════

create or replace view product_stock as
select
  p.id, p.sku, p.barcode, p.name, p.variant,
  coalesce(c.name, 'Uncategorised') as category,
  coalesce(b.name, '')              as brand,
  p.cost_price, p.sell_price, p.reorder_level, p.is_active,
  i.store_id,
  coalesce(i.quantity, 0) as stock,
  case
    when coalesce(i.quantity,0) <= 0                 then 'out_of_stock'
    when coalesce(i.quantity,0) <= p.reorder_level   then 'low_stock'
    else 'in_stock'
  end as stock_status
from products p
left join categories c on c.id = p.category_id
left join brands     b on b.id = p.brand_id
left join inventory  i on i.product_id = p.id;
