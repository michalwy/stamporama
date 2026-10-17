import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/app/icons";
import { phoneRow } from "@/app/phone-screen";
import { phoneBrowseAreaPath, phoneBrowseYearPath } from "@/lib/phone";
import { phoneIssueCountText, phoneYearLabel } from "@/lib/phone-browse-view";
import type { PhoneBrowseLevel } from "@/lib/phone-browse";

// The pieces the browse screens share (#2005): a row that opens the next level, a section heading,
// the plain sentence an empty level says, and one area level — the top one and an area's both.
// No `"use client"`: every browse screen is a server page.

export const BROWSE_SECTION_TITLE: CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  fontWeight: 700,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

export const BROWSE_MUTED: CSSProperties = {
  margin: 0,
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

export const BROWSE_LIST: CSSProperties = { display: "flex", flexDirection: "column", gap: "0.5rem" };

/** A row that goes one level down: what it is, what is under it, and the chevron that says so. */
export function BrowseRow({
  href,
  label,
  detail,
  children,
}: {
  href: string;
  label: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <Link href={href} style={phoneRow}>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        <span style={{ overflowWrap: "anywhere" }}>{label}</span>
        {detail && <span style={{ ...BROWSE_MUTED, fontWeight: 400 }}>{detail}</span>}
        {children}
      </span>
      <Icon name="next" size="lg" />
    </Link>
  );
}

/** The line above a level's rows — where in the tree this is, outermost first. */
export function BrowseTrail({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return <p style={BROWSE_MUTED}>{names.join(" › ")}</p>;
}

/**
 * One level of the area tree: its sub-areas, then the years of its own issues. A level with neither
 * says so in a sentence rather than showing nothing.
 */
export function BrowseAreaLevel({
  collectionSlug,
  level,
}: {
  collectionSlug: string;
  level: PhoneBrowseLevel;
}) {
  const { area, children, years } = level;
  if (children.length === 0 && years.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)" }}>
        {area
          ? `Nothing is filed under ${area.name} — it has no sub-areas and no issues.`
          : "No areas yet — areas are set up in the full app."}
      </p>
    );
  }
  return (
    <>
      {children.length > 0 && (
        <section style={BROWSE_LIST}>
          {area && <h2 style={BROWSE_SECTION_TITLE}>Sub-areas</h2>}
          {children.map((child) => (
            <BrowseRow
              key={child.id}
              href={phoneBrowseAreaPath(collectionSlug, child.id)}
              label={child.name}
              detail={phoneIssueCountText(child.issueCount)}
            />
          ))}
        </section>
      )}
      {area && years.length > 0 && (
        <section style={BROWSE_LIST}>
          <h2 style={BROWSE_SECTION_TITLE}>
            {children.length > 0 ? `Issues of ${area.name} itself, by year` : "Years"}
          </h2>
          {years.map((y) => (
            <BrowseRow
              key={y.year ?? "none"}
              href={phoneBrowseYearPath(collectionSlug, area.id, y.year)}
              label={phoneYearLabel(y.year)}
              detail={phoneIssueCountText(y.count)}
            />
          ))}
        </section>
      )}
    </>
  );
}
