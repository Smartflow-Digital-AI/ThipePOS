# BeautyPOS

Point of sale for a beauty **product retail** store. Next.js 14 · TypeScript · Tailwind · Supabase.

Built to run **today with zero hardware** — you click "scan", you click "approve" on a
simulated Yoco machine, the receipt prints to screen — and to switch to **real hardware
by changing one environment variable**, with no changes to any screen.

---

## Two ways in

The till and the back office are separate on purpose.

```
  /login            PIN pad, on the counter PCs
                    → Till · Sales · Returns
                    Cashiers, managers, admin

  /office/login     email + password, from a laptop
                    → Home · Products · Stock · Vouchers · Reports · Settings
                    Managers, admin, stock controller
```

**The PIN does not grant your rank — it opens a till session.** An admin
who signs in at the counter gets the cashier's app and nothing more. Anyone
standing in the queue can read a 4-digit PIN off the counter, so the worst
one can be worth is a shift's till access, never cost prices or settings.

Routes are enforced, not just hidden: typing `/reports` while on a till
session redirects you back to the till.

**Manager override.** When a cashier hits something above their level —
today that is a return past the 7-day window — a manager types their PIN,
that one action goes through, and the cashier is still signed in. Nobody
swaps accounts, so nobody leaves a manager session open on a counter PC
all afternoon. Every approval writes a row to `overrides`: who asked, who
approved, for what, on which till. Query it weekly.

To add another override point, wrap the action in `<OverrideGate>` and
give it an `action` slug — the audit trail comes free.

## Run it right now

```bash
npm install
npm run dev
```

Open http://localhost:3000 → sign in with PIN **1234** (Thandeka, cashier).

No Supabase needed. No `.env` needed. Everything runs off local state so you can
walk the client through the whole flow on a laptop.

**Till PINs** — all get the same till-only app:

| PIN  | Who      | Role    | Can approve overrides |
|------|----------|---------|---|
| 1234 | Thandeka | Cashier | no |
| 4321 | Sipho    | Cashier | no |
| 5555 | Kagiso   | Manager | yes |
| 9999 | Karabo   | Admin   | yes |

Zanele (stock) has no till PIN — stock controllers never touch money.

**Back office** at `/office/login`:

| Email | Password | Sees |
|---|---|---|
| karabo@glowbeauty.co.za | admin123 | everything |
| kagiso@glowbeauty.co.za | manager123 | all but Settings |
| zanele@glowbeauty.co.za | stock123 | Products + Stock only |

---

## The end-to-end flow

```
  Sign in (PIN)
        ↓
  Open till  ──────────  count the float, R1000
        ↓
  ┌─ SELL ─────────────────────────────────────────┐
  │  tap a tile  or  hover → click the scan icon   │
  │  (the scan icon fires the exact same code      │
  │   path a real USB scanner will)                │
  │                                                 │
  │  cart builds → VAT calculated → Pay            │
  └─────────────────────────────────────────────────┘
        ↓
  ┌─ PAY ──────────────────────────────────────────┐
  │  CASH   → quick-tender buttons, change shown,  │
  │           drawer "opens"                        │
  │  CARD   → Yoco overlay, Approve / Decline      │
  │  SPLIT  → part card, balance in cash           │
  └─────────────────────────────────────────────────┘
        ↓
  Receipt prints (on-screen 80mm slip)
        ↓
  Stock decremented · sale queued for Supabase
        ↓
  End of shift → Sales → Close till → count cash → variance
```

### Returns

```
  Returns → find the receipt (number, customer or cashier)
        ↓
  Pick lines and quantities — partial returns supported,
  and the same receipt can be returned against more than once
        ↓
  Per line: SELLABLE  → stock goes back on the shelf
            DAMAGED   → customer is paid, stock is written off
        ↓
  Reason + refund method
     CASH   → drawer opens
     CARD   → refunded against the ORIGINAL Yoco transaction
     CREDIT → lands on the customer's account (needs a customer)
        ↓
  CREDIT NOTE prints (not a receipt — a separate document)
        ↓
  Sale becomes "part returned" or "returned"
  Cash refunds come OFF the expected drawer total at close
```

Card and store credit switch themselves off when they don't apply — you cannot
refund to a card on a sale that was paid in cash, and store credit needs a
customer attached. The over-refund guard is enforced in two places: the UI caps
the stepper, and `process_refund` in the database raises if you get past it.

---

## Project layout

```
app/
  login/                PIN pad
  (app)/
    till/               ⭐ the selling screen
    returns/            receipt lookup → refund → voucher
    vouchers/           outstanding store credit (back office)
    dashboard/          today's numbers
    sales/              history + close till
    products/           catalogue, cost, margin
    stock/              on-hand + adjustments with reasons
    customers/          loyalty + store credit
    reports/            date-ranged revenue, margin, CSV export
    settings/           store, staff, device status
  api/payments/charge/  Yoco server route (secret key never hits browser)
  api/payments/refund/  Yoco refund route — refunds against the original txn
  api/receipts/email/   emails a receipt (provider key stays server-side)
  office/login/         back-office sign-in (email + password)

lib/
  notifications/        receipt email, mock or live — same swap as hardware

lib/
  hardware/             ⭐ the device abstraction — read this first
    types.ts              the four interfaces
    mock.ts               simulated drivers (today)
    live.ts               real drivers (when boxes arrive)
    index.ts              the env-var switch
  store.ts              app state, offline-first, persisted
  types.ts              domain model + money maths
  supabase/             client + the sync pusher
  data/seed.ts          the 20 products (mirrors the SQL seed)

supabase/
  schema.sql            ⭐ THE ONE FILE TO RUN — everything, ready for go-live
  migrations/
    0001_schema.sql     the original tables (superseded by schema.sql)
    0002_seed.sql       the original seed (superseded by schema.sql)
    0003_refunds.sql    only if you already ran 0001 + 0002 somewhere
```

## The database

Run **`supabase/schema.sql`** — one file, top to bottom, in the Supabase SQL
editor. It contains every table, every index, the transactional functions, the
views and the seed data. It refuses to run over a database that already has
sales in it, so you cannot destroy live data by pasting it twice.

Read section 14 before go-live: Row Level Security ships **off** so you can get
running, and must be on before the shop trades.

---

## Themes and screen sizes

Three themes, switched from the header or Settings → Appearance, stored per device:

| Theme | Use it for |
|---|---|
| **Light** | A bright shop floor, daylight through the window |
| **Dim** | Warm grey. Easiest on the eyes over a long shift |
| **Dark** | Evening trade, or a screen facing a window |

With no stored choice the app follows the operating system. A blocking script in
`<head>` sets the theme before first paint — without it a light-mode tablet
flashes black every time the till opens.

All colour lives in CSS variables in `app/globals.css` (three blocks of ~14
numbers). Tailwind reads them, so one utility class works in every theme and no
component knows a theme exists. **Adding a fourth theme is one more block.**

Layout targets a counter, not a phone:

- **≥1024px** — product grid and the sale panel side by side
- **<1024px** (tablet) — grid goes full width, the sale becomes a slide-over
  behind a sticky bar showing item count and total
- Tables drop low-value columns as space runs out rather than scrolling
  sideways — a cashier will not think to swipe a table
- Touch devices get taller buttons automatically (`@media (pointer: coarse)`)

## No customer accounts

Nobody registers. The shop works like Mr Price: an email is asked for at
checkout **only** to send that receipt, and it is stored on that sale — there
is no customers table, no profile, no loyalty. Under POPIA that is one stated
purpose and nothing else kept, which is also why there is nothing to breach.

Returns are found by **receipt number**, not by person.

### Store credit is a printed voucher

With no accounts there is nowhere to put store credit, so it goes on a slip:

```
  Return refunded to store credit
        ↓
  Voucher printed:  GB-DMFV-K6RX   ·   R219.99   ·   valid 3 years
        ↓
  Customer keeps the slip
        ↓
  At the till: Pay → Voucher → type the code
        ↓
  Spent in parts — R34.99 taken, R185.00 stays on the same code
```

Details that matter:

- **Codes avoid look-alike characters.** No O/0, I/1/L, S/5, B/8, Z/2 — they get
  read off a curling till slip and typed by hand. Lowercase and spaces are
  accepted; `gb dmfv k6rx` finds the same voucher.
- **Never cash change from a voucher.** The balance stays on the code. Paying
  out cash would turn store credit into the cash-out it exists to avoid.
- **Three years' validity** — the Consumer Protection Act (s63) gives prepaid
  vouchers that long, and it is not worth arguing with a customer over.
- **`redeem_voucher` locks the row (`FOR UPDATE`).** You have three tills; without
  the lock two cashiers redeeming the same code at the same instant both read
  "R100 remaining" and both take R100. Never do this read-then-write from the client.
- **Outstanding vouchers are a liability.** The Vouchers page and the
  `voucher_liability` view show what the shop still owes. Check it monthly — it
  never appears in a sales report.

## The stock ledger

**Every change to stock writes a movement.** No exceptions — sales, returns,
deliveries, write-offs, adjustments. Each row carries the reason, the person, the
reference, and the running balance after it.

Before this, the number on the shelf card was the only record. Sales moved stock
silently and adjustments lived in component state that died on refresh, so nobody
could explain a shelf count. That also made shrinkage unmeasurable: you could not
tell theft from a mis-key from a delivery that was two short.

`applyMovements()` in `lib/store.ts` is the only place stock levels change. Route
everything through it and it stays impossible to move stock without a trace.

### Stock, for the stock controller

| Tab | What it does |
|---|---|
| **On hand** | Current quantities, adjust with a reason |
| **Receiving** | Goods in — supplier, invoice ref, **counted vs invoiced**, unit cost |
| **Write-offs** | Breakages, expiries, testers, losses |
| **History** | The whole ledger, filterable by product, type, person, reference |

**Count what is in the box, not what is on the invoice.** The two quantity columns
on Receiving are the point of the screen — a supplier who bills for 20 and ships 18
costs you money every time until somebody compares them. Stock goes up by what
arrived; the difference is recorded as a discrepancy.

A damaged return writes **two** movements: restocked, then written off. Net stock is
the same either way, but the ledger tells the true story — and without both halves,
damage reporting has nothing to count.

### Stock control, for the manager

Reports → **Stock control** answers "is stock being taken in correctly?" as three
separate questions:

- **Delivery accuracy by supplier** — anything under 100% is stock you paid for that
  never reached the shelf
- **Cost price changes** — a supplier's quiet price rise is a margin cut you did not
  agree to
- **Losses by product** and **manual changes by person** — deliveries and sales move
  stock on their own, so anything in that last table is a human overriding the system

## Audit — what a manager can actually check

Two questions that do not appear in any sales report:

**Did the drawer balance?** Every shift is kept, not just the current one, with
its float, cash taken, refunds paid out, expected, counted and variance. A
variance you cannot look up a week later is a ritual, not a control.

**Who authorised the exceptions?** Every manager override is logged with who
asked, who approved, what for, and on which till.

Both live on **Audit** (`/audit`, manager and admin). Read the overrides tab
weekly: one override is a customer being looked after, the same cashier needing
three a day is something else.

## Four rules the code follows everywhere

**1. Money is an integer number of cents.**
`R89.99` is `8999`. Never a float. Floats drift, and a till that drifts by a cent
a day is a till nobody trusts by December. Format only at the edge, with `money()`.

**2. Money is entered like a card machine, never as free text.**
Digits fill from the right: `14000` is R140.00, not R14 000. A free-text
field parsed as rands lets a cashier enter R14 000 when they meant R140 and
hand over R12 000 in change — there is no decimal point to miss, because
there is no decimal point. Anything wildly over what is due also asks for a
second press before the drawer opens. See `components/ui/MoneyInput.tsx`.

**3. A refund is a new document, never an edit.**
The sale that happened, happened. Refunds live in their own table and point back
at the sale; returned quantities are derived by summing them. That is why partial
returns, and repeat partial returns against the same receipt, need no extra
machinery — and why an auditor can see both halves.

**4. The sale is written locally first.**
Never put a network call between the customer and their receipt. Load-shedding and
shop wifi mean the till has to keep selling with no internet. Sales save to
localStorage with `synced: false`, and a background pusher drains them to Supabase
when the connection returns. The header shows how many are waiting.

---

## Going live with hardware

See **HARDWARE.md**. Short version: every device sits behind an interface in
`lib/hardware/`. Finish the classes in `live.ts`, set `NEXT_PUBLIC_HARDWARE_MODE=live`,
and no screen changes at all.

## Connecting Supabase

See **SETUP.md** for the step-by-step.
