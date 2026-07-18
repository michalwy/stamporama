# 0005 — next-themes for Light/Dark Theme Switching

**Status:** Accepted  
**Date:** 2026-07-18

## Context

The app uses semantic color tokens in `globals.css`. To support light and dark themes with user preference (Light / Dark / Auto), the app needs class-based theme switching, localStorage persistence, and flash-free initial paint.

## Decision

Use [next-themes](https://github.com/pacocoursey/next-themes) with `attribute="class"` and `defaultTheme="system"`.

- Dark token values defined under `.dark` in `globals.css`.
- `ThemeProvider` wraps the app at the root layout level.
- Three modes: Light, Dark, Auto (follows OS `prefers-color-scheme`).
- Choice persisted in `localStorage` automatically by next-themes.
- The injected inline script prevents flash of wrong theme on load.

## Alternatives Considered

- **Manual implementation**: a custom script + React context could replicate the behavior, but next-themes handles edge cases (SSR hydration, system listener cleanup, script injection) with zero configuration.
- **Tailwind `darkMode: "class"`**: Tailwind's built-in dark variant works with utility classes, but the app uses CSS custom properties for theming, not Tailwind utilities. The class-based approach via next-themes toggles the `.dark` class that our token overrides target.

## Consequences

- next-themes is a small, focused dependency (~2 kB) with wide Next.js adoption.
- `suppressHydrationWarning` is required on `<html>` because next-themes injects a class before React hydrates.
- Adding new semantic tokens requires defining values in both the `:root` and `.dark` blocks.
