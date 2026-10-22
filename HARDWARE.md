# Hardware — buying it, and switching the app over

You have never built against hardware before. The good news: for a POS there are
only four devices, and three of them are dumber than they look.

---

## What the client should buy

### Per till (× 3)

| Item | What to get | Rough cost |
|---|---|---|
| **PC** | **Laptop**, Windows 11 Home, 8GB RAM, 256GB SSD. See the note below — this used to say mini PC. | R6 000 – R9 000 |
| **Monitor** | Included with the laptop. (A mini PC needs one: R2 000 – R4 500 non-touch.) | — |
| **Barcode scanner** | **USB, wired, 1D laser.** Zebra DS2208 or a generic. Wired, not Bluetooth. | R600 – R1 500 |
| **Receipt printer** | 80mm thermal, **USB + auto-cutter**. Epson TM-T20III is the safe choice; Xprinter XP-80 is the budget one. | R1 500 – R3 500 |
| **Cash drawer** | Any RJ11 drawer that plugs into the printer. | R700 – R1 200 |
| **Yoco machine** | Yoco Neo or Khumo. Get it from Yoco directly. | R1 200 – R1 800 |

**Per till: roughly R9 000 – R17 000. Three tills: R27 000 – R50 000.**

### Also needed
- **UPS per till** (R1 200 each) — load-shedding mid-sale corrupts things. Non-negotiable.
- **One manager laptop** for reports and stock — any laptop they already own.
- **Decent router** with the tills on wired ethernet if you can. Wifi drops; ethernet doesn't.

---

## Laptop or mini PC — revised

This originally said mini PC. For South Africa a laptop wins, and it is not
about the computer: **a laptop has a battery, so it is its own UPS.** Once you
add a monitor and a UPS to a mini PC the two cost the same, and only one of
them keeps trading through load shedding.

A mini PC is still more durable behind a counter and harder to steal, so it is
the right answer where power is reliable. Here it is not. See `PILOT-TILL.md`.

The **printer** needs a UPS either way — it has no battery, and the cash drawer
opens through it.

**Either way: not tablets.** Three reasons:

1. **Barcode scanners are USB keyboards.** On a mini PC it just works. On Android
   and iPad you fight with OTG adapters and Bluetooth HID pairing that drops.
2. **Receipt printers need drivers or a raw USB/network socket.** Trivial on
   Windows/Linux. Painful on a tablet.
3. **A mini PC is R3 500 and lasts five years** behind a counter. A tablet gets
   dropped, walks off, and needs charging.

Tablets are right for a market stall or a roaming salesperson. For a fixed counter
with a drawer and a printer bolted to it, a mini PC wins on every axis.

---

## The four devices, and what each actually is

### 1. Barcode scanner — it's a keyboard

This surprises everyone. A USB scanner does not need a driver or an SDK. It types
the barcode characters extremely fast and presses Enter. That's it.

`KeyboardWedgeScanner` in `lib/hardware/live.ts` is **already finished**. It
buffers keystrokes that arrive less than 50ms apart and flushes on Enter — fast
bursts are the scanner, slow typing is a human.

**To use it:** plug the scanner in, set `NEXT_PUBLIC_HARDWARE_MODE=live`. Done.

### 2. Receipt printer

Two ways, pick one:

**(a) Browser print — start here.** `window.print()` against the 80mm receipt that
`components/pos/Receipt.tsx` already renders with `@media print` rules. Works today,
zero setup. Downside: the operator sees a print dialog each time. You can suppress
that in Chrome with kiosk-printing flags:

```
chrome.exe --kiosk-printing --app=http://localhost:3000
```

That is genuinely good enough to open the shop with.

**(b) Print bridge — the proper version.** Run a tiny Node service on each till PC
that holds the USB/network printer open and accepts ESC/POS bytes over HTTP.
Point `NEXT_PUBLIC_PRINT_BRIDGE_URL` at it. `ThermalPrinter` already POSTs to it.

Useful packages for the bridge: `node-thermal-printer`, `escpos`.

### 3. Cash drawer — it's opened by the printer

The drawer has no intelligence and usually no PC connection. It plugs into the
**RJ11 port on the back of the receipt printer**. You open it by sending the
printer an ESC/POS "kick" sequence:

```
0x1B 0x70 0x00 0x19 0xFA     ESC p 0 25 250
```

`PrinterKickDrawer` in `live.ts` sends exactly that to the print bridge. Which
means: **the drawer only works once the printer bridge (option b) exists.** If
you go with browser printing, wire the drawer to a small USB relay instead, or
leave it as a manual-key drawer at first.

### 4. Yoco card machine

The one that needs real work. Also the one with real money attached, so do it last
and test it hard.

**The critical rule:** `YOCO_SECRET_KEY` must never reach the browser. The flow is:

```
browser  →  POST /api/payments/charge  →  Yoco API  →  the machine beeps
                    (your server,
                 holds the secret key)
```

The browser then polls `GET /api/payments/charge?id=...` until it settles.
`YocoCardReader` in `live.ts` implements that polling loop already — it is real
code, not a sketch.

**What you have to do:**

1. Open a Yoco business account and get the machines.
2. Yoco dashboard → **Developers** → generate keys.
3. **Email Yoco support and ask which API your machine uses.** Yoco has more than
   one product line — an online payments API and an in-person terminal API — and
   the endpoints and payloads differ. This is a five-minute email that saves you a
   week. Ask specifically: *"I have a Yoco Neo. What is the endpoint to initiate a
   payment on the terminal from my own POS software, and how do I get the result?"*
4. Fill in the two `TODO` blocks in `app/api/payments/charge/route.ts`.
5. Test against Yoco's sandbox before touching a real card.
6. Move from polling to **webhooks** once it's stable — register a webhook URL with
   Yoco, have it write the result, and let the poll route just read that row. Polling
   is easier to get working; webhooks are what you keep.

---

## The switch

```bash
# .env
NEXT_PUBLIC_HARDWARE_MODE=live
NEXT_PUBLIC_PRINT_BRIDGE_URL=http://localhost:8080/print   # if using option (b)
YOCO_SECRET_KEY=sk_live_...
```

That is the entire migration. **No screen changes.** The reason is that no
component anywhere imports a driver — they all go through `hardware()`, which
returns either the mock bundle or the live bundle. Check `app/(app)/settings`
after switching: the device list will flip from amber "Simulation" to green "Live".

**Keep it that way.** If you ever find yourself importing a printer library inside
a React component, stop — it belongs behind an interface in `lib/hardware/`.

---

## Order to do this in

1. **Scanner** — already works, instant win, biggest speed gain for the cashier.
2. **Printer via browser print** — good enough to open the shop.
3. **Yoco** — the money path. Sandbox first, then one till, then all three.
4. **Print bridge + cash drawer** — the polish, once the shop is trading.

Do not try to do all four in one week.

---

## Test these before you hand it over

The failures that hurt are the boring ones:

- [ ] Pull the network cable mid-sale — does it still complete and queue?
- [ ] Kill the power mid-sale (that's what the UPS is for) — is the sale intact on reboot?
- [ ] Decline a card, then take cash instead — does the sale complete cleanly?
- [ ] Scan the same item 30 times fast — any dropped or doubled scans?
- [ ] Open Till 2 on two PCs at once — the database should refuse the second.
- [ ] Close a till with a deliberate R50 short — does the variance read −R50?
- [ ] Reprint a receipt from Sales history — does it match the original exactly?


## Switching a device on

Each device has its own switch, because they arrive on different days.

```
NEXT_PUBLIC_HARDWARE_MODE=mock   # default for all four
NEXT_PUBLIC_SCANNER_MODE=live
NEXT_PUBLIC_PRINTER_MODE=live
NEXT_PUBLIC_DRAWER_MODE=live
NEXT_PUBLIC_READER_MODE=live
```

Order they can realistically go live in:

1. **Scanner** — any time. It is a keyboard wedge; plug it in and it
   types digits. No driver, no bridge.
2. **Printer** — needs the print bridge running on the till and
   `NEXT_PUBLIC_PRINT_BRIDGE_URL` pointing at it.
3. **Drawer** — only after the printer. It opens by an ESC/POS kick
   sent down the printer's cable (`PrinterKickDrawer`), so a live
   drawer with a simulated printer is a drawer that silently never
   opens. The app reports it as simulated until the printer is live.
4. **Card machine** — needs the Yoco keys.

If a drawer with its own USB cable ever replaces the RJ11 one, write a
second `CashDrawer` implementation and switch on it in
`lib/hardware/index.ts`. No screen changes — that is what the
interface is for.
