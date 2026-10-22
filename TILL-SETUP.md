# Setting up a till — do this once per laptop

Three laptops, three printers, three scanners, three drawers. This is the
same twelve steps three times. Budget **40 minutes for the first**, 15 each
for the other two.

Work through one machine completely and sell something on it before you
unbox the next. Three half-built tills is how you lose a Saturday.

---

## Which laptop is which

Decide this before you start and write it on masking tape on each lid.
The till account is what gives the machine its identity — the app reads
the till from the account, so **signing in as `till2` makes that laptop
Till 2**, permanently, with no button to get wrong.

| Laptop | Till account | Becomes |
|--------|--------------------------------|--------|
| 1 | `till1@thipeblinggirl.co.za` | Till 1 |
| 2 | `till2@thipeblinggirl.co.za` | Till 2 |
| 3 | `till3@thipeblinggirl.co.za` | Till 3 |

Passwords are in `CREDENTIALS.local.md`. **Change them before go-live** —
they were generated for setup, not for a shop floor.

---

## Do these once, before you travel

- [ ] App deployed to Vercel and loading on your own machine
- [ ] Vercel env vars set (see `DEPLOYING.md`), including
      `NEXT_PUBLIC_PRINT_BRIDGE_URL` and `NEXT_PUBLIC_PRINT_BRIDGE_TOKEN`
- [ ] Your Vercel URL added to `origins` in each laptop's `bridge.config.json`
- [ ] Download the **Epson APD 5.13E** installer once and copy it to a USB
      stick. Do not plan on the shop's wifi being good enough to pull 71 MB
      three times.
- [ ] Download the **Node.js LTS** installer to the same stick (see below)
- [ ] Copy the `bridge/` folder to the stick

### Node is a real prerequisite

The print bridge is a Node program. A fresh client laptop will not have
Node, and without it nothing prints and no drawer opens. Install **Node.js
LTS** on each laptop from the stick — accept every default, it takes two
minutes.

> Worth doing later: the bridge can be packaged into a single `.exe` so the
> client's machines need no Node at all. Not worth it for three laptops you
> are setting up by hand; very worth it at ten.

---

## Per laptop — twelve steps

### Cabling (steps 1–2)

**1. Cable the drawer to the printer, not the laptop.**
The drawer plugs into the **`DK` port** on the printer — the RJ11 socket
that looks like a network port. The drawer has no intelligence and no
connection to the PC; it opens because the printer sends it a pulse.

**2. Cable the printer to the laptop by USB, and power both on.**
Printer on *before* you install the driver.

### Printer (steps 3–6)

**3. Install Node.js LTS** from the stick. Defaults are fine.

**4. Install Epson APD 5.13E** from the stick. Right-click → **Run as
administrator**. It creates a queue called `EPSON TM-T88V Receipt5`.

**5. Print the driver's own test page.**
`Win + R` → `control printers` → right-click the printer → **Printer
properties** → **Print Test Page**.

Do not skip this. If it fails here it is the driver or the cable, and
nothing further down this list will help.

**6. Share the printer.**
Same dialog → **Sharing** tab → *Change Sharing Options* → tick *Share this
printer* → share name exactly:

```
POS80
```

No spaces. The same name on all three laptops is correct — the share is
local to each machine.

Verify in PowerShell rather than looking for an icon badge:

```powershell
Get-Printer | Select-Object Name, Shared, ShareName
```

You want `True` and `POS80`.

### Bridge (steps 7–9)

**7. Copy the `bridge` folder** from the stick to the laptop — anywhere;
the installer moves it to `C:\BeautyPOS\bridge`.

**8. Check `bridge.config.json`** before installing. One line per machine
is all that changes, and usually nothing does:

```json
{
  "port": 8080,
  "columns": 42,
  "transport": "share",
  "share": "\\\\localhost\\POS80",
  "token": "<same as NEXT_PUBLIC_PRINT_BRIDGE_TOKEN>",
  "origins": ["https://thipe-pos.vercel.app"]
}
```

`columns` is **42** for the TM-T88V. 48 is the usual figure for 80mm paper
and it is wrong for this model — every line wraps and amounts split across
rows. Origins take **no trailing slash**; one will never match.

**9. Run the installer** — right-click the `bridge` folder → *Open in
Terminal*, then:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

It checks Node is present, installs to `C:\BeautyPOS\bridge`, verifies the
printer really is shared under the name in your config, registers a
Scheduled Task, starts the bridge hidden, and prints a test slip.

No administrator rights needed. The task runs **as the logged-in user**,
on purpose: a task running as SYSTEM has no printer connections, and
`\\localhost\POS80` is a per-user resource.

Why a Scheduled Task and not a Startup shortcut: it **restarts the bridge
if it dies**, and it runs with no console window. A black terminal on a
shop counter gets closed by someone tidying up, and then nothing prints.

### Test the hardware (step 10)

The installer already printed a test slip. If you need another:

```
cd C:\BeautyPOS\bridge
npm run test-print
```

Check the slip:

- [ ] The `####` bar reaches **both** paper edges. If it wraps, `columns`
      is wrong.
- [ ] The **drawer opened**. If the slip printed but the drawer did not,
      the drawer cable is in the wrong socket — see step 1.

### Connect the till (step 11)

Open **Chrome** and go to the Vercel URL.

> Use Chrome or Edge, not Safari. The page is served over HTTPS and talks
> to the bridge over `http://localhost`; Chrome and Edge permit that,
> Safari blocks it.

You will get **Connect this till**. Sign in with *that laptop's* till
account from the table at the top. Done once per machine — the token
survives reboots and nights with no internet.

The login screen should now show the till name as a fixed label rather than
three buttons. **If you still see three buttons, you are not connected** —
the account did not take.

### Sell something (step 12)

Scan a product, take cash, complete the sale.

- [ ] Receipt prints, correctly laid out
- [ ] Drawer kicks at the moment the sale completes
- [ ] The slip names the right till
- [ ] The sale appears on the Overview screen within a few seconds

Then and only then, open the next box.

---

## Scanner

No driver, no setup. A USB barcode scanner is a keyboard: it types the
digits and presses Enter. Plug it in.

If scanning does nothing, the scanner is not sending **Enter** after the
barcode. Every scanner ships with a configuration sheet of barcodes in the
box — scan the one for *add Enter / CR suffix*. Keep those sheets; they are
nearly impossible to find again.

You do not need the cursor to be anywhere in particular. The till captures
scans wherever focus happens to be and keeps the digits out of whatever
field is selected.

---

## After all three

- [ ] Change all six passwords and all four till PINs (admin is still `9999`)
- [ ] Fill in the real store name, address, phone and **VAT number** —
      until then slips print "SALES RECEIPT (not a tax invoice)", on purpose
- [ ] Load the real products with real barcodes and real cost prices
- [ ] Put each laptop and its printer on a **UPS**. Load shedding mid-sale
      is not hypothetical. The app survives it — sales are written locally
      first — but a till that reboots during a queue still costs you.
- [ ] Show the manager the cash-up flow and the blind count

---

## When something is wrong

The till shows the bridge's own words, not a status code. Start there.

| Message on the till | What it means |
|---|---|
| `Print service is not running on this till` | The bridge window is closed, or Node is not installed |
| `Bad or missing X-Bridge-Token` | `token` and `NEXT_PUBLIC_PRINT_BRIDGE_TOKEN` differ |
| `Origin not allowed` | The Vercel URL is missing from `origins` |
| `Could not write to \\localhost\POS80` | Share name wrong, or has a space |
| Slip prints, drawer dead | Drawer cable in the wrong socket on the printer |
| Everything wraps onto two lines | `columns` is 48; it should be 42 |
| Login shows three till buttons | That machine is not connected to a till account |
| Scanner types into a field | Not possible since the scan capture was fixed — if it happens, the page is stale, reload |

A failed print never fails a sale. The money is recorded first; the till
offers **Try again**, and the slip can be reprinted from Sales.
