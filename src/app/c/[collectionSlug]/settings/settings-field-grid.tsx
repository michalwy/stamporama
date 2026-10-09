"use client";

import type { ReactNode } from "react";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { formControl } from "@/app/control-style";

/** The narrowest a card may get before the grid drops a column. */
const CARD_MIN_WIDTH = "18rem";
const GRID_GAP = "1.25rem";

/**
 * The **grid of fields** — one of the three body shapes a Settings page is built from (#1473;
 * ADR-0059 §5), for the plain forms: Collection, Photos & storage, Bid recommendation, Duplicate
 * numbers.
 *
 * The page takes the window's width, and the cards share it **two or three to a row**: `auto-fill`
 * over a minimum that is never less than a third of the row, so a wide window gets three columns
 * and never a fourth, and a narrower one falls back to two. What #691 still asks for — a single
 * field never stretched across the window — holds because every control sits inside a card, and a
 * card is at most a third or a half of the row.
 */
export function SettingsFieldGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(max(${CARD_MIN_WIDTH}, (100% - 2 * ${GRID_GAP}) / 3), 1fr))`,
        gap: GRID_GAP,
        alignItems: "stretch",
      }}
    >
      {children}
    </div>
  );
}

interface SettingsFieldCardProps {
  label: string;
  /** One short line under the label (#1460) — only where the label and the value do not say it. */
  hint?: ReactNode;
  /** The longer explanation, behind an ⓘ beside the label; the user guide has the rest. */
  tooltip?: ReactNode;
  /** The control, or the figure a read-only card shows. */
  children: ReactNode;
  /** What the control resolves to, in words — a line under it, not a second hint. */
  status?: ReactNode;
  error?: string | null;
}

/**
 * One card of the grid: a label, a short hint line, the control, and under it what the control
 * currently means and any error. The hint is one line at most (#1460); a longer explanation goes
 * behind the ⓘ and into the user guide.
 */
export function SettingsFieldCard({
  label,
  hint,
  tooltip,
  children,
  status,
  error,
}: SettingsFieldCardProps) {
  return (
    <section
      aria-label={label}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        minWidth: 0,
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        padding: "1.125rem 1.25rem",
        background: "var(--color-bg-elevated)",
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.9375rem",
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            {label}
          </p>
          {tooltip && (
            <Tooltip content={tooltip} maxWidth="24rem">
              <span
                role="img"
                aria-label={`About ${label}`}
                style={{ display: "inline-flex", color: "var(--color-text-muted)", cursor: "help" }}
              >
                <Icon name="info" />
              </span>
            </Tooltip>
          )}
        </div>
        {hint && (
          <p
            style={{
              margin: "0.25rem 0 0",
              fontSize: "0.8125rem",
              color: "var(--color-text-muted)",
            }}
          >
            {hint}
          </p>
        )}
      </div>

      {/* The control sits at the card's foot, so a row of cards lines its controls up whatever
          their hints' length. */}
      <div style={{ marginTop: "auto" }}>{children}</div>

      {status && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          {status}
        </p>
      )}
      {error && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-error)" }}>{error}</p>
      )}
    </section>
  );
}

/** A select inside a card: as wide as its card allows, never wider. */
export const SETTINGS_FIELD_SELECT_STYLE: React.CSSProperties = {
  ...formControl,
  maxWidth: "100%",
  padding: "0.4rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

/** A short number field inside a card. */
export const SETTINGS_FIELD_NUMBER_STYLE: React.CSSProperties = {
  ...formControl,
  width: "5rem",
  padding: "0.4rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};
