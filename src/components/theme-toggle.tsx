"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const options = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Auto" },
] as const;

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!mounted) return <div style={{ height: "2rem" }} />;

  return (
    <div
      style={{
        display: "inline-flex",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-border)",
        overflow: "hidden",
      }}
    >
      {options.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          style={{
            padding: "0.25rem 0.625rem",
            fontSize: "0.75rem",
            fontWeight: 500,
            cursor: "pointer",
            border: "none",
            background:
              theme === value
                ? "var(--color-accent)"
                : "var(--color-bg-elevated)",
            color:
              theme === value
                ? "#ffffff"
                : "var(--color-text-muted)",
            transition: "background 0.15s, color 0.15s",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
