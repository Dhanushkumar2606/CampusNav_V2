# Branding — premium palette

The "DK" personal brand palette: dark navy + emerald green / teal cyan /
purple. Tokens are defined **once** as HSL CSS variables in
`frontend/src/index.css` (`:root` for dark, `.light` overrides for light
theme), and `frontend/tailwind.config.ts` maps every `brand.*` utility to
`hsl(var(--brand-*))` — so a single token set drives both themes.

## Colors (dark theme reference)

| Token | HSL (dark) | Use |
|-------|------------|-----|
| `brand.navy` | `226 52% 10%` | Cards, elevated surfaces |
| `brand.deep` | `224 52% 6%` | Page background |
| `brand.surface` | `225 46% 14%` | Inputs, in-between surfaces |
| `brand.green` | `160 84% 39%` | Primary accent, primary CTA + glow |
| `brand.cyan` | `172 66% 50%` | Secondary accent (links, info) |
| `brand.purple` | `234 89% 74%` | Tertiary accent (badges, gradients) |
| `brand.muted` | `226 40% 18%` | Borders, dividers |
| `brand.text` | `219 55% 94%` | Primary text |
| `brand.subtle` | `222 31% 68%` | Secondary text |
| `brand.amber` | `38 92% 50%` | Warnings |
| `brand.danger` | `0 91% 71%` | Errors, destructive actions |

Light theme swaps the `--brand-*` values via `.light { … }` in
`src/index.css` (deep/navy/surface become near-white, text becomes inky
`225 45% 13%`, green darkens to `160 84% 36%`, cyan to `172 70% 36%`).

## Where colors live

1. `frontend/src/index.css` — the CSS variables (source of truth) +
   `card`, `popover`, `destructive` tokens.
2. `frontend/tailwind.config.ts` — maps `brand.*` → `hsl(var(--brand-*) / <alpha-value>)`.
3. `frontend/src/lib/brand.ts` — dark-theme JS mirror (hex) used only for
   MapLibre paint specs, which cannot read CSS vars. Map overlays are
   intentionally pinned to the dark palette.
4. `backend/app/seed/csv_loader.py` + `BACKEND_LINKS` — nothing brand-specific.

## How to swap

1. Edit the HSL values in `src/index.css` (both `:root` and `.light`).
2. Restart the Vite dev server.
3. MapLibre overlays follow `src/lib/brand.ts` if a map-side change is needed.