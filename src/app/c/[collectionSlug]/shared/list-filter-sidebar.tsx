"use client";

import type { CollectionAreaData } from "@/lib/areas";
import { AreaFilterSidebar } from "./area-filter-sidebar";
import { YearFilterPanel, type YearFacet } from "./year-filter-panel";

interface ListFilterSidebarProps {
  // ── Area tree ──
  areas: CollectionAreaData[];
  filterAreaId: string | null;
  onNavigateArea: (areaId: string | null) => void;

  // ── Year filter ──
  /** null represents "no facets loaded yet". */
  yearFacets: YearFacet[] | undefined;
  yearsLoading: boolean;
  /** Active year: a numeric string, "none" (no-year bucket), or null when unset. */
  selectedYear: string | null;
  onSelectYear: (year: string | null) => void;

  /** "page" (default): panels manage their own full-height / sticky layout.
   *  "dialog": each panel is wrapped in a bounded scroll box so long trees scroll
   *  inside a constrained dialog rather than against the viewport. */
  variant?: "page" | "dialog";
}

/**
 * The shared left filter rail for every list screen (issues, stamps, inventory)
 * and the inventory stamp picker: the area tree plus the year filter, side by
 * side. Composing them here means a new filter panel is added in one place and
 * appears on every list automatically — callers render a single element and only
 * supply the data + selection wiring, which differs per list (server-side facets
 * for the lists, client-side for the picker).
 */
export function ListFilterSidebar({
  areas,
  filterAreaId,
  onNavigateArea,
  yearFacets,
  yearsLoading,
  selectedYear,
  onSelectYear,
  variant = "page",
}: ListFilterSidebarProps) {
  const area = (
    <AreaFilterSidebar
      areas={areas}
      filterAreaId={filterAreaId}
      onNavigate={onNavigateArea}
    />
  );
  const years = (
    <YearFilterPanel
      facets={yearFacets}
      isLoading={yearsLoading}
      selectedYear={selectedYear}
      onSelect={onSelectYear}
    />
  );

  if (variant === "dialog") {
    // The panels are authored for the page (sticky, max-height: 100vh); in a
    // constrained dialog, wrap each so its contents scroll within the dialog.
    // `display: flex` makes the wrapper stretch its panel to full height (a plain
    // block wrapper would leave the panel — and its dividing border — only as tall
    // as its content), matching the page layout where the panel is a direct flex
    // child of the row.
    const wrap: React.CSSProperties = {
      height: "100%",
      overflowY: "auto",
      flexShrink: 0,
      display: "flex",
    };
    return (
      <>
        <div style={wrap}>{area}</div>
        <div style={wrap}>{years}</div>
      </>
    );
  }

  return (
    <>
      {area}
      {years}
    </>
  );
}
