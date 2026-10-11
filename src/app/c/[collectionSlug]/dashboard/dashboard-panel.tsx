"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import {
  DASHBOARD_SECTIONS,
  isEmptyGroup,
  remainingCount,
  sectionTotal,
  type DashboardGroup,
  type DashboardSectionSpec,
} from "@/lib/dashboard-rules";
import { formatInstant, formatRelative } from "../auctions/auction-format";
import { sectionTintForHref } from "../nav-sections";
import { Tooltip } from "../shared/tooltip";
import { useDashboardSection } from "./use-dashboard-query";

/**
 * The operational Dashboard (#1808; ADR-0067): the work waiting on the collector, five sections in a
 * grid across the full width. A section is groups, a group is a count and its rows, and **every row
 * links to the screen where the thing is dealt with** — nothing is acted on here, the bell's rule
 * (#367): an action taken away from its screen is taken without the context that makes it right.
 *
 * An empty group stays on screen, collapsed to its title and a zero, so a quiet dashboard reads as
 * *nothing to do* rather than *nothing loaded*.
 */

const GRID_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(24rem, 1fr))",
  gap: "1rem",
  alignItems: "start",
};

const CARD_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  minHeight: "10rem",
  padding: "1rem 1.25rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
};

const NOTE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

export function DashboardPanel({
  collectionId,
  collectionSlug,
}: {
  collectionId: string;
  collectionSlug: string;
}) {
  const base = `/c/${collectionSlug}`;
  // One clock for the screen, taken at render, so two rows never read their times apart.
  const now = new Date();
  return (
    <div style={GRID_STYLE}>
      {DASHBOARD_SECTIONS.map((spec) => (
        <SectionCard
          key={spec.id}
          spec={spec}
          collectionId={collectionId}
          base={base}
          now={now}
        />
      ))}
    </div>
  );
}

function SectionCard({
  spec,
  collectionId,
  base,
  now,
}: {
  spec: DashboardSectionSpec;
  collectionId: string;
  base: string;
  now: Date;
}) {
  const query = useDashboardSection(collectionId, spec.id);
  // The colour the sidebar already gives the screen this work is done on (#762) — read off the
  // section's link, so a screen moving section re-tints its card with it.
  const hue = sectionTintForHref(`${base}/${spec.href}`, base);
  const tint = hue ? `var(--color-tag-${hue})` : "var(--color-accent)";
  const section = query.data;

  return (
    <section style={{ ...CARD_STYLE, borderTop: `3px solid ${tint}` }} aria-label={spec.title}>
      <header style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>
          <Link href={`${base}/${spec.href}`} style={{ color: tint, textDecoration: "none" }}>
            {spec.title}
          </Link>
        </h3>
        {section && section.groups.length > 0 && (
          <span
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--color-text-secondary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {sectionTotal(section)}
          </span>
        )}
      </header>

      {section ? (
        section.groups.length === 0 ? (
          // A section whose groups have not been built yet (#1809–#1813) — said in words, never as a
          // zero, which would claim there is nothing to do.
          <p style={NOTE_STYLE}>No groups here yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {section.groups.map((group) => (
              <Group key={group.id} group={group} base={base} now={now} tint={tint} />
            ))}
          </div>
        )
      ) : query.isError ? (
        <p style={NOTE_STYLE}>This section could not be loaded.</p>
      ) : (
        <SectionSkeleton />
      )}
    </section>
  );
}

/** The card's final geometry with nothing in it, so groups appearing shift nothing (#151). */
function SectionSkeleton() {
  return (
    <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {["9rem", "14rem", "12rem"].map((width) => (
        <span
          key={width}
          style={{
            display: "inline-block",
            width,
            height: "0.8125rem",
            borderRadius: "0.25rem",
            background: "var(--color-border)",
          }}
        />
      ))}
    </div>
  );
}

const GROUP_HEADING: CSSProperties = {
  margin: 0,
  fontSize: "0.75rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const GROUP_COUNT: CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
};

function Group({
  group,
  base,
  now,
  tint,
}: {
  group: DashboardGroup;
  base: string;
  now: Date;
  tint: string;
}) {
  if (isEmptyGroup(group)) {
    // Collapsed to one muted line: the zero says the group was looked at and holds nothing.
    return (
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.5rem",
          color: "var(--color-text-muted)",
        }}
      >
        <h4 style={{ ...GROUP_HEADING, fontWeight: 600 }}>{group.title}</h4>
        <span style={GROUP_COUNT}>0</span>
      </div>
    );
  }

  const rest = remainingCount(group);
  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.25rem" }}>
        <h4 style={{ ...GROUP_HEADING, color: "var(--color-text-secondary)" }}>
          <Link href={`${base}/${group.href}`} style={{ color: "inherit", textDecoration: "none" }}>
            {group.title}
          </Link>
        </h4>
        <span style={{ ...GROUP_COUNT, color: tint }}>{group.count}</span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
          borderLeft: `2px solid ${tint}`,
          paddingLeft: "0.375rem",
          marginLeft: "0.125rem",
        }}
      >
        {group.items.map((item) => (
          <Link
            key={item.key}
            href={`${base}/${item.href}`}
            style={{
              display: "block",
              padding: "0.375rem 0.5rem",
              borderRadius: "0.375rem",
              textDecoration: "none",
              color: "var(--color-text-primary)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--color-bg-row-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              // Repeats a string already on screen but ellipsized — the one case `title` survives (#291).
              title={item.label}
            >
              {item.label}
            </span>
            {(item.detail || item.at) && (
              <span style={{ display: "block", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                {item.detail}
                {item.at && (
                  <>
                    {item.detail ? " · " : null}
                    <Tooltip content={formatInstant(item.at)}>{formatRelative(item.at, now)}</Tooltip>
                  </>
                )}
              </span>
            )}
          </Link>
        ))}
      </div>
      {rest > 0 && (
        <Link
          href={`${base}/${group.href}`}
          style={{
            display: "block",
            padding: "0.3rem 0.5rem",
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "var(--color-accent)",
            textDecoration: "none",
          }}
        >
          {rest} more →
        </Link>
      )}
    </section>
  );
}
