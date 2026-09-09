# Supabase setup — step by step

The app runs without this. Do it when you want sales to leave the device.

---

## 1. Create the project

1. Go to https://supabase.com/dashboard → **New project**
2. Name: `beautypos`
3. Database password: generate one, **save it in your password manager**
4. Region: **eu-west-1 (Ireland)** — closest to South Africa with good latency.
   (There is no Africa region. eu-west-1 is what most SA apps use.)
5. Wait ~2 minutes for it to provision.

---

## 2. Run the schema

1. Left sidebar → **SQL Editor** → **New query**
2. Open `supabase/migrations/0001_schema.sql`, paste the whole file, **Run**
3. New query again → paste `supabase/migrations/0002_seed.sql`, **Run**

You should see `Success. No rows returned` both times.

**Check it worked:** sidebar → **Table Editor**. You should have `products` with
22 rows, `stores` with 1, `tills` with 3, `staff` with 5.

---

## 3. Get your keys

Sidebar → **Project Settings** → **API**

| Copy this | Into this env var |
|-----------|-------------------|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` |

> The `service_role` key bypasses every security rule. It goes in `.env` on the
> server only — never in a `NEXT_PUBLIC_` variable, never in the browser, never
> committed to git.

---

## 4. Get the store and till IDs

SQL Editor → run:

```sql
select id, name from stores;
select id, name from tills order by name;
```

---

## 5. Write your .env

```bash
cp .env.example .env
```

Then fill it in:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

NEXT_PUBLIC_HARDWARE_MODE=mock

# From step 4. EACH TILL PC GETS A DIFFERENT TILL ID.
NEXT_PUBLIC_STORE_ID=11111111-1111-1111-1111-111111111111
NEXT_PUBLIC_TILL_ID=22222222-2222-2222-2222-222222222201
```

Restart `npm run dev`. Ring up a sale — the "to sync" chip in the header should
appear and then clear within 30 seconds. Check `sales` in the Table Editor.

---

## 6. Row Level Security — do this before go-live

The tables ship with RLS **off** so you can get running. Turn it on before the
shop uses it for real, or anyone with your anon key can read every sale.

```sql
-- Lock every table
alter table stores           enable row level security;
alter table tills            enable row level security;
alter table staff            enable row level security;
alter table products         enable row level security;
alter table categories       enable row level security;
alter table brands           enable row level security;
alter table inventory        enable row level security;
alter table stock_movements  enable row level security;
alter table customers        enable row level security;
alter table till_sessions    enable row level security;
alter table sales            enable row level security;
alter table sale_items       enable row level security;
alter table payments         enable row level security;
alter table refunds          enable row level security;
alter table refund_items     enable row level security;
alter table suppliers        enable row level security;
alter table purchase_orders  enable row level security;
alter table settings         enable row level security;

-- Simplest workable policy: signed-in users can work with their own store.
-- Start here, tighten per-role later.
create policy "read own store" on products
  for select to authenticated using (true);

create policy "read own store inventory" on inventory
  for select to authenticated
  using (store_id = (auth.jwt() ->> 'store_id')::uuid);

create policy "write own store sales" on sales
  for all to authenticated
  using  (store_id = (auth.jwt() ->> 'store_id')::uuid)
  with check (store_id = (auth.jwt() ->> 'store_id')::uuid);
```

> Note: `complete_sale` and `verify_staff_pin` are `security definer`, so they
> keep working through RLS. That is deliberate — the sale transaction has to be
> able to touch inventory even when the caller cannot.

---

## 7. Staff authentication

Right now `lib/store.ts` matches PINs against the local seed array. That is fine
for a demo and **not** fine for the shop.

To switch to the database:

1. Add a route `app/api/auth/pin/route.ts` that calls the `verify_staff_pin`
   function with the service-role client (it hashes with bcrypt server-side).
2. Have `login()` in the store call that route instead of matching the array.
3. Delete the "Demo PINs" card at the bottom of `app/login/page.tsx`.

The SQL function is already written for you at the bottom of `0002_seed.sql`.

---

## Multi-till checklist

Three tills means three copies of the app, one per PC. Per machine:

- [ ] Same `NEXT_PUBLIC_SUPABASE_URL` and anon key
- [ ] **Different** `NEXT_PUBLIC_TILL_ID`
- [ ] Same `NEXT_PUBLIC_STORE_ID`
- [ ] Label the physical PC with its till number

The database enforces one open session per till (`one_open_session_per_till`),
so two people cannot open Till 2 at once.

---

## Backups

Supabase free tier does **not** back up daily. Before the shop depends on this:

- Upgrade to Pro (~$25/mo) for daily backups and point-in-time recovery, **or**
- Set a weekly `pg_dump` on a schedule and store it off-site.

A POS without backups is a business risk, not a technical one.
