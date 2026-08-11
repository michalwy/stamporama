"use client";

import { LabelWithError } from "@/app/dialog-shell";
import type { WantAcceptanceInput } from "@/lib/wants";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";

// The three acceptance axes of a want (#532; ADR-0032 §1/§3), as one editor shared by the want form
// and the intake review's *narrow* step — the two places the same question is asked, which must not
// answer it in two different shapes.
//
// Each axis is a `MultiSelectFilter`, the control the list toolbars already use, and it fits for a
// reason rather than by resemblance: **its empty selection already means "every value"**, which is
// exactly what an empty acceptance set means here. So the trigger reads `Any condition` when nothing
// is ticked and `3 conditions` when several are — a want's terms stated in one line each, instead of
// three open checkbox grids that made a short form scroll.
//
// On the certificate and format axes the "none" value is an **option of its own** — *No certificate*,
// *Single* — because a null there is a value, not the absence of an answer (ADR-0006 §2;
// `StampFormat`). The control keys options by string, so that value travels as a sentinel and is
// mapped back at the boundary; it is never stored.

/** The `null` member's key inside the control. Never leaves this module. */
const NONE = "__none__";

const toKey = (id: string | null): string => id ?? NONE;
const fromKey = (key: string): string | null => (key === NONE ? null : key);

/**
 * One axis: a label over the control, so a row of them reads as a form rather than as a toolbar.
 *
 * The label is the dialog's own `LabelWithError` — the same component *Priority* and *Notes* use
 * below — rather than a lookalike declared here. Four fields in one grid have to share a baseline,
 * and two label styles a rem apart is exactly how they stop sharing one. It emits a `<span>` with no
 * `htmlFor`, which is right: the control it names is a button carrying its own `aria-label`, not a
 * labelable input.
 */
function Axis({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <LabelWithError>{label}</LabelWithError>
      {children}
    </div>
  );
}

/**
 * The three sets, edited together.
 *
 * `value` is the whole acceptance and every change hands the whole acceptance back: a want's axes
 * are replaced as a unit on save (see `writeAcceptance`), so a partial edit here would be a second
 * shape for the same fact.
 *
 * Laid out in **two columns**, with an optional fourth cell for a field that belongs beside them
 * without being an acceptance axis — the want form puts *Priority* there. The slot rather than a
 * second grid in the caller, because a control on its own row below would read as a different kind
 * of question than the three above it, which it is not.
 */
export function WantAcceptanceFields({
  collectionId,
  value,
  onChange,
  disabled = false,
  extra,
  menuZIndex,
  onPopoverOpenChange,
}: {
  collectionId: string;
  value: WantAcceptanceInput;
  onChange: (next: WantAcceptanceInput) => void;
  disabled?: boolean;
  /** Rendered as the grid's fourth cell. */
  extra?: React.ReactNode;
  /** Raised above the enclosing dialog's panel — see `MultiSelectFilter`'s own note. */
  menuZIndex?: number;
  /** True while any of the three menus is open, so the enclosing dialog can stop dismissing itself
   *  on Escape (#361). */
  onPopoverOpenChange?: (open: boolean) => void;
}) {
  const { data: conditions } = useCollectionConditions(collectionId);
  const { data: certificateStatuses } = useCollectionCertificateStatuses(collectionId);
  const { data: formats } = useCollectionFormats(collectionId);

  // One report for three menus: the dialog only cares whether *something* is stacked above it, and
  // only one can be open at a time (opening one closes the last on the outside-click listener).
  // `fullWidth` because these are **form fields** here, not toolbar controls: each sits in a grid
  // cell beside the others and has to line up with them, and a control sized to its own label would
  // leave four ragged boxes.
  const shared = {
    zIndex: menuZIndex,
    onOpenChange: onPopoverOpenChange,
    disabled,
    fullWidth: true,
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "1rem",
        alignItems: "start",
      }}
    >
      <Axis label="Acceptable conditions">
        <MultiSelectFilter
          // The one axis with no "none" row: a copy always has a condition.
          options={(conditions ?? []).map((c) => ({ id: c.id, label: c.abbreviation || c.name }))}
          selected={value.conditionIds}
          onChange={(next) => onChange({ ...value, conditionIds: next })}
          allLabel="Any condition"
          itemNoun="conditions"
          ariaLabel="Acceptable conditions"
          {...shared}
        />
      </Axis>

      <Axis label="Acceptable certificate">
        <MultiSelectFilter
          options={[
            { id: NONE, label: "No certificate" },
            ...(certificateStatuses ?? []).map((c) => ({ id: c.id, label: c.name })),
          ]}
          selected={value.certificateStatusIds.map(toKey)}
          onChange={(next) =>
            onChange({ ...value, certificateStatusIds: next.map(fromKey) })
          }
          allLabel="Any certificate"
          itemNoun="certificate options"
          ariaLabel="Acceptable certificate"
          {...shared}
        />
      </Axis>

      <Axis label="Acceptable format">
        <MultiSelectFilter
          options={[
            { id: NONE, label: "Single" },
            ...(formats ?? []).map((f) => ({ id: f.id, label: f.name })),
          ]}
          selected={value.formatIds.map(toKey)}
          onChange={(next) => onChange({ ...value, formatIds: next.map(fromKey) })}
          allLabel="Any format"
          itemNoun="formats"
          ariaLabel="Acceptable format"
          {...shared}
        />
      </Axis>

      {extra}
    </div>
  );
}
