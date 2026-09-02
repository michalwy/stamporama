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
  style,
}: {
  collectionId: string;
  conditionId: string | null | undefined;
  label: React.ReactNode;
  tooltip?: React.ReactNode;
  /** Merged over the chip, for a surface that needs it heavier or larger than a list row does —
   * the quick-CV dialog's badge, which is one statement on a card rather than one of six chips on
   * a line. The tint is never overridden here; a chip that could be told to be a different colour
   * than its entry would be a second answer to the question this component exists to settle. */
  style?: React.CSSProperties;
}) {
  const { data: conditions } = useCollectionConditions(collectionId);
  const condition = useMemo(
    () => conditions?.find((c) => c.id === conditionId),
    [conditions, conditionId]
  );
  return (
    <Tooltip content={tooltip ?? condition?.name ?? ""}>
      <span style={{ ...chipStyle(condition?.color), ...style }}>{label}</span>
    </Tooltip>
  );
}

export function CertificateStatusChip({
  collectionId,
  certificateStatusId,
  label,
  tooltip,
  style,
}: {
  collectionId: string;
  /** Null is the *no certificate* value (ADR-0006 §2), which has no dictionary row and so no
   * colour of its own — a group row saying "no certificate" still gets the neutral chip. */
  certificateStatusId: string | null | undefined;
  label: React.ReactNode;
  tooltip?: React.ReactNode;
  /** See {@link ConditionChip}'s `style`. */
  style?: React.CSSProperties;
}) {
  const { data: statuses } = useCollectionCertificateStatuses(collectionId);
  const status = useMemo(
    () => statuses?.find((s) => s.id === certificateStatusId),
    [statuses, certificateStatusId]
  );
  return (
    <Tooltip content={tooltip ?? "Certificate status"}>
      <span style={{ ...chipStyle(status?.color), ...style }}>{label}</span>
    </Tooltip>
  );
}
