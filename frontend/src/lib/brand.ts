/**
 * Brand palette as TS constants. Mirrors the `brand.*` tokens in
 * `tailwind.config.ts` and the CSS variables in `src/index.css`.
 *
 * Use these constants for non-CSS contexts where Tailwind utilities don't
 * reach — MapLibre source/layer paint specs, marker DOM elements, etc.
 * When the palette is swapped, update both this file and the Tailwind config.
 */
export const brand = {
  navy: "#0A0E27",
  deep: "#060920",
  green: "#39FF14",
  cyan: "#00E5FF",
  purple: "#B026FF",
  muted: "#1A1F3A",
  text: "#E6EAF2",
  subtle: "#8A92B2",
} as const;

/** Pretty-print a campus node label. e.g. "main_block" -> "Main Block". */
export function prettyLabel(label: string): string {
  return label
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
