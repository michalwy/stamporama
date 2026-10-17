import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { baseBtn } from "@/app/button-style";
import { Icon } from "@/app/icons";

/**
 * The frame every phone screen is drawn in (#2002, ADR-0072) — the phone's counterpart of `Screen`,
 * which stays the frame of every desktop screen.
 *
 * A phone screen is **phone-only**: drawn at the phone's width, without the desktop sidebar, its
 * controls sized for a thumb. Opened on a desk it keeps that width, centred, rather than gaining a
 * desktop layout — there is no breakpoint anywhere in the app, and this does not add one.
 *
 * The header carries the screen's title and **the link to the full app**, so no phone screen can be
 * without the way back to the desk (ADR-0072 §3). Each screen names where that link goes — the desk's
 * counterpart of what is on the phone, or the collection's start when there is none.
 *
 * Its own module, without `"use client"`, so a server page and a client screen can both use it;
 * `tests/unit/screen-frame.test.ts` holds every page under `phone/` to it.
 */

/** A thumb's target (#2002): every control on a phone screen is at least this tall. */
export const PHONE_TAP_TARGET = "3rem";

/** The width a phone screen is drawn at — a phone's, and no wider when opened on a desk. */
export const PHONE_SCREEN_WIDTH = "30rem";

/**
 * A full-width row a thumb opens — an entry on the start screen, a collection in the list. A link
 * styled once here so the phone screens that follow draw their lists the same way.
 */
export const phoneRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  minHeight: PHONE_TAP_TARGET,
  padding: "0.75rem 1rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "1rem",
  fontWeight: 500,
  textDecoration: "none",
  boxSizing: "border-box",
};

/**
 * A phone screen's button: the one button shape (`baseBtn`), a thumb's height and the phone's type
 * size. The colours are the caller's, as on every `baseBtn`.
 */
export const phoneButton: CSSProperties = {
  ...baseBtn,
  minHeight: PHONE_TAP_TARGET,
  fontSize: "1rem",
};

interface PhoneScreenProps {
  /** The screen's heading, in the header beside the link to the full app. */
  title: string;
  /** Where *Full app* goes: the desk's screen for the same thing. */
  fullAppHref: string;
  children: ReactNode;
}

export function PhoneScreen({ title, fullAppHref, children }: PhoneScreenProps) {
  return (
    <div style={{ minHeight: "100dvh", background: "var(--color-bg-page)" }}>
      <div
        style={{
          maxWidth: PHONE_SCREEN_WIDTH,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          minHeight: "100dvh",
        }}
      >
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.5rem 0.5rem 0.5rem 1rem",
            paddingTop: "max(0.5rem, env(safe-area-inset-top))",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-bg-elevated)",
          }}
        >
          <h1
            style={{
              flex: 1,
              minWidth: 0,
              margin: 0,
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </h1>
          <Link
            href={fullAppHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              minHeight: PHONE_TAP_TARGET,
              padding: "0 0.75rem",
              borderRadius: "0.5rem",
              color: "var(--color-accent)",
              fontSize: "0.9375rem",
              fontWeight: 500,
              textDecoration: "none",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <Icon name="desk" />
            Full app
          </Link>
        </header>
        <main
          style={{
            flex: 1,
            padding: "1rem",
            paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
