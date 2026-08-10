"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// Shared chrome for the full detail screens (#517/#518/#519) — a copy, a stamp, an Issue. The
// three pages answer different questions but read as one screen: the same back link, the same
// card, the same label/value grid. Presentational only: no data fetching, no page knowledge.

const CARD: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem 1.25rem 1.25rem",
};

/** "← Back to copies" — the way out of a detail screen, in every list's own words. */
export function DetailBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{
        fontSize: "0.8125rem",
        color: "var(--color-text-secondary)",
        textDecoration: "none",
        marginBottom: "0.75rem",
      }}
    >
      ← {label}
    </Link>
  );
}

/**
 * One section of a detail screen. `actions` sits on the heading row — that is where a card's
 * *own* control belongs (open the full price breakdown, jump to the list this card summarises),
 * never in a page-level toolbar that would say nothing about which card it acts on.
 *
 * `breakInside: avoid` is what keeps a card whole inside {@link DetailMasonry}; it costs nothing
 * on a card placed outside one.
 */
export function DetailCard({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  /** Shown beside the title as a muted figure, for a card that holds a list. */
  count?: number | string | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ ...CARD, breakInside: "avoid" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "0.8125rem",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--color-text-secondary)",
          }}
        >
          {title}
          {count != null && count !== "" && (
            <span style={{ marginLeft: "0.5rem", fontWeight: 500, color: "var(--color-text-muted)" }}>
              {count}
            </span>
          )}
        </h2>
        {actions && <div style={{ display: "flex", gap: "0.5rem" }}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Label-above-value grid. Auto-fills, so a card with four fields and one with twelve line up. */
export function FieldGrid({ children, min = "12rem" }: { children: ReactNode; min?: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))`,
        gap: "0.75rem 1.5rem",
      }}
    >
      {children}
    </div>
  );
}

/** One label/value pair. A blank value reads as an em dash rather than as an empty row — the
 *  field is part of the record whether or not it is filled in. */
export function Field({ label, children }: { label: string; children?: ReactNode }) {
  const empty = children == null || children === "" || children === false;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: 0 }}>
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          letterSpacing: "0.03em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "0.875rem",
          color: empty ? "var(--color-text-muted)" : "var(--color-text-primary)",
          overflowWrap: "anywhere",
        }}
      >
        {empty ? "—" : children}
      </span>
    </div>
  );
}

/** The sentence a card shows in place of its contents when there are none. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>{children}</div>
  );
}

/** The quiet button a card heading carries. Same shape as the offer detail's card buttons. */
export const DETAIL_BUTTON: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.25rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  textDecoration: "none",
};

/**
 * The page shell: a stack of full-width bands. Everything that is *not* a dashboard of cards —
 * the identity line, the state chips, a card holding a list too wide to sit in a column — is a
 * band of its own; the cards go inside a {@link DetailMasonry}.
 */
export function DetailLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>{children}</div>
  );
}

/** A band across the whole width — the identity line, the state chips, a full-width card. */
export function DetailFullRow({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return <div style={style}>{children}</div>;
}

/**
 * The dashboard: two columns, each holding the cards the screen puts in it.
 *
 * **Which card sits where is the screen's decision, not the layout's.** An earlier version packed
 * the cards automatically (CSS multi-column, which balances column heights and so cannot leave the
 * holes a grid's rows do); it filled the space, but it decided the order, and the pairings that
 * make these screens readable — an issue's stamp tree beside its completeness grid, a copy's
 * physical facts beside its trade history — are not something a height-balancing algorithm knows
 * about. So the columns are explicit and each screen states its own two lists.
 *
 * The consequence is that the two columns end at different heights, and that is accepted: the
 * alternative is either a hole between cards or a reading order nobody chose. Keeping the taller
 * column's tail short is what the ordering is for.
 *
 * `auto-fit` over a minimum width is what makes a narrow window fall back to one column — the two
 * lists then simply run one after the other, which is why the left column carries what the screen
 * is *about* and the right what it *relates to*. It is not a breakpoint; this app has none, being
 * desktop-only.
 */
export function DetailColumns({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(30rem, 1fr))",
        alignItems: "start",
        gap: "1rem",
      }}
    >
      {children}
    </div>
  );
}

/** One column of the dashboard — a stack of cards in the order the screen lists them. */
export function DetailColumn({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>
      {children}
    </div>
  );
}
