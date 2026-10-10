// Fires a test slip at the running bridge, reading the port and token
// from bridge.config.json so the two can never drift apart. An earlier
// version read the token from an environment variable, which meant a
// configured bridge answered its own test with 401.

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

const port = cfg.port ?? 8080;
const url = `http://localhost:${port}/print`;

try {
  const health = await fetch(`http://localhost:${port}/health`).then((r) => r.json());
  console.log(`bridge   ${health.transport} -> ${health.target} (${health.columns} columns)`);
} catch {
  console.error(
    `\nThe bridge is not running on port ${port}.\n` +
      `Open a SECOND window, run start-bridge.bat (or: node print-bridge.mjs),\n` +
      `leave it open, then run this again.\n`
  );
  process.exit(1);
}

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(cfg.token ? { 'X-Bridge-Token': cfg.token } : {}),
  },
  body: JSON.stringify({ type: 'test' }),
});

const body = await res.json().catch(() => ({}));

if (res.ok) {
  console.log('\nSent. Check the slip:');
  console.log('  1. the #### bar should touch both paper edges');
  console.log('  2. the cash drawer should have opened');
  console.log('\nIf the bar wrapped, set "columns": 42 and run this again.');
} else {
  console.error(`\nFailed (${res.status}): ${body.error ?? 'no reason given'}`);
  process.exit(1);
}
