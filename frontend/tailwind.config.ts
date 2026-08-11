import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand palette — premium dark-navy + emerald/teal. Kept under the
        // `brand.*` namespace so existing components keep compiling; swap
        // values here, in `src/index.css`, and in `src/lib/brand.ts`
        // (the non-CSS mirror used by MapLibre paint specs).
        brand: {
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
        },
        // shadcn CSS variable bridge so the button (and any future
        // shadcn components) renders against our dark navy by default.
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
