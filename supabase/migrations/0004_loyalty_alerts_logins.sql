-- ═══════════════════════════════════════════════════════════════════
--  0004 — LOYALTY, STOCK ALERTS, SIGN-IN LOG
--
--  Additive and idempotent. Safe to run on a database that already
--  has the earlier migrations applied, and safe to run twice.
--
--  Run it last:
--      0001_schema.sql → 0002_seed.sql → 0003_refunds.sql → this one.
--
--  (It was numbered 0003 briefly, which collided with the refunds
--  migration. If a file called 0003_loyalty_alerts_logins.sql is still
--  lying around, delete it — this is the same script.)
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  LOYALTY
--
--  Note what this is NOT: it is not the `customers` table from 0001.
--  That one carries a full name and assumes somebody sat down and
--  registered. Nobody registers at a beauty counter with a queue
--  behind them — the most you get is ten digits.
--
--  So the PHONE NUMBER is the identity. Everything else is optional,
--  including the name.
--
--  Points turn into the credit_notes instrument that already exists
--  rather than becoming a second kind of money. Vouchers already have
--  a code, an expiry, part-spend and a redemption path at the till;
--  building "points tender" would have meant building all of that a
--  second time.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists loyalty_members (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references stores(id) on delete cascade,
  -- Normalised to 27XXXXXXXXX before it ever reaches here. The app
  -- does that in normalisePhone(); the constraint makes sure nothing
  -- else can sneak a 082... or a +27 82 ... in behind it.
  phone           text not null,
  name            text,
  points          int  not null default 0 check (points >= 0),
  lifetime_spend  int  not null default 0,   -- cents
  -- POPIA s69: marketing consent is a separate, recorded, reversible
  -- act. Buying something is not consent to be messaged.
  marketing_opt_in boolean not null default false,
  joined_at       timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  constraint loyalty_phone_sa check (phone ~ '^27[6-8][0-9]{8}$'),
  unique (store_id, phone)
);

create index if not exists loyalty_members_phone_idx on loyalty_members (phone);
create index if not exists loyalty_members_points_idx on loyalty_members (points desc);

-- The points ledger. Same reason stock has one: a balance nobody can
-- explain is a balance a customer will argue with at the counter.
create table if not exists loyalty_ledger (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references loyalty_members(id) on delete cascade,
  store_id      uuid not null references stores(id) on delete cascade,
  points        int  not null,            -- signed; negative when spent
  balance_after int  not null,
  reason        text not null check (reason in ('earn','redeem','refund','adjust')),
  reference     text not null default '', -- sale number, refund number, voucher code
  staff_id      uuid references staff(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists loyalty_ledger_member_idx
  on loyalty_ledger (member_id, created_at desc);

-- Sales gain the loyalty columns. The points figure is SNAPSHOTTED so
-- a receipt reprinted next year still tells the truth about what that
-- sale earned, even after the rate changes.
alter table sales add column if not exists customer_phone     text;
alter table sales add column if not exists loyalty_member_id  uuid references loyalty_members(id) on delete set null;
alter table sales add column if not exists points_earned      int not null default 0;

create index if not exists sales_loyalty_idx on sales (loyalty_member_id);

-- ── Earning, atomically ────────────────────────────────────────────
-- Find-or-create the member, add the points, write the ledger row and
-- stamp the sale — in one transaction, under a row lock, so two tills
-- serving the same shopper cannot both read the same balance.
create or replace function award_loyalty_points(
  p_store_id    uuid,
  p_phone       text,
  p_sale_id     uuid,
  p_sale_number text,
  p_total       int,
  p_staff_id    uuid,
  p_rand_per_point int default 10
) returns table (member_id uuid, earned int, balance int)
language plpgsql
security definer
as $$
declare
  v_member  loyalty_members%rowtype;
  v_earned  int;
  v_balance int;
begin
  if p_phone !~ '^27[6-8][0-9]{8}$' then
    raise exception 'not a South African mobile number: %', p_phone;
  end if;

  insert into loyalty_members (store_id, phone)
  values (p_store_id, p_phone)
  on conflict (store_id, phone) do nothing;

  select * into v_member
  from loyalty_members
  where store_id = p_store_id and phone = p_phone
  for update;                                   -- ← the lock that matters

  v_earned  := floor(p_total / (p_rand_per_point * 100));
  v_balance := v_member.points + v_earned;

  update loyalty_members
     set points         = v_balance,
         lifetime_spend = lifetime_spend + p_total,
         last_seen_at   = now()
   where id = v_member.id;

  if v_earned > 0 then
    insert into loyalty_ledger
      (member_id, store_id, points, balance_after, reason, reference, staff_id)
    values
      (v_member.id, p_store_id, v_earned, v_balance, 'earn', p_sale_number, p_staff_id);
  end if;

  update sales
     set loyalty_member_id = v_member.id,
         customer_phone    = p_phone,
         points_earned     = v_earned
   where id = p_sale_id;

  return query select v_member.id, v_earned, v_balance;
end;
$$;

-- ── Redeeming into a voucher ───────────────────────────────────────
create or replace function redeem_loyalty_points(
  p_store_id  uuid,
  p_member_id uuid,
  p_staff_id  uuid,
  p_points    int default 100,
  p_value     int default 5000,   -- cents
  p_code      text default null
) returns table (code text, amount int, balance int)
language plpgsql
security definer
as $$
declare
  v_member  loyalty_members%rowtype;
  v_balance int;
  v_code    text;
begin
  select * into v_member from loyalty_members where id = p_member_id for update;
  if not found then
    raise exception 'no such loyalty member';
  end if;
  if v_member.points < p_points then
    raise exception 'not enough points: has %, needs %', v_member.points, p_points;
  end if;

  v_balance := v_member.points - p_points;
  v_code    := coalesce(p_code, 'GB-' || upper(substr(md5(random()::text), 1, 4))
                              || '-'  || upper(substr(md5(random()::text), 1, 4)));

  update loyalty_members set points = v_balance, last_seen_at = now()
   where id = v_member.id;

  insert into loyalty_ledger
    (member_id, store_id, points, balance_after, reason, reference, staff_id)
  values
    (v_member.id, p_store_id, -p_points, v_balance, 'redeem', v_code, p_staff_id);

  -- Consumer Protection Act s63: three years before a voucher expires.
  insert into credit_notes (store_id, code, amount, remaining, issued_at, expires_at, status)
  values (p_store_id, v_code, p_value, p_value, now(), now() + interval '3 years', 'active');

  return query select v_code, p_value, v_balance;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
--  STOCK ALERTS
--
--  A dashboard card saying "3 below reorder level" only exists while
--  somebody is looking at the dashboard. The stock controller does
--  not live there.
--
--  So a crossing is an EVENT with a row. Only crossings are written —
--  selling one more unit of something already flagged raises nothing,
--  because a shop that gets forty notifications for one low product
--  stops reading notifications. Receiving stock RESOLVES the alert:
--  reordering is the dismissal.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists stock_alerts (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id)   on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  kind        text not null check (kind in ('low_stock','out_of_stock')),
  level       int  not null,          -- stock at the moment it crossed
  threshold   int  not null,          -- the line it crossed
  trigger     text not null default '',
  -- Who this is addressed to. Everyone else's bell stays quiet.
  roles       text[] not null default array['stock_controller','manager','admin'],
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists stock_alerts_open_idx
  on stock_alerts (store_id, created_at desc) where resolved_at is null;

-- Read state is PER PERSON. A manager clearing their bell must not
-- silence the stock controller's copy — that is the whole point of
-- routing by role.
create table if not exists stock_alert_reads (
  alert_id uuid not null references stock_alerts(id) on delete cascade,
  staff_id uuid not null references staff(id)        on delete cascade,
  read_at  timestamptz not null default now(),
  primary key (alert_id, staff_id)
);

-- The shop-wide floor. A product is low at its own reorder_level OR
-- at this, whichever bites first.
insert into settings (key, value)
values ('low_stock_threshold', '20'::jsonb)
on conflict (key) do nothing;

-- ── Raise and resolve, from the movement itself ────────────────────
create or replace function reconcile_stock_alert(
  p_store_id   uuid,
  p_product_id uuid,
  p_trigger    text default ''
) returns void
language plpgsql
security definer
as $$
declare
  v_stock     int;
  v_reorder   int;
  v_floor     int;
  v_line      int;
  v_kind      text;
  v_open      stock_alerts%rowtype;
begin
  select coalesce(i.quantity, 0), p.reorder_level
    into v_stock, v_reorder
    from products p
    left join inventory i on i.product_id = p.id and i.store_id = p_store_id
   where p.id = p_product_id;

  select coalesce((value #>> '{}')::int, 20) into v_floor
    from settings where key = 'low_stock_threshold';

  v_line := greatest(coalesce(v_reorder, 0), coalesce(v_floor, 20));

  select * into v_open
    from stock_alerts
   where product_id = p_product_id and store_id = p_store_id and resolved_at is null
   order by created_at desc limit 1;

  -- Back above the line: close it. Reordering IS the dismissal.
  if v_stock > v_line then
    if found then
      update stock_alerts set resolved_at = now() where id = v_open.id;
    end if;
    return;
  end if;

  v_kind := case when v_stock <= 0 then 'out_of_stock' else 'low_stock' end;

  -- Already flagged at the same severity. Say nothing.
  if found and v_open.kind = v_kind then
    return;
  end if;

  -- Low → out is a real escalation. Close the softer row first rather
  -- than stacking both.
  if found then
    update stock_alerts set resolved_at = now() where id = v_open.id;
  end if;

  insert into stock_alerts (store_id, product_id, kind, level, threshold, trigger)
  values (p_store_id, p_product_id, v_kind, v_stock, v_line, p_trigger);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
--  SIGN-IN LOG
--
--  till_sessions records who had the drawer. It says nothing about
--  who was in the back office at 22:40 reading cost prices, or who
--  signed in to a till and rang up nothing at all.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists login_events (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  staff_id      uuid not null references staff(id)  on delete cascade,
  role          text not null,
  surface       text not null check (surface in ('till','office')),
  till_id       uuid references tills(id) on delete set null,
  signed_in_at  timestamptz not null default now(),
  signed_out_at timestamptz,
  ended         text not null default 'still_active'
                  check (ended in ('signed_out','still_active'))
);

create index if not exists login_events_recent_idx
  on login_events (store_id, signed_in_at desc);
create index if not exists login_events_staff_idx
  on login_events (staff_id, signed_in_at desc);

-- A browser that is simply closed never calls logout, so the previous
-- session would sit "active" forever and make the log useless.
-- Signing in again is proof the last one ended.
create or replace function open_login(
  p_store_id uuid,
  p_staff_id uuid,
  p_role     text,
  p_surface  text,
  p_till_id  uuid default null
) returns uuid
language plpgsql
security definer
as $$
declare v_id uuid;
begin
  update login_events
     set signed_out_at = now(), ended = 'signed_out'
   where staff_id = p_staff_id and ended = 'still_active';

  insert into login_events (store_id, staff_id, role, surface, till_id)
  values (p_store_id, p_staff_id, p_role, p_surface, p_till_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
--  Views the back office reads
-- ═══════════════════════════════════════════════════════════════════

-- What the shop owes on points RIGHT NOW. Points below a full voucher
-- cost nothing yet — they are not redeemable, so they are not a
-- liability.
create or replace view loyalty_liability as
select
  count(*)                                             as members,
  sum(points)                                          as points_outstanding,
  sum(floor(points / 100) * 5000)                      as owed_cents,
  count(*) filter (where points >= 100)                as ready_to_redeem,
  count(*) filter (where last_seen_at > now() - interval '30 days') as active_30d
from loyalty_members;

create or replace view open_stock_alerts as
select a.*, p.name, p.sku
  from stock_alerts a
  join products p on p.id = a.product_id
 where a.resolved_at is null
 order by (a.kind = 'out_of_stock') desc, a.created_at desc;

-- Time on the system per person per day, and how much of it was
-- outside normal trading hours.
create or replace view staff_time as
select
  staff_id,
  date_trunc('day', signed_in_at)                     as day,
  count(*)                                            as sign_ins,
  sum(extract(epoch from (coalesce(signed_out_at, now()) - signed_in_at)) / 60)::int
                                                      as minutes,
  count(*) filter (
    where extract(hour from signed_in_at) < 7
       or extract(hour from signed_in_at) >= 19
  )                                                   as after_hours
from login_events
group by staff_id, date_trunc('day', signed_in_at);
