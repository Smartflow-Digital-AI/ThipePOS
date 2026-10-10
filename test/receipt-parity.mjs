// Guards the one thing three renderers must agree on: what a slip
// SAYS. The screen receipt, the thermal slip and the emailed copy all
// read lib/receipt-policy.json; this asserts that file still matches
// the constants the APP computes with, because a policy file that
// drifts from lib/types.ts is worse than none — it looks
// authoritative and lies.
//
//   node test/receipt-parity.mjs

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { renderReceipt, POLICY, COLUMNS_80MM } from '../bridge/escpos.mjs';

let pass = 0;
const check = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const types = fs.readFileSync(new URL('../lib/types.ts', import.meta.url), 'utf8');
const num = (re) => Number(types.match(re)[1]);

check('bridge loaded the shared policy, not its fallback', () => {
  const disk = JSON.parse(fs.readFileSync(new URL('../lib/receipt-policy.json', import.meta.url)));
  assert.equal(POLICY.returnDays, disk.returnDays);
  assert.equal(POLICY.thankYou, disk.thankYou);
});

check('VAT rate matches lib/types.ts', () =>
  assert.equal(POLICY.vatRatePct / 100, num(/VAT_RATE = ([\d.]+)/)));

check('points per voucher matches lib/types.ts', () =>
  assert.equal(POLICY.pointsPerVoucher, num(/POINTS_PER_VOUCHER = (\d+)/)));

check('voucher rand value matches lib/types.ts', () =>
  assert.equal(POLICY.voucherRandPerRedemption, num(/VOUCHER_RAND_PER_REDEMPTION = (\d+)/)));

// The slip must promise exactly what the returns screen enforces.
// Printing "7 days" while the code refuses returns after 5 is an
// argument at the counter that the shop loses, holding its own receipt.
check('printed return window matches RETURN_WINDOW_DAYS', () =>
  assert.equal(POLICY.returnDays, num(/RETURN_WINDOW_DAYS = (\d+)/)));

check('default paper width is the TM-T88V real 42 columns', () =>
  assert.equal(COLUMNS_80MM, 42));

check('the screen receipt reads the policy rather than hardcoding it', () => {
  const tsx = fs.readFileSync(new URL('../components/pos/Receipt.tsx', import.meta.url), 'utf8');
  assert.match(tsx, /policy\.returnDays/);
  assert.match(tsx, /policy\.vatRatePct/);
  assert.doesNotMatch(tsx, /within 7 days|within 30 days/, 'return window hardcoded in the TSX');
});

// ── the arithmetic a tax invoice has to survive ──────────────────
// cartTotals returns subtotal EXCLUSIVE of VAT, so subtotal + VAT
// must equal total on the paper. This is the bug that shipped.
const total = 167248;
const tax = total - Math.round(total / 1.15);
const base = {
  store_name: 'Thipe Blinggirl', store_address: 'Shop 12', store_phone: '015 123 4567',
  vat_number: '4123456789', sale_number: 'T1-000147', till_name: 'Till 1',
  cashier_name: 'Lerato', datetime: '09 Oct 2026, 14:32',
  lines: [{ name: 'Nail Polish 250ml', qty: 2, unit_price: 8999, line_total: 17998 }],
  subtotal: total - tax, discount_total: 0, tax_total: tax, total,
  payments: [{ method: 'voucher', amount: total }],
};

const money = (c) => 'R' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d)\.)/g, ' ');
const plain = (r, cols = 42) => {
  const b = renderReceipt(r, cols);
  let i = 0, out = '', line = '';
  while (i < b.length) {
    if (b[i] === 0x1d && b[i + 1] === 0x6b) { while (i < b.length && b[i] !== 0x00) i++; i++; continue; }
    if (b[i] === 0x1b && [0x61, 0x45, 0x64, 0x2d].includes(b[i + 1])) { i += 3; continue; }
    if (b[i] === 0x1d && [0x21, 0x68, 0x77, 0x48].includes(b[i + 1])) { i += 3; continue; }
    if (b[i] === 0x1b && b[i + 1] === 0x40) { i += 2; continue; }
    if (b[i] === 0x1b && b[i + 1] === 0x70) { i += 5; continue; }
    if (b[i] === 0x1d && b[i + 1] === 0x56) { i += 4; continue; }
    if (b[i] === 0x0a) { out += line + '\n'; line = ''; i++; continue; }
    line += String.fromCharCode(b[i]); i++;
  }
  return out + line;
};

check('subtotal + VAT = total, and all three reach the slip', () => {
  assert.equal(base.subtotal + base.tax_total, base.total, 'fixture must balance');
  const t = plain(base);
  assert.match(t, /VAT SUMMARY/);
  assert.match(t, /RATE\s+GOODS\s+VAT/);
  assert.match(t, new RegExp(`15%\\s+${money(base.subtotal)}\\s+${money(base.tax_total)}`));
  assert.match(t, /TOTAL/);
});

check('a voucher payment is not labelled Cash', () => {
  const t = plain(base);
  assert.match(t, /Voucher/);
  assert.doesNotMatch(t, /^Cash\s/m);
});

check('no VAT number means it does not claim to be a tax invoice', () => {
  const t = plain({ ...base, vat_number: '' });
  assert.match(t, /SALES RECEIPT/);
  assert.match(t, /not a tax invoice/);
  assert.doesNotMatch(t, /TAX INVOICE/);
  assert.doesNotMatch(t, /VAT SUMMARY/, 'a non-registered shop must not print VAT amounts');
});

check('return window on paper matches the policy file', () =>
  assert.match(plain(base), new RegExp(`within ${POLICY.returnDays} days`)));

check('the item table totals the units sold', () =>
  assert.match(plain(base), /TOTAL ARTICLES\s+2/));

check('a payment summary names what was due and what was tendered', () => {
  const t = plain({ ...base, payments: [{ method: 'cash', amount: 50000 }], cash_received: 50000, change_given: 50000 - base.total });
  assert.match(t, /PAYMENT SUMMARY/);
  assert.match(t, /Amount due/);
  assert.match(t, /Cash tendered/);
  assert.match(t, /Change/);
});

check('credit note carries the voucher, its expiry and the warning', () => {
  const t = plain({
    ...base, doc_type: 'credit_note', original_sale_number: 'T1-000147',
    voucher_code: 'TB-9F4K-2210', voucher_expires: '2029-10-09T00:00:00+02:00',
    refund_reason: 'Wrong shade', refund_method: 'Voucher',
  });
  assert.match(t, /CREDIT NOTE/);
  assert.match(t, /Against receipt/);
  assert.match(t, /TB-9F4K-2210/);
  assert.match(t, /Valid until 2029/);
  assert.match(t, /cannot be replaced/);
  assert.doesNotMatch(t, /Returns accepted/, 'a credit note is not a sale');
});

check('the sale number prints as a scannable CODE39 barcode', () => {
  const b = renderReceipt(base);
  const i = b.indexOf(Buffer.from([0x1d, 0x6b, 0x04]));
  assert.ok(i > -1, 'no GS k CODE39 command found');
  const end = b.indexOf(0x00, i + 3);
  assert.equal(b.slice(i + 3, end).toString('ascii'), 'T1-000147');
});

check('nothing overflows the paper at 42 or 32 columns', () => {
  for (const cols of [42, 32]) {
    for (const r of [base, { ...base, doc_type: 'credit_note', voucher_code: 'TB-9F4K-2210' }]) {
      for (const ln of plain(r, cols).split('\n')) {
        assert.ok(ln.length <= cols, `${cols}col overflow (${ln.length}): ${ln}`);
      }
    }
  }
});

console.log(`\n${pass} checks passed`);
