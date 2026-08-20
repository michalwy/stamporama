"use client";

import { useMemo, useState, useTransition } from "react";
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
import type { CollectionAreaData } from "@/lib/areas";
import type { TradeReceiveLineData } from "@/lib/trade-lines";
import type { AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import {
  addTradeReceiveLineAction,
  updateTradeReceiveLineAction,
} from "@/app/actions/trades";
import { useInvalidateTradeDetail } from "./use-trade-detail-query";

// Entering one line of the **receive** side (#637), as two steps: pick the stamp, then say what
// state it is in — the auction lot line's flow exactly, because it is the identical question about
// the identical kind of material. Neither is a copy anyone owns yet, and both are described from
// something in front of the collector (a listing there; a partner's list here).
//
// The picker is the **existing** `StampPickerBrowser`, and that matters more here than anywhere
// else: a partner's material routinely comes from an area this collection has never touched, and
// that picker already creates an issue and a stamp in flight. The alternative — leaving the screen
// to file a stamp first — would break the flow at exactly the wrong moment, halfway through typing
// out what somebody is offering you.
//
// Beside the stamp: condition, certificate status, format and quantity — the same key `Want` uses
// (ADR-0032), nullable members and all. A blank certificate **is** *no certificate* (ADR-0006 §2)
// and a blank format **is** the single (ADR-0020); neither is an unanswered question.
//
// What can be picked is a stamp **or a whole checklist**. A partner offering "Michel 1–12, complete"
// is offering twelve stamps, and twelve trips through a picker is the reason such an offer would go
// half-written down. It is an **entry shortcut only**: it expands server-side into one line per
// stamp, because every downstream reader — the piece count both sides balance on, the partner's copy
// of the list, the identification at closing — works per stamp. Editing offers stamps alone; turning
// one line into twelve is not an edit.

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

export function TradeReceiveLineDialog({
  collectionId,
  sectionId,
  areas,
  vendorMaps,
  line,
  onClose,
}: {
  collectionId: string;
  sectionId: string;
  areas: CollectionAreaData[];
  vendorMaps: AreaVendorMaps;
  /** The line being edited; absent when adding, which is what opens on the picker. */
  line?: TradeReceiveLineData;
  onClose: () => void;
}) {
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const { data: certificateStatuses = [] } = useCollectionCertificateStatuses(collectionId);
  const { data: formats = [] } = useCollectionFormats(collectionId);
  const { invalidateTrade } = useInvalidateTradeDetail();

  /** Edit-mode prefill for the summary, prefix-formatted from the line's **own** area (#357) —
   *  without it the chips would be bare numbers from three different catalogs. */
  const initial: PickedStamp | undefined = useMemo(() => {
    if (!line) return undefined;
    return {
      stampId: line.stampId,
      catalogLabels: orderedCatalogLabels(
        line.catalogNumbers,
        vendorMaps.vendorMapFor(line.areaId, line.issueId),
        line.areaId ? (vendorMaps.primaryVendorByArea.get(line.areaId) ?? null) : null
      ),
      name: line.stampName,
      secondary:
        line.issueName || line.issueYear ? issueLabel(line.issueName, line.issueYear) : null,
      unknownVariant: line.unknownVariant,
    };
  }, [line, vendorMaps]);

  const [picked, setPicked] = useState<PickedStamp | null>(initial ?? null);
  /** A whole set picked instead of a stamp. Add only. */
  const [checklist, setChecklist] = useState<PickedIssue | null>(null);
  // Adding opens on the picker: the affordance said "add a line", so the picker is the screen.
  const [picking, setPicking] = useState(!line);

  // Editing keeps what the line says; adding starts from what was last used — the same remembered
  // pair every add-copy entry point reads (#121, #234).
  const [conditionId, setConditionId] = useState(
    () => line?.conditionId ?? readLast(LS_LAST_CONDITION, collectionId)
  );
  const [certificateStatusId, setCertificateStatusId] = useState(
    () => line?.certificateStatusId ?? readLast(LS_LAST_CERT, collectionId)
  );
  const [formatId, setFormatId] = useState(line?.formatId ?? "");
  const [quantity, setQuantity] = useState(String(line?.quantity ?? 1));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

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
        onPick={(next) => {
          setPicked(next);
          setChecklist(null);
          setPicking(false);
        }}
        // Add only: an edit changes one line, and a whole set is a different act.
        onPickIssue={
          line
            ? undefined
            : (set) => {
                setChecklist(set);
                setPicked(null);
                setPicking(false);
              }
        }
        // Backing out with nothing chosen abandons the whole line; from an edit it returns to the
        // line still being edited.
        onClose={() => (line || picked || checklist ? setPicking(false) : onClose())}
      />
    );
  }
  if (!picked && !checklist) return null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // A portal propagates events along the **React** tree, not the DOM one, so without this a
    // submit here could reach the `onSubmit` of whatever form this dialog was opened from.
    e.stopPropagation();
    if (!picked && !checklist) return;
    writeLast(LS_LAST_CONDITION, collectionId, validCondition);
    writeLast(LS_LAST_CERT, collectionId, validCertificate);
    const raw = {
      stampId: picked?.stampId ?? "",
      ...(checklist ? { checklistId: checklist.checklistId } : {}),
      conditionId: validCondition,
      certificateStatusId: validCertificate,
      formatId,
      quantity,
    };
    setError(undefined);
    startTransition(async () => {
      const result = line
        ? await updateTradeReceiveLineAction(line.id, raw)
        : await addTradeReceiveLineAction(sectionId, raw);
      if (result.status === "success") {
        invalidateTrade(collectionId);
        onClose();
      } else {
        setError(result.message);
      }
    });
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <DialogShell
      title={line ? "Edit line" : "What is coming"}
      onClose={onClose}
      maxWidth="36rem"
    >
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={submit}
      >
        <DialogBody>
          {/* What was picked, restated — the picker is gone, and a form asking about "the
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
            {checklist ? (
              <>
                <div style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
                  Whole set: {checklist.label} — {checklist.requiredCount} stamp
                  {checklist.requiredCount === 1 ? "" : "s"}
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--color-text-muted)",
                    marginTop: "0.125rem",
                  }}
                >
                  One line each, all described the way you set below.
                </div>
              </>
            ) : (
              picked && (
                <>
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
                    {picked.catalogLabels.map((label) => (
                      <CatalogNumberChip key={label} label={label} style={STAMP_SECONDARY_CHIP} />
                    ))}
                    {(picked.name || picked.catalogLabels.length === 0) && (
                      <span>{picked.name || "(unnamed stamp)"}</span>
                    )}
                    {picked.unknownVariant && (
                      <span style={{ color: "var(--color-text-muted)" }}>— unknown variant</span>
                    )}
                  </div>
                  {picked.secondary && (
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--color-text-muted)",
                        marginTop: "0.125rem",
                      }}
                    >
                      {picked.secondary}
                    </div>
                  )}
                </>
              )
            )}
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="trade-line-condition">Condition</LabelWithError>
              <select
                id="trade-line-condition"
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
              <LabelWithError htmlFor="trade-line-certificate">Certificate</LabelWithError>
              <select
                id="trade-line-certificate"
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
              <LabelWithError htmlFor="trade-line-format">Format</LabelWithError>
              <select
                id="trade-line-format"
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
              <LabelWithError htmlFor="trade-line-quantity">Quantity</LabelWithError>
              <NumericInput
                id="trade-line-quantity"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
          </div>

          <p style={NOTE}>
            This is what the partner is offering, described the way your want list describes a
            stamp — nothing is created in your collection by writing it down. Quantity is how many
            of {checklist ? "each" : "these"} are coming; two of the same stamp at the same condition
            can equally be two lines.
          </p>
        </DialogBody>

        <DialogActions
          actionLabel={
            isPending
              ? "Saving…"
              : line
                ? "Save line"
                : checklist
                  ? `Add ${checklist.requiredCount} line${checklist.requiredCount === 1 ? "" : "s"}`
                  : "Add line"
          }
          disabled={isPending || !validCondition}
          cancelDisabled={isPending}
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
