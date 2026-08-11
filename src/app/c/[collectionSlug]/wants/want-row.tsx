"use client";

import { useState } from "react";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { WantListItem } from "@/lib/wants";
import { WANT_PRIORITY_CHIP, WANT_PRIORITY_LABEL } from "@/lib/want-rules";
import { StampIdentity } from "@/app/c/[collectionSlug]/shared/stamp-identity";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import {
  RowQuickActions,
  pickRowActions,
} from "@/app/c/[collectionSlug]/shared/row-quick-actions";
import { useDetailPageAction } from "@/app/c/[collectionSlug]/shared/use-detail-page-action";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { WantCopyCountsLine } from "./want-copy-counts";

// One want on the list (#532). The row's job is to say **what would satisfy it** — the three
// acceptance sets, each reading `Any …` when it is empty rather than showing nothing, because a
// blank axis and an unanswered one look identical and mean opposite things (ADR-0032 §1).

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  fontSize: "0.75rem",
  background: "var(--color-bg-muted)",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

const MUTED: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

/** The dictionaries an axis resolves its ids against, keyed for lookup. */
export interface WantDictionaries {
  conditions: Map<string, StampConditionData>;
  certificateStatuses: Map<string, CertificateStatusData>;
  formats: Map<string, StampFormatData>;
}

/** One axis as text: the members joined, or `anyLabel` when the set is empty. */
function axisText(
  ids: (string | null)[],
  nameFor: (id: string | null) => string,
  anyLabel: string
): string {
  if (ids.length === 0) return anyLabel;
  return ids.map(nameFor).join(", ");
}

export function WantRow({
  want,
  collectionId,
  dictionaries,
  vendorMap,
  primaryVendorId,
  isLast,
  onEdit,
  onClose,
  onReopen,
  onDelete,
}: {
  want: WantListItem;
  collectionId: string;
  dictionaries: WantDictionaries;
  vendorMap: Map<string, AreaCatalogEntry>;
  primaryVendorId: string | null;
  isLast: boolean;
  onEdit: (want: WantListItem) => void;
  onClose: (want: WantListItem) => void;
  onReopen: (want: WantListItem) => void;
  onDelete: (want: WantListItem) => void;
}) {
  const open = want.closedAt === null;
  // The row paints its **own** background rather than borrowing its container's — it is drawn both
  // straight onto the list and inside an expanded issue group, whose members sit on the page colour,
  // and a row with no background of its own came out grey there. Hover is the same pair every other
  // list row uses.
  const [hovered, setHovered] = useState(false);

  // The stamp's own screen (#518) — where the catalogue numbers, the prices behind this row's range
  // and the copies held all are. First in the menu, as it is in every menu it appears in: it is the
  // entry that goes *somewhere*, and the rest act on the want in place.
  const detailPage = useDetailPageAction("stamp", want.stampId);

  // Built once and handed to both the menu and the promoted icons beside it (`pickRowActions`), so
  // a shortcut and its menu entry cannot drift into doing different things.
  const rowActions: RowAction[] = [
    detailPage,
    { key: "edit", label: "Edit want", icon: "edit", onSelect: () => onEdit(want) },
    open
      ? { key: "close", label: "Close want", icon: "check", onSelect: () => onClose(want) }
      : { key: "reopen", label: "Reopen want", icon: "restore", onSelect: () => onReopen(want) },
    {
      key: "delete",
      label: "Delete want",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete(want),
    },
  ];

  const conditionText = axisText(
    want.conditionIds,
    (id) => {
      const c = id ? dictionaries.conditions.get(id) : undefined;
      return c ? c.abbreviation || c.name : "?";
    },
    "Any condition"
  );
  const certificateText = axisText(
    want.certificateStatusIds,
    (id) => (id === null ? "No certificate" : (dictionaries.certificateStatuses.get(id)?.name ?? "?")),
    "Certificate: any"
  );
  const formatText = axisText(
    want.formatIds,
    (id) => (id === null ? "Single" : (dictionaries.formats.get(id)?.name ?? "?")),
    "Any format"
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        padding: "0.75rem 1rem",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
        transition: "background 0.1s ease",
      }}
    >
      {/* The wanted stamp's catalog photo as a fixed left column, like every other list row — a
          want is read to recognise a stamp on a dealer's table, so the picture is the point. The
          column is reserved when there is none, or the text of every row stops lining up. */}
      <div style={{ opacity: open ? 1 : 0.6, display: "flex" }}>
        <PhotoThumb collectionId={collectionId} photos={want.photos} reserveWhenEmpty />
      </div>

      {/* A closed want is faded, but the fade is on the **content**, never on the row: `opacity` on
          the container would take the background down with it, and inside an expanded issue group —
          whose members sit on the page colour — that is exactly how a row turns grey. The actions
          keep their full contrast, since reopening one is the thing you came to a closed row for. */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "0.375rem",
          opacity: open ? 1 : 0.6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <StampIdentity
            stamp={{
              name: want.stampName,
              catalogNumbers: want.catalogNumbers,
              colnectId: want.colnectId,
              subtype: want.subtype,
            }}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
            size="small"
          />
          {want.unknownVariant && <span style={MUTED}>— any variant</span>}
          {!open && <span style={CHIP}>Closed</span>}
        </div>

        {/* What would satisfy it, and how badly. Always the same four in the same order: a want
            read at a dealer's table is scanned, not studied. Priority joined the chips rather than
            sitting off to the right, because it is one more fact *about this want* — and the three
            beside it are what makes its colour readable as urgency rather than as a warning. */}
        <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
          <span style={CHIP}>{conditionText}</span>
          <span style={CHIP}>{certificateText}</span>
          <span style={CHIP}>{formatText}</span>
          <span
            style={{
              ...CHIP,
              ...WANT_PRIORITY_CHIP[want.priority],
              border: `1px solid ${WANT_PRIORITY_CHIP[want.priority].border}`,
              fontWeight: want.priority === "high" ? 600 : 400,
            }}
          >
            {WANT_PRIORITY_LABEL[want.priority]}
          </span>
        </div>

        {want.notes && <span style={MUTED}>{want.notes}</span>}
      </div>

      {/* The row's right-hand facts, **stacked** rather than in a line: the held badge is there for
          some wants and not others, and side by side that shifted every price to a different
          horizontal position down the list. Stacked and right-aligned, the price lands on the same
          edge whether or not a badge sits above it — which is what makes a column of figures
          scannable. The `⋮` stays outside the stack so it keeps its own column. */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.5rem",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "0.25rem",
            minHeight: "1.85rem",
            justifyContent: "center",
          }}
        >
          {/* Only what would satisfy **this** want. A row *is* one want, so the stamp-wide figure
              said the same thing a second time in most cases and a different thing in the one case
              that matters — and two numbers a line apart is worse than one. The buckets carry the
              meaning; a sentence explaining them would be words for what the labels already say. */}
          <WantCopyCountsLine copies={want.matchingCopies} />
          {/* What the catalogue says this would cost — a **range**, because the want accepts a set
              of combinations and each has its own value. One figure when only one is priced, rather
              than `12.00 – 12.00`. */}
          {want.catalogRange && (
            <Tooltip
              content={`Catalogue value across what this want accepts: ${want.catalogRange.pricedCombinations} of ${want.catalogRange.totalCombinations} acceptable combinations ${want.catalogRange.pricedCombinations === 1 ? "is" : "are"} priced.${want.catalogRange.estimated ? " Some figures are estimates — a lowest-variant value, or a format derived from the single by a multiplier." : ""}`}
            >
              <span
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--color-text-secondary)",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {want.catalogRange.estimated && "≈ "}
                {want.catalogRange.minBase === want.catalogRange.maxBase
                  ? want.catalogRange.minBase
                  : `${want.catalogRange.minBase} – ${want.catalogRange.maxBase}`}{" "}
                {want.catalogRange.baseCurrency}
              </span>
            </Tooltip>
          )}
        </div>
        {/* The two things done from a want row over and over: open the stamp behind it — to read
            the catalogue numbers, the prices this row's range came from, or the copies held — and
            edit the terms, which are refined as you learn what is actually out there. Promoted, not
            moved: both stay in the menu, which remains the complete list of what the row can do. */}
        <RowQuickActions
          actions={pickRowActions(rowActions, ["detail-page", "edit"])}
          visible={hovered}
        />
        <RowActionsMenu ariaLabel="Want actions" actions={rowActions} />
      </div>
    </div>
  );
}
