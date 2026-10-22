# Deploying Thipe BeautyPOS Steps

## Security model

**Two kinds of session, one per browser.**

| | What it is | How it signs in |
|---|---|---|
| **Till device** | The machine on the counter | An admin types the till's credentials ONCE on that machine. The refresh token then lives in that browser. |
| **Office user** | A named person on a laptop | Their own Supabase account, every time. |

A till account belongs to the **machine, not the person**. The cashier
PIN sits on top and opens a shift — it is not a database identity.
That is why a PIN is worth exactly one shift's till access and never
a cost price.

**Why the till password is typed by hand and not read from an env
var:** anything in `NEXT_PUBLIC_*` is compiled into the JavaScript
bundle and served to every visitor. A password there is not a
password.

`store_id` and `pos_role` live in each account's `app_metadata`, which
is the part of the JWT only the service key can write. In
`user_metadata` the token holder could edit it and make themselves an
admin.

### What RLS actually enforces

- **anon** — the key in your bundle — gets `401` on every table and
  `404` on every function. It reaches nothing.
- **A till** can read `till_catalogue` and write sales, refunds,
  sessions, loyalty and alerts for its own shop. It **cannot** read
  `products` (cost price), `staff` (PIN hashes) or the sign-in log.
- **Office** reads everything for its own shop; admin alone writes
  settings, staff and tills.
- `sales` has **no UPDATE and no DELETE policy for anybody**. A
  completed sale is a tax record; a return writes a second document.

### The hole RLS does not close, and how it is closed

Every `SECURITY DEFINER` function runs with the owner's rights and
walks straight past every policy — so a till could have passed another
shop's `store_id` to `complete_sale_v2` and written a sale there.
`assert_own_store()` is called at the top of every one of them and
compares the argument against the JWT. Verified: a till attempting a
cross-store sale gets `that is not your shop`.

PIN checking is restricted further — only a `till` role, only for its
own shop. A 4-digit PIN is ten thousand guesses, so it must not be
grindable from an office laptop or another branch.

### Still open

- **Leaked-password protection is off.** Supabase → Authentication →
  Policies → enable the HaveIBeenPwned check.
- **Change every password in `CREDENTIALS.local.md`**, and the till
  PINs, before the shop trades.
- `till_catalogue` is deliberately `SECURITY DEFINER` (it has to reach
  past the office-only policy on `products`), so the linter flags it.
  Its guard is the `app_role() <> ''` and store check in its `WHERE`.

## Hardware — one switch per device

Hardware does not arrive in one box on one day, so there is a default
and an override per device:

```
NEXT_PUBLIC_HARDWARE_MODE=mock   # default for all four
NEXT_PUBLIC_SCANNER_MODE=live    # the exceptions
NEXT_PUBLIC_PRINTER_MODE=mock
NEXT_PUBLIC_DRAWER_MODE=mock
NEXT_PUBLIC_READER_MODE=mock
```

**The cash drawer cannot go live before the printer.** It has no brain
and usually no cable to the PC — it hangs off the RJ11 port on the
back of the receipt printer and opens when the printer is sent an
ESC/POS kick. Set `DRAWER_MODE=live` while the printer is simulated
and the app reports the drawer as simulated anyway, deliberately,
rather than leaving a cashier waiting for a drawer that was never
going to move. Settings shows each device's real state.

The barcode scanner is a **keyboard wedge**: plug in the USB dongle,
put the cursor anywhere on the till screen, and scanning types the
digits. Nothing to install.

## Where the catalogue lives

**Postgres, with a local cache.**

Products, prices and stock are read from the database on load, on
window focus, and every five minutes. The local copy in
`lib/data/seed.ts` is now only the offline cache and the first-run
seed — the till keeps selling through a dead line, but the database
is the authority whenever there is one.

Two different reads, because the two surfaces may know different
things:

| | Reads | Sees cost price |
|---|---|---|
| Till | `till_catalogue` view | **No** — the column is not in the view |
| Office | `products` + `inventory` | Yes |

**Add product** in the back office is real: it writes to `products`,
creates the category and brand if they are new, sets opening stock,
and logs that stock as a `stocktake` movement so the very first figure
on the shelf card can be explained like every one after it.

Products are never deleted — a sold product has to stay joinable to
the receipt that sold it. The eye icon deactivates, which takes it off
the till and leaves the history intact.

## Where the data lives right now

**In the browser first, then Supabase.**

Everything — sales, returns, vouchers, stock movements, deliveries, till
sessions, overrides — is written to `localStorage` under the key
`beautypos-v1` by Zustand's `persist` middleware (`lib/store.ts`).

Supabase is wired but **inert**. `lib/supabase/client.ts` checks for
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; with
neither set, `isSupabaseConfigured` is `false`, `supabase()` returns
`null`, and every push in `lib/supabase/sync.ts` returns early. The
schema and RPC functions are ready in `supabase/schema.sql` — nothing
is calling them yet.

What that means once it is deployed:

| | |
|---|---|
| Each visitor | Gets their own private shop, in their own browser |
| Your data vs theirs | Completely separate. They cannot see or break yours |
| Two tills, two devices | Two unrelated shops. Nothing is shared yet |
| Survives | Refresh, closing the tab, redeploys |
| Wiped by | Clearing site data, or closing a private window |

For a client demo this is ideal: they can hammer it and nothing is at
risk. It is **not** multi-till and **not** shared — that arrives with
Supabase.

## Deploy

No environment variables are needed. Hardware mode defaults to `mock`
(`lib/hardware/index.ts`), so the scanner, printer, drawer and Yoco
terminal are all simulated.

```bash
cd C:\Users\Unarine\Downloads\beautypos\beautypos
npx vercel          # links the project, gives a preview URL
npx vercel --prod   # production URL
```

Delete the `_to_delete` folder first so it is not uploaded.
`.vercelignore` keeps `node_modules`, `.next`, `test/` and the SQL out
of the upload.

Every pattern in it is **anchored with a leading slash**, and that
matters. `.vercelignore` uses gitignore syntax, where a pattern with no
slash matches a directory of that name at *any* depth — so a bare
`supabase` line also excluded `lib/supabase/`, and the deployment built
without the Supabase client:

```
Module not found: Can't resolve '@/lib/supabase/client'
```

The build passes locally because the file is right there. It only fails
on Vercel, because Vercel never received it.

### Optional environment variables

| Variable | Default | Set it when |
|---|---|---|
| `NEXT_PUBLIC_HARDWARE_MODE` | `mock` | The real hardware arrives → `live` |
| `NEXT_PUBLIC_DEMO_MODE` | *(on)* | You want no demo data → `off` |
| `NEXT_PUBLIC_SUPABASE_URL` | — | Connecting the real backend |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | Connecting the real backend |

## Demo data

A first visit to an empty browser generates **a month of trading**:
around 200 sales with a real weekly rhythm (Saturdays busy, Sundays
closed, month-end lift), returns — some restocked, some written off —
three deliveries with one short-shipped, write-offs, ~30 closed shifts
with small cash variances, manager overrides, and live vouchers.

It is deterministic, so the numbers are the same every time you
rehearse the walkthrough.

- **Generated by** `lib/data/demo.ts`, triggered by
  `components/DemoSeeder.tsx` in the root layout.
- **Never runs** if the browser already has sales, if a demo month was
  already generated there, or if **Supabase is configured** — the
  moment there is a real backend, fabricated sales are a hazard.
- **Settings → Local data** has *Load demo month* and *Clear
  everything*. Clearing stays cleared; it will not refill on reload.

The stock ledger reconciles: every product's running balance chains
movement by movement and lands exactly on its shelf figure, so the
out-of-stock frontal is out **because it sold out**.

## Controls worth pointing at during the demo

- **Blind cash-up.** The cashier is never shown what the drawer should
  contain. Show the figure first and a short drawer gets counted to the
  number it was given — every variance quietly disappears and the shop
  congratulates itself on a record it never had. Count first, reveal
  after.
- **Stock alerts route by role.** A crossing writes one row addressed
  to the stock controller, manager and admin. A manager clearing their
  bell does not silence anyone else's. Receiving stock resolves the
  alert — reordering is the dismissal.
- **Points are a ledger, not a counter.** Every movement chains to the
  balance before it, so a disputed balance can be walked back to the
  receipt that created it.

## Demo script that lands

1. **Login** — PINs are on screen. `1234` Thandeka (cashier).
2. **Till** — tap products, or hover a tile and press the scan icon to
   simulate the barcode gun. Pay by cash to show the change
   calculation, or card to watch the Yoco flow.
3. **Loyalty** — type a cellphone number. A known one shows the name
   and balance; at 100 points the Redeem button issues a real voucher
   on the spot.
4. **Returns** — pull up a receipt, return one line, issue a voucher.
5. **Close till** — count the drawer *without* being told what to
   expect, then watch the variance and the breakdown appear.
6. Sign out → **Back office** (`karabo@glowbeauty.co.za` / `admin123`).
7. **Home** — the live floor, the month, the alerts.
8. **Stock → Receiving** — take in a delivery two units short and show
   it surface on Home under *Needs attention*.

## Before go-live — not before the demo

- [ ] Delete the demo PIN card at the bottom of `app/login/page.tsx`
- [ ] Set `NEXT_PUBLIC_DEMO_MODE=off`
- [ ] Run the migrations **in order**: `0001_schema.sql`,
      `0002_seed.sql`, `0003_refunds.sql`, then
      `0004_loyalty_alerts_logins.sql` (loyalty, stock alerts and the
      sign-in log — additive and safe to re-run). Set the two Supabase
      env vars.
- [x] ~~Enable RLS~~ — on for all 27 tables, policies verified
- [x] ~~Move the back-office login to Supabase Auth~~ — done; the
      seed compare survives only for a build with no database
      configured
- [ ] Turn on leaked-password protection in Supabase Auth
- [ ] Replace the @glowbeauty.co.za staff addresses with real ones,
      in BOTH Supabase Auth and the `staff` table
- [ ] Wire a real email provider for receipts
- [ ] Change every seeded PIN and password
