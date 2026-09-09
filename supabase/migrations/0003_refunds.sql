-- ═══════════════════════════════════════════════════════════════════
--  0003 — refunds
--
--  ONLY run this if you already ran 0001 and 0002 on this database.
--  On a fresh project just run ../schema.sql instead, which already
--  contains everything in here.
-- ═══════════════════════════════════════════════════════════════════

-- Sales can now be partly returned.
alter table sales drop constraint if exists sales_status_check;
alter table sales add constraint sales_status_check
  check (status in ('completed','partially_refunded','refunded','voided'));

-- Refunds get their own number series and a till/session to hang off,
-- so a cash refund can be traced to the drawer it came out of.
create sequence if not exists refund_number_seq start 2000;

alter table refunds add column if not exists store_id        uuid references stores(id);
alter table refunds add column if not exists till_id         uuid references tills(id);
alter table refunds add column if not exists till_session_id uuid references till_sessions(id) on delete set null;
alter table refunds add column if not exists customer_id     uuid references customers(id) on delete set null;
alter table refunds add column if not exists card_reference  text;
alter table refunds alter column refund_number set default 'R-' || nextval('refund_number_seq');

alter table refund_items add column if not exists sku        text not null default '';
alter table refund_items add column if not exists unit_price int  not null default 0;

create index if not exists refunds_sale_idx    on refunds (sale_id);
create index if not exists refunds_session_idx on refunds (till_session_id);
create index if not exists refunds_created_idx on refunds (created_at desc);

-- The rest — process_refund(), the updated close_till_session() that
-- nets out cash refunds, and the sale_ledger view — are identical to
-- the versions in ../schema.sql. Copy sections 11 and 12 from that
-- file and run them; they are all CREATE OR REPLACE, so re-running
-- them over the old versions is safe.
