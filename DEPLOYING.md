# Deploying Thipe Blinggirl POS

Everything you need, in order. ~10 minutes.

---

## 1. Environment variables on Vercel

`.env.local` is gitignored and **never uploaded**. Vercel needs its own
copy. Project → Settings → Environment Variables.

Set all of these for **Production** (and Preview, if you want previews
to work):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tlnlgdtzylnlhshjllrm.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `anon` key from Supabase → Settings → API |
| `NEXT_PUBLIC_STORE_ID` | `11111111-1111-1111-1111-111111111111` |
| `NEXT_PUBLIC_TILL_ID` | `22222222-2222-2222-2222-222222222201` |
| `NEXT_PUBLIC_DEMO_MODE` | `off` |
| `NEXT_PUBLIC_HARDWARE_MODE` | `mock` |
| `NEXT_PUBLIC_SCANNER_MODE` | `live` |
| `NEXT_PUBLIC_PRINTER_MODE` | `mock` → `live` when it arrives |
| `NEXT_PUBLIC_DRAWER_MODE` | `mock` → `live` **after** the printer |
| `NEXT_PUBLIC_READER_MODE` | `mock` → `live` with the Yoco keys |

Copy the values straight out of your local `.env.local` — they are
already correct there.

### Two things about these

**Every `NEXT_PUBLIC_*` value is public.** Next bakes them into the
JavaScript that every visitor downloads. That is fine for all of the
above — the anon key is designed for it and RLS is what actually
protects the data — but it is why no password, service key or Yoco
secret may ever be `NEXT_PUBLIC_`.

**Changing one needs a redeploy.** They are compiled in at build time,
not read at runtime. Vercel will not pick up a changed variable until
you redeploy.

---

## 2. Deploy

```
cd C:\Users\Unarine\Downloads\beautypos\beautypos
npx vercel          # preview URL
npx vercel --prod   # production URL
```

`.vercelignore` keeps `node_modules`, `.next`, `test/`, `supabase/`,
`_to_delete/` and `CREDENTIALS.local.md` out of the upload.

---

## 3. Supabase, two settings

**Authentication → URL Configuration → Site URL** — set it to your
Vercel production URL. Password sign-in works without this, but
password-reset emails will point at the wrong place until you do.

**Authentication → Policies (or Providers → Email) → enable leaked
password protection.** Supabase checks new passwords against
HaveIBeenPwned. One toggle.

---

## 4. First run on each till

Open the production URL on the till machine. It will ask you to
**connect the till** before showing the PIN pad. Type that till's
credentials from `CREDENTIALS.local.md` — once, by you, not by a
cashier.

After that the machine stays connected: the refresh token lives in
that browser, survives reboots and nights with no internet, and the
cashier only ever types four digits.

Use the matching account per machine — `till1@` on Till 1, `till2@`
on Till 2 — or the sign-in log and the live floor will tell you the
wrong till is trading.

**Use a real browser profile, not incognito.** Incognito throws the
session away on close and the till will ask for the password again
every morning.

---

## 5. Before the shop actually trades

- [ ] **Change every password** in `CREDENTIALS.local.md`, in
      Supabase → Authentication → Users.
- [ ] **Change the four till PINs** (9999 / 5555 / 1234 / 4321). They
      are the demo values and 9999 approves overrides.
- [ ] **Fill in the store's address, phone and VAT number** —
      `update stores set address=…, phone=…, vat_number=… where id =
      '11111111-…'`. A receipt without a VAT number is not a valid tax
      invoice.
- [ ] Replace the `@glowbeauty.co.za` staff addresses with real ones
      (Supabase Auth **and** the `staff` table **and**
      `lib/data/seed.ts`).
- [ ] Set the real price on the `NL-TB-POL250` test product, or hide
      it.
- [ ] Deactivate the `ZZ-CRUD-TEST` product (already hidden).

The demo PIN card on the login screen now hides itself automatically
whenever a database is configured, so it will not appear on the
deployed site.

---

## What you do NOT need

- **No service-role key.** Nothing server-side uses one. If you ever
  add one, it is `SUPABASE_SERVICE_ROLE_KEY` with no `NEXT_PUBLIC_`.
- **No database migration step on deploy.** The schema is already
  applied. Vercel only builds the front end.
- **No seed step.** The demo seeder refuses to run whenever Supabase
  is configured.

---

## If the build fails on Vercel

Almost always one of two things:

**`Module not found: Can't resolve '@/lib/…'`** — something got
excluded by `.vercelignore`. Remember its patterns are gitignore
syntax: a line without a leading slash matches a folder of that name
at *any depth*. That is how a bare `supabase` once excluded
`lib/supabase/` and broke the build.

**A type error that does not appear locally** — Linux is
case-sensitive and Windows is not, so `@/components/ui/page` resolves
on your machine and fails on Vercel. Check the casing of the import
against the real filename.
