#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  BeautyPOS print bridge
//
//  WHY THIS EXISTS
//  A browser has no way to reach a USB thermal printer, and
//  window.print() cannot send the five raw bytes that open a cash
//  drawer. So the till's browser POSTs JSON here, and this process —
//  running on the till PC itself — converts it to ESC/POS and writes
//  it to the printer. It is the only part of BeautyPOS that touches
//  hardware directly.
//
//  RUN IT
//      node print-bridge.mjs
//
//  CONFIGURE IT  (bridge.config.json, or environment variables)
//      transport : "tcp" | "share" | "device" | "auto"
//      host/port : network printer            (tcp, port defaults 9100)
//      share     : \\\\localhost\\POS80       (Windows shared printer)
//      device    : /dev/usb/lp0               (Linux/macOS)
//      columns   : 48 for 80mm paper, 32 for 58mm
//      token     : shared secret the till must send
//      origins   : which web origins may call this
//
//  Stdlib only — no npm install, so it runs on a till with no build
//  tools and cannot rot when a dependency does.
// ═══════════════════════════════════════════════════════════════════

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderReceipt, renderTest, COLUMNS_80MM } from './escpos.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ─── configuration ────────────────────────────────────────────────
function loadConfig() {
  let file = {};
  const p = path.join(HERE, 'bridge.config.json');
  if (fs.existsSync(p)) {
    try {
      file = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      console.error(`[bridge] bridge.config.json is not valid JSON: ${e.message}`);
      process.exit(1);
    }
  }
  const env = process.env;
  const cfg = {
    port: Number(env.BRIDGE_PORT ?? file.port ?? 8080),
    transport: env.BRIDGE_TRANSPORT ?? file.transport ?? 'auto',
    host: env.PRINTER_HOST ?? file.host ?? '',
    printerPort: Number(env.PRINTER_PORT ?? file.printerPort ?? 9100),
    share: env.PRINTER_SHARE ?? file.share ?? '',
    device: env.PRINTER_DEVICE ?? file.device ?? '',
    columns: Number(env.BRIDGE_COLUMNS ?? file.columns ?? COLUMNS_80MM),
    token: env.BRIDGE_TOKEN ?? file.token ?? '',
    origins: env.BRIDGE_ORIGINS
      ? env.BRIDGE_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
      : file.origins ?? ['*'],
  };

  if (cfg.transport === 'auto') {
    cfg.transport = cfg.host ? 'tcp' : cfg.share ? 'share' : cfg.device ? 'device' : '';
  }
  return cfg;
}

const cfg = loadConfig();

function target() {
  if (cfg.transport === 'tcp') return `${cfg.host}:${cfg.printerPort}`;
  if (cfg.transport === 'share') return cfg.share;
  if (cfg.transport === 'device') return cfg.device;
  return '(not configured)';
}

// ─── transports ───────────────────────────────────────────────────
// Each returns a promise that rejects with a message a cashier could
// act on, because "Error" on a till screen is worth nothing.

function sendTcp(buf) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: cfg.host, port: cfg.printerPort });
    const fail = (msg) => { sock.destroy(); reject(new Error(msg)); };
    sock.setTimeout(6000);
    sock.on('timeout', () => fail(`Printer at ${target()} did not respond. Is it on and on the network?`));
    sock.on('error', (e) =>
      fail(
        e.code === 'ECONNREFUSED'
          ? `Printer at ${target()} refused the connection. Check the IP and that port ${cfg.printerPort} is the raw-print port.`
          : e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT'
          ? `Cannot reach the printer at ${cfg.host}. Check it is powered on and on the same network.`
          : `Printer error: ${e.message}`
      )
    );
    sock.on('connect', () => sock.end(buf, () => resolve()));
    sock.on('close', () => resolve());
  });
}

function sendShare(buf) {
  // Windows: a USB printer installed with its driver and shared can be
  // written to raw with `copy /b`. No native module, which is the
  // whole reason this path exists.
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `beautypos-${Date.now()}-${process.pid}.bin`);
    fs.writeFile(tmp, buf, (werr) => {
      if (werr) return reject(new Error(`Could not stage the print job: ${werr.message}`));
      execFile(
        'cmd',
        ['/c', 'copy', '/b', tmp, cfg.share],
        { windowsHide: true, timeout: 15000 },
        (err, stdout, stderr) => {
          fs.unlink(tmp, () => {});
          if (err) {
            return reject(
              new Error(
                `Could not write to ${cfg.share}. Confirm the printer is shared under that exact name ` +
                  `(Printer properties > Sharing) and that the share name has no spaces. ` +
                  `${(stderr || stdout || err.message).trim()}`
              )
            );
          }
          resolve();
        }
      );
    });
  });
}

function sendDevice(buf) {
  return new Promise((resolve, reject) => {
    fs.writeFile(cfg.device, buf, (e) => {
      if (e) {
        return reject(
          new Error(
            e.code === 'EACCES'
              ? `No permission to write to ${cfg.device}. Add this user to the lp group.`
              : e.code === 'ENOENT'
              ? `${cfg.device} does not exist. Check the printer is plugged in.`
              : `Printer error: ${e.message}`
          )
        );
      }
      resolve();
    });
  });
}

function sendRaw(buf) {
  if (cfg.transport === 'tcp') return sendTcp(buf);
  if (cfg.transport === 'share') return sendShare(buf);
  if (cfg.transport === 'device') return sendDevice(buf);
  return Promise.reject(
    new Error('No printer configured. Set transport and host/share/device in bridge.config.json.')
  );
}

// A printer has one paper path. Two receipts sent at the same moment
// would interleave their bytes and print one ruined slip, so every
// job goes through a single chain.
let chain = Promise.resolve();
function enqueue(buf) {
  const run = chain.then(() => sendRaw(buf), () => sendRaw(buf));
  chain = run.catch(() => {});
  return run;
}

// ─── HTTP ─────────────────────────────────────────────────────────
function cors(req, res) {
  const origin = req.headers.origin;
  // No Origin header at all means this is not a browser cross-origin
  // request: curl, Node, the bridge's own test script. A browser
  // always attaches Origin to a cross-origin POST, so its absence
  // cannot be the drive-by case the allow-list exists to stop — and
  // the token still applies either way. Rejecting these made the
  // bridge fail its own test with 403.
  const ok = !origin || cfg.origins.includes('*') || cfg.origins.includes(origin);
  if (ok && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
  return ok;
}

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Request too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => {
      if (!parts.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); }
      catch { reject(new Error('Body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const originAllowed = cors(req, res);

  if (req.method === 'OPTIONS') { res.writeHead(originAllowed ? 204 : 403).end(); return; }

  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      transport: cfg.transport || null,
      target: target(),
      columns: cfg.columns,
      tokenRequired: Boolean(cfg.token),
    });
  }

  if (req.method !== 'POST' || url.pathname !== '/print') {
    return json(res, 404, { ok: false, error: 'Use POST /print or GET /health' });
  }

  if (!originAllowed) return json(res, 403, { ok: false, error: 'Origin not allowed' });

  // The token's job is narrow and worth stating plainly: it stops a
  // random web page the cashier happens to open from popping the cash
  // drawer. Because it travels in a custom header, the browser must
  // pre-flight the request, and an origin we do not list never gets
  // that far. It is not a secret from anyone who can read the till's
  // own bundle — the real controls are the allow-list, binding to
  // 127.0.0.1, and the fact that every drawer opening is logged.
  if (cfg.token && req.headers['x-bridge-token'] !== cfg.token) {
    return json(res, 401, { ok: false, error: 'Bad or missing X-Bridge-Token' });
  }

  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, 400, { ok: false, error: e.message }); }

  try {
    if (body.type === 'receipt') {
      if (!body.receipt) return json(res, 400, { ok: false, error: 'Missing receipt' });
      await enqueue(renderReceipt(body.receipt, cfg.columns));
      console.log(`[bridge] receipt ${body.receipt.sale_number ?? '?'} printed`);
      return json(res, 200, { ok: true });
    }

    if (body.type === 'raw') {
      if (!Array.isArray(body.bytes) || !body.bytes.length) {
        return json(res, 400, { ok: false, error: 'bytes must be a non-empty array' });
      }
      if (body.bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
        return json(res, 400, { ok: false, error: 'bytes must all be 0-255' });
      }
      await enqueue(Buffer.from(body.bytes));
      console.log(`[bridge] raw ${body.bytes.length}B${body.reason ? ` (${body.reason})` : ''}`);
      return json(res, 200, { ok: true });
    }

    if (body.type === 'test') {
      await enqueue(
        Buffer.concat([
          renderTest({ transport: cfg.transport || 'none', target: target() }, cfg.columns),
          Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]), // prove the drawer too
        ])
      );
      console.log('[bridge] test slip printed');
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { ok: false, error: `Unknown type "${body.type}"` });
  } catch (e) {
    console.error(`[bridge] ${e.message}`);
    return json(res, 502, { ok: false, error: e.message });
  }
});

// Bound to loopback on purpose: the till's browser is on this machine,
// so nothing else on the shop network should be able to reach the
// drawer. Set BRIDGE_BIND=0.0.0.0 only if a second till must share
// this printer, and understand that you are opening the drawer to the
// whole LAN when you do.
const BIND = process.env.BRIDGE_BIND ?? '127.0.0.1';

server.listen(cfg.port, BIND, () => {
  console.log('─────────────────────────────────────────────');
  console.log(' BeautyPOS print bridge');
  console.log(`  listening  http://${BIND}:${cfg.port}`);
  console.log(`  transport  ${cfg.transport || 'NOT CONFIGURED'}`);
  console.log(`  printer    ${target()}`);
  console.log(`  paper      ${cfg.columns} columns`);
  console.log(`  token      ${cfg.token ? 'required' : 'none (anything local can print)'}`);
  console.log(`  origins    ${cfg.origins.join(', ')}`);
  console.log('─────────────────────────────────────────────');
  if (!cfg.transport) {
    console.log(' Nothing will print until a transport is set.');
    console.log(' Copy bridge.config.example.json to bridge.config.json.');
  } else {
    console.log(' Test it:  curl -X POST http://localhost:' +
      cfg.port + '/print -H "Content-Type: application/json" -d "{\\"type\\":\\"test\\"}"');
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[bridge] Port ${cfg.port} is already in use — the bridge may already be running.`);
    process.exit(1);
  }
  throw e;
});
