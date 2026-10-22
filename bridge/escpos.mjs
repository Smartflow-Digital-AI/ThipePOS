// ═══════════════════════════════════════════════════════════════════
//  ESC/POS — turning a receipt into bytes a thermal printer accepts.
//
//  A thermal printer is not a printer in the desktop sense. There is
//  no page, no driver, no layout engine: you send it a byte stream of
//  text interleaved with control codes, and it prints as it reads.
//  That is exactly why the browser cannot drive it and this service
//  has to exist.
//
//  Everything here is plain ASCII and stdlib. No dependencies, so it
//  installs on a till PC with no build tools.
// ═══════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ESC = 0x1b;
const GS = 0x1d;

// What a slip SAYS lives in lib/receipt-policy.json, shared with the
// on-screen receipt. Two renderers printing different return windows
// is an argument at the counter, so neither owns the words.
const FALLBACK_POLICY = {
  vatRatePct: 15,
  returnDays: 7,
  returnNote: 'Unopened products only.',
  returnLine: 'Returns within {days} days with this slip.',
  thankYou: 'Thank you for shopping at',
  creditKeepNote: 'Keep this credit note as proof of refund.',
  cardRefundNote: 'Card refunds can take 3-5 working days to reflect.',
  voucherRedeemNote: 'Present this slip to redeem.',
  voucherSafeNote: 'Keep it safe - it cannot be replaced if lost.',
  pointsPerVoucher: 100,
  voucherRandPerRedemption: 50,
};

function loadPolicy() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = fs.readFileSync(path.join(here, '..', 'lib', 'receipt-policy.json'), 'utf8');
    return { ...FALLBACK_POLICY, ...JSON.parse(raw) };
  } catch {
    // The bridge must print even if it was copied somewhere without
    // the app beside it. Falling back beats refusing to sell.
    return FALLBACK_POLICY;
  }
}

export const POLICY = loadPolicy();

// 'card' | 'cash' | 'voucher' | anything else — mirrors payLabel() in
// components/pos/Receipt.tsx.
function payLabel(method) {
  const m = String(method ?? '').toLowerCase();
  if (m === 'card') return 'Card';
  if (m === 'cash') return 'Cash';
  if (m === 'voucher') return 'Voucher';
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Payment';
}

// 80mm paper at Font A is 48 characters. 58mm paper is 32.
export const COLUMNS_80MM = 42;  // TM-T88V Font A. 48 wraps.
export const COLUMNS_58MM = 32;

// ─── money, identical to the app's money() in lib/types.ts ─────────
// The slip and the screen must never disagree by a cent, so this is a
// deliberate duplicate of that function rather than an approximation.
export function money(cents) {
  const neg = cents < 0;
  const v = Math.abs(Math.round(cents));
  const s = (v / 100).toFixed(2);
  const [whole, frac] = s.split('.');
  const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}R${spaced}.${frac}`;
}

// A thermal printer in its default code page renders anything outside
// ASCII as noise. Product names arrive from a database that accepts
// anything, so fold the characters that actually turn up in cosmetics
// names and drop the rest rather than printing mojibake on a tax
// invoice.
const FOLD = {
  '’': "'", '‘': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '…': '...', ' ': ' ',
  'é': 'e', 'è': 'e', 'ê': 'e', 'à': 'a',
  'â': 'a', 'ç': 'c', 'ô': 'o', 'û': 'u',
  'î': 'i', 'ñ': 'n', 'ü': 'u', 'ö': 'o',
  'ä': 'a', '°': ' ', '•': '-', '®': '(R)',
  '™': '(TM)', '©': '(C)',
};

function ascii(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    if (FOLD[ch] !== undefined) { out += FOLD[ch]; continue; }
    const c = ch.codePointAt(0);
    out += c >= 0x20 && c <= 0x7e ? ch : '';
  }
  return out;
}

/** Break a long name across lines without splitting mid-word. */
function wrap(text, width) {
  const words = ascii(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!line) { line = w; continue; }
    if (line.length + 1 + w.length <= width) { line += ' ' + w; continue; }
    lines.push(line);
    line = w;
  }
  if (line) lines.push(line);
  // A single word longer than the paper still has to print.
  return lines.flatMap((l) =>
    l.length <= width ? [l] : l.match(new RegExp(`.{1,${width}}`, 'g')) ?? [l]
  );
}

// The app formats datetime in the till's own browser before sending
// it, so it arrives as a display string already in shop time. Parsing
// that again would re-interpret it in the bridge machine's zone and
// move a tax invoice's time by hours. So a display string is printed
// exactly as given, and only a real ISO timestamp is formatted here.
const ISO = /^\d{4}-\d{2}-\d{2}T/;

function stamp(v, withTime = true) {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  if (!ISO.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  });
}

export class Escpos {
  constructor(columns = COLUMNS_80MM) {
    this.cols = columns;
    this.bytes = [];
    // Double-width halves how many characters fit on the paper. Any
    // code that pads a line to the full column count while that mode
    // is on produces a line twice the width of the paper, which the
    // printer then wraps. So the scale is tracked and every padding
    // decision asks width(), never cols.
    this.scaled = false;
    this._align = 0;
  }

  /** Characters that fit on one line at the current scale. */
  width() {
    return this.scaled ? Math.floor(this.cols / 2) : this.cols;
  }

  raw(...b) { this.bytes.push(...b.flat()); return this; }
  text(s) { this.bytes.push(...Buffer.from(ascii(s), 'ascii')); return this; }
  line(s = '') { return this.text(s).raw(0x0a); }

  init() { return this.raw(ESC, 0x40); }
  /** 0 left, 1 centre, 2 right */
  align(n) { this._align = n; return this.raw(ESC, 0x61, n); }
  bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  /** Double width AND height — for the shop name and the total. */
  big(on) { this.scaled = Boolean(on); return this.raw(GS, 0x21, on ? 0x11 : 0x00); }
  underline(on) { return this.raw(ESC, 0x2d, on ? 1 : 0); }
  feed(n = 1) { return this.raw(ESC, 0x64, n); }

  rule(ch = '-') { return this.line(ch.repeat(this.width())); }

  /** Label on the left, figure on the right, on one line — or on two
   *  when they cannot share one. The old version clamped the gap to a
   *  single space and let the row run past the paper edge, which the
   *  printer then wrapped at its own width, splitting amounts like
   *  'R359.96' across lines as 'R' and '359.96'. */
  pair(left, right, { boldRow = false } = {}) {
    const l = ascii(left);
    const r = ascii(right);
    const w = this.width();
    if (boldRow) this.bold(true);
    if (l.length + 1 + r.length <= w) {
      this.line(l + ' '.repeat(w - l.length - r.length) + r);
    } else {
      for (const part of wrap(l, w)) this.line(part);
      this.line(r.length >= w ? r.slice(0, w) : r.padStart(w));
    }
    if (boldRow) this.bold(false);
    return this;
  }

  /** Centre by asking the printer, not by padding.
   *  Padding and hardware centring together centre the padding too,
   *  which pushes the text right by half the pad.
   *
   *  Wraps as well: a sentence that fits 80mm paper does not fit
   *  58mm, and leaving that to each caller means it gets forgotten
   *  in exactly the lines nobody re-reads, like the small print on a
   *  voucher. */
  centre(s) {
    const back = this._align;
    this.align(1);
    for (const l of wrap(s, this.width())) this.line(l);
    if (back !== 1) this.align(back);
    return this;
  }

  /** Double-size only while it still fits the paper. A long shop name
   *  at double width silently wraps, so it stays normal size. */
  bigIfItFits(s) {
    const fits = ascii(s).length <= Math.floor(this.cols / 2);
    if (fits) this.big(true);
    this.bold(true).centre(s).bold(false);
    if (fits) this.big(false);
    return this;
  }

  /** One sale line: wrapped description, then qty x unit ... amount.
   *  ReceiptLine carries no variant and no per-line discount — the
   *  caller folds the variant into name and nets the discount off
   *  line_total — so this takes exactly what the screen takes. */
  item({ name, qty, unit_price, line_total }) {
    for (const l of wrap(name, this.width())) this.line(l);
    this.pair(`  ${qty} x ${money(unit_price)}`, money(line_total));
    return this;
  }

  /** A solid bar, for testing a print head.
   *
   *  Emitted as raw CP437 0xDB bytes rather than through text(),
   *  because ascii() strips everything outside printable ASCII and a
   *  solid block is precisely the character that is not in it. ESC t 0
   *  pins the code page first so 0xDB really is a block and not an
   *  accented letter from whatever page the printer was left on. */
  solid(rows = 1) {
    this.raw(ESC, 0x74, 0x00); // code page 0 = PC437
    for (let i = 0; i < rows; i++) {
      this.raw(new Array(this.width()).fill(0xdb)).raw(0x0a);
    }
    return this;
  }

  /** A table row of fixed-width cells: [text, width, 'l'|'r'].
   *  Receipt columns only line up if every row agrees on the widths,
   *  which pair() cannot express for three or four columns. */
  cells(spec) {
    let out = '';
    for (const [text, w, align = 'r'] of spec) {
      const t = ascii(text).slice(0, w);
      out += align === 'l' ? t.padEnd(w) : t.padStart(w);
    }
    // Trailing spaces cost paper on a thermal printer and show up as
    // a ragged right edge if the slip is ever photographed.
    return this.line(out.slice(0, this.width()).replace(/\s+$/, ''));
  }

  /** A centred section heading, the way a till slip marks a block. */
  heading(t) {
    return this.feed(1).bold(true).centre(t).bold(false);
  }

  /** A real, scannable CODE39 barcode of the sale number.
   *  The screen receipt draws a decorative '||| || |||' because HTML
   *  cannot make a scannable one cheaply. Paper can, and a scannable
   *  receipt number is what makes return-by-receipt a scan instead of
   *  a cashier typing nine characters with a queue waiting. */
  barcode(code) {
    const data = ascii(code).toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '');
    if (!data) return this;
    this.raw(GS, 0x68, 60);      // height, dots
    this.raw(GS, 0x77, 2);       // module width
    this.raw(GS, 0x48, 0);       // no human-readable text; we print our own
    this.align(1);
    this.raw(GS, 0x6b, 4);       // CODE39, NUL-terminated
    this.text(data).raw(0x00);
    this.raw(0x0a);
    this.align(this._align);
    return this;
  }

  /** ESC p m t1 t2 — pin 2, 25ms on, 250ms off. Opens the drawer. */
  kick() { return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa); }

  /** Feed the slip clear of the head, then cut. */
  cut() { return this.feed(4).raw(GS, 0x56, 0x42, 0x00); }

  done() { return Buffer.from(this.bytes); }
}

// ═══════════════════════════════════════════════════════════════════
//  The receipt itself.
//
//  This is a SOUTH AFRICAN TAX INVOICE, not a thank-you note. For a
//  customer to claim the VAT back it must carry the words "TAX
//  INVOICE", the seller's VAT number, the date, a unique number, and
//  the VAT amount shown separately. Prices are VAT-inclusive at 15%,
//  so the VAT line is backed out of the total, never added to it.
//
//  If vat_number is blank the slip prints as "SALES RECEIPT" and says
//  it is not a tax invoice, rather than printing an invalid one.
// ═══════════════════════════════════════════════════════════════════
export function renderReceipt(r, columns = COLUMNS_80MM) {
  const p = new Escpos(columns);
  const credit = r.doc_type === 'credit_note';
  const hasVat = Boolean(String(r.vat_number ?? '').trim());
  const P = POLICY;
  const W = columns;

  // Column widths for the item table, summing to the paper width.
  const QTY = 4;
  const AMT = 11;
  const DESC = W - QTY - AMT;

  p.init().align(0);

  // ── who is selling ──────────────────────────────────────────
  p.bigIfItFits(r.store_name ?? '');
  if (r.store_address) p.centre(r.store_address);
  if (r.store_phone) p.centre(`Tel ${r.store_phone}`);
  if (hasVat) p.centre(`VAT Reg No ${r.vat_number}`);

  // A tax invoice without a VAT number is one SARS will reject, so a
  // slip that cannot be one does not claim to be one.
  p.feed(1);
  p.bigIfItFits(credit ? 'CREDIT NOTE' : hasVat ? 'TAX INVOICE' : 'SALES RECEIPT');
  if (!hasVat && !credit) p.centre('(not a tax invoice)');
  p.feed(1);

  // ── which sale ──────────────────────────────────────────────
  // Paired across the line rather than one row each: a slip is read
  // at a glance over a counter, and nine half-empty rows push the
  // total off the bottom of what the customer can see.
  p.rule('=');
  p.pair(`${credit ? 'Credit' : 'Receipt'} ${r.sale_number ?? ''}`, stamp(r.datetime));
  p.pair(r.till_name ?? '', r.cashier_name ?? '');
  if (credit && r.original_sale_number) p.pair('Against receipt', r.original_sale_number);
  if (r.customer_email) p.pair('Emailed to', r.customer_email);
  if (r.customer_phone) p.pair('Loyalty', r.customer_phone);

  // ── what was bought ─────────────────────────────────────────
  p.rule('=');
  p.cells([['QTY', QTY, 'l'], ['DESCRIPTION', DESC, 'l'], ['AMOUNT', AMT]]);
  p.rule();

  let units = 0;
  for (const l of r.lines ?? []) {
    units += l.qty ?? 0;
    const desc = wrap(l.name, DESC);
    p.cells([[String(l.qty ?? ''), QTY, 'l'], [desc[0] ?? '', DESC, 'l'], ['', AMT]]);
    for (const extra of desc.slice(1)) {
      p.cells([['', QTY, 'l'], [extra, DESC, 'l'], ['', AMT]]);
    }
    p.cells([
      ['', QTY, 'l'],
      [`@ ${money(l.unit_price)}`, DESC, 'l'],
      [money(l.line_total), AMT],
    ]);
  }

  p.rule();
  p.pair('TOTAL ARTICLES', String(units));

  // ── the money ───────────────────────────────────────────────
  // subtotal is the VAT-EXCLUSIVE figure (cartTotals returns
  // total - tax_total), so goods + VAT = total. An earlier version
  // printed it as though VAT were already inside it, which put
  // arithmetic on a tax invoice that did not add up.
  if (r.discount_total) {
    p.rule();
    p.pair('Discount', '-' + money(r.discount_total));
  }

  if (hasVat) {
    p.heading('VAT SUMMARY');
    const c = Math.floor(W / 3);
    p.cells([['RATE', W - 2 * c, 'l'], ['GOODS', c], ['VAT', c]]);
    p.cells([
      [`${P.vatRatePct}%`, W - 2 * c, 'l'],
      [money(r.subtotal ?? 0), c],
      [money(r.tax_total ?? 0), c],
    ]);
  }

  p.rule('=');
  p.bold(true).big(true);
  p.pair(credit ? 'REFUNDED' : 'TOTAL', money(r.total ?? 0));
  p.big(false).bold(false);
  p.rule('=');

  // ── how it was settled ──────────────────────────────────────
  const payRows = [];
  if (!credit) {
    for (const pay of r.payments ?? []) {
      // A bare "Cash R359.96" directly above "Cash tendered R500.00"
      // reads as two different cash amounts. When the tendered figure
      // is on the slip it already tells the whole story.
      if (pay.method === 'cash' && typeof r.cash_received === 'number') continue;
      payRows.push([payLabel(pay.method), money(pay.amount)]);
    }
  }
  if (typeof r.cash_received === 'number') {
    payRows.push(['Cash tendered', money(r.cash_received)]);
    payRows.push(['Change', money(r.change_given ?? 0)]);
  }
  const withRef = (r.payments ?? []).find((x) => x.reference);
  if (payRows.length || withRef) {
    p.heading('PAYMENT SUMMARY');
    p.pair('Amount due', money(r.total ?? 0));
    for (const [l, v] of payRows) p.pair(l, v);
    if (withRef) p.line(`Ref ${withRef.reference}`);
  }

  if (credit) {
    p.rule();
    if (r.refund_reason) {
      p.line('Reason');
      for (const l of wrap(r.refund_reason, W)) p.line('  ' + l);
    }
    p.pair('Refunded to', r.refund_method ?? '-');
  }

  // ── store credit voucher ────────────────────────────────────
  if (credit && r.voucher_code) {
    p.heading('STORE CREDIT VOUCHER');
    p.rule('*');
    p.big(true).bold(true).centre(r.voucher_code).bold(false).big(false);
    p.rule('*');
    p.centre(P.voucherRedeemNote);
    // Consumer Protection Act s63: a trade voucher is valid three
    // years from issue. Printing the date is what makes it provable.
    // On its own line: wrapped, "Valid until" and the date land on
    // different rows and the slip reads like it expired on nothing.
    if (r.voucher_expires) p.centre(`Valid until ${stamp(r.voucher_expires, false)}`);
    p.bold(true).centre(P.voucherSafeNote).bold(false);
  }

  // ── loyalty points ──────────────────────────────────────────
  // A balance a shopper can only learn by asking a cashier is a
  // balance they stop trusting.
  if (typeof r.points_earned === 'number' && r.points_earned > 0) {
    p.rule();
    p.bold(true).centre(`+${r.points_earned} POINTS EARNED`).bold(false);
    if (typeof r.points_balance === 'number') {
      const hint =
        r.points_balance >= P.pointsPerVoucher
          ? ` - ask for your R${P.voucherRandPerRedemption} voucher`
          : '';
      p.centre(`Balance: ${r.points_balance} points${hint}`);
    }
  }

  // ── footer ──────────────────────────────────────────────────
  p.rule();
  p.centre(P.thankYou);
  p.bold(true).centre(r.store_name ?? '').bold(false);
  if (credit) {
    p.centre(P.creditKeepNote);
    p.centre(P.cardRefundNote);
  } else {
    p.centre(P.returnLine.replace('{days}', String(P.returnDays)));
    p.centre(P.returnNote);
  }

  p.feed(1).barcode(r.sale_number ?? '');
  p.centre(r.sale_number ?? '');
  p.cut();

  return p.done();
}

export function renderTest(info, columns = COLUMNS_80MM, label = null, kick = true) {
  const p = new Escpos(columns);
  p.init().align(0).bigIfItFits('BeautyPOS');
  p.centre('print bridge test').feed(1);
  p.pair('Transport', info.transport);
  p.pair('Target', info.target);
  p.pair('Columns', String(columns));
  p.pair('Time', new Date().toLocaleString('en-ZA'));
  if (label) p.pair('Run', label);
  p.rule('=');
  p.line('Width check - the bar below should');
  p.line('exactly reach both paper edges:');
  p.rule('#');
  p.feed(1);
  // A solid block is the print-head test. On a worn head the dead
  // dots show as vertical white lines straight through it, which a
  // page of text hides.
  p.line('Print head - look for WHITE VERTICAL');
  p.line('lines through the block below:');
  p.solid(4);
  p.feed(1);
  p.line('If the bar wraps onto a second line,');
  p.line('set COLUMNS to 32 for 58mm paper.');
  if (kick) p.feed(1).centre('Drawer should have opened.');
  p.cut();
  return p.done();
}
