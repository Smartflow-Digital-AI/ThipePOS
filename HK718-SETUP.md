# Hisense HK718 — out of the box to trading

Windows IoT Enterprise LTSB · 14" operator screen · 10" customer screen ·
built-in 80mm printer.

Two phases, in this order:

- **Phase 1 — make it trade.** Everything working, normal Windows desktop.
- **Phase 2 — lock it down.** Staff see only the POS.

**Do not start Phase 2 until Phase 1 fully works.** Locking down a machine
that is not yet trading means debugging printers through a screen with no
Start menu.

---

## Before you leave

### Getting it online

**Take a LAN cable first.** The HK718 has an Ethernet port, and a cable has
no drivers, no dongle, and does not drop. If a cable can reach the counter,
that is the answer and you can skip the WiFi shopping.

If you must use WiFi:

- Buy a **USB WiFi adapter that is plug-and-play on Windows 10**. Many cheap
  Realtek dongles need a driver from a CD — and you cannot download that
  driver, because the machine has no internet. That is the trap.
- **Insurance, free:** bring a USB cable for your phone. Android **USB
  tethering** gets the terminal online in 30 seconds with no driver, which
  is enough to download anything else you need.

### On a USB stick

- [ ] Node.js LTS installer
- [ ] Google Chrome **offline** installer (the standard one needs internet)
- [ ] The `bridge` folder from this repo
- [ ] Epson APD 5.13E — only if you are also setting up a TM-T88V
- [ ] 80mm thermal roll, and a spare

### Write down

- [ ] `till1@thipeblinggirl.co.za` and its password (from `CREDENTIALS.local.md`)
- [ ] Your Vercel URL
- [ ] `NEXT_PUBLIC_PRINT_BRIDGE_TOKEN` (must match `bridge.config.json`)

---

# Phase 1 — make it trade

### 1. First boot and an admin account

Work through Windows setup. Create a **local** account called `Admin` with a
password you keep.

> **This account is your way back in.** Phase 2 replaces the desktop for the
> till user. Without a second administrator account, a launcher that fails
> leaves you with a blank screen and no menu.

### 2. Network

Plug in the cable, or connect WiFi. Confirm a browser loads a page.

### 3. Windows Update — do this early

LTSB builds ship old and the first update round can be large. Start it now
and let it run while you do the rest. Reboot when it asks.

### 4. Chrome

Install from the stick. Set it as the default browser. Windows IoT LTSB has
no Microsoft Store, so the offline installer matters.

### 5. Node.js LTS

Install from the stick, accept the defaults. Then open a **new** PowerShell
and check:

```powershell
node --version
```

Nothing prints → Node is not on PATH. Close every window and reopen.

### 6. The built-in printer

**Check first — it may already be installed.** `Win + R` → `control printers`.
If you see a printer named for the Hisense or a generic 80mm thermal, the
driver is already there.

If not, it will be on the recovery partition, a bundled USB, or Hisense
support. Install it, then:

- **Print the driver's own test page.** Printer properties → General → Print
  Test Page. If this fails, stop — it is the driver, and nothing below helps.
- **Share it.** Printer properties → **Sharing** → *Change Sharing Options* →
  tick *Share this printer* → name it exactly `POS80`. No spaces.

Confirm:

```powershell
Get-Printer | Select-Object Name, Shared, ShareName
```

You want `True` and `POS80`.

### 7. Cash drawer

Plug it into the **RJ11/RJ12 drawer port** on the terminal — the one that
looks like a network socket. The drawer opens through the printer, so there
is nothing to configure.

### 8. The print bridge

Copy `bridge` to the terminal, check `bridge.config.json`:

```json
{
  "port": 8080,
  "columns": 42,
  "transport": "share",
  "share": "\\\\localhost\\POS80",
  "token": "<matches NEXT_PUBLIC_PRINT_BRIDGE_TOKEN>",
  "origins": ["https://thipe-pos.vercel.app"]
}
```

Origins take **no trailing slash** — one will never match. Then:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

### 9. Prove the hardware

```powershell
cd C:\BeautyPOS\bridge
npm run burn-in
```

25 slips, about 25 seconds. Check:

- [ ] `####` bar reaches **both** paper edges — if it wraps, set `columns`
      to 32 or 48 and run again. 80mm does **not** guarantee 42; the
      TM-T88V turned out to be 42 when the spec implied 48.
- [ ] Drawer opened on the first slip
- [ ] No white vertical lines through the black block (print head)
- [ ] All 25 cut cleanly (autocutter)

### 10. The second screen

`Win + P` → **Extend**. Then Settings → System → Display:

- [ ] Both screens listed
- [ ] The 14" is **Display 1** / main, the 10" sits to its **right**
- [ ] Note the 14" screen's **pixel width** — you need it in a moment

### 11. First sale

Open Chrome → your Vercel URL → **Connect this till** → sign in as
`till1@…`. The login screen should then show the till name as a fixed
label, not three buttons. Three buttons means it is not connected.

Ring up a sale with cash.

- [ ] Receipt prints
- [ ] Drawer kicks as the sale completes
- [ ] Slip names the right till

### 12. Both screens

Edit `bridge\start-pos-screens.bat`:

```bat
set POS_URL=https://thipe-pos.vercel.app
set MAIN_WIDTH=1366      REM <- the 14" screen's pixel width from step 10
```

Double-click it. The till opens on the 14", the customer display on the 10".

- [ ] Scan an item → it appears on the customer screen
- [ ] Take cash → customer screen shows **change due**

If the customer window opens on top of the till, `MAIN_WIDTH` is wrong.

**Phase 1 is done.** The terminal trades. Stop here if you are out of time —
everything below is polish.

---

# Phase 2 — lock it down

Staff should see the POS and nothing else. No desktop, no Start menu, no
taskbar, no way to wander into Facebook.

> Read the escape hatch at the bottom **before** you start.

### 13. A separate till account

Settings → Accounts → Other users → **Add account** → *I don't have this
person's sign-in information* → *Add a user without a Microsoft account*.

Name it `Till`. Leave it a **Standard user**, not an administrator.

Sign in as `Till` once so Windows builds the profile, then sign out.

### 14. Set up the POS for that user

Signed in as `Till`:

- Open Chrome, go to the Vercel URL, **Connect this till** as `till1@…`
  (this is per Windows user — the `Admin` account's sign-in does not carry)
- Run `start-pos-screens.bat` once and confirm both screens

### 15. Replace the desktop with the POS

Still as `Till`, in PowerShell:

```powershell
New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" `
  -Name Shell -Value "C:\BeautyPOS\bridge\start-pos-screens.bat" `
  -PropertyType String -Force
```

This replaces `explorer.exe` **for that user only**. At next sign-in there is
no desktop and no taskbar — the POS is the whole machine.

The `Admin` account is untouched and still has a normal desktop.

### 16. Sign in automatically

So a power cut recovers with nobody typing a password:

```
Win + R  →  netplwiz
```

Select `Till` → untick *Users must enter a user name and password* → enter
the Till password twice.

Power returns → boots → signs in as Till → bridge starts → POS fills both
screens. Nobody touches anything.

> This is a real trade-off: anyone who powers on the terminal is inside the
> till software. For a terminal in a locked shop it is normal practice, but
> it is the client's call, not yours.

### 17. Final check

Reboot. With nobody touching the machine:

- [ ] It signs in by itself
- [ ] Both screens come up with the POS
- [ ] No desktop, no taskbar, no Start menu
- [ ] A sale prints and the drawer opens

---

## Escape hatches — read before Phase 2

**Getting back to a desktop as Till:** `Ctrl + Shift + Esc` opens Task
Manager even with no shell → File → Run new task → `explorer.exe`.

**Switching to Admin:** `Ctrl + Alt + Del` → Sign out, then hold **Shift**
while clicking Sign out to stop auto-login, and pick `Admin`.

**Undo the custom shell** (as Till, or from Admin editing that user's hive):

```powershell
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name Shell
```

**Undo auto-login:** `netplwiz`, re-tick the box.

If all else fails, sign in as `Admin` — which is why step 1 exists.

---

## If something is wrong

The till shows the bridge's own words, not a status code.

| On the till | Cause |
|---|---|
| `Print service is not running on this till` | Bridge not started, or Node missing |
| `Bad or missing X-Bridge-Token` | Token differs between the two files |
| `Origin not allowed` | Vercel URL missing from `origins`, or has a trailing slash |
| `Could not write to \\localhost\POS80` | Share name wrong or has a space |
| Everything wraps onto two lines | `columns` is wrong — check the `####` bar |
| Slip prints, drawer dead | Drawer in the wrong socket |
| Login shows three till buttons | This Windows user has not connected a till account |
| Customer screen stuck on "Welcome" | The two Chrome windows are on different profiles — they must share one `--user-data-dir` |
