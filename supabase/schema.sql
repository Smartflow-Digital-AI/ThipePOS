-- ═══════════════════════════════════════════════════════════════════
--
--   BeautyPOS — COMPLETE DATABASE
--   Run this ONE file in Supabase → SQL Editor → New query → Run.
--
--   This is the whole thing: every table, every function, every
--   index. It is the file to run on go-live day. It replaces
--   migrations/0001 and 0002 — you do not need those as well.
--
--   Safe to re-run on a fresh project. It will REFUSE to run over
--   an existing database with data (see the guard at the top).
--
--   ─────────────────────────────────────────────────────────────
--   MONEY RULE, and it is not negotiable:
--   every amount is an INTEGER number of CENTS.
--   R89.99 is stored as 8999. Never numeric, never float.
--   Floats drift. A till that drifts a cent a day is a till
--   nobody trusts by December.
--   ─────────────────────────────────────────────────────────────
--
--   CONTENTS
--     1.  Extensions
--     2.  Stores, tills, staff
--     3.  Catalogue (categories, brands, products)
--     4.  Inventory + movements
--     5.  Customers
--     6.  Till sessions
--     7.  Sales, sale items, payments
--     8.  Refunds
--     9.  Suppliers + purchase orders
--    10.  Settings
--    11.  Functions   ← the important part
--    12.  Views
--    13.  Seed data (store, 3 tills, 5 staff, 22 products)
--    14.  Row Level Security  (commented out — read before enabling)
--
-- ═══════════════════════════════════════════════════════════════════


-- ─── 0. Guard against running this over live data ──────────────────

do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'sales')
     and (select count(*) from public.sales) > 0
  then
    raise exception
      'REFUSING TO RUN: this database already has % sales in it. '
      'Running this file would destroy them. If you really mean to '
      'wipe and rebuild, drop the schema manually first.',
      (select count(*) from public.sales);
  end if;
end $$;


-- ─── 1. Extensions ─────────────────────────────────────────────────

create extension if not exists "pgcrypto";   -- gen_random_uuid(), crypt()


-- ─── Clean slate (only reached if the guard above passed) ──────────

drop view   if exists product_stock          cascade;
drop view   if exists sale_ledger            cascade;
drop table  if exists delivery_lines         cascade;
drop table  if exists deliveries             cascade;
drop table  if exists credit_notes           cascade;
drop table  if exists overrides              cascade;
drop table  if exists refund_items           cascade;
drop table  if exists refunds                cascade;
drop table  if exists payments               cascade;
drop table  if exists sale_items             cascade;
drop table  if exists sales                  cascade;
drop table  if exists till_sessions          cascade;
drop table  if exists stock_movements        cascade;
drop table  if exists inventory              cascade;
drop table  if exists purchase_order_items   cascade;
drop table  if exists purchase_orders        cascade;
drop table  if exists suppliers              cascade;
drop table  if exists products               cascade;
drop table  if exists brands                 cascade;
drop table  if exists categories             cascade;
drop table  if exists customers              cascade;
drop table  if exists staff                  cascade;
drop table  if exists tills                  cascade;
drop table  if exists stores                 cascade;
drop table  if exists settings               cascade;
drop type   if exists staff_role             cascade;
drop type   if exists movement_type          cascade;
drop sequence if exists sale_number_seq      cascade;
drop sequence if exists refund_number_seq    cascade;
drop sequence if exists voucher_seq          cascade;


-- ─── 2. Stores, tills, staff ───────────────────────────────────────

create table stores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text not null default '',
  phone       text not null default '',
  vat_number  text not null default '',
  created_at  timestamptz not null default now()
);

create table tills (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references stores(id) on delete cascade,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

create type staff_role as enum ('admin', 'manager', 'cashier', 'stock_controller');

-- Two ways in, on purpose:
--   pin_hash  → the counter. Opens a TILL session and nothing more.
--   email     → the back office, via Supabase Auth (auth_user_id).
--
-- The PIN deliberately does not grant rank. Anyone standing in the
-- queue can read a 4-digit PIN off the counter, so the worst it can be
-- worth is one shift's till access — never cost prices or settings.
create table staff (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,          -- ← office login: link to auth.users
  store_id     uuid not null references stores(id) on delete cascade,
  full_name    text not null,
  email        text unique,          -- null for till-only staff
  role         staff_role not null default 'cashier',
  pin_hash     text,                 -- bcrypt. NEVER store a bare PIN.
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  -- Everyone needs at least one way in.
  constraint staff_has_a_credential check (pin_hash is not null or email is not null)
);

create index staff_store_idx on staff (store_id) where is_active;


-- ─── 3. Catalogue ──────────────────────────────────────────────────

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
  variant       text not null default '',
  category_id   uuid references categories(id) on delete set null,
  brand_id      uuid references brands(id)     on delete set null,
  cost_price    int  not null default 0 check (cost_price >= 0),
  sell_price    int  not null default 0 check (sell_price >= 0),  -- VAT INCLUSIVE
  reorder_level int  not null default 10,
  is_active     boolean not null default true,
  image_url     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index products_barcode_idx  on products (barcode);
create index products_category_idx on products (category_id);
create index products_search_idx   on products
  using gin (to_tsvector('simple',
    name || ' ' || coalesce(variant,'') || ' ' || sku));


-- ─── 4. Inventory ──────────────────────────────────────────────────
-- Quantity is PER STORE. One row per product per store.

create table inventory (
  product_id uuid not null references products(id) on delete cascade,
  store_id   uuid not null references stores(id)   on delete cascade,
  quantity   int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (product_id, store_id)
);

create type movement_type as enum (
  'sale', 'refund', 'receive', 'adjust',
  'damage', 'transfer_in', 'transfer_out', 'stocktake'
);

-- Every single change to stock leaves a row here. This is what turns
-- "the numbers are wrong" into "here is exactly who did what, when".
create table stock_movements (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  store_id   uuid not null references stores(id)   on delete cascade,
  type       movement_type not null,
  quantity   int  not null,          -- negative when stock leaves
  reason     text not null default '',
  reference  text not null default '',  -- sale number, refund number, PO number
  staff_id   uuid references staff(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The running balance after each movement. Storing it means the stock
-- history reads straight off the table — "was 20, sold 6, now 14" —
-- instead of replaying every row since the beginning of time.
alter table stock_movements add column if not exists balance_after int;
-- Receives only: what this delivery charged per unit, so a supplier
-- raising prices quietly shows up in a report.
alter table stock_movements add column if not exists unit_cost int;

create index stock_moves_product_idx on stock_movements (product_id, created_at desc);
create index stock_moves_ref_idx     on stock_movements (reference);
create index stock_moves_type_idx    on stock_movements (type, created_at desc);
create index stock_moves_staff_idx   on stock_movements (staff_id, created_at desc);


-- ─── 4b. Deliveries (goods received) ───────────────────────────────
--
-- No purchase orders: this shop orders by phone and WhatsApp, so a
-- delivery is recorded against the supplier's own invoice.
--
-- The pair of quantities is the whole point. qty_received is what was
-- COUNTED INTO THE SHOP; qty_invoiced is what the supplier says they
-- sent. A supplier who bills for 20 and ships 18 costs you money every
-- single time until somebody compares the two numbers.

create sequence grn_seq start 500;

create table deliveries (
  id               uuid primary key default gen_random_uuid(),
  delivery_number  text not null unique default 'GRN-' || nextval('grn_seq'),
  store_id         uuid not null references stores(id) on delete cascade,
  supplier         text not null,
  invoice_ref      text not null default '',
  received_by      uuid references staff(id),
  total_cost       int  not null default 0,
  -- sum(invoiced − received). Positive means short-shipped.
  discrepancy_units int not null default 0,
  created_at       timestamptz not null default now()
);

create index deliveries_supplier_idx on deliveries (supplier, created_at desc);
create index deliveries_created_idx  on deliveries (created_at desc);

create table delivery_lines (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  uuid not null references deliveries(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  name         text not null,
  sku          text not null,
  qty_received int  not null check (qty_received >= 0),
  qty_invoiced int  not null check (qty_invoiced >= 0),
  unit_cost    int  not null default 0
);

create index delivery_lines_delivery_idx on delivery_lines (delivery_id);
create index delivery_lines_product_idx  on delivery_lines (product_id);


-- ─── 5. No customer accounts ───────────────────────────────────────
--
-- This shop does not register anyone. The only personal data captured
-- is an email at checkout, stored on that sale, used to send that one
-- receipt — see sales.customer_email below.
--
-- Under POPIA that is a single stated purpose with no profile built.
-- It is also why there is no customers table to secure, breach, or
-- explain to the Information Regulator.
--
-- Store credit therefore cannot live on an account. It lives on a
-- printed voucher — see credit_notes in section 8c.


-- ─── 6. Till sessions (one cashier's shift on one till) ────────────

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

-- The database enforces one open session per till. Two cashiers
-- cannot open Till 2 at the same time — that is a data problem you
-- do not want to discover from a broken cash-up.
create unique index one_open_session_per_till
  on till_sessions (till_id) where status = 'open';

create index till_sessions_till_idx on till_sessions (till_id, opened_at desc);


-- ─── 7. Sales ──────────────────────────────────────────────────────

create sequence sale_number_seq   start 1000;
create sequence refund_number_seq start 2000;

create table sales (
  id              uuid primary key default gen_random_uuid(),
  sale_number     text not null unique default 'S-' || nextval('sale_number_seq'),
  store_id        uuid not null references stores(id),
  till_id         uuid not null references tills(id),
  till_session_id uuid references till_sessions(id) on delete set null,
  cashier_id      uuid references staff(id),
  -- Captured only to send the receipt. Not an account, not a profile.
  customer_email  text,
  subtotal        int  not null,          -- excl VAT
  discount_total  int  not null default 0,
  tax_total       int  not null,
  total           int  not null,          -- incl VAT — what was actually paid
  status          text not null default 'completed'
                    check (status in ('completed','partially_refunded','refunded','voided')),
  created_at      timestamptz not null default now()
);

create index sales_created_idx  on sales (created_at desc);
create index sales_session_idx  on sales (till_session_id);
create index sales_email_idx    on sales (customer_email) where customer_email is not null;

create table sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references sales(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  -- SNAPSHOTS. If the product is renamed or repriced next month, the
  -- receipt from today must still read exactly as it did today.
  name        text not null,
  sku         text not null,
  unit_price  int  not null,
  qty         int  not null check (qty > 0),
  discount    int  not null default 0,
  line_total  int  not null
);

create index sale_items_sale_idx    on sale_items (sale_id);
create index sale_items_product_idx on sale_items (product_id);

create table payments (
  id             uuid primary key default gen_random_uuid(),
  sale_id        uuid not null references sales(id) on delete cascade,
  method         text not null check (method in ('cash','card','voucher')),
  amount         int  not null,
  card_reference text,        -- Yoco transaction id — you NEED this to refund
  card_last4     text,
  card_brand     text,
  voucher_code   text,        -- which credit note was spent
  created_at     timestamptz not null default now()
);

create index payments_sale_idx on payments (sale_id);


-- ─── 8. Refunds ────────────────────────────────────────────────────
--
-- A refund is a SEPARATE DOCUMENT, never an edit to the sale.
-- The sale that happened, happened. You cannot un-print a receipt,
-- and SARS needs to see both halves of the story.

create table refunds (
  id              uuid primary key default gen_random_uuid(),
  refund_number   text not null unique default 'R-' || nextval('refund_number_seq'),
  sale_id         uuid not null references sales(id),
  store_id        uuid not null references stores(id),
  till_id         uuid references tills(id),
  till_session_id uuid references till_sessions(id) on delete set null,
  staff_id        uuid references staff(id),
  -- Set when the refund was given as a voucher rather than money.
  credit_note_code text,
  total           int  not null check (total > 0),
  reason          text not null default '',
  method          text not null check (method in ('cash','card','store_credit')),
  card_reference  text,        -- Yoco's id for the REFUND, not the sale
  created_at      timestamptz not null default now()
);

create index refunds_sale_idx    on refunds (sale_id);
create index refunds_session_idx on refunds (till_session_id);
create index refunds_created_idx on refunds (created_at desc);

create table refund_items (
  id         uuid primary key default gen_random_uuid(),
  refund_id  uuid not null references refunds(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  name       text not null,
  sku        text not null,
  unit_price int  not null,
  qty        int  not null check (qty > 0),
  amount     int  not null,
  -- false when the item came back damaged: the customer gets their
  -- money, the stock does NOT go back on the shelf.
  restock    boolean not null default true
);

create index refund_items_refund_idx  on refund_items (refund_id);
create index refund_items_product_idx on refund_items (product_id);


-- ─── 8b. Overrides ─────────────────────────────────────────────────
--
-- When a cashier needs something above their level, a manager approves
-- that ONE action and control returns to the cashier immediately.
--
-- The row below is the entire point. An override nobody can point at
-- afterwards is not a control, it is a formality — so we record who
-- asked, who approved, for what, on which till, at what time.
--
-- Query this weekly. A cashier who needs three overrides a day is
-- either being trained badly or something else is going on.

create table overrides (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references stores(id) on delete cascade,
  till_id         uuid references tills(id),
  till_session_id uuid references till_sessions(id) on delete set null,
  action          text not null,      -- 'refund_outside_window'
  detail          text not null default '',
  requested_by    uuid references staff(id),
  approved_by     uuid not null references staff(id),
  created_at      timestamptz not null default now(),
  -- Nobody approves their own exception.
  constraint no_self_approval check (approved_by is distinct from requested_by)
);

create index overrides_created_idx  on overrides (created_at desc);
create index overrides_approver_idx on overrides (approved_by, created_at desc);
create index overrides_session_idx  on overrides (till_session_id);


-- ─── 8c. Credit notes (store-credit vouchers) ──────────────────────
--
-- With no customer accounts, store credit is a PRINTED SLIP with a
-- code — the way a high-street shop hands you one. The customer keeps
-- the paper; this table is the truth about what it is worth.
--
-- Every active voucher is a LIABILITY: money the shop already owes and
-- will hand over in goods. Watch the outstanding total.

create sequence voucher_seq start 1;

create table credit_notes (
  id         uuid primary key default gen_random_uuid(),
  -- Read off a curling till slip and typed by hand, so the alphabet
  -- excludes O/0, I/1/L, S/5, B/8 and Z/2. Generated in the app.
  code       text not null unique,
  store_id   uuid not null references stores(id) on delete cascade,
  refund_id  uuid references refunds(id) on delete set null,
  amount     int  not null check (amount > 0),      -- as issued
  remaining  int  not null check (remaining >= 0),  -- still on it
  issued_at  timestamptz not null default now(),
  expires_at timestamptz not null,
  status     text not null default 'active'
               check (status in ('active','redeemed','expired','void')),
  -- You cannot spend more than was ever put on it.
  constraint remaining_within_amount check (remaining <= amount)
);

create index credit_notes_code_idx   on credit_notes (code);
create index credit_notes_active_idx on credit_notes (status) where status = 'active';


-- ─── 9. Suppliers & purchase orders ────────────────────────────────

create table suppliers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  contact_name text not null default '',
  phone        text not null default '',
  email        text not null default '',
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


-- ─── 10. Settings ──────────────────────────────────────────────────

create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);


-- ═══════════════════════════════════════════════════════════════════
--  11. FUNCTIONS
--
--  These exist because a POS operation is never one write. Completing
--  a sale is: insert sale + insert lines + insert payments + move
--  stock + log movements. Doing that in five round-trips from the
--  browser means that one day the network dies after step 3 and you
--  have taken money without moving stock.
--
--  One function = one transaction = all of it or none of it.
-- ═══════════════════════════════════════════════════════════════════

-- ─── complete_sale ─────────────────────────────────────────────────

-- Note: complete_sale calls redeem_voucher, which is defined further
-- down. plpgsql resolves function calls at execution time, not at
-- creation, so the order in this file does not matter.
create or replace function complete_sale(
  p_store_id        uuid,
  p_till_id         uuid,
  p_till_session_id uuid,
  p_cashier_id      uuid,
  p_customer_email  text,
  p_subtotal        int,
  p_discount_total  int,
  p_tax_total       int,
  p_total           int,
  p_items           jsonb,  -- [{product_id,name,sku,unit_price,qty,discount,line_total}]
  p_payments        jsonb   -- [{method,amount,card_reference,card_last4,card_brand}]
)
returns table (sale_id uuid, sale_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_number  text;
  v_item    jsonb;
  v_payment jsonb;
  v_balance int;
begin
  insert into sales (store_id, till_id, till_session_id, cashier_id, customer_email,
                     subtotal, discount_total, tax_total, total)
  values (p_store_id, p_till_id, p_till_session_id, p_cashier_id, nullif(trim(p_customer_email), ''),
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

    update inventory
       set quantity   = quantity - (v_item->>'qty')::int,
           updated_at = now()
     where product_id = (v_item->>'product_id')::uuid
       and store_id   = p_store_id
    returning quantity into v_balance;

    insert into stock_movements (product_id, store_id, type, quantity, balance_after,
                                 reference, staff_id)
    values ((v_item->>'product_id')::uuid, p_store_id, 'sale',
            -(v_item->>'qty')::int, v_balance, v_number, p_cashier_id);
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    insert into payments (sale_id, method, amount, card_reference, card_last4, card_brand, voucher_code)
    values (
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::int,
      v_payment->>'card_reference',
      v_payment->>'card_last4',
      v_payment->>'card_brand',
      v_payment->>'voucher_code'
    );

    -- Spending a voucher happens inside the same transaction as the
    -- sale. If the sale rolls back, the voucher is untouched; if the
    -- voucher cannot be spent, the sale does not happen. Never two
    -- separate calls — that is how a voucher gets spent on a sale that
    -- was never recorded.
    if v_payment->>'method' = 'voucher' and v_payment->>'voucher_code' is not null then
      perform redeem_voucher(v_payment->>'voucher_code', (v_payment->>'amount')::int);
    end if;
  end loop;

  return query select v_sale_id, v_number;
end;
$$;


-- ─── process_refund ────────────────────────────────────────────────
--
-- Refuses to over-refund. If someone returns 2 of an item they bought
-- 3 of, and later tries to return 2 more, this raises rather than
-- quietly handing out money that was never taken.

create or replace function process_refund(
  p_sale_id         uuid,
  p_store_id        uuid,
  p_till_id         uuid,
  p_till_session_id uuid,
  p_staff_id        uuid,
  p_reason          text,
  p_method          text,
  p_card_reference  text,
  p_items           jsonb,  -- [{product_id,name,sku,unit_price,qty,amount,restock}]
  -- Supplied by the app when the refund is given as a voucher, so the
  -- code on the printed slip and the code in the database are the same.
  p_voucher_code    text default null,
  p_voucher_years   int  default 3
)
returns table (refund_id uuid, refund_number text, refund_total int, voucher_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund_id  uuid;
  v_number     text;
  v_item       jsonb;
  v_total      int := 0;
  v_sold       int;
  v_already    int;
  v_qty        int;
  v_sold_units int;
  v_ret_units  int;
  v_voucher    text := null;
  v_balance    int;
begin

  -- Validate EVERY line before writing anything.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::int;

    select coalesce(sum(si.qty), 0) into v_sold
      from sale_items si
     where si.sale_id = p_sale_id
       and si.product_id = (v_item->>'product_id')::uuid;

    select coalesce(sum(ri.qty), 0) into v_already
      from refund_items ri
      join refunds r on r.id = ri.refund_id
     where r.sale_id = p_sale_id
       and ri.product_id = (v_item->>'product_id')::uuid;

    if v_qty <= 0 then
      raise exception 'Refund quantity must be positive';
    end if;

    if v_already + v_qty > v_sold then
      raise exception
        'Cannot refund % of product % — only % were sold and % already returned',
        v_qty, v_item->>'name', v_sold, v_already;
    end if;

    v_total := v_total + (v_item->>'amount')::int;
  end loop;

  if v_total <= 0 then
    raise exception 'Refund total must be positive';
  end if;

  if p_method = 'store_credit' then
    v_voucher := coalesce(p_voucher_code, 'GB-' || upper(substr(md5(random()::text), 1, 8)));
  end if;

  insert into refunds (sale_id, store_id, till_id, till_session_id, staff_id,
                       credit_note_code, total, reason, method, card_reference)
  values (p_sale_id, p_store_id, p_till_id, p_till_session_id, p_staff_id,
          v_voucher, v_total, p_reason, p_method, p_card_reference)
  returning refunds.id, refunds.refund_number into v_refund_id, v_number;

  -- The voucher IS the refund when method is store_credit.
  if v_voucher is not null then
    insert into credit_notes (code, store_id, refund_id, amount, remaining, expires_at)
    values (v_voucher, p_store_id, v_refund_id, v_total, v_total,
            now() + make_interval(years => p_voucher_years));
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into refund_items (refund_id, product_id, name, sku, unit_price, qty, amount, restock)
    values (
      v_refund_id,
      (v_item->>'product_id')::uuid,
      v_item->>'name',
      v_item->>'sku',
      (v_item->>'unit_price')::int,
      (v_item->>'qty')::int,
      (v_item->>'amount')::int,
      coalesce((v_item->>'restock')::boolean, true)
    );

    -- Everything coming back goes ON the books first...
    update inventory
       set quantity   = quantity + (v_item->>'qty')::int,
           updated_at = now()
     where product_id = (v_item->>'product_id')::uuid
       and store_id   = p_store_id
    returning quantity into v_balance;

    insert into stock_movements (product_id, store_id, type, quantity, balance_after,
                                 reason, reference, staff_id)
    values ((v_item->>'product_id')::uuid, p_store_id, 'refund',
            (v_item->>'qty')::int, v_balance, p_reason, v_number, p_staff_id);

    -- ...and damaged goods come straight back off as a write-off.
    -- Net stock is unchanged either way, but the ledger tells the true
    -- story: it came back AND it was scrapped. Without both halves,
    -- damage reporting has nothing to count.
    if not coalesce((v_item->>'restock')::boolean, true) then
      update inventory
         set quantity   = quantity - (v_item->>'qty')::int,
             updated_at = now()
       where product_id = (v_item->>'product_id')::uuid
         and store_id   = p_store_id
      returning quantity into v_balance;

      insert into stock_movements (product_id, store_id, type, quantity, balance_after,
                                   reason, reference, staff_id)
      values ((v_item->>'product_id')::uuid, p_store_id, 'damage',
              -(v_item->>'qty')::int, v_balance,
              'Returned damaged — not resaleable', v_number, p_staff_id);
    end if;
  end loop;

  -- Roll the sale's status forward.
  select coalesce(sum(qty),0) into v_sold_units from sale_items where sale_id = p_sale_id;
  select coalesce(sum(ri.qty),0) into v_ret_units
    from refund_items ri join refunds r on r.id = ri.refund_id
   where r.sale_id = p_sale_id;

  update sales
     set status = case when v_ret_units >= v_sold_units then 'refunded'
                       else 'partially_refunded' end
   where id = p_sale_id;

  return query select v_refund_id, v_number, v_total, v_voucher;
end;
$$;


-- ─── receive_delivery ──────────────────────────────────────────────
--
-- Stock going UP is exactly as dangerous as stock going down: half a
-- delivery recorded is a shelf count nobody can reconcile. One
-- transaction, or none of it.

create or replace function receive_delivery(
  p_store_id      uuid,
  p_supplier      text,
  p_invoice_ref   text,
  p_received_by   uuid,
  p_update_costs  boolean,
  p_lines         jsonb  -- [{product_id,name,sku,qty,qty_invoiced,unit_cost}]
)
returns table (delivery_id uuid, delivery_number text, discrepancy int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_number  text;
  v_line    jsonb;
  v_total   int := 0;
  v_diff    int := 0;
  v_qty     int;
  v_balance int;
begin
  insert into deliveries (store_id, supplier, invoice_ref, received_by)
  values (p_store_id, p_supplier, coalesce(p_invoice_ref, ''), p_received_by)
  returning deliveries.id, deliveries.delivery_number into v_id, v_number;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := (v_line->>'qty')::int;
    if v_qty <= 0 then continue; end if;

    insert into delivery_lines (delivery_id, product_id, name, sku,
                                qty_received, qty_invoiced, unit_cost)
    values (v_id, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
            v_qty, (v_line->>'qty_invoiced')::int, (v_line->>'unit_cost')::int);

    update inventory
       set quantity = quantity + v_qty, updated_at = now()
     where product_id = (v_line->>'product_id')::uuid
       and store_id = p_store_id
    returning quantity into v_balance;

    insert into stock_movements (product_id, store_id, type, quantity, balance_after,
                                 reason, reference, staff_id, unit_cost)
    values ((v_line->>'product_id')::uuid, p_store_id, 'receive', v_qty, v_balance,
            p_supplier, v_number, p_received_by, (v_line->>'unit_cost')::int);

    -- A supplier raising a price should be a decision, not a silent
    -- side effect of unpacking a box.
    if p_update_costs and (v_line->>'unit_cost')::int > 0 then
      update products set cost_price = (v_line->>'unit_cost')::int, updated_at = now()
       where id = (v_line->>'product_id')::uuid;
    end if;

    v_total := v_total + (v_line->>'unit_cost')::int * v_qty;
    v_diff  := v_diff + ((v_line->>'qty_invoiced')::int - v_qty);
  end loop;

  update deliveries
     set total_cost = v_total, discrepancy_units = v_diff
   where id = v_id;

  return query select v_id, v_number, v_diff;
end;
$$;


-- ─── redeem_voucher ────────────────────────────────────────────────
--
-- FOR UPDATE is the whole point of this function.
--
-- You have three tills. Without the row lock, two cashiers redeeming
-- the same voucher at the same instant both read "R100 remaining" and
-- both take R100 — you have just given away R200 on a R100 voucher.
-- The lock makes the second one wait and see the truth.
--
-- Never do this read-then-write from the client.

create or replace function redeem_voucher(p_code text, p_amount int)
returns table (taken int, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v         credit_notes%rowtype;
  v_taken   int;
begin
  select * into v from credit_notes where code = upper(trim(p_code)) for update;

  if not found then
    raise exception 'No voucher with code %', p_code;
  end if;
  if v.status <> 'active' then
    raise exception 'Voucher % is already %', p_code, v.status;
  end if;
  if v.expires_at <= now() then
    update credit_notes set status = 'expired' where id = v.id;
    raise exception 'Voucher % expired on %', p_code, v.expires_at::date;
  end if;

  -- Take at most what is on it. The balance stays on the same code —
  -- NEVER give cash change from a voucher, that is a cash-out.
  v_taken := least(v.remaining, p_amount);
  if v_taken <= 0 then
    raise exception 'Voucher % has nothing left on it', p_code;
  end if;

  update credit_notes
     set remaining = v.remaining - v_taken,
         status    = case when v.remaining - v_taken <= 0 then 'redeemed' else status end
   where id = v.id;

  return query select v_taken, v.remaining - v_taken;
end;
$$;


-- ─── close_till_session ────────────────────────────────────────────
--
-- Cash refunds paid OUT of the drawer come off the expected total.
-- Miss this and every till with a refund on it reads as short.

create or replace function close_till_session(
  p_session_id   uuid,
  p_counted_cash int,
  p_closed_by    uuid
)
returns table (expected int, counted int, variance int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_float    int;
  v_cash_in  int;
  v_cash_out int;
  v_expected int;
begin
  select opening_float into v_float from till_sessions where id = p_session_id;

  select coalesce(sum(pay.amount), 0) into v_cash_in
    from payments pay
    join sales s on s.id = pay.sale_id
   where s.till_session_id = p_session_id
     and pay.method = 'cash';

  select coalesce(sum(r.total), 0) into v_cash_out
    from refunds r
   where r.till_session_id = p_session_id
     and r.method = 'cash';

  v_expected := v_float + v_cash_in - v_cash_out;

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


-- ─── verify_staff_pin ──────────────────────────────────────────────
-- Call from the SERVER only, with the service-role key.

-- Opens a TILL session. Note the role filter: a stock controller's PIN
-- (if they ever get one) still cannot open a till, and this function
-- returns nothing that would let the caller assume otherwise.
create or replace function verify_staff_pin(p_store_id uuid, p_pin text)
returns table (id uuid, full_name text, role staff_role)
language sql
security definer
set search_path = public
as $
  select s.id, s.full_name, s.role
    from staff s
   where s.store_id = p_store_id
     and s.is_active
     and s.pin_hash is not null
     and s.pin_hash = crypt(p_pin, s.pin_hash)
     and s.role in ('cashier', 'manager', 'admin')
   limit 1;
$;

-- Approves ONE exception. Separate from verify_staff_pin because the
-- answer to "may this person sell?" and "may this person authorise an
-- exception?" must never be the same question.
create or replace function verify_override_pin(p_store_id uuid, p_pin text)
returns table (id uuid, full_name text, role staff_role)
language sql
security definer
set search_path = public
as $
  select s.id, s.full_name, s.role
    from staff s
   where s.store_id = p_store_id
     and s.is_active
     and s.pin_hash is not null
     and s.pin_hash = crypt(p_pin, s.pin_hash)
     and s.role in ('manager', 'admin')
   limit 1;
$;


-- ═══════════════════════════════════════════════════════════════════
--  12. VIEWS
-- ═══════════════════════════════════════════════════════════════════

-- Product + its stock at a store, ready for the till grid.
create or replace view product_stock as
select
  p.id, p.sku, p.barcode, p.name, p.variant,
  coalesce(c.name, 'Uncategorised') as category,
  coalesce(b.name, '')              as brand,
  p.cost_price, p.sell_price, p.reorder_level, p.is_active,
  i.store_id,
  coalesce(i.quantity, 0) as stock,
  case
    when coalesce(i.quantity,0) <= 0               then 'out_of_stock'
    when coalesce(i.quantity,0) <= p.reorder_level then 'low_stock'
    else 'in_stock'
  end as stock_status
from products p
left join categories c on c.id = p.category_id
left join brands     b on b.id = p.brand_id
left join inventory  i on i.product_id = p.id;


-- Net position per sale: what was taken, what went back.
-- This is the view to build the owner's numbers on.
create or replace view sale_ledger as
select
  s.id,
  s.sale_number,
  s.store_id,
  s.till_id,
  s.till_session_id,
  s.created_at,
  s.total                             as gross_total,
  coalesce(r.refunded, 0)             as refunded_total,
  s.total - coalesce(r.refunded, 0)   as net_total,
  s.status
from sales s
left join (
  select sale_id, sum(total) as refunded
    from refunds
   group by sale_id
) r on r.sale_id = s.id;


-- What the shop owes in unspent vouchers. Check this monthly — it is
-- a real liability that never appears in a sales report.
create or replace view voucher_liability as
select
  store_id,
  count(*) filter (where status = 'active' and expires_at > now()) as active_vouchers,
  coalesce(sum(remaining) filter (where status = 'active' and expires_at > now()), 0) as outstanding,
  coalesce(sum(amount), 0)                                          as issued_total,
  coalesce(sum(amount - remaining), 0)                              as redeemed_total
from credit_notes
group by store_id;


-- Shrinkage: what left the building without being sold.
create or replace view stock_losses as
select
  m.store_id,
  m.product_id,
  p.name,
  p.sku,
  date_trunc('month', m.created_at) as month,
  sum(abs(m.quantity))              as units_lost,
  sum(abs(m.quantity) * p.cost_price) as value_at_cost
from stock_movements m
join products p on p.id = m.product_id
where m.type in ('damage', 'stocktake')
   or (m.type = 'adjust' and m.quantity < 0)
group by m.store_id, m.product_id, p.name, p.sku, date_trunc('month', m.created_at);


-- Which suppliers actually send what they bill for.
create or replace view supplier_accuracy as
select
  d.store_id,
  d.supplier,
  count(*)                                   as deliveries,
  sum(dl.qty_received)                       as units_received,
  sum(greatest(0, dl.qty_invoiced - dl.qty_received)) as units_short,
  sum(dl.qty_received * dl.unit_cost)        as spend,
  round(
    100.0 * sum(dl.qty_received) /
    nullif(sum(dl.qty_received) + sum(greatest(0, dl.qty_invoiced - dl.qty_received)), 0)
  , 1)                                       as accuracy_pct
from deliveries d
join delivery_lines dl on dl.delivery_id = d.id
group by d.store_id, d.supplier;


-- ═══════════════════════════════════════════════════════════════════
--  13. SEED DATA
--
--  Delete this whole section if you are setting up a real store and
--  want to enter your own products. Keep it to have something to
--  test against.
-- ═══════════════════════════════════════════════════════════════════

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

-- Demo PINs: 9999 admin / 5555 manager / 1234 + 4321 cashiers.
-- CHANGE THESE before the shop uses it.
--
-- Note the stock controller has an email and NO pin — they never work a
-- till. The cashiers have a pin and NO email — they never see margin.
insert into staff (store_id, full_name, role, pin_hash, email) values
  ('11111111-1111-1111-1111-111111111111','Karabo Sithole',   'admin',            crypt('9999', gen_salt('bf')), 'karabo@glowbeauty.co.za'),
  ('11111111-1111-1111-1111-111111111111','Kagiso Modise',    'manager',          crypt('5555', gen_salt('bf')), 'kagiso@glowbeauty.co.za'),
  ('11111111-1111-1111-1111-111111111111','Thandeka Mokoena', 'cashier',          crypt('1234', gen_salt('bf')), null),
  ('11111111-1111-1111-1111-111111111111','Sipho Khumalo',    'cashier',          crypt('4321', gen_salt('bf')), null),
  ('11111111-1111-1111-1111-111111111111','Zanele Dube',      'stock_controller', null,                          'zanele@glowbeauty.co.za');

insert into categories (name, sort_order) values
  ('Hair', 1), ('Nails', 2), ('Cosmetics', 3), ('Skincare', 4), ('Tools', 5);

insert into brands (name) values
  ('Dark & Lovely'), ('Cantu'), ('ORS'), ('TCB'), ('LuxLocks'),
  ('NailPro'), ('ColorLux'), ('GlowSkin'), ('Nubian Heritage'), ('Generic');

insert into products (sku, barcode, name, variant, category_id, brand_id,
                      cost_price, sell_price, reorder_level)
select v.sku, v.barcode, v.name, v.variant,
       (select id from categories where name = v.cat),
       (select id from brands     where name = v.brand),
       v.cost, v.sell, v.reorder
from (values
  ('HR-DL-RLX',  '6001234500011','Relaxer Kit',              'Regular',        'Hair',     'Dark & Lovely',   7800, 12999, 10),
  ('HR-CN-LIC',  '6001234500028','Shea Butter Leave-In',     '453g',           'Hair',     'Cantu',           9500, 15999,  8),
  ('HR-OR-MAY',  '6001234500035','Olive Oil Hair Mayonnaise','443ml',          'Hair',     'ORS',             7200, 11999,  8),
  ('HR-TC-FOOD', '6001234500042','Hair Food',                '250ml',          'Hair',     'TCB',             2800,  4999, 20),
  ('HR-LX-BW16', '6001234500059','Body Wave Bundle',         'Brazilian 16"',  'Hair',     'LuxLocks',       52000, 89900,  4),
  ('HR-LX-FR13', '6001234500066','Lace Frontal Closure',     '13x4 HD',        'Hair',     'LuxLocks',       78000,129900,  3),
  ('HR-GN-EDGE', '6001234500073','Edge Control Gel',         '120ml',          'Hair',     'Generic',         3200,  6499, 15),
  ('NL-CL-GP01', '6001234500080','Gel Polish',               'Ruby Red 15ml',  'Nails',    'ColorLux',        4200,  8999, 15),
  ('NL-CL-GP02', '6001234500097','Gel Polish',               'Nude Beige 15ml','Nails',    'ColorLux',        4200,  8999, 15),
  ('NL-NP-ACP',  '6001234500103','Acrylic Powder',           'Clear 100g',     'Nails',    'NailPro',        12000, 21999, 10),
  ('NL-NP-MON',  '6001234500110','Monomer Liquid',           '250ml',          'Nails',    'NailPro',        16500, 28999,  6),
  ('NL-NP-TIP',  '6001234500127','Nail Tips',                'Natural 500pk',  'Nails',    'NailPro',         6800, 12999, 10),
  ('NL-NP-GLU',  '6001234500134','Nail Glue',                '5g',             'Nails',    'NailPro',         1500,  3499, 30),
  ('NL-GN-LAMP', '6001234500141','UV/LED Nail Lamp',         '48W',            'Tools',    'Generic',        38000, 64900,  4),
  ('CS-GS-LIP',  '6001234500158','Matte Liquid Lipstick',    'Brick',          'Cosmetics','GlowSkin',        4500,  9999, 12),
  ('CS-GS-FND',  '6001234500165','Foundation Stick',         'Shade 4',        'Cosmetics','GlowSkin',       13500, 24999,  8),
  ('CS-GS-MAS',  '6001234500172','Volumising Mascara',       'Black',          'Cosmetics','GlowSkin',        5800, 11999, 12),
  ('CS-GS-PWD',  '6001234500189','Setting Powder',           'Translucent',    'Cosmetics','GlowSkin',        9500, 17999,  8),
  ('CS-GS-EYE',  '6001234500196','Eyeshadow Palette',        '12 Shade',       'Cosmetics','GlowSkin',       12500, 22999,  6),
  ('SK-GS-VITC', '6001234500202','Vitamin C Serum',          '30ml',           'Skincare', 'GlowSkin',       16000, 29999,  6),
  ('SK-NH-SHEA', '6001234500219','Shea Butter Body Cream',   '500ml',          'Skincare', 'Nubian Heritage', 5200,  9999, 12),
  ('SK-NH-SOAP', '6001234500226','African Black Soap',       '150g bar',       'Skincare', 'Nubian Heritage', 2600,  5999, 20)
) as v(sku, barcode, name, variant, cat, brand, cost, sell, reorder);

-- Opening stock, deliberately mixed so you can see in-stock / low /
-- out-of-stock states in the UI immediately.
insert into inventory (product_id, store_id, quantity)
select p.id, '11111111-1111-1111-1111-111111111111',
  case p.sku
    when 'HR-LX-FR13' then 0
    when 'CS-GS-FND'  then 3
    when 'HR-CN-LIC'  then 5
    when 'NL-GN-LAMP' then 2
    when 'SK-GS-VITC' then 4
    else 15 + (abs(hashtext(p.sku)) % 45)
  end
from products p;

insert into suppliers (name, contact_name, phone, email) values
  ('Beauty Wholesale SA',   'R. Naidoo',  '011 555 0142','orders@beautywholesale.co.za'),
  ('ColorLux Distributors', 'A. Patel',   '011 555 0198','sales@colorlux.co.za'),
  ('NailPro Supplies',      'M. Dlamini', '011 555 0177','info@nailpro.co.za'),
  ('LuxLocks Hair Imports', 'F. van Wyk', '011 555 0203','hello@luxlocks.co.za');

insert into settings (key, value) values
  ('tax',      '{"rate": 0.15, "inclusive": true, "label": "VAT"}'),
  ('receipt',  '{"footer": "Thank you for shopping at Glow Beauty Supply!", "return_days": 7}'),
  ('vouchers', '{"valid_years": 3, "prefix": "GB"}'),
  ('currency', '{"code": "ZAR", "symbol": "R"}');


-- ═══════════════════════════════════════════════════════════════════
--  14. ROW LEVEL SECURITY
--
--  ⚠  THIS IS OFF. Turn it on before the shop trades for real, or
--     anyone holding your anon key can read every sale you have ever
--     made — and your cost prices, and your margins.
--
--  Uncomment the block below once your auth is wired up. Test it
--  from the app BEFORE go-live, not on the morning of.
--
--  The functions above are all `security definer`, so they keep
--  working through RLS. That is deliberate: completing a sale has to
--  be able to touch inventory even when the caller cannot.
-- ═══════════════════════════════════════════════════════════════════

/*
alter table stores          enable row level security;
alter table tills           enable row level security;
alter table staff           enable row level security;
alter table products        enable row level security;
alter table categories      enable row level security;
alter table brands          enable row level security;
alter table inventory       enable row level security;
alter table stock_movements enable row level security;
alter table till_sessions   enable row level security;
alter table sales           enable row level security;
alter table sale_items      enable row level security;
alter table payments        enable row level security;
alter table refunds         enable row level security;
alter table credit_notes    enable row level security;
alter table deliveries      enable row level security;
alter table delivery_lines  enable row level security;
alter table overrides       enable row level security;
alter table refund_items    enable row level security;
alter table suppliers       enable row level security;
alter table purchase_orders enable row level security;
alter table settings        enable row level security;

-- Catalogue is readable by any signed-in staff member.
create policy staff_read_products   on products   for select to authenticated using (true);
create policy staff_read_categories on categories for select to authenticated using (true);
create policy staff_read_brands     on brands     for select to authenticated using (true);

-- Everything else is scoped to the store on the user's JWT.
create policy own_store_inventory on inventory
  for all to authenticated
  using      (store_id = (auth.jwt() ->> 'store_id')::uuid)
  with check (store_id = (auth.jwt() ->> 'store_id')::uuid);

create policy own_store_sales on sales
  for all to authenticated
  using      (store_id = (auth.jwt() ->> 'store_id')::uuid)
  with check (store_id = (auth.jwt() ->> 'store_id')::uuid);

create policy own_store_refunds on refunds
  for all to authenticated
  using      (store_id = (auth.jwt() ->> 'store_id')::uuid)
  with check (store_id = (auth.jwt() ->> 'store_id')::uuid);

-- Line tables inherit access from their parent document.
create policy own_sale_items on sale_items
  for all to authenticated
  using (exists (select 1 from sales s
                  where s.id = sale_items.sale_id
                    and s.store_id = (auth.jwt() ->> 'store_id')::uuid));

create policy own_payments on payments
  for all to authenticated
  using (exists (select 1 from sales s
                  where s.id = payments.sale_id
                    and s.store_id = (auth.jwt() ->> 'store_id')::uuid));

create policy own_refund_items on refund_items
  for all to authenticated
  using (exists (select 1 from refunds r
                  where r.id = refund_items.refund_id
                    and r.store_id = (auth.jwt() ->> 'store_id')::uuid));

-- Cost prices are management information. Cashiers must not read them.
-- Enforce that with a restricted view rather than a column policy:
--   create view products_for_till as
--     select id, sku, barcode, name, variant, category_id, brand_id,
--            sell_price, reorder_level, is_active
--       from products;
*/


-- ═══════════════════════════════════════════════════════════════════
--  DONE.
--
--  Sanity check — run this and you should get 1 / 3 / 5 / 22 / 22:
--
--    select
--      (select count(*) from stores)     as stores,
--      (select count(*) from tills)      as tills,
--      (select count(*) from staff)      as staff,
--      (select count(*) from products)   as products,
--      (select count(*) from inventory)  as inventory_rows;
-- ═══════════════════════════════════════════════════════════════════
