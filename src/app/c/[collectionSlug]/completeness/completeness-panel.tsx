"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { CollectionAreaData } from "@/lib/areas";
import {
  getCompletenessReportAction,
  getChecklistMissingStampsAction,
  type CompletenessRequest,
} from "@/app/actions/completeness";
import type { IncompleteChecklist } from "@/lib/completeness-screen";
import {
  COMPLETENESS_DISPOSITION_CHIPS,
  COMPLETENESS_DISPOSITION_CHIP_LABEL,
  CONDITIONS_PARAM,
  DISPOSITIONS_PARAM,
  completenessPercent,
  dispositionChipsValue,
  readConditionIds,
  readDispositionChips,
  toggleDispositionChip,
  type CompletenessDispositionChip,
} from "@/lib/completeness-screen-rules";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useListAreaYearFilter } from "@/app/c/[collectionSlug]/shared/use-list-area-year-filter";
import { usePersistedFilterParams } from "@/app/c/[collectionSlug]/shared/use-persisted-filter-params";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { dispositionTint } from "@/app/c/[collectionSlug]/shared/disposition-colors";
import {
  STICKY_TOOLBAR_STYLE,
  TOOLBAR_LABEL_STYLE,
} from "@/app/c/[collectionSlug]/shared/list-toolbar";
import {
  SpecialisedChecklistsToggle,
  SpecialisedMark,
} from "@/app/c/[collectionSlug]/shared/specialised-checklists";
import { SET_COMPLETENESS_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";
import {
  useIssueYears,
  useIssueAreaFacets,
} from "@/app/c/[collectionSlug]/issues/use-issues-query";

interface CompletenessPanelProps {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
}

/** The screen's own filters, remembered per collection (#2266); area and year are the rail's. */
const REMEMBERED_KEYS = [CONDITIONS_PARAM, DISPOSITIONS_PARAM] as const;

/** The disposition chip's colour: the three dispositions wear their own (#1646), *None* the accent. */
const CHIP_TINT: Partial<Record<CompletenessDispositionChip, ReturnType<typeof dispositionTint>>> = {
  "in-collection": dispositionTint("inCollection"),
  "for-sale": dispositionTint("forSale"),
  "for-trade": dispositionTint("forTrade"),
};

const MUTED_TEXT: React.CSSProperties = {
  padding: "2rem",
  color: "var(--color-text-muted)",
  fontSize: "0.9375rem",
};

/**
 * The Completeness screen's body (#2266): the shared Area and Year rail on the left, the conditions
 * and disposition chips above, then the summary and the incomplete checklists.
 */
export function CompletenessPanel({ collectionId, collectionSlug, areas }: CompletenessPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Area + year, the selection every list rail shares (#143, #844) — so arriving from the Issues,
  // Stamps or Copies list shows the area chosen there.
  const { filterAreaId, year } = useListAreaYearFilter(collectionId, areas);
  const [includeSubAreas] = useSubtreeScope("area");
  const filterAreaIds = useMemo(
    () => resolveAreaFilterIds(areas, filterAreaId, includeSubAreas) ?? undefined,
    [filterAreaId, areas, includeSubAreas]
  );

  const { readParam, remember } = usePersistedFilterParams(
    "completeness-filters",
    collectionId,
    REMEMBERED_KEYS,
    searchParams
  );
  const conditionIds = useMemo(() => readConditionIds(readParam(CONDITIONS_PARAM)), [readParam]);
  const dispositions = useMemo(
    () => readDispositionChips(readParam(DISPOSITIONS_PARAM)),
    [readParam]
  );

  const { data: conditions } = useCollectionConditions(collectionId);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      remember(updates);
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/completeness${qs ? `?${qs}` : ""}`);
    },
    [remember, router, collectionSlug, searchParams]
  );

  function handleNavigateArea(areaId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    // "all" sentinel (not delete) so an explicit "all areas" is distinguishable from an absent
    // param that falls back to the store (#143).
    params.set("areaId", areaId ?? "all");
    router.push(`/c/${collectionSlug}/completeness?${params.toString()}`);
  }

  // The rail's counts are the Issues list's: issues per year and per area, each with the other
  // axis in force — what is being measured here is the issues' checklists.
  const { data: yearFacets, isLoading: yearsLoading } = useIssueYears(collectionId, {
    areaIds: filterAreaIds,
  });
  const { data: areaFacets } = useIssueAreaFacets(collectionId, { year: year || undefined });

  const request: CompletenessRequest = useMemo(
    () => ({ areaIds: filterAreaIds, year: year || undefined, conditionIds, dispositions }),
    [filterAreaIds, year, conditionIds, dispositions]
  );
  const { data: report, isLoading } = useQuery({
    queryKey: ["completeness", collectionId, request],
    queryFn: () => getCompletenessReportAction(collectionId, request),
    placeholderData: keepPreviousData,
  });

  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        overflow: "clip",
        flex: 1,
        minHeight: "24rem",
        background: "var(--color-bg-elevated)",
      }}
    >
      <ListFilterSidebar
        areas={areas}
        filterAreaId={filterAreaId}
        onNavigateArea={handleNavigateArea}
        areaFacets={areaFacets}
        yearFacets={yearFacets}
        yearsLoading={yearsLoading}
        selectedYear={year || null}
        onSelectYear={(y) => updateParams({ year: y ?? "all" })}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          borderLeft: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            ...STICKY_TOOLBAR_STYLE,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            columnGap: "1.5rem",
            rowGap: "0.5rem",
            padding: "0.75rem 1.25rem",
            borderBottom: "1px solid var(--color-border)",
            // Opaque: the list scrolls underneath it.
            background: "var(--color-bg-elevated)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={TOOLBAR_LABEL_STYLE}>Condition</span>
            <MultiSelectFilter
              options={(conditions ?? []).map((c) => ({
                id: c.id,
                label: `${c.abbreviation} — ${c.name}`,
              }))}
              selected={conditionIds}
              onChange={(ids) => updateParams({ [CONDITIONS_PARAM]: ids.join(",") })}
              allLabel="Every condition"
              itemNoun="conditions"
              ariaLabel="Count copies in these conditions"
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
            <Tooltip content="A copy counts when it carries any disposition switched on here. None is a copy with no disposition yet. One stays on.">
              <span style={TOOLBAR_LABEL_STYLE}>Disposition</span>
            </Tooltip>
            {COMPLETENESS_DISPOSITION_CHIPS.map((chip) => (
              <FilterChip
                key={chip}
                label={COMPLETENESS_DISPOSITION_CHIP_LABEL[chip]}
                active={dispositions.includes(chip)}
                toggle
                tint={CHIP_TINT[chip]}
                onClick={() =>
                  updateParams({
                    [DISPOSITIONS_PARAM]: dispositionChipsValue(
                      toggleDispositionChip(dispositions, chip)
                    ),
                  })
                }
              />
            ))}
          </div>
          <SpecialisedChecklistsToggle />
        </div>

        {isLoading || !report ? (
          <div style={MUTED_TEXT}>Loading completeness…</div>
        ) : report.summary.checklists === 0 ? (
          <div style={MUTED_TEXT}>
            No checklists under this area and years. A checklist on an issue is what completeness
            is measured against.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", padding: "1.25rem" }}>
            <Summary summary={report.summary} />
            <IncompleteList
              collectionId={collectionId}
              collectionSlug={collectionSlug}
              checklists={report.incomplete}
              conditionIds={conditionIds}
              dispositions={dispositions}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({
  summary,
}: {
  summary: { held: number; total: number; completeChecklists: number; checklists: number };
}) {
  const percent = completenessPercent(summary.held, summary.total);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
      <Figure
        label="Stamps held"
        value={`${summary.held} / ${summary.total}`}
        detail={percent === null ? null : `${percent}%`}
        share={summary.total > 0 ? summary.held / summary.total : 0}
      />
      <Figure
        label="Complete checklists"
        value={`${summary.completeChecklists} / ${summary.checklists}`}
        detail={null}
        share={summary.checklists > 0 ? summary.completeChecklists / summary.checklists : 0}
      />
    </div>
  );
}

function Figure({
  label,
  value,
  detail,
  share,
}: {
  label: string;
  value: string;
  detail: string | null;
  share: number;
}) {
  return (
    <div
      style={{
        flex: "0 1 20rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
        padding: "0.875rem 1rem",
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        background: "var(--color-bg-page)",
      }}
    >
      <span style={TOOLBAR_LABEL_STYLE}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <span
          style={{
            fontSize: "1.375rem",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: "var(--color-text-primary)",
          }}
        >
          {value}
        </span>
        {detail && (
          <span style={{ fontSize: "0.9375rem", color: "var(--color-text-secondary)" }}>{detail}</span>
        )}
      </span>
      <span
        aria-hidden
        style={{
          height: "0.375rem",
          borderRadius: "999px",
          background: "var(--color-border)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${Math.min(1, Math.max(0, share)) * 100}%`,
            background: "var(--color-accent)",
          }}
        />
      </span>
    </div>
  );
}

function IncompleteList({
  collectionId,
  collectionSlug,
  checklists,
  conditionIds,
  dispositions,
}: {
  collectionId: string;
  collectionSlug: string;
  checklists: IncompleteChecklist[];
  conditionIds: string[];
  dispositions: CompletenessDispositionChip[];
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <h3
        style={{
          margin: 0,
          fontSize: "0.9375rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Incomplete checklists ({checklists.length})
      </h3>
      {checklists.length === 0 ? (
        <div style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
          Every checklist here is complete.
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            overflow: "clip",
          }}
        >
          {checklists.map((c, idx) => (
            <IncompleteRow
              key={c.checklistId}
              collectionId={collectionId}
              collectionSlug={collectionSlug}
              checklist={c}
              isLast={idx === checklists.length - 1}
              conditionIds={conditionIds}
              dispositions={dispositions}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function IncompleteRow({
  collectionId,
  collectionSlug,
  checklist,
  isLast,
  conditionIds,
  dispositions,
}: {
  collectionId: string;
  collectionSlug: string;
  checklist: IncompleteChecklist;
  isLast: boolean;
  conditionIds: string[];
  dispositions: CompletenessDispositionChip[];
}) {
  const [open, setOpen] = useState(false);
  const missingCount = checklist.requiredCount - checklist.owned;
  const { data: missing, isLoading } = useQuery({
    queryKey: [
      "completeness",
      collectionId,
      "missing",
      checklist.checklistId,
      conditionIds,
      dispositions,
    ],
    queryFn: () =>
      getChecklistMissingStampsAction(collectionId, checklist.checklistId, {
        conditionIds,
        dispositions,
      }),
    enabled: open,
  });

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.75rem minmax(0, 1fr) 4rem 6rem 7rem",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.5rem 0.75rem",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Hide the missing stamps" : "Show the missing stamps"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "1.5rem",
            height: "1.5rem",
            border: "none",
            background: "none",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <Icon name={open ? "collapse" : "expand"} />
        </button>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            minWidth: 0,
            fontSize: "0.875rem",
          }}
        >
          <Link
            href={`/c/${collectionSlug}/issues/${checklist.issueId}`}
            style={{
              color: "var(--color-text-primary)",
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {checklist.issueName ?? "(unnamed issue)"}
          </Link>
          <span
            style={{
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {checklist.name}
          </span>
          <SpecialisedMark kind={checklist.kind} />
        </span>
        <span
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {checklist.issueYear ?? "—"}
        </span>
        <span style={{ justifySelf: "start", ...SET_COMPLETENESS_CHIP }}>
          {checklist.owned}/{checklist.requiredCount}
        </span>
        <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          {missingCount} missing
        </span>
      </div>
      {open && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.375rem",
            padding: "0 0.75rem 0.75rem 3.25rem",
          }}
        >
          {isLoading || !missing ? (
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>Loading…</span>
          ) : (
            missing.map((label, i) => (
              <span key={`${label}-${i}`} style={SET_COMPLETENESS_CHIP}>
                {label}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
}
