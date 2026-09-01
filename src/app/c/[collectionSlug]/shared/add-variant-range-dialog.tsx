"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  type DialogAsideProps,
} from "@/app/dialog-shell";
import {
  parseVariantNumberSpec,
  formatCatalogNumber,
  AUTO_CREATE_MAX_STAMPS,
} from "@/lib/catalog-number";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { StampSubtypeData } from "@/lib/subtypes";
import type { CatalogDuplicateGroup, DuplicateCatalogMode } from "@/lib/duplicate-catalog";
import { LS_LAST_SUBTYPE, readLast, writeLast } from "./add-copy-defaults";

// A whole run of variants under one base stamp, in one save (#722).
//
// The single add dialog (#54) is the editor for a stamp, and this is deliberately *not* a second
// one: a variant range types the one thing that differs between six stamps — the catalog-number
// suffix — plus the one thing they share, the subtype. Everything else each stamp gets is what the
// single dialog would have given it, and everything else the collector wants to say about a
// particular variant is said by editing it afterwards.
//
// Only the **primary** catalogue is numbered here. A secondary catalogue's variant lettering does
// not follow the primary's position for position — that is exactly where catalogues disagree — so
// filling it in from a range would be guesswork, and it is typed per stamp as it always was.

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

export interface AddVariantRangeParent {
  stampId: string;
  name: string | null;
  catalogNumbers: { catalogVendorId: string; number: string }[];
}

interface AddVariantRangeDialogProps extends DialogAsideProps {
  collectionId: string;
  issueId: string;
  /** The issue every variant is filed under, named the way the rest of the app names it. */
  issueName: string;
  areaId: string;
  parent: AddVariantRangeParent;
  vendors: AreaCatalogEntry[];
  primaryVendorId: string | null;
  isPending: boolean;
  error?: React.ReactNode;
  onSubmit: (formData: FormData) => void;
  onClose: () => void;
}

export function AddVariantRangeDialog({
  aside,
  asideWidth,
  collectionId,
  issueId,
  issueName,
  areaId,
  parent,
  vendors,
  primaryVendorId,
  isPending,
  error,
  onSubmit,
  onClose,
}: AddVariantRangeDialogProps) {
  // The catalogue the run is numbered in: the area's primary one, which is what a range is for.
  // It gives way only when the base stamp carries no number *there* and does carry one somewhere
  // else — a suffix typed on its own has to hang off something, and the number the collector can
  // see on the stamp is the one they are writing against.
  const vendor = useMemo(() => {
    const numbered = (v: AreaCatalogEntry) =>
      parent.catalogNumbers.some((cn) => cn.catalogVendorId === v.catalogVendorId);
    const primary = vendors.find((v) => v.catalogVendorId === primaryVendorId);
    if (primary && numbered(primary)) return primary;
    return vendors.find(numbered) ?? primary ?? vendors[0] ?? null;
  }, [vendors, primaryVendorId, parent.catalogNumbers]);

  const baseNumber =
    parent.catalogNumbers.find((cn) => cn.catalogVendorId === vendor?.catalogVendorId)?.number ?? "";
  const baseLabel = vendor
    ? formatCatalogNumber(vendor.vendorAbbreviation, vendor.prefix, baseNumber || "—")
    : null;

  const [spec, setSpec] = useState("");

  // ── Subtype (#342): one for the whole run, starting where the single add dialog starts ──
  const [subtypes, setSubtypes] = useState<StampSubtypeData[]>([]);
  const [subtypeId, setSubtypeId] = useState("");
  useEffect(() => {
    let cancelled = false;
    import("@/app/actions/subtypes")
      .then((m) => m.getStampSubtypesAction(collectionId))
      .then((list) => {
        if (cancelled) return;
        setSubtypes(list);
        const defId = list.find((s) => s.isDefault)?.id ?? list[0]?.id ?? "";
        const remembered = readLast(LS_LAST_SUBTYPE, collectionId);
        setSubtypeId(list.some((s) => s.id === remembered) ? remembered : defId);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  const parsed = useMemo(
    () => (spec.trim() ? parseVariantNumberSpec(spec, baseNumber) : null),
    [spec, baseNumber]
  );
  const numbers = parsed && !("error" in parsed) ? parsed.numbers : [];
  const specError = parsed && "error" in parsed ? parsed.error : null;
  const overLimit = numbers.length > AUTO_CREATE_MAX_STAMPS;

  // ── Live duplicate check (#85), the issue's own range dialog verbatim ──
  const [dup, setDup] = useState<{ mode: DuplicateCatalogMode; groups: CatalogDuplicateGroup[] }>({
    mode: "warn",
    groups: [],
  });
  // The generated numbers as one scalar, so the debounce re-runs when they change and not on every
  // keystroke that leaves them the same ("a-f" and "a-f " generate the same six).
  const numbersKey = numbers.join(",");
  const catalogVendorId = vendor?.catalogVendorId ?? "";
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const list = numbersKey ? numbersKey.split(",") : [];
      if (!catalogVendorId || list.length === 0 || list.length > AUTO_CREATE_MAX_STAMPS) {
        if (!cancelled) setDup((prev) => ({ mode: prev.mode, groups: [] }));
        return;
      }
      const { checkCatalogDuplicatesAction } = await import("@/app/actions/duplicate-catalog");
      const res = await checkCatalogDuplicatesAction(
        collectionId,
        list.map((number) => ({ catalogVendorId, number })),
        // The issue may override its area's prefix (#377), which is part of the identity checked.
        { contextAreaId: areaId, contextIssueId: issueId }
      );
      if (!cancelled) setDup(res);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [collectionId, areaId, issueId, catalogVendorId, numbersKey]);

  const dupBlocking = dup.mode === "block" && dup.groups.length > 0;
  const canSubmit =
    !isPending && !!vendor && numbers.length > 0 && !specError && !overLimit && !dupBlocking;

  return (
    <DialogShell
      title="Add variant range"
      onClose={onClose}
      minHeight="22rem"
      // Opened from the stamp picker, this dialog covers the piece being identified; the picker
      // carries the scan tile along the whole chain (#592), so it comes here too. The aside is a
      // fixed column and the form takes what is left, so the panel has to widen to make room —
      // otherwise this dialog's narrow default cap squeezes the form to a few characters. Same
      // shape as the issue and stamp dialogs the picker opens beside it.
      aside={aside}
      asideWidth={asideWidth}
      maxWidth={aside ? "min(96vw, 56rem)" : undefined}
      height={aside ? "min(90vh, 44rem)" : undefined}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          // Remember the subtype just used, so the next child stamp starts there (#342).
          if (subtypeId) writeLast(LS_LAST_SUBTYPE, collectionId, subtypeId);
          onSubmit(new FormData(e.currentTarget));
        }}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        <DialogBody>
          {!vendor ? (
            <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
              This stamp&apos;s area has no catalog vendors configured.
            </p>
          ) : (
            <>
              <p
                style={{
                  margin: "0 0 1rem",
                  fontSize: "0.875rem",
                  color: "var(--color-text-secondary)",
                }}
              >
                Add variants under <strong>{baseLabel}</strong>
                {parent.name ? ` — ${parent.name}` : ""}, filed under {issueName}. They are
                numbered in <strong>{vendor.vendorName}</strong>; other catalogs are filled in per
                stamp.
              </p>

              <input type="hidden" name="catalogVendorId" value={vendor.catalogVendorId} />

              <LabelWithError htmlFor="f-variant-numbers">Variant numbers</LabelWithError>
              <input
                id="f-variant-numbers"
                name="variantNumbers"
                type="text"
                value={spec}
                autoFocus
                disabled={isPending}
                placeholder={baseNumber ? `e.g. a-f, or ${baseNumber}a-${baseNumber}f` : "e.g. 240a-240f"}
                onChange={(e) => setSpec(e.target.value)}
                style={INPUT_STYLE}
              />
              <div
                style={{
                  marginTop: "0.25rem",
                  fontSize: "0.75rem",
                  color: "var(--color-text-muted)",
                }}
              >
                Suffixes on their own (<code>a-f</code>, <code>A-C</code>, <code>I-III</code>,
                <code>a, c, e</code>) are read against{" "}
                {baseNumber ? <strong>{baseNumber}</strong> : "the base number"}; full numbers work
                too.
              </div>

              {subtypes.length > 0 && (
                <div style={{ marginTop: "1rem" }}>
                  <LabelWithError htmlFor="f-variant-subtype">Subtype</LabelWithError>
                  <select
                    id="f-variant-subtype"
                    name="subtypeId"
                    value={subtypeId}
                    onChange={(e) => setSubtypeId(e.target.value)}
                    disabled={isPending}
                    style={INPUT_STYLE}
                  >
                    {subtypes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.actsAsVariant ? " (variant)" : ""}
                      </option>
                    ))}
                  </select>
                  <div
                    style={{
                      marginTop: "0.25rem",
                      fontSize: "0.75rem",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    Every variant in the run gets this subtype.
                  </div>
                </div>
              )}

              {/* Live summary */}
              <div style={{ marginTop: "1rem", fontSize: "0.8125rem" }}>
                {specError ? (
                  <span style={{ color: "var(--color-error)" }}>{specError}</span>
                ) : numbers.length === 0 ? (
                  <span style={{ color: "var(--color-text-muted)" }}>
                    Enter the variant numbers to preview.
                  </span>
                ) : overLimit ? (
                  <span style={{ color: "var(--color-error)" }}>
                    Range cannot exceed {AUTO_CREATE_MAX_STAMPS} stamps ({numbers.length}{" "}
                    requested).
                  </span>
                ) : (
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    Will create <strong>{numbers.length}</strong>{" "}
                    {numbers.length === 1 ? "variant" : "variants"}{" "}
                    <span style={{ color: "var(--color-text-muted)" }}>
                      ({numbers.slice(0, 8).join(", ")}
                      {numbers.length > 8 ? "…" : ""})
                    </span>
                    .
                  </span>
                )}
              </div>

              {dup.groups.length > 0 && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    fontSize: "0.8125rem",
                    color: dupBlocking ? "var(--color-error)" : "var(--color-warning)",
                  }}
                >
                  {dupBlocking ? "Blocked — duplicate" : "Warning — duplicate"} catalog{" "}
                  {dup.groups.length === 1 ? "number" : "numbers"} already in this collection:{" "}
                  {dup.groups.slice(0, 5).map((g) => g.label).join(", ")}
                  {dup.groups.length > 5 ? ` and ${dup.groups.length - 5} more` : ""}.
                  {dupBlocking
                    ? " Switch to warnings under Settings → Duplicates to save anyway."
                    : ""}
                </div>
              )}
            </>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Adding…" : "Add variants"}
          onCancel={onClose}
          disabled={!canSubmit}
          cancelDisabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
