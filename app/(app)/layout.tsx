'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ScanLine, LayoutDashboard, Package, Boxes, Receipt,
  BarChart3, Settings, LogOut, Wifi, WifiOff, CloudUpload, Sparkles, RotateCcw, Ticket, ShieldCheck,
  HeartHandshake,
} from 'lucide-react';
import { usePos } from '@/lib/store';
import { startSync } from '@/lib/supabase/sync';
import { signOutDevice } from '@/lib/supabase/auth';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { AlertBell } from '@/components/ui/AlertBell';
import { CatalogueSync } from '@/components/CatalogueSync';
import type { Role, Surface } from '@/lib/types';
import { STORE, TILLS } from '@/lib/data/seed';

// Every screen belongs to exactly ONE surface. Permissions follow the
// surface first and the role second, so an admin who signs in at the
// counter gets the cashier's app — not the owner's.
//
// This list is also the enforcement: a route not on it for your
// surface redirects, it does not merely hide from the rail.
const NAV: {
  href: string; label: string; icon: typeof ScanLine;
  surface: Surface; roles: Role[];
}[] = [
  // ── Till: selling, and nothing that reveals what things cost ──
  { href: '/till',      label: 'Till',      icon: ScanLine,        surface: 'till',   roles: ['cashier', 'manager', 'admin'] },
  { href: '/sales',     label: 'Sales',     icon: Receipt,         surface: 'till',   roles: ['cashier', 'manager', 'admin'] },
  { href: '/returns',   label: 'Returns',   icon: RotateCcw,       surface: 'till',   roles: ['cashier', 'manager', 'admin'] },

  // ── Back office: the business ──
  { href: '/dashboard', label: 'Home',      icon: LayoutDashboard, surface: 'office', roles: ['manager', 'admin'] },
  { href: '/products',  label: 'Products',  icon: Package,         surface: 'office', roles: ['stock_controller', 'manager', 'admin'] },
  { href: '/stock',     label: 'Stock',     icon: Boxes,           surface: 'office', roles: ['stock_controller', 'manager', 'admin'] },
  { href: '/vouchers',  label: 'Vouchers',  icon: Ticket,          surface: 'office', roles: ['manager', 'admin'] },
  { href: '/loyalty',   label: 'Loyalty',   icon: HeartHandshake,  surface: 'office', roles: ['manager', 'admin'] },
  { href: '/reports',   label: 'Reports',   icon: BarChart3,       surface: 'office', roles: ['manager', 'admin'] },
  { href: '/audit',     label: 'Audit',     icon: ShieldCheck,     surface: 'office', roles: ['manager', 'admin'] },
  { href: '/settings',  label: 'Settings',  icon: Settings,        surface: 'office', roles: ['admin'] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const staff = usePos((s) => s.staff);
  const surface = usePos((s) => s.surface);
  const logout = usePos((s) => s.logout);
  const tillId = usePos((s) => s.tillId);
  const sales = usePos((s) => s.sales);
  const refundsList = usePos((s) => s.refunds);

  const [online, setOnline] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);
  useEffect(() => startSync(), []);

  const allowed = staff && surface
    ? NAV.filter((n) => n.surface === surface && n.roles.includes(staff.role))
    : [];

  useEffect(() => {
    if (!ready) return;
    if (!staff || !surface) {
      router.replace('/login');
      return;
    }
    // Enforcement, not decoration: a route you cannot reach from your
    // rail is a route you cannot reach by typing it either.
    if (!allowed.some((n) => n.href === pathname)) {
      router.replace(allowed[0]?.href ?? '/login');
    }
  }, [ready, staff, surface, pathname, allowed, router]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (!ready || !staff || !surface) return null;
  if (!allowed.some((n) => n.href === pathname)) return null;

  const till = TILLS.find((t) => t.id === tillId);
  const { overrides: overridesList, creditNotes } = usePos.getState();
  const unsynced =
    sales.filter((s) => !s.synced).length +
    refundsList.filter((r) => !r.synced).length +
    overridesList.filter((o) => !o.synced).length +
    creditNotes.filter((v) => !v.synced).length;
  const nav = allowed;
  const initials = staff.full_name.split(' ').map((n) => n[0]).join('');

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      {/* Keeps the shelf in step with the database. */}
      <CatalogueSync />
      {/* ── Rail ─────────────────────────────────────────────────
          Narrows on tablets, scrolls if a role has many sections. */}
      <aside
        className="w-[58px] lg:w-[70px] flex-none bg-panel border-r border-line
                   flex flex-col items-center py-3 lg:py-4"
      >
        <Link
          href={nav[0]?.href ?? '/till'}
          className="w-9 h-9 rounded-lg bg-brand flex items-center justify-center mb-4 flex-none"
          aria-label="BeautyPOS"
        >
          <Sparkles size={17} className="text-brand-fg" />
        </Link>

        <nav className="flex-1 flex flex-col gap-0.5 w-full px-1.5 overflow-y-auto scroll min-h-0">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                title={label}
                aria-current={active ? 'page' : undefined}
                className={`h-[46px] rounded-lg flex flex-col items-center justify-center gap-1
                  flex-none transition-colors ${
                    active
                      ? 'bg-brand-soft text-brand'
                      : 'text-faint hover:text-ink hover:bg-raised'
                  }`}
              >
                <Icon size={18} />
                <span className="text-[9px] font-medium leading-none">{label}</span>
              </Link>
            );
          })}
        </nav>

        <button
          onClick={() => {
            // An office person signing out ends their Supabase session
            // too — it is their named identity and the sign-in log
            // depends on it meaning something.
            //
            // A till does NOT: the device stays connected so the next
            // cashier types four digits, not a password. The device
            // session is undone by an admin, not by signing out.
            if (surface === 'office') void signOutDevice();
            logout();
            router.replace(surface === 'office' ? '/office/login' : '/login');
          }}
          title="Sign out"
          className="mt-2 h-10 w-10 flex-none rounded-lg flex items-center justify-center
                     text-faint hover:text-bad hover:bg-raised transition-colors"
        >
          <LogOut size={18} />
        </button>
      </aside>

      {/* ── Main ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header
          className="h-14 flex-none border-b border-line bg-panel
                     flex items-center justify-between gap-3 px-3 sm:px-5"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm truncate hidden sm:block">{STORE.name}</span>
            <span className="text-faint hidden sm:inline">·</span>
            {surface === 'till' ? (
              <span className="text-sm text-dim whitespace-nowrap">{till?.name}</span>
            ) : (
              <span className="chip-mute">Back office</span>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {unsynced > 0 && (
              <span className="chip-warn" title="Waiting to reach Supabase">
                <CloudUpload size={12} />
                <span className="hidden sm:inline">{unsynced} to sync</span>
                <span className="sm:hidden num">{unsynced}</span>
              </span>
            )}

            <span className={online ? 'chip-ok' : 'chip-bad'}>
              {online ? <Wifi size={12} /> : <WifiOff size={12} />}
              <span className="hidden md:inline">{online ? 'Online' : 'Offline'}</span>
            </span>

            {/* Stock alerts follow the person, not the screen. */}
            {surface === 'office' && <AlertBell />}

            <ThemeToggle compact />

            <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-line">
              <div
                className="w-8 h-8 rounded-full bg-raised border border-line flex items-center
                           justify-center text-2xs font-semibold flex-none"
                title={`${staff.full_name} · ${staff.role.replace('_', ' ')}`}
              >
                {initials}
              </div>
              <div className="leading-tight hidden lg:block">
                <div className="text-xs font-medium whitespace-nowrap">{staff.full_name}</div>
                <div className="text-[10px] text-faint capitalize">
                  {staff.role.replace('_', ' ')}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-hidden min-h-0">{children}</main>
      </div>
    </div>
  );
}
