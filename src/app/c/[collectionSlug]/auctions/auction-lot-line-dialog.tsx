"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { STAMP_SECONDARY_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { CatalogNumberChip } from "@/app/c/[collectionSlug]/shared/catalog-number-chip";
import {
  LS_LAST_CERT,
  LS_LAST_CONDITION,
  readLast,
  writeLast,
} from "@/app/c/[collectionSlug]/shared/add-copy-defaults";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import {
  StampPickerBrowser,
  type PickedIssue,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-browser";
import {
  issueLabel,
  orderedCatalogLabels,
  type PickedStamp,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import type { AuctionLotLineItem } from "@/lib/auction-lines";
import type { CollectionAreaData } from "@/lib/areas";
import type { AuctionLotLineRaw } from "@/app/actions/auctions";
import type { AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";

// Entering one composition line (#353), as **two steps in modals** — the purchase-order intake's
// flow (#121) exactly: pick what it is, then say what state it is in.
//
// Step one is the stamp browser. Step two is this dialog. They are separate because they are two
// different questions asked of two different sources: the first is answered from the catalogue tree,
// the second from the listing text in front of the collector. Putting the selects on screen while
// nothing is picked would be asking about the condition of nothing in particular; putting them
// *under* the picker inline made the pick and the description compete for the same strip of screen.
//
// What can be picked is a stamp **or a whole issue**. A house lot is routinely "Michel 1–12,
// complete", and twelve trips through a picker is the reason such a lot would go undescribed. The
// series is an **entry shortcut only**: it expands server-side into one line per member marked
// required for completeness, because catalogue value is summed per stamp and a lost lot has to be
// attributable per stamp. Editing offers stamps alone — one line becoming twelve is not an edit.

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const NOTE: React.CSSProperties = {
  margin: "0.625rem 0 0",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.4,
};

/** How a caller that must *show* an unsaved line renders what was picked — the add-lot dialog
 * builds its contents list in memory before anything exists to read back (#353). */
export interface LineSelectionSummary {
  /** Prefix-formatted catalog numbers (#357). Empty for a whole-issue pick. */
  catalogLabels: string[];
  /** What to call it: the stamp's name, or `Whole issue: X — N stamps`. */
  label: string;
}

/** What the picker handed back: one stamp, or a whole issue to expand into its required members. */
type LineSelection =
  | { kind: "stamp"; stampId: string; picked: PickedStamp }
  | { kind: "issue"; issue: PickedIssue };

export function AuctionLotLineDialog({
  collectionId,
  areas,
  line,
  vendorMapFor,
  primaryVendorByArea,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  /** The line being edited; absent when adding, which is what opens on the picker. */
  line?: AuctionLotLineItem;
  /** Catalog-entry lookup resolved from the line's area *and* issue, so a per-issue prefix
   * override (#377) reaches the restated pick. */
  vendorMapFor: AreaVendorMaps["vendorMapFor"];
  primaryVendorByArea: Map<string, string | null>;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  /** The line's fields, plus how to render them for callers that must show the line before it is
   * saved — the add-lot dialog builds its contents list in memory (#353). */
  onSubmit: (raw: AuctionLotLineRaw, summary: LineSelectionSummary) => void;
}) {
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const { data: certificateStatuses = [] } = useCollectionCertificateStatuses(collectionId);
  const { data: formats = [] } = useCollectionFormats(collectionId);

  /** Edit-mode prefill for the summary. The vendor map is resolved from the **line's own area**
   * (#357) — without it the chips would be bare numbers from three different catalogs. */
  const initial: PickedStamp | undefined = useMemo(() => {
    if (!line) return undefined;
    const vendorMap = vendorMapFor(line.areaId, line.issueId);
    const primaryVendorId = line.areaId ? (primaryVendorByArea.get(line.areaId) ?? null) : null;
    return {
      stampId: line.stampId,
      catalogLabels: orderedCatalogLabels(line.catalogNumbers, vendorMap, primaryVendorId),
      name: line.stampName,
      secondary:
        line.issueName || line.issueYear ? issueLabel(line.issueName, line.issueYear) : null,
      unknownVariant: line.unknownVariant,
    };
  }, [line, vendorMapFor, primaryVendorByArea]);

  const [selection, setSelection] = useState<LineSelection | null>(
    initial ? { kind: "stamp", stampId: initial.stampId, picked: initial } : null
  );
  // Adding opens on the picker: the affordance said "add a line", so the picker is the screen.
  const [picking, setPicking] = useState(!line);

  // Editing keeps what the line says; adding starts from what was last used, which is the same
  // remembered pair every add-copy entry point reads (#121, #234) — a collector describing a parcel
  // and one taking it in are answering the same question about the same material.
  const [conditionId, setConditionId] = useState(
    () => line?.conditionId ?? readLast(LS_LAST_CONDITION, collectionId)
  );
  const [certificateStatusId, setCertificateStatusId] = useState(
    () => line?.certificateStatusId ?? readLast(LS_LAST_CERT, collectionId)
  );
  const [formatId, setFormatId] = useState(line?.formatId ?? "");
  const [quantity, setQuantity] = useState(String(line?.quantity ?? 1));

  // A remembered id that no longer exists in this collection must not silently select nothing.
  const validCondition = conditions.some((c) => c.id === conditionId) ? conditionId : "";
  const validCertificate = certificateStatuses.some((c) => c.id === certificateStatusId)
    ? certificateStatusId
    : "";

  if (picking) {
    return (
      <StampPickerBrowser
        collectionId={collectionId}
        areas={areas}
        onPick={(picked) => {
          setSelection({ kind: "stamp", stampId: picked.stampId, picked });
          setPicking(false);
        }}
        // Add only: turning one existing line into twelve is not an edit.
        onPickIssue={
          line
            ? undefined
            : (issue) => {
                setSelection({ kind: "issue", issue });
                setPicking(false);
              }
        }
        // Backing out of the picker with nothing chosen abandons the whole line; from an edit it
        // returns to the line that is still being edited.
        onClose={() => (line || selection ? setPicking(false) : onClose())}
      />
    );
  }
  if (!selection) return null;

  const count = selection.kind === "issue" ? selection.issue.requiredCount : 1;
  const summaryText =
    selection.kind === "issue"
      ? `Whole issue: ${selection.issue.label} — ${count} required stamp${count === 1 ? "" : "s"}`
      : [selection.picked.catalogLabels.join(", ") || null, selection.picked.name || null]
          .filter(Boolean)
          .join(" · ") || "(unnamed stamp)";

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // A portal propagates events along the **React** tree, not the DOM one, so without this a
    // submit here reaches the `onSubmit` of whatever form this dialog was opened from — the add-lot
    // dialog is one — and saves that instead. Belt and braces: callers also render this outside
    // their own form.
    e.stopPropagation();
    if (!selection) return;
    writeLast(LS_LAST_CONDITION, collectionId, validCondition);
    writeLast(LS_LAST_CERT, collectionId, validCertificate);
    onSubmit(
      {
        stampId: selection.kind === "stamp" ? selection.stampId : "",
        issueId: selection.kind === "issue" ? selection.issue.issueId : undefined,
        conditionId: validCondition,
        certificateStatusId: validCertificate,
        formatId,
        quantity,
      },
      selection.kind === "stamp"
        ? {
            catalogLabels: selection.picked.catalogLabels,
            label: selection.picked.name || "(unnamed stamp)",
          }
        : {
            catalogLabels: [],
            label: `Whole issue: ${selection.issue.label} — ${count} stamp${count === 1 ? "" : "s"}`,
          }
    );
  }

  const actionLabel = isPending
    ? "Saving…"
    : line
      ? "Save line"
      : count > 1
        ? `Add ${count} lines`
        : "Add line";

  // Portaled to <body>: this dialog is opened from inside others (the composition dialog, the
  // add-lot dialog), whose panels are transform-centered and so become the containing block for
  // `position: fixed` descendants. The stamp picker escapes the same way.
  if (typeof document === "undefined") return null;
  return createPortal(
    <DialogShell title={line ? "Edit line" : "Set condition"} onClose={onClose} maxWidth="36rem">
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={submit}>
        <DialogBody>
          {/* What was picked, restated — the previous screen is gone, and a form asking about "the
              condition" without saying of what is a form you cannot check. */}
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.625rem 0.75rem",
              borderRadius: "0.5rem",
              background: "var(--color-bg-page)",
              border: "1px solid var(--color-border)",
            }}
          >
            {selection.kind === "stamp" ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "0.3rem",
                  fontSize: "0.875rem",
                  color: "var(--color-text-primary)",
                }}
              >
                {selection.picked.catalogLabels.map((label) => (
                  <CatalogNumberChip
                    key={label}
                    label={label}
                    style={STAMP_SECONDARY_CHIP}
                  />
                ))}
                {(selection.picked.name || selection.picked.catalogLabels.length === 0) && (
                  <span>{selection.picked.name || "(unnamed stamp)"}</span>
                )}
                {selection.picked.unknownVariant && (
                  <span style={{ color: "var(--color-text-muted)" }}>— unknown variant</span>
                )}
              </div>
            ) : (
              <div style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
                {summaryText}
              </div>
            )}
            {selection.kind === "stamp" && selection.picked.secondary && (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--color-text-muted)",
                  marginTop: "0.125rem",
                }}
              >
                {selection.picked.secondary}
              </div>
            )}
            {selection.kind === "issue" && (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--color-text-muted)",
                  marginTop: "0.125rem",
                }}
              >
                One line each, all described the way you set below.
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="lot-line-condition">Condition</LabelWithError>
              <select
                id="lot-line-condition"
                value={validCondition}
                onChange={(e) => setConditionId(e.target.value)}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">— Select —</option>
                {conditions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.abbreviation})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="lot-line-certificate">Certificate</LabelWithError>
              <select
                id="lot-line-certificate"
                value={validCertificate}
                onChange={(e) => setCertificateStatusId(e.target.value)}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {/* None is the unmarked default, as on a copy (ADR-0006 §2). */}
                <option value="">— None —</option>
                {certificateStatuses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="lot-line-format">Format</LabelWithError>
              <select
                id="lot-line-format"
                value={formatId}
                onChange={(e) => setFormatId(e.target.value)}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {/* Single is the empty value: there is no such row in the dictionary (ADR-0020). */}
                <option value="">Single</option>
                {formats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ width: "7rem", flexShrink: 0 }}>
              <LabelWithError htmlFor="lot-line-quantity">Quantity</LabelWithError>
              <NumericInput
                id="lot-line-quantity"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
          </div>

          <p style={NOTE}>
            The value is read at exactly this condition, certificate and format — matching is strict,
            so a lot with an Attest stays unpriced until a price exists at that level. A multiple is
            priced as that multiple: an explicit catalogue price for the format, else the
            single&apos;s price times the format&apos;s multiplier, and with neither it stays
            unpriced rather than being valued as a single. Quantity is how many of{" "}
            <em>{count > 1 ? "each" : "these"}</em> the lot holds.
          </p>
        </DialogBody>

        <DialogActions
          actionLabel={actionLabel}
          disabled={isPending || !validCondition}
          error={error}
          onCancel={onClose}
          leading={
            <DialogSecondaryButton onClick={() => setPicking(true)} disabled={isPending}>
              ← {line ? "Change stamp" : "Back"}
            </DialogSecondaryButton>
          }
        />
      </form>
    </DialogShell>,
    document.body
  );
}
