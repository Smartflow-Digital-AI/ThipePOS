'use client';

export function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto scroll">
      <div className="px-4 sm:px-6 py-4 sm:py-5 max-w-[1600px] mx-auto">
        {/* Actions wrap under the title on narrow screens rather than
            squeezing the heading into two characters. */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-dim mt-1">{subtitle}</p>}
          </div>
          {actions && (
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:flex-none">
              {actions}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : '';
  return (
    <div className="card p-3 sm:p-4">
      <div className="text-2xs uppercase tracking-wider text-dim mb-1.5 truncate" title={label}>
        {label}
      </div>
      <div className={`text-xl sm:text-2xl font-semibold num tracking-tight ${toneClass}`}>
        {value}
      </div>
      {hint && <div className="text-2xs text-faint mt-1 line-clamp-2">{hint}</div>}
    </div>
  );
}

/**
 * A column can be `'Name'` or `{ l: 'Name', cls: 'hidden md:table-cell' }`.
 *
 * Dropping low-value columns on a tablet beats letting the table scroll
 * sideways — a cashier will not think to swipe a table.
 */
export type Col = string | { l: string; cls?: string };

export function Table({ head, children }: { head: Col[]; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto scroll">
        <table className="w-full min-w-[520px]">
          <thead>
            <tr>
              {head.map((h, i) => {
                const label = typeof h === 'string' ? h : h.l;
                const cls = typeof h === 'string' ? '' : (h.cls ?? '');
                return (
                  <th key={i} className={`th ${cls}`}>
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return <div className="card p-10 sm:p-12 text-center text-sm text-dim">{message}</div>;
}

/** Horizontal filter pills that scroll instead of wrapping into a mess. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto scroll -mx-1 px-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`h-10 px-3 rounded-lg text-sm border transition-colors whitespace-nowrap flex-none ${
            value === o.key
              ? 'bg-ink text-base border-ink'
              : 'bg-panel border-line text-dim hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
