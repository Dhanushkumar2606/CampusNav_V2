# Branding — placeholder palette

These are placeholder values for the "DK" personal brand palette described
in the spec ("dark navy + neon green/cyan/purple"). Swap the hex values
once the real DK palette is finalized.

## Colors

| Token       | Hex        | Use                                               |
|-------------|------------|---------------------------------------------------|
| `brand.navy`| `#0A0E27`  | Background, primary surfaces                      |
| `brand.deep`| `#060920`  | Deeper base, page background                      |
| `brand.green` | `#39FF14` | Primary accent (highlight, primary CTA)          |
| `brand.cyan`  | `#00E5FF` | Secondary accent (links, info)                   |
| `brand.purple`| `#B026FF` | Tertiary accent (badges, gradients)              |
| `brand.muted` | `#1A1F3A` | Cards, lifted surfaces                            |
| `brand.text`  | `#E6EAF2` | Primary text on dark                              |
| `brand.subtle`| `#8A92B2` | Secondary text on dark                            |

## How to swap

1. Edit `frontend/tailwind.config.ts` and update the `brand` color tokens.
2. (Optionally) update `frontend/src/index.css` CSS variables for the
   shadcn dark theme.
3. Restart the Vite dev server.

No other files reference the hex values directly.
