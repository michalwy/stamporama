"use client";

import { useMemo } from "react";
import { tagColorTokens } from "@/lib/tag-colors";
import { ROW_CHIP } from "./chip-styles";
import { useCollectionConditions } from "./use-display-condition";
import { useCollectionCertificateStatuses } from "./use-certificate-statuses";
import { Tooltip } from "./tooltip";

// The condition and certificate-status chips (#728), wherever a row draws one.
//
// **The colour is resolved from the dictionary, not carried on the row.** Every list already hands
// its rows a `conditionId`, and the dictionary is a handful of entries the screen can hold in one
// cached query — so a chip looks its own colour up rather than having a `conditionColor` threaded
// through a dozen read models, their group and lot variants, and the four screens that reshape
// them. Recolouring a condition then takes one write and one query invalidation, instead of a hunt
// for the reads that copied the old colour into a payload.
//
// While the dictionary is still loading, and for an id it does not hold, the chip falls back to the
// neutral shape the app drew before this — a chip that says its abbreviation in grey is right, only
// quieter, whereas a chip that waits is a row that moves under the reader.

function chipStyle(color: string | null | undefined): React.CSSProperties {
  const tokens = tagColorTokens(color);
  return {
    ...ROW_CHIP,
    color: tokens.color,
    borderColor: tokens.border,
    background: tokens.background,
  };
}

export function ConditionChip({
  collectionId,
  conditionId,
  /** What the chip says — the abbreviation on a row, the full name where there is room. */
  label,
  /** Hover text; defaults to the condition's own name from the dictionary. */
  tooltip,
}: {
  collectionId: string;
  conditionId: string | null | undefined;
  label: React.ReactNode;
  tooltip?: React.ReactNode;
}) {
  const { data: conditions } = useCollectionConditions(collectionId);
  const condition = useMemo(
    () => conditions?.find((c) => c.id === conditionId),
    [conditions, conditionId]
  );
  return (
    <Tooltip content={tooltip ?? condition?.name ?? ""}>
      <span style={chipStyle(condition?.color)}>{label}</span>
    </Tooltip>
  );
}

export function CertificateStatusChip({
  collectionId,
  certificateStatusId,
  label,
  tooltip,
}: {
  collectionId: string;
  /** Null is the *no certificate* value (ADR-0006 §2), which has no dictionary row and so no
   * colour of its own — a group row saying "no certificate" still gets the neutral chip. */
  certificateStatusId: string | null | undefined;
  label: React.ReactNode;
  tooltip?: React.ReactNode;
}) {
  const { data: statuses } = useCollectionCertificateStatuses(collectionId);
  const status = useMemo(
    () => statuses?.find((s) => s.id === certificateStatusId),
    [statuses, certificateStatusId]
  );
  return (
    <Tooltip content={tooltip ?? "Certificate status"}>
      <span style={chipStyle(status?.color)}>{label}</span>
    </Tooltip>
  );
}
