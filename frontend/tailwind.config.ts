import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand palette — placeholder values, swap via BRANDING.md
        // once the real DK palette is finalized.
        brand: {
          navy: "#0A0E27",
          deep: "#060920",
          green: "#39FF14",
          cyan: "#00E5FF",
          purple: "#B026FF",
          muted: "#1A1F3A",
          text: "#E6EAF2",
          subtle: "#8A92B2",
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
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(57,255,20,0.4)" },
          "50%": { boxShadow: "0 0 24px 4px rgba(57,255,20,0.5)" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 2.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
