// Fires test slips at the running bridge, reading the port and token
// from bridge.config.json so the two can never drift apart.
//
//   node test-print.mjs            one slip, and open the drawer
//   node test-print.mjs 25         burn-in: 25 slips, no drawer
//
// The burn-in run is for vetting a second-hand printer. The two parts
// that wear out are the print head and the autocutter, and neither
// shows a problem on a single slip — a tired cutter fails on the
// twentieth cut, not the first.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfgPath = path.join(HERE, 'bridge.config.json');

let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch {
  console.error('Could not read bridge.config.json. Run this from the bridge folder.');
  process.exit(1);
}

const count = Math.max(1, Number(process.argv[2]) || 1);
const burnIn = count > 1;
const port = cfg.port ?? 8080;
const url = `http://localhost:${port}/print`;

try {
  const h = await fetch(`http://localhost:${port}/health`).then((r) => r.json());
  console.log(`bridge   ${h.transport} -> ${h.target} (${h.columns} columns)`);
} catch {
  console.error(
    `\nThe bridge is not running on port ${port}.\n` +
      `Open a SECOND window, run start-bridge.bat (or: node print-bridge.mjs),\n` +
      `leave it open, then run this again.\n`
  );
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  ...(cfg.token ? { 'X-Bridge-Token': cfg.token } : {}),
};

let failed = 0;
for (let i = 1; i <= count; i++) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'test',
      // Only the first slip kicks the drawer. Twenty-five solenoid
      // cracks tells you nothing extra and empties the shop.
      drawer: i === 1,
      label: burnIn ? `${i} of ${count}` : null,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    failed++;
    console.error(`  slip ${i}: FAILED (${res.status}) ${body.error ?? ''}`);
    if (failed >= 3) {
      console.error('\nThree failures. Stopping.');
      process.exit(1);
    }
  } else if (burnIn) {
    process.stdout.write(`\r  printed ${i}/${count}`);
  }
  // Let the cutter and head recover between slips, as they would
  // between real customers. Hammering it flat out is not the test.
  if (i < count) await new Promise((r) => setTimeout(r, 900));
}

if (burnIn) console.log('');

console.log(
  burnIn
    ? `\nBurn-in done: ${count - failed}/${count} printed.\n\n` +
        `  1. CUTTER   did every slip separate cleanly? Any that tore,\n` +
        `              jammed, or stayed attached means a worn cutter.\n` +
        `  2. HEAD     hold the slips to the light. White vertical lines\n` +
        `              through the solid block = dead dots. They do not\n` +
        `              heal, and they get wider.\n` +
        `  3. FADE     is the last slip fainter than the first? That is\n` +
        `              a head overheating, usually near end of life.\n`
    : `\nSent. Check the slip:\n` +
        `  1. the #### bar should touch both paper edges\n` +
        `  2. no white vertical lines through the solid block\n` +
        `  3. the cash drawer should have opened\n\n` +
        `If the bar wrapped, set "columns": 42 and run this again.\n` +
        `To vet a second-hand printer:  node test-print.mjs 25\n`
);
