# BeautyPOS print bridge

A small service that runs **on the till PC** and does the two things a
browser cannot:

1. send a receipt to the thermal printer as ESC/POS bytes, and
2. open the cash drawer.

## Why it has to exist

The drawer has no cable to the PC. It hangs off the RJ11 port on the
back of the **printer**, and it opens when the printer receives five
raw bytes (`1B 70 00 19 FA`). A browser has no way to send raw bytes
to a USB device, and `window.print()` sends a rendered page to the OS
spooler — there is no point in that path where the kick could be
inserted. So the till's browser POSTs JSON here, and this process
talks to the hardware.

No npm install. Stdlib only, so it cannot break when a dependency does.

## Setup

### 1. Tell it how the printer is connected

Edit `bridge.config.json`. Fill in **one** of these:

**Network printer** (has an Ethernet port — most Epson TM-T20/T82 and
Xprinter models). Hold FEED while powering the printer on and it prints
its own IP address.

```json
{ "transport": "tcp", "host": "192.168.1.50", "printerPort": 9100 }
```

**USB printer on Windows.** Install the printer's driver, then
Printer properties → Sharing → *Share this printer*, name it `POS80`
(no spaces). Then:

```json
{ "transport": "share", "share": "\\\\localhost\\POS80" }
```

**USB printer on Linux/macOS:**

```json
{ "transport": "device", "device": "/dev/usb/lp0" }
```

### 2. Install it

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

Installs to `C:\BeautyPOS\bridge`, registers a Scheduled Task that starts
the bridge hidden at logon and restarts it if it dies, then prints a test
slip. No admin rights needed.

For a quick run without installing, double-click `start-bridge.bat` and
leave the window open.

### 3. Print a test slip

```
npm run test-print
```

It prints a width-check slip **and** kicks the drawer, so one command
proves both. If the `####` bar wraps onto a second line you are on
58mm paper — set `"columns": 32`.

## Paper width

| Paper | `columns` |
|-------|-----------|
| 80mm  | 48        |
| 58mm  | 32        |

## The token

`bridge.config.json`'s `token` must match `NEXT_PUBLIC_PRINT_BRIDGE_TOKEN`
in the app's `.env.local`. Its job is narrow and worth being honest
about: it stops a random web page the cashier happens to open from
popping the cash drawer. Because it travels in a custom header, the
browser must pre-flight the request, and an origin not in `origins`
never gets that far.

It is **not** a secret from anyone who can read the till's own
JavaScript bundle. The real protections are the origin allow-list, the
fact that the service binds to `127.0.0.1` only, and that every drawer
opening is logged.

`bridge.config.json` is gitignored for that reason. `bridge/` as a
whole is excluded from Vercel — nothing in the app imports it.

## Deploying the app to Vercel

Add your Vercel URL to `origins`:

```json
"origins": ["http://localhost:3000", "https://your-app.vercel.app"]
```

An HTTPS page calling `http://localhost` is normally blocked as mixed
content, but Chrome and Edge treat `localhost` as a trustworthy origin
and allow it. Safari does not. **Verify this on the actual till
browser before go-live** — if it is blocked you will see a console
error and no receipt, with the sale still correctly recorded.

## If nothing prints

The till screen shows the bridge's own error message rather than a
status code, so start there. Then:

| Message | Cause |
|---|---|
| `Print service is not running on this till` | the bridge is not started, or the port differs |
| `Bad or missing X-Bridge-Token` | token mismatch between the two files |
| `Origin not allowed` | add the app's URL to `origins` |
| `refused the connection` | wrong IP, or port 9100 is not the raw-print port |
| `Could not write to \\localhost\...` | share name wrong, or has a space in it |
| `No permission to write to /dev/...` | add the user to the `lp` group |

A failed print never fails a sale. The sale is recorded first; the
till offers **Try again**, and the slip can be reprinted later from
Sales.

## Endpoints

| Method | Path | Body |
|---|---|---|
| GET | `/health` | — returns transport, target, columns |
| POST | `/print` | `{"type":"receipt","receipt":{...}}` |
| POST | `/print` | `{"type":"raw","bytes":[27,112,0,25,250]}` |
| POST | `/print` | `{"type":"test"}` |

Jobs are serialised — a printer has one paper path, and two receipts
sent at the same instant would interleave their bytes into one ruined
slip.
