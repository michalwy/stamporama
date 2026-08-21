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
import { type PickedStamp } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import type { CollectionAreaData } from "@/lib/areas";
import type { GiveRequirementReport } from "@/lib/trade-give-resolution";
import {
  describeGiveResolution,
  isGiveGap,
  summariseGiveResolutions,
  GIVE_AXIS_ANY,
  GIVE_AXIS_NONE,
} from "@/lib/trade-give-resolution-rules";
import { addTradeGiveLinesByStampAction } from "@/app/actions/trades";
import { useInvalidateTradeDetail } from "./use-trade-detail-query";

// Adding a give line **by stamp** (#659), which is the only way a partner ever asks: their list says
// *this stamp, in this condition*, and never which of your three copies.
//
// The other way in — "Add copies" — is the collector browsing their own shelf. This one starts from
// the partner's sentence and lets the resolver find the copy, by the fixed order stated in
// `trade-give-resolution-rules.ts`: what is marked for trade, then the plain single, then something
// with a photo to show, then the lowest copy number so a list read twice reads the same.
//
// The picker is the receive side's — `StampPickerBrowser`, whole sets included. A partner asking for
// "Michel 1–12, complete" is asking twelve questions, and the answer to most of them may well be
// *not that one*; twelve trips through a picker is the reason such a request would go half-answered.
//
// **The two optional axes are narrowings, not values.** They open on *any*, because a wish list says
// nothing about a certificate or a format — and reading that silence as "no certificate" would hide
// the collector's only copy behind a requirement nobody stated. Saying *None* explicitly is a
// different sentence, and available.
//
// **A gap is the answer, not a failure.** What comes back is a report: the lines that were made, and
// the requirements nothing could serve — which is precisely what the collector writes back to the
// partner, and on a whole set the main thing they learn.

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

const SUBJECT_BOX: React.CSSProperties = {
  marginBottom: "1rem",
  padding: "0.625rem 0.75rem",
  borderRadius: "0.5rem",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
};

const REPORT_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "0.75rem",
  padding: "0.375rem 0",
  borderTop: "1px solid var(--color-border)",
  fontSize: "0.8125rem",
};

export function TradeGiveRequirementDialog({
  collectionId,
  sectionId,
  sectionName,
  areas,
  onClose,
}: {
  collectionId: string;
  sectionId: string;
  sectionName: string;
  areas: CollectionAreaData[];
  onClose: () => void;
}) {
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const { data: certificateStatuses = [] } = useCollectionCertificateStatuses(collectionId);
  const { data: formats = [] } = useCollectionFormats(collectionId);
  const { invalidateTrade } = useInvalidateTradeDetail();

  const [picked, setPicked] = useState<PickedStamp | null>(null);
  /** A whole set asked for instead of a stamp — one requirement per stamp on it. */
  const [checklist, setChecklist] = useState<PickedIssue | null>(null);
  // The affordance said "by stamp", so the picker is the screen it opens on.
  const [picking, setPicking] = useState(true);

  const [conditionId, setConditionId] = useState(() =>
    readLast(LS_LAST_CONDITION, collectionId)
  );
  const [certificateStatusId, setCertificateStatusId] = useState<string>(GIVE_AXIS_ANY);
  const [formatId, setFormatId] = useState<string>(GIVE_AXIS_ANY);
  const [quantity, setQuantity] = useState("1");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  /** What the resolver came to. Present means the dialog is showing the report rather than the
   *  form — the one screen the whole act exists to produce when the answer is *you do not hold it*. */
  const [report, setReport] = useState<GiveRequirementReport | null>(null);

  // A remembered condition that no longer exists in this collection must not silently select nothing.
  const validCondition = conditions.some((c) => c.id === conditionId) ? conditionId : "";

  const summary = useMemo(
    () => (report ? summariseGiveResolutions(report.outcomes) : null),
    [report]
  );

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
        onPickIssue={(set) => {
          setChecklist(set);
          setPicked(null);
          setPicking(false);
        }}
        // Backing out with nothing chosen abandons the whole thing.
        onClose={() => (picked || checklist ? setPicking(false) : onClose())}
      />
    );
  }
  if (!picked && !checklist) return null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // A portal propagates events along the **React** tree, not the DOM one, so without this a
    // submit here could reach the `onSubmit` of whatever form this dialog was opened from.
    e.stopPropagation();
    writeLast(LS_LAST_CONDITION, collectionId, validCondition);
    const raw = {
      stampId: picked?.stampId ?? "",
      ...(checklist ? { checklistId: checklist.checklistId } : {}),
      conditionId: validCondition,
      certificateStatusId,
      formatId,
      quantity,
    };
    setError(undefined);
    startTransition(async () => {
      const result = await addTradeGiveLinesByStampAction(sectionId, raw);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      invalidateTrade(collectionId);
      // Everything asked for, nothing refused: there is nothing to tell the collector that the
      // lines themselves do not already say.
      if (result.refused.length === 0 && result.outcomes.every((o) => o.missing === 0)) {
        onClose();
        return;
      }
      setReport({
        added: result.added,
        refused: result.refused,
        outcomes: result.outcomes,
      });
    });
  }

  if (typeof document === "undefined") return null;

  if (report && summary) {
    return createPortal(
      <DialogShell title="What you can give" onClose={onClose} maxWidth="34rem">
        <DialogBody>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
            {report.added === 0
              ? "Nothing was added."
              : `${report.added} ${report.added === 1 ? "line" : "lines"} added to ${sectionName}.`}{" "}
            {summary.gaps > 0 &&
              `${summary.gaps} of these you do not hold in that condition${
                summary.shortfalls > 0 ? "," : "."
              }`}{" "}
            {summary.shortfalls > 0 && `${summary.shortfalls} you hold fewer of than asked.`}
          </p>
          <div style={{ marginTop: "0.75rem" }}>
            {report.outcomes.map((outcome) => (
              <div key={outcome.index} style={REPORT_ROW}>
                <span
                  style={{
                    color: isGiveGap(outcome)
                      ? "var(--color-text-muted)"
                      : "var(--color-text-primary)",
                  }}
                >
                  {outcome.stampLabel}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    color:
                      outcome.missing > 0
                        ? "var(--color-warning)"
                        : "var(--color-text-secondary)",
                  }}
                >
                  {describeGiveResolution(outcome)}
                </span>
              </div>
            ))}
          </div>
          {/* Copies that were free when the list was resolved and gone by the time it was written —
              the reason eligibility is re-checked on write at all. Named, never counted. */}
          {report.refused.length > 0 && (
            <p style={NOTE}>{report.refused.map((r) => r.reason).join(" ")}</p>
          )}
          <p style={NOTE}>
            This list is what you send back: a stamp with nothing against it is one you do not hold
            in that condition, and saying so is half of answering a wish list.
          </p>
        </DialogBody>
        <DialogActions actionLabel="Done" onCancel={onClose} onAction={onClose} />
      </DialogShell>,
      document.body
    );
  }

  return createPortal(
    <DialogShell title="Give by stamp" onClose={onClose} maxWidth="36rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={submit}
      >
        <DialogBody>
          {/* What was asked for, restated — the picker is gone, and a form asking about "the
              condition" without saying of what is a form you cannot check. */}
          <div style={SUBJECT_BOX}>
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
                  One requirement each; the ones you hold become lines, the rest come back as gaps.
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
              <LabelWithError htmlFor="give-requirement-condition">Condition</LabelWithError>
              <select
                id="give-requirement-condition"
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
            <div style={{ width: "7rem", flexShrink: 0 }}>
              <LabelWithError htmlFor="give-requirement-quantity">Quantity</LabelWithError>
              <NumericInput
                id="give-requirement-quantity"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="give-requirement-certificate">Certificate</LabelWithError>
              <select
                id="give-requirement-certificate"
                value={certificateStatusId}
                onChange={(e) => setCertificateStatusId(e.target.value)}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {/* Any is the default: the partner said nothing about it. */}
                <option value={GIVE_AXIS_ANY}>Any</option>
                <option value={GIVE_AXIS_NONE}>No certificate</option>
                {certificateStatuses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="give-requirement-format">Format</LabelWithError>
              <select
                id="give-requirement-format"
                value={formatId}
                onChange={(e) => setFormatId(e.target.value)}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value={GIVE_AXIS_ANY}>Any</option>
                <option value={GIVE_AXIS_NONE}>Single</option>
                {formats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p style={NOTE}>
            The copy is chosen for you: what you have marked for trade first, then the plain single
            over a certified piece or a multiple, then one with a photo to show, and the lowest copy
            number to settle it. Nothing sold, gone, still in the post, promised to another trade or
            held back on this one is ever picked — and if you hold none, this comes back as a gap
            rather than a line.
          </p>
        </DialogBody>

        <DialogActions
          actionLabel={
            isPending
              ? "Finding copies…"
              : checklist
                ? `Give what I hold of ${checklist.requiredCount}`
                : "Add copy"
          }
          disabled={isPending || !validCondition}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
          leading={
            <DialogSecondaryButton onClick={() => setPicking(true)} disabled={isPending}>
              ← Back
            </DialogSecondaryButton>
          }
        />
      </form>
    </DialogShell>,
    document.body
  );
}
