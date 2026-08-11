/**
 * Brand palette as TS constants. Mirrors the `brand.*` tokens in
 * `tailwind.config.ts` and the CSS variables in `src/index.css`.
 *
 * Use these constants for non-CSS contexts where Tailwind utilities don't
 * reach — MapLibre source/layer paint specs, marker DOM elements, etc.
 * When the palette is swapped, update both this file and the Tailwind config.
 */
export const brand = {
  deep: "#070B16",
  navy: "#0C1226",
  surface: "#131B33",
  muted: "#1C2542",
  text: "#E7EDF8",
  subtle: "#94A3C7",
  green: "#10B981",
  cyan: "#2DD4BF",
  purple: "#818CF8",
  amber: "#F59E0B",
  danger: "#F87171",
} as const;

/** Pretty-print a campus node label. e.g. "main_block" -> "Main Block". */
export function prettyLabel(label: string): string {
  return label
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
