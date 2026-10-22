# The pilot till — buy one, prove everything

Build **one** complete till, run the acceptance test at the bottom, and only
then buy for tills 2 and 3. Everything after the first is then mechanical.

Prices are indicative South African retail and move; treat them as a budget,
not a quote.

---

## What to buy

| Item | What to get | Budget |
|---|---|---|
| **Laptop** | Windows 11 **Home**, 8GB RAM, 256GB SSD, any modern i3 / Ryzen 3 / N100. It runs one Chrome tab. | R6 000 – R9 000 |
| **Powered USB hub** | Only if the laptop has fewer than 3 USB-A ports. Powered, not bus-powered. | R250 – R500 |
| **Thermal rolls** | 80mm × 80m, box of 50. | R350 – R600 |
| **UPS** | ~600VA, for the **printer** (and router if it is nearby). | R900 – R1 500 |

**Pilot total: roughly R7 500 – R11 500.**

### Already in hand
Epson TM-T88V printer, barcode scanner, cash drawer, RJ11 drawer cable.

---

## Three things that will waste a day if you get them wrong

**1. Not Windows in S mode.** Budget laptops often ship in "S mode", which
blocks anything not from the Microsoft Store — so no Node.js and no Epson
driver. Switching out is free and takes two minutes, but it is **one-way**, so
check before you hand it over. Settings → System → Activation → *Switch to
Windows 11 Home*.

**2. Not a Chromebook, not a Mac.** A Chromebook cannot run the print bridge at
all. A Mac can, but the printer path is different from the three Windows
machines, so you would be supporting two setups to save nothing.

**3. Count the USB-A ports.** Printer and scanner need one each, and thin
laptops increasingly ship with one USB-A and the rest USB-C. If it has fewer
than three, buy the powered hub at the same time.

---

## Why a laptop and not a mini PC

`HARDWARE.md` originally recommended a mini PC. For South Africa a laptop wins,
and the reason is the battery:

| | Mini PC | Laptop |
|---|---|---|
| PC | R3 000 – R4 500 | R6 000 – R9 000 |
| Monitor | R2 000 – R4 500 | included |
| UPS for the PC | R1 200 | **not needed — battery** |
| **Total** | **R6 200 – R10 200** | **R6 000 – R9 000** |
| Load shedding | dies instantly | keeps trading |

Same money, and the laptop rides out load shedding. The mini PC is more durable
behind a counter and harder to walk off with, so it is the better answer where
power is reliable. Here it is not.

The **printer** still needs the UPS either way — it has no battery, and the cash
drawer opens through it.

---

## What NOT to buy yet

- **Touchscreen monitor.** The workflow is scanner-driven; the trackpad covers
  the rest. Add one later if staff ask.
- **Customer-facing display.** Nice, not needed.
- **A fourth printer.** Ask the friend for a spare instead — a free cold spare
  beats a new unit with a warranty you cannot use during a Saturday queue.
- **Yoco machine**, until the client confirms which product line they are on.
  Card is the last unbuilt device.

---

## Build order

1. Switch out of S mode if needed; run Windows Update once, fully.
2. Install **Node.js LTS** and **Epson APD 5.13E** (both from the USB stick).
3. Follow `TILL-SETUP.md` from step 5.
4. Run `npm run burn-in` on the printer — 25 slips. Second-hand units have two
   wear parts and neither shows up on one slip.
5. Work the acceptance test below.

---

## Acceptance test

The pilot is done when every line passes. These are the things that actually
break in a shop, not a feature list.

### Hardware
- [ ] Scan a product — it lands in the cart with the cursor in a text field
- [ ] Scan an unknown barcode — clear message naming the code and digit count
- [ ] Sale completes → slip prints → drawer kicks, both within a second
- [ ] `####` bar on the test slip reaches both paper edges exactly
- [ ] No white vertical lines through the burn-in block (print head)
- [ ] All 25 burn-in slips cut cleanly (autocutter)

### It survives real failures
- [ ] **Printer switched off** → sale still completes, error names the cause,
      **Try again** works once it is back on
- [ ] **Printer unplugged from power** (load shedding) → sale completes, till
      says to use the drawer key
- [ ] **Network cable out / wifi off** → sale still completes; it syncs when
      the connection returns
- [ ] **Reboot the laptop** → bridge starts on its own, no terminal window,
      first sale prints with nobody touching anything
- [ ] Close the bridge by hand → till says *"Print service is not running"*
      rather than failing silently

### The money is right
- [ ] Receipt arithmetic: goods + VAT = total
- [ ] Blind cash-up — the cashier is never shown the expected figure first
- [ ] Deliberately miscount the float by R20 → variance is flagged
- [ ] Refund → credit note prints with a voucher code and a 3-year expiry
- [ ] Redeem that voucher on a later sale

### Day-to-day
- [ ] Admin adds a product with a barcode in the office → scan it on the till
- [ ] Change a price in the office → the till picks it up within 5 minutes
- [ ] Sell below the low-stock threshold → the right roles get the alert
- [ ] Capture a cellphone number → points print on the slip
- [ ] A sale on the till appears on the Overview screen within seconds

### Handover
- [ ] All six passwords and all four PINs changed from the setup values
- [ ] Store name, address, phone and **VAT number** are the client's real ones
- [ ] A slip printed today is a valid tax invoice
- [ ] Kiosk mode: the laptop boots into the POS full-screen
- [ ] The manager has done one cash-up unaided

---

## Then, tills 2 and 3

Same build, about 20 minutes each once the driver and bridge are familiar. The
only per-machine differences:

- the till account it connects with (`till2@…`, `till3@…`) — which is what
  gives the laptop its till identity
- `columns` in `bridge.config.json`, **if** that printer is a different model
  from the T88V

Everything else is identical.
