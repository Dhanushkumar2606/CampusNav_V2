import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand palette — premium dark-navy + emerald/teal, defined as HSL
        // CSS variables (src/index.css) with dark values on `:root` and
        // light overrides under `.light`, so every `brand.*` utility flips
        // with the theme. Keep in sync with `src/index.css` and the JS
        // mirror in `src/lib/brand.ts` (used by MapLibre paint specs, which
        // stay on the dark palette by design).
        brand: {
          deep: "hsl(var(--brand-deep) / <alpha-value>)",
          navy: "hsl(var(--brand-navy) / <alpha-value>)",
          surface: "hsl(var(--brand-surface) / <alpha-value>)",
          muted: "hsl(var(--brand-muted) / <alpha-value>)",
          text: "hsl(var(--brand-text) / <alpha-value>)",
          subtle: "hsl(var(--brand-subtle) / <alpha-value>)",
          green: "hsl(var(--brand-green) / <alpha-value>)",
          cyan: "hsl(var(--brand-cyan) / <alpha-value>)",
          purple: "hsl(var(--brand-purple) / <alpha-value>)",
          amber: "hsl(var(--brand-amber) / <alpha-value>)",
          warning: "hsl(var(--brand-amber) / <alpha-value>)",
          danger: "hsl(var(--brand-danger) / <alpha-value>)",
        },
        // shadcn CSS variable bridge so shadcn components render against
        // the active theme (dark navy by default, near-white on `.light`).
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        secondary: "hsl(var(--secondary))",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        accent: "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        popover: "hsl(var(--popover))",
        "popover-foreground": "hsl(var(--popover-foreground))",
        destructive: "hsl(var(--destructive))",
        "destructive-foreground": "hsl(var(--destructive-foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(3,6,16,0.5), 0 8px 24px -12px rgba(3,6,16,0.8)",
        float: "0 8px 24px -6px rgba(3,6,16,0.7), 0 2px 8px rgba(3,6,16,0.5)",
        glow: "0 0 20px -4px rgba(16,185,129,0.45)",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(16,185,129,0.25)" },
          "50%": { boxShadow: "0 0 20px 4px rgba(16,185,129,0.35)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 2.5s ease-in-out infinite",
        shimmer: "shimmer 1.4s linear infinite",
        "fade-in": "fade-in 200ms ease-out",
        "toast-in": "toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
