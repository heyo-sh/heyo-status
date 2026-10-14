"use client";

import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import type { StatusColors, StatusMode } from "../types";
import { DEFAULT_STATUS_THEME_STORAGE_KEY } from "./script";

export { DEFAULT_STATUS_THEME_STORAGE_KEY } from "./script";
export type ResolvedStatusMode = Exclude<StatusMode, "system">;

interface StatusThemeContextValue {
  theme: StatusMode;
  resolvedTheme: ResolvedStatusMode;
  mounted: boolean;
  setTheme(theme: StatusMode): void;
  toggleTheme(): void;
}

const StatusThemeContext = createContext<StatusThemeContextValue | undefined>(
  undefined,
);

function resolveTheme(theme: StatusMode): ResolvedStatusMode {
  return theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : theme;
}

/**
 * heyo-ui tokens resolve both palettes with `light-dark()`, which reads
 * `color-scheme`; `[data-mode]` is what sets it. Writing the attribute is the
 * whole switch, and removing it in system mode hands the decision back to the
 * operating system instead of freezing today's preference into the document.
 */
function applyTheme(theme: StatusMode): ResolvedStatusMode {
  const resolvedTheme = resolveTheme(theme);
  const root = window.document.documentElement;
  if (theme === "system") root.removeAttribute("data-mode");
  else root.setAttribute("data-mode", theme);
  return resolvedTheme;
}

/**
 * Owns the persisted colour-mode preference. It is deliberately independent of
 * framework routing so it can be mounted in React Router, Next, and Astro.
 */
export function StatusThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = DEFAULT_STATUS_THEME_STORAGE_KEY,
}: {
  children: ReactNode;
  defaultTheme?: StatusMode;
  storageKey?: string;
}) {
  const [theme, setThemeState] = useState<StatusMode>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] =
    useState<ResolvedStatusMode>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let storedTheme = defaultTheme;
    try {
      const value = window.localStorage.getItem(storageKey);
      if (isStatusMode(value)) storedTheme = value;
    } catch {
      // A disabled storage implementation must not prevent theme switching.
    }

    setThemeState(storedTheme);
    setResolvedTheme(applyTheme(storedTheme));

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMediaChange = () => {
      try {
        if (window.localStorage.getItem(storageKey) === "system") {
          setResolvedTheme(applyTheme("system"));
        }
      } catch {
        if (storedTheme === "system") setResolvedTheme(applyTheme("system"));
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKey) return;
      try {
        const value = window.localStorage.getItem(storageKey);
        if (!isStatusMode(value)) return;
        setThemeState(value);
        setResolvedTheme(applyTheme(value));
      } catch {
        // Ignore changes from tabs where localStorage is unavailable.
      }
    };

    media.addEventListener("change", onMediaChange);
    window.addEventListener("storage", onStorage);
    setMounted(true);
    return () => {
      media.removeEventListener("change", onMediaChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [defaultTheme, storageKey]);

  const setTheme = useCallback(
    (nextTheme: StatusMode) => {
      setThemeState(nextTheme);
      setResolvedTheme(applyTheme(nextTheme));
      try {
        window.localStorage.setItem(storageKey, nextTheme);
      } catch {
        // The in-memory preference still applies to the current page.
      }
    },
    [storageKey],
  );

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  return (
    <StatusThemeContext.Provider
      value={{ theme, resolvedTheme, mounted, setTheme, toggleTheme }}
    >
      {children}
    </StatusThemeContext.Provider>
  );
}

/** Returns the active theme context or throws when no provider was mounted. */
export function useStatusTheme(): StatusThemeContextValue {
  const value = useContext(StatusThemeContext);
  if (!value) {
    throw new Error(
      "useStatusTheme must be used inside a Heyo Status StatusThemeProvider.",
    );
  }
  return value;
}

/**
 * Applies configured colour overrides as heyo-ui tokens, scoped to the status
 * page so an embedding application keeps its own brand.
 *
 * `primary` drives the solid brand surface (buttons, links, the live dot) and
 * `secondary` its soft tint (badges, highlighted rows). Only those two move:
 * every surface, edge and status colour still comes from heyo-ui, so an
 * override can never produce unreadable text on an unexpected background.
 */
export function StatusThemeTokens({
  children,
  colors = {},
}: {
  children: ReactNode;
  colors?: StatusColors;
}) {
  const style = {
    ...(colors.primary
      ? {
          "--color-heyo-brand": colors.primary,
          "--color-heyo-brand-hover": colors.primary,
        }
      : {}),
    ...(colors.secondary
      ? { "--color-heyo-brand-tint": colors.secondary }
      : {}),
  } as CSSProperties;

  return (
    <div
      className="heyo-status-theme-tokens font-sans text-heyo-default"
      style={style}
    >
      {children}
    </div>
  );
}

function isStatusMode(value: unknown): value is StatusMode {
  return value === "light" || value === "dark" || value === "system";
}
