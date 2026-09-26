"use client";

import Link from "next/link";
import { useCallback, useMemo, type CSSProperties, type MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { StampSubtypeData } from "@/lib/subtypes";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import {
  DEFAULT_ROW_DIMENSION,
  NOT_FILED,
  STEPS_PARAM,
  STRUCTURE_DIMENSIONS,
  STRUCTURE_DIMENSION_LABEL,
  decodeSteps,
  encodeSteps,
  isStructureDimension,
  stepBackUpdates,
  type StructureDimension,
  type StructureHeading,
} from "@/lib/collection-structure-rules";
import {
  COPIES_LIST_RAIL_KEYS,
  copiesListAreaId,
  copiesListDecade,
  copiesListQueryParams,
  copiesListRailYear,
} from "@/lib/copies-list-url";
import { NO_AREA } from "@/lib/list-area-year-filter";
import { asMultiStampFilter } from "@/lib/multi-stamp";
import { DEFAULT_TAG_FILTER_MODE, isTagFilterMode } from "@/lib/tag-filter";
import { buildLocationTree } from "@/app/location-tree-select";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { ListToolbar } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { DISPOSITION_FILTERS, REMEMBERED_FILTER_KEYS, exactCopiesListHref } from "../copies-list-filters";
import { CopiesFilterControls, NO_SHRINK, SPARE_FILTERS } from "../copies-filter-controls";
import {
  useCollectionStructure,
  useStructureAreaFacets,
  useStructureYearFacets,
} from "./use-structure-query";

/**
 * The collection structure screen (#1401; ADR-0056): the copies the Copies list would show, counted
 * along one of the collection's dimensions or two crossed, with a drill-down.
 *
 * **It states counts and never lists a copy** — that is the Copies list's job, and the rule that
 * keeps this screen from becoming a second one (ADR-0056 amends #397 on exactly that condition).
 * Clicking a heading or a cell narrows the screen to it; the count itself is a link to the Copies
 * list under exactly the filters that produce it.
 *
 * **Everything is in the address, under the Copies list's own names**: the bar's filters, the rail's
 * area and year, the two dimensions and the drill-down steps. Nothing is remembered, so the screen
 * opened from the holdings tile shows what the tile counts, and a view can be bookmarked and walked
 * back through. A drill-down step *is* a filter — it writes the same parameters the bar does — and
 * the steps are only the breadcrumb that knows how to undo them.
 */

/** Every parameter the screen narrows by: the Copies list's remembered set, the rail and the search. */
const FILTER_KEYS: readonly string[] = [...REMEMBERED_FILTER_KEYS, ...COPIES_LIST_RAIL_KEYS];

const DIMENSION_PARAMS = { rows: "rows", columns: "cols" } as const;

function csv(raw: string | null): string[] {
  return raw ? raw.split(",").filter(Boolean) : [];
}

// ── Styles ───────────────────────────────────────────────────────────────────

const CARD_STYLE: CSSProperties = {
  display: "flex",
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  overflow: "clip",
  flex: 1,
  minHeight: "24rem",
  background: "var(--color-bg-elevated)",
};

const MAIN_STYLE: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  borderLeft: "1px solid var(--color-border)",
};

const BODY_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
  padding: "1rem 1.25rem 1.5rem",
};

const CONTROLS_ROW: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
};

const LABEL_STYLE: CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const CRUMB_BUTTON: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: "0.875rem",
  color: "var(--color-accent)",
  textDecoration: "underline",
  textUnderlineOffset: "0.2em",
};

const CRUMB_CURRENT: CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

const TABLE_STYLE: CSSProperties = {
  borderCollapse: "collapse",
  fontSize: "0.8125rem",
  fontVariantNumeric: "tabular-nums",
  width: "max-content",
  minWidth: "20rem",
};

const CELL: CSSProperties = {
  padding: "0.4rem 0.75rem",
  borderBottom: "1px solid var(--color-border)",
  textAlign: "right",
};

const HEADING_CELL: CSSProperties = {
  ...CELL,
  textAlign: "left",
  fontWeight: 400,
};

const TOTAL_CELL: CSSProperties = {
  ...CELL,
  fontWeight: 600,
  borderLeft: "1px solid var(--color-border)",
};

const FOOT_CELL: CSSProperties = {
  ...CELL,
  fontWeight: 600,
  borderBottom: "none",
  borderTop: "2px solid var(--color-border-strong)",
};

const DRILL_BUTTON: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  font: "inherit",
  color: "var(--color-text-primary)",
  textAlign: "left",
};

const COUNT_LINK: CSSProperties = {
  color: "var(--color-accent)",
  textDecoration: "underline",
  textDecorationColor: "var(--color-border)",
  textUnderlineOffset: "0.2em",
};

const EMPTY_COUNT: CSSProperties = { color: "var(--color-text-muted)" };

const NOTE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  maxWidth: "48rem",
};

const MESSAGE_STYLE: CSSProperties = {
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

// ── Panel ────────────────────────────────────────────────────────────────────

interface StructurePanelProps {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  formats: StampFormatData[];
  subtypes: StampSubtypeData[];
}

export function StructurePanel({
  collectionId,
  collectionSlug,
  areas,
  locations,
  conditions,
  certificateStatuses,
  formats,
  subtypes,
}: StructurePanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const base = `/c/${collectionSlug}`;

  // The two subtree switches (#385) are browser preferences the Copies list reads too, so a count
  // here and the list its link opens resolve a picked area or location the same way.
  const [includeSubAreas] = useSubtreeScope("area");
  const [includeSubLocations, setIncludeSubLocations] = useSubtreeScope("location");

  const rowParam = searchParams.get(DIMENSION_PARAMS.rows);
  const rows: StructureDimension = isStructureDimension(rowParam) ? rowParam : DEFAULT_ROW_DIMENSION;
  const colParam = searchParams.get(DIMENSION_PARAMS.columns);
  const columns: StructureDimension | null =
    isStructureDimension(colParam) && colParam !== rows ? colParam : null;
  const steps = useMemo(() => decodeSteps(searchParams.get(STEPS_PARAM)), [searchParams]);

  // The bar's values, off the address alone.
  const search = searchParams.get("search") ?? "";
  const values = useMemo(() => {
    const read = (key: string) => searchParams.get(key);
    const rawTagMode = read("tagMode");
    return {
      conditionIds: csv(read("conditionIds")),
      certificateStatusIds: csv(read("certificateStatusIds")),
      formatIds: csv(read("formatIds")),
      subtypeIds: csv(read("subtypeIds")),
      deliveryStates: csv(read("deliveryStates")),
      tagIds: csv(read("tagIds")),
      tagMode: isTagFilterMode(rawTagMode) ? rawTagMode : DEFAULT_TAG_FILTER_MODE,
      locationId: read("locationId") ?? "",
      multiStamp: asMultiStampFilter(read("multiStamp")),
      activeDispositions: new Set(
        DISPOSITION_FILTERS.map((f) => f.key).filter((key) => read(key) === "true")
      ),
      spareFilters: new Set(SPARE_FILTERS.map((f) => f.key).filter((key) => read(key) === "true")),
    };
  }, [searchParams]);
  const areaId = copiesListAreaId(searchParams, areas);
  const railYear = copiesListRailYear(searchParams);
  const decade = copiesListDecade(searchParams);

  /** The one write funnel: every filter, dimension and step change is a navigation, so the back
   * button steps through the screen's states (#1401). */
  const update = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`${base}/inventory/structure${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, base, searchParams]
  );

  // ── Reads ──
  const catalogVendors = useMemo(() => {
    const seen = new Map<string, { id: string; abbreviation: string }>();
    for (const area of areas) {
      for (const entry of area.catalogEntries) {
        if (!seen.has(entry.catalogVendorId)) {
          seen.set(entry.catalogVendorId, {
            id: entry.catalogVendorId,
            abbreviation: entry.vendorAbbreviation,
          });
        }
      }
    }
    return [...seen.values()];
  }, [areas]);

  const structureQuery = useMemo(() => {
    const query = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value) query.set(key, value);
    }
    query.set("rows", rows);
    if (columns) query.set("cols", columns);
    query.set("includeSubAreas", String(includeSubAreas));
    query.set("includeSubLocations", String(includeSubLocations));
    query.sort();
    return query.toString();
  }, [searchParams, rows, columns, includeSubAreas, includeSubLocations]);
  const { data, isError } = useCollectionStructure(collectionId, structureQuery);

  // The rail's counts, from the Copies list's own facet routes under this screen's filters — the
  // year facets without the year, the area counts without the area, as the list's rail reads them.
  const { yearQuery, areaQuery } = useMemo(() => {
    const own = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value) own.set(key, value);
    }
    const listQuery = copiesListQueryParams(own, {
      areas,
      includeSubAreas,
      includeSubLocations,
      catalogVendors,
    });
    const years = new URLSearchParams(listQuery);
    years.delete("year");
    const areasOnly = new URLSearchParams(listQuery);
    areasOnly.delete("areaIds");
    years.sort();
    areasOnly.sort();
    return { yearQuery: years.toString(), areaQuery: areasOnly.toString() };
  }, [searchParams, areas, includeSubAreas, includeSubLocations, catalogVendors]);
  const { data: yearFacets, isLoading: yearsLoading } = useStructureYearFacets(
    collectionId,
    yearQuery
  );
  const { data: areaFacets } = useStructureAreaFacets(collectionId, areaQuery);

  const noAreaCount = areaFacets?.find((f) => f.areaId === NO_AREA)?.count ?? 0;
  const noAreaEntry =
    noAreaCount > 0 || areaId === NO_AREA
      ? {
          label: "No area",
          title: "Copies whose stamp is filed in no area",
          count: noAreaCount,
          selected: areaId === NO_AREA,
          onSelect: () => update({ areaId: NO_AREA }),
        }
      : undefined;

  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

  // ── Links and the drill-down ──
  /** The screen's own filters, under the Copies list's names — what every count's link starts from. */
  const filterParams = useMemo(() => {
    const own: Record<string, string> = {};
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value) own[key] = value;
    }
    return own;
  }, [searchParams]);

  const copiesHref = useCallback(
    (...segments: StructureHeading[]) =>
      exactCopiesListHref(base, Object.assign({}, filterParams, ...segments.map((s) => s.params))),
    [base, filterParams]
  );

  /** Narrow the screen to a heading or a cell: its parameters laid over the filters, recorded as a
   * step with what they replaced so the breadcrumb can undo exactly this. */
  const drill = useCallback(
    (...segments: StructureHeading[]) => {
      const params: Record<string, string> = Object.assign({}, ...segments.map((s) => s.params));
      const prev = Object.fromEntries(
        Object.keys(params).map((key) => [key, searchParams.get(key) ?? ""])
      );
      const label = segments.map((s) => s.label).join(" · ");
      update({ ...params, [STEPS_PARAM]: encodeSteps([...steps, { label, params, prev }]) });
    },
    [searchParams, steps, update]
  );

  const stepBack = (keep: number) =>
    update({
      ...stepBackUpdates(steps, keep),
      [STEPS_PARAM]: encodeSteps(steps.slice(0, keep + 1)),
    });

  const hasResettableFilters =
    FILTER_KEYS.some((key) => !!searchParams.get(key)) || steps.length > 0;
  const resetFilters = () =>
    update({
      ...Object.fromEntries(FILTER_KEYS.map((key) => [key, ""])),
      [STEPS_PARAM]: "",
    });

  return (
    <div style={CARD_STYLE}>
      <ListFilterSidebar
        areas={areas}
        filterAreaId={areaId}
        onNavigateArea={(id) => update({ areaId: id ?? "" })}
        areaExtraEntry={noAreaEntry}
        areaFacets={areaFacets}
        yearFacets={yearFacets}
        yearsLoading={yearsLoading}
        selectedYear={railYear}
        onSelectYear={(y) => update({ year: y ?? "", decade: "" })}
        yearSpan={decade !== null ? { label: `${decade}–${decade + 9}` } : null}
      />

      <div style={MAIN_STYLE}>
        <ListToolbar
          search={search}
          onSearchChange={(v) => update({ search: v })}
          sortBy=""
          sortDir="asc"
          onSortChange={() => {}}
          sortOptions={[]}
          searchMaxWidth="13rem"
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.5rem",
              flex: "1 1 auto",
              minWidth: 0,
            }}
          >
            {/* The Copies list's own bar (#1401): a drill-down step lands on it as a filter, and a
                count links to the list under exactly what it shows. */}
            <CopiesFilterControls
              collectionId={collectionId}
              conditions={conditions}
              certificateStatuses={certificateStatuses}
              formats={formats}
              subtypes={subtypes}
              locations={locations}
              locationTree={locationTree}
              deliveryStates={values.deliveryStates}
              activeDispositions={values.activeDispositions}
              conditionIds={values.conditionIds}
              certificateStatusIds={values.certificateStatusIds}
              formatIds={values.formatIds}
              subtypeIds={values.subtypeIds}
              multiStamp={values.multiStamp}
              tagIds={values.tagIds}
              tagMode={values.tagMode}
              locationId={values.locationId}
              includeSubLocations={includeSubLocations}
              setIncludeSubLocations={setIncludeSubLocations}
              spareFilters={values.spareFilters}
              updateParams={update}
            />
            <Tooltip
              style={NO_SHRINK}
              content="Clear every filter on this screen and the drill-down with it, the area and the year included."
            >
              <button
                type="button"
                onClick={resetFilters}
                aria-hidden={!hasResettableFilters}
                tabIndex={hasResettableFilters ? undefined : -1}
                style={{
                  ...FILTER_CONTROL_STYLE,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "var(--color-accent)",
                  whiteSpace: "nowrap",
                  visibility: hasResettableFilters ? "visible" : "hidden",
                }}
              >
                Reset filters
              </button>
            </Tooltip>
          </div>
        </ListToolbar>

        <div style={BODY_STYLE}>
          <div style={CONTROLS_ROW}>
            <nav aria-label="Drill-down" style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", alignItems: "baseline" }}>
              {steps.length === 0 ? (
                <span style={CRUMB_CURRENT}>Top level</span>
              ) : (
                <button type="button" style={CRUMB_BUTTON} onClick={() => stepBack(-1)}>
                  Top level
                </button>
              )}
              {steps.map((step, i) => (
                <span key={i} style={{ display: "inline-flex", gap: "0.375rem", alignItems: "baseline" }}>
                  <span style={{ color: "var(--color-text-muted)" }}>›</span>
                  {i === steps.length - 1 ? (
                    <span style={CRUMB_CURRENT}>{step.label}</span>
                  ) : (
                    <button type="button" style={CRUMB_BUTTON} onClick={() => stepBack(i)}>
                      {step.label}
                    </button>
                  )}
                </span>
              ))}
            </nav>

            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <label style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
                <span style={LABEL_STYLE}>Rows</span>
                <select
                  value={rows}
                  onChange={(e) =>
                    update({
                      rows: e.target.value,
                      // The same dimension twice is a diagonal, not a crossing.
                      cols: e.target.value === columns ? "" : (columns ?? ""),
                    })
                  }
                  style={FILTER_CONTROL_STYLE}
                  aria-label="Count rows by"
                >
                  {STRUCTURE_DIMENSIONS.map((dimension) => (
                    <option key={dimension} value={dimension}>
                      {STRUCTURE_DIMENSION_LABEL[dimension]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
                <span style={LABEL_STYLE}>Columns</span>
                <select
                  value={columns ?? ""}
                  onChange={(e) => update({ cols: e.target.value })}
                  style={FILTER_CONTROL_STYLE}
                  aria-label="Cross the rows with"
                >
                  <option value="">None</option>
                  {STRUCTURE_DIMENSIONS.filter((d) => d !== rows).map((dimension) => (
                    <option key={dimension} value={dimension}>
                      {STRUCTURE_DIMENSION_LABEL[dimension]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {data ? (
            data.total === 0 ? (
              <div style={MESSAGE_STYLE}>No copies match these filters.</div>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <StructureTable
                    data={data}
                    copiesHref={copiesHref}
                    onDrill={drill}
                  />
                </div>
                <StructureNotes
                  dimension={data.rowDimension}
                  overlapNote={data.rowOverlapNote}
                  outside={data.outsideRows}
                  node={outsideNode(data.rowDimension, areaId, values.locationId, areas, locations)}
                  label={data.columnDimension ? "Rows" : null}
                />
                {data.columnDimension && (
                  <StructureNotes
                    dimension={data.columnDimension}
                    overlapNote={data.columnOverlapNote}
                    outside={data.outsideColumns}
                    node={outsideNode(data.columnDimension, areaId, values.locationId, areas, locations)}
                    label="Columns"
                  />
                )}
              </>
            )
          ) : isError ? (
            <div style={{ ...MESSAGE_STYLE, color: "var(--color-error)" }}>
              The structure could not be loaded.
            </div>
          ) : (
            <div style={MESSAGE_STYLE}>Counting…</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The node a narrowed tree dimension's rows sit under, by name — for the note saying that the
 *  copies filed on the node itself are in none of its children. */
function outsideNode(
  dimension: StructureDimension,
  areaId: string | null,
  locationId: string,
  areas: CollectionAreaData[],
  locations: LocationData[]
): string | null {
  if (dimension === "area" && areaId && areaId !== NO_AREA) {
    return areas.find((a) => a.id === areaId)?.name ?? null;
  }
  if (dimension === "location" && locationId && locationId !== NOT_FILED) {
    return locations.find((l) => l.id === locationId)?.name ?? null;
  }
  return null;
}

// ── The table ────────────────────────────────────────────────────────────────

function Count({
  count,
  href,
  bold,
}: {
  count: number;
  href: string;
  bold?: boolean;
}) {
  if (count === 0) return <span style={EMPTY_COUNT}>0</span>;
  return (
    <Link
      href={href}
      style={{ ...COUNT_LINK, ...(bold ? { fontWeight: 600 } : null) }}
      // The count opens the Copies list; the cell around it drills down. Two acts, one click each.
      onClick={(e: MouseEvent) => e.stopPropagation()}
    >
      {count}
    </Link>
  );
}

function HeadingButton({
  heading,
  onDrill,
}: {
  heading: StructureHeading;
  onDrill: () => void;
}) {
  const style: CSSProperties = {
    ...DRILL_BUTTON,
    ...(heading.noValue ? { fontStyle: "italic" } : null),
  };
  if (heading.count === 0) return <span style={{ ...style, cursor: "default" }}>{heading.label}</span>;
  return (
    <button type="button" style={style} onClick={onDrill}>
      {heading.label}
    </button>
  );
}

function StructureTable({
  data,
  copiesHref,
  onDrill,
}: {
  data: NonNullable<ReturnType<typeof useCollectionStructure>["data"]>;
  copiesHref: (...segments: StructureHeading[]) => string;
  onDrill: (...segments: StructureHeading[]) => void;
}) {
  const crossed = data.columnDimension !== null;
  const corner = crossed
    ? `${STRUCTURE_DIMENSION_LABEL[data.rowDimension]} \\ ${STRUCTURE_DIMENSION_LABEL[data.columnDimension!]}`
    : STRUCTURE_DIMENSION_LABEL[data.rowDimension];

  return (
    <table style={TABLE_STYLE}>
      <thead>
        <tr>
          <th style={{ ...HEADING_CELL, ...LABEL_STYLE }}>{corner}</th>
          {data.columns.map((column) => (
            <th key={column.key} style={{ ...CELL, fontWeight: 400 }}>
              <HeadingButton heading={column} onDrill={() => onDrill(column)} />
            </th>
          ))}
          <th style={{ ...TOTAL_CELL, ...LABEL_STYLE, textAlign: "right" }}>
            {crossed ? "Total" : "Copies"}
          </th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => (
          <tr key={row.key}>
            <th scope="row" style={HEADING_CELL}>
              <HeadingButton heading={row} onDrill={() => onDrill(row)} />
            </th>
            {data.columns.map((column, j) => {
              const count = row.cells[j] ?? 0;
              return (
                <td
                  key={column.key}
                  style={{ ...CELL, cursor: count > 0 ? "pointer" : "default" }}
                  onClick={count > 0 ? () => onDrill(row, column) : undefined}
                >
                  <Count count={count} href={copiesHref(row, column)} />
                </td>
              );
            })}
            <td style={TOTAL_CELL}>
              <Count count={row.count} href={copiesHref(row)} bold />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" style={{ ...FOOT_CELL, textAlign: "left" }}>
            Total
          </th>
          {data.columns.map((column) => (
            <td key={column.key} style={FOOT_CELL}>
              <Count count={column.count} href={copiesHref(column)} bold />
            </td>
          ))}
          <td style={{ ...FOOT_CELL, borderLeft: "1px solid var(--color-border)" }}>
            <Count count={data.total} href={copiesHref()} bold />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/** What the table cannot say in numbers: that the segments overlap, and that some copies fall in
 *  none of them. Never a number of its own — every count on this screen is a link, and "the rest"
 *  is no filter the list can apply. */
function StructureNotes({
  dimension,
  overlapNote,
  outside,
  node,
  label,
}: {
  dimension: StructureDimension;
  overlapNote: string | null;
  outside: number;
  node: string | null;
  label: string | null;
}) {
  const notes: string[] = [];
  if (overlapNote) notes.push(overlapNote);
  if (outside > 0) {
    if (node && dimension === "area") {
      notes.push(`Copies filed on ${node} itself, rather than in one of its sub-areas, are in none of these.`);
    } else if (node && dimension === "location") {
      notes.push(`Copies filed in ${node} itself, rather than in a location inside it, are in none of these.`);
    } else if (dimension === "disposition") {
      notes.push("Copies out of the collection, not offered for sale or trade and not in intake are in none of these.");
    } else {
      notes.push("Some copies fall in none of these, so they add up to less than the total.");
    }
  }
  if (notes.length === 0) return null;
  return (
    <p style={NOTE_STYLE}>
      {label && <strong>{label}: </strong>}
      {notes.join(" ")}
    </p>
  );
}
