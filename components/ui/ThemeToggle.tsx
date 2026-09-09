'use client';

import { Sun, Cloud, Moon } from 'lucide-react';
import { useTheme, THEMES, type Theme } from '@/lib/theme';

const ICONS = { light: Sun, dim: Cloud, dark: Moon } as const;
const LABELS: Record<Theme, string> = { light: 'Light', dim: 'Dim', dark: 'Dark' };

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="seg" role="group" aria-label="Colour theme">
      {THEMES.map((t) => {
        const Icon = ICONS[t];
        const on = theme === t;
        return (
          <button
            key={t}
            onClick={() => setTheme(t)}
            aria-pressed={on}
            title={LABELS[t]}
            className={`seg-item ${on ? 'seg-item-on' : ''} ${compact ? '!px-2' : ''}`}
          >
            <Icon size={13} />
            {!compact && <span className="hidden sm:inline">{LABELS[t]}</span>}
          </button>
        );
      })}
    </div>
  );
}
