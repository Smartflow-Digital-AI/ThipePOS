import type { Config } from 'tailwindcss';

// Every colour is a CSS variable holding "R G B" channels, so the same
// utility class works in all three themes and Tailwind's opacity
// modifiers (bg-brand/12) still work. Theme values live in globals.css.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base:     token('bg'),
        panel:    token('surface'),
        raised:   token('surface-2'),
        hover:    token('surface-3'),
        line:     token('border'),
        lineSoft: token('border-soft'),

        ink:   token('text'),
        dim:   token('text-dim'),
        faint: token('text-faint'),

        brand: {
          DEFAULT: token('brand'),
          hover:   token('brand-hover'),
          fg:      token('brand-fg'),
          soft:    'rgb(var(--brand) / 0.12)',
          line:    'rgb(var(--brand) / 0.35)',
        },
        ok:   { DEFAULT: token('ok'),   soft: 'rgb(var(--ok) / 0.12)' },
        warn: { DEFAULT: token('warn'), soft: 'rgb(var(--warn) / 0.12)' },
        bad:  { DEFAULT: token('bad'),  soft: 'rgb(var(--bad) / 0.12)' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: { '2xs': ['11px', '15px'] },
      borderRadius: { DEFAULT: '8px', lg: '12px', xl: '16px' },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop:  'var(--shadow-pop)',
      },
      keyframes: {
        in:      { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        slideIn: { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        pulseRing: {
          '0%':   { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        in:      'in 140ms ease-out',
        slideIn: 'slideIn 200ms cubic-bezier(0.32,0.72,0,1)',
        fadeIn:  'fadeIn 150ms ease-out',
        ring:    'pulseRing 1.4s ease-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
