import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";

type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** True once the user has picked a theme locally (toggle or stored preference). */
  hasUserChosenTheme: () => boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("theme") as Theme | null;
      if (stored) return stored;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  });

  // A stored theme is the user's own choice; the server-persisted preference
  // may only seed the theme when no local choice exists yet. Otherwise
  // navigating to Profile would re-apply the (possibly stale) saved
  // preference and clobber the theme the user just picked.
  const userChosen = useRef(
    typeof window !== "undefined" && localStorage.getItem("theme") !== null
  );
  const themeRef = useRef(theme);

  useEffect(() => {
    themeRef.current = theme;
    // `:root` carries the dark palette; `.light` overrides it. No `dark`
    // class needed — this also means components never pair `dark:`-variant
    // classes with the brand tokens.
    const root = window.document.documentElement;
    root.classList.toggle("light", theme === "light");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const setTheme = (next: Theme) => {
    if (next !== themeRef.current) userChosen.current = true;
    setThemeState(next);
  };

  const toggleTheme = () => setTheme(themeRef.current === "dark" ? "light" : "dark");

  const hasUserChosenTheme = () => userChosen.current;

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, hasUserChosenTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
