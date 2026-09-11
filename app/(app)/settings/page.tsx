'use client';

import { useState } from 'react';
import { Cpu, Store as StoreIcon, Users, Receipt, Trash2, CheckCircle2, CircleDashed, Palette, RefreshCw, Bell, Minus, Plus } from 'lucide-react';
import { usePos } from '@/lib/store';
import { hardware, isMock } from '@/lib/hardware';
import { Page } from '@/components/ui/Page';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { STORE, TILLS, STAFF } from '@/lib/data/seed';
import { money } from '@/lib/types';

export default function SettingsPage() {
  const sales = usePos((s) => s.sales);
  const demoSeeded = usePos((s) => s.demoSeeded);
  const seedDemo = usePos((s) => s.seedDemo);
  const resetAll = usePos((s) => s.resetAll);
  const lowStockThreshold = usePos((s) => s.lowStockThreshold);
  const setLowStockThreshold = usePos((s) => s.setLowStockThreshold);
  const products = usePos((s) => s.products);
  const [confirmReset, setConfirmReset] = useState(false);
  const hw = hardware();

  const devices = [
    { name: 'Barcode scanner', driver: hw.scanner.mode === 'mock' ? 'Simulated (click to scan)' : 'USB keyboard wedge' },
    { name: 'Receipt printer', driver: hw.printer.mode === 'mock' ? 'Simulated (on-screen preview)' : 'Thermal 80mm' },
    { name: 'Cash drawer',     driver: hw.drawer.mode === 'mock' ? 'Simulated' : 'Printer kick (ESC/POS)' },
    { name: 'Card machine',    driver: hw.reader.mode === 'mock' ? 'Simulated Yoco' : 'Yoco terminal' },
  ];

  return (
    <Page title="Settings" subtitle="Store, devices and staff">
      {/* Appearance */}
      <div className="card p-4 sm:p-5 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Palette size={17} className="text-dim" />
            <div>
              <div className="font-medium">Appearance</div>
              <div className="text-2xs text-dim mt-0.5">
                Set per device. Light for a bright shop floor, dim for long shifts,
                dark for evening trade.
              </div>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </div>

      {/* Hardware — the important one right now */}
      <div className="card p-4 sm:p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Cpu size={17} className="text-dim" />
            <span className="font-medium">Hardware</span>
          </div>
          <span className={isMock() ? 'chip-warn' : 'chip-ok'}>
            {isMock() ? 'Simulation mode' : 'Live devices'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          {devices.map((d) => (
            <div
              key={d.name}
              className="flex items-center justify-between px-3.5 h-14 rounded-lg bg-raised border border-line"
            >
              <div>
                <div className="text-sm">{d.name}</div>
                <div className="text-2xs text-dim">{d.driver}</div>
              </div>
              {isMock() ? (
                <CircleDashed size={16} className="text-warn" />
              ) : (
                <CheckCircle2 size={16} className="text-ok" />
              )}
            </div>
          ))}
        </div>

        <div className="text-2xs text-dim leading-relaxed px-3 py-2.5 rounded bg-base border border-line">
          Every device sits behind an interface in{' '}
          <code className="text-brand">lib/hardware/</code>. To go live, finish the
          driver classes in <code className="text-brand">live.ts</code> and set{' '}
          <code className="text-brand">NEXT_PUBLIC_HARDWARE_MODE=live</code>. No screen changes.
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Store */}
        <div className="card p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <StoreIcon size={17} className="text-dim" />
            <span className="font-medium">Store</span>
          </div>
          <dl className="space-y-3 text-sm">
            <Field label="Name" value={STORE.name} />
            <Field label="Address" value={STORE.address} />
            <Field label="Phone" value={STORE.phone} />
            <Field label="VAT number" value={STORE.vat_number} />
            <Field label="VAT rate" value="15% (inclusive pricing)" />
            <Field label="Tills" value={TILLS.map((t) => t.name).join(', ')} />
          </dl>
        </div>

        {/* Staff */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-4 border-b border-line">
            <Users size={17} className="text-dim" />
            <span className="font-medium">Staff</span>
          </div>
          <div className="divide-y divide-lineSoft">
            {STAFF.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="text-sm">{s.full_name}</div>
                  <div className="text-2xs text-dim capitalize">
                    {s.role.replace('_', ' ')}
                  </div>
                </div>
                <span className="chip-mute">Active</span>
              </div>
            ))}
          </div>
        </div>

        {/* Receipt */}
        <div className="card p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <Receipt size={17} className="text-dim" />
            <span className="font-medium">Receipt</span>
          </div>
          <dl className="space-y-3 text-sm">
            <Field label="Width" value="80mm thermal" />
            <Field label="Footer" value="Thank you for shopping at Glow Beauty Supply!" />
            <Field label="Return window" value="7 days, unopened, with slip" />
          </dl>
        </div>

        {/* Stock alerts */}
        <div className="card p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <Bell size={17} className="text-dim" />
            <span className="font-medium">Stock alerts</span>
          </div>

          <div className="text-2xs uppercase tracking-wider text-dim mb-2">
            Alert when stock drops to
          </div>
          <div className="flex items-center gap-2 mb-3">
            <button
              className="w-10 h-10 rounded-lg bg-raised border border-line hover:bg-hover
                         flex items-center justify-center flex-none"
              onClick={() => setLowStockThreshold(lowStockThreshold - 1)}
              disabled={lowStockThreshold <= 0}
              aria-label="Lower the threshold"
            >
              <Minus size={15} />
            </button>
            <div className="flex-1 text-center">
              <span className="text-2xl font-semibold num">{lowStockThreshold}</span>
              <span className="text-sm text-dim ml-1.5">units</span>
            </div>
            <button
              className="w-10 h-10 rounded-lg bg-raised border border-line hover:bg-hover
                         flex items-center justify-center flex-none"
              onClick={() => setLowStockThreshold(lowStockThreshold + 1)}
              aria-label="Raise the threshold"
            >
              <Plus size={15} />
            </button>
          </div>

          <p className="text-2xs text-faint leading-relaxed mb-3">
            A product raises its hand at this level <em>or</em> at its own reorder
            level — whichever is higher. So a fast mover set to reorder at 8 still
            alerts at {lowStockThreshold}.
          </p>

          <div className="text-2xs text-dim">
            Goes to{' '}
            <span className="text-ink">stock controller, manager and admin</span> as a
            bell in the header.{' '}
            <span className="num text-ink">
              {products.filter((p) => p.stock > 0 && p.stock <= Math.max(p.reorder_level, lowStockThreshold)).length}
            </span>{' '}
            product(s) sit below the line right now.
          </div>
        </div>

        {/* Data */}
        <div className="card p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <Trash2 size={17} className="text-dim" />
            <span className="font-medium">Local data</span>
            {demoSeeded && sales.length > 0 && (
              <span className="chip-warn ml-auto">Demo data</span>
            )}
          </div>

          <div className="text-sm text-dim mb-1">
            {sales.length} sale{sales.length === 1 ? '' : 's'} stored in this browser
            {sales.length > 0 && (
              <> · {money(sales.reduce((s, x) => s + x.total, 0))} total</>
            )}
          </div>
          <div className="text-2xs text-faint mb-4 leading-relaxed">
            Everything lives in this browser under <span className="num">beautypos-v1</span>.
            Nothing is on a server yet — another device, or another browser, starts
            with its own separate shop. Sales are queued here and pushed to Supabase
            once it is connected.
          </div>

          {!confirmReset ? (
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => seedDemo(true)}>
                <RefreshCw size={15} /> Load demo month
              </button>
              <button className="btn-quiet" onClick={() => setConfirmReset(true)}>
                Clear everything
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-dim mb-3">
                This wipes every sale, return, voucher and stock movement in this
                browser and leaves a clean shop. It stays empty — the demo month
                will not reload by itself.
              </p>
              <div className="flex gap-2">
                <button
                  className="btn-danger"
                  onClick={() => {
                    resetAll();
                    setConfirmReset(false);
                  }}
                >
                  Yes, wipe everything
                </button>
                <button className="btn-quiet" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-dim flex-none">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
