"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { PhotoSummary } from "@/lib/photos";
import type { QuickCatalogPriceContext } from "@/lib/stamps";
import { deriveFormatPrice } from "@/lib/format-factor";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import {
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { PhotoStrip } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { CatalogNumberChip } from "@/app/c/[collectionSlug]/shared/catalog-number-chip";

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

/** Condition badge (#227): emphasises which condition × certificate the entered value applies
 * to, so it can't be missed in the "this stamp" card. */
const CONDITION_BADGE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  color: "var(--color-accent)",
  background: "var(--color-accent-soft)",
  border: "1px solid var(--color-accent-border)",
  whiteSpace: "nowrap",
};

/** What the dialog prices: a stamp at one condition × certificate, plus the context it shows.
 * `ItemListItem` satisfies it structurally (a copy carries its own condition and format), and the
 * Issue list builds one from a stamp-tree node plus the list's display condition and display format
 * (#341, #343). The format is **context, not a target** — see the dialog's own doc comment. */
export interface QuickPriceSubject {
  stampId: string;
  stampName: string | null;
  issueName: string | null;
  issueYear: number | null;
  conditionId: string;
  conditionAbbreviation: string;
  certificateStatusId: string | null;
  certificateStatusName: string | null;
  /** The format the calling screen is *showing* — a copy's own format, or a list's format switcher
   * (#343). Null / absent is the single. It is never written: it buys the read-only line saying what
   * the figure being typed works out at for a copy in that format. */
  formatId?: string | null;
  /** Kept because a copy row's item and a lot line both carry one structurally; the dialog names the
   * format from the loaded context instead, which is the same read that resolves its factor. */
  formatAbbreviation?: string | null;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  photos: PhotoSummary[];
}

/**
 * Inline "set catalog value" dialog (#147, #170): prices a stamp on the latest edition of every
 * catalog active on its area — one input per vendor, the primary catalog focused by default for
 * fast entry, the rest optional. Shows the stamp's issue, catalog numbers (primary highlighted),
 * condition badge, area, the subject's photos, and any prices already recorded (the target rows
 * marked) so the user can price consistently. Shared by the purchase-order intake view (#121),
 * the sale-lot composition view (#164), the Copies list (#228) and the Issue list (#341). The
 * dialog only loads the context and reports the entered amounts; the caller performs the save.
 *
 * ## It always prices the single, wherever it is opened from
 *
 * A figure typed here is read off a paper catalogue, and a catalogue quotes singles. A multiple's
 * value is that quotation times the resolved `StampFormatFactor` — which is exactly how a copy in
 * that format is valued when it carries no explicit price of its own (`pickFormatCatalogPrice`). So
 * the row read and written is the **single's**, whatever format the calling screen is showing, and
 * the shown format earns a *read-only* line per catalogue instead: `× 2.2 = 27.50` as the collector
 * types, so the number they are checking against the copy in their hand is on screen without the
 * dialog pretending to write it.
 *
 * Writing the shown format's row instead would do two wrong things at once — file a single's
 * quotation as the multiple's own price, and suppress the factor for that stamp for good — from a
 * dialog whose collector asked for neither. A multiple whose real price *deviates* from the
 * derivation is a deliberate act: an explicit row on the stamp's **Prices** tab, the one screen that
 * shows the grid it deviates from. When such a row already exists the line says so and names it,
 * because then nothing typed here changes what that copy is worth.
 */
export function QuickPriceDialog({
  subject: item,
  collectionId,
  areaName,
  primaryVendorId,
  vendorMap,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  subject: QuickPriceSubject;
  collectionId: string;
  areaName: string | null;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (entries: Array<{ catalogNameId: string; amount: string }>) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [context, setContext] = useState<QuickCatalogPriceContext | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const primaryInputRef = useRef<HTMLInputElement>(null);

  // Focus the primary catalog's field once inputs are enabled (autoFocus can't fire while
  // they are disabled during the context load).
  useEffect(() => {
    if (!loading && !loadError) primaryInputRef.current?.focus();
  }, [loading, loadError]);

  // Keyed on the identity fields, not the subject object: a caller building the subject
  // inline (the Issue list's stamp rows) would otherwise refetch on every render.
  const { stampId, conditionId, certificateStatusId } = item;
  /** The format the caller is showing. It changes what the dialog *says*, never what it reads or
   * writes — but it is still in the key, since the derived line and any explicit format price on
   * file come back with the context. */
  const displayFormatId = item.formatId ?? null;
  useEffect(() => {
    let active = true;
    (async () => {
      const { getQuickCatalogPriceContextAction } = await import("@/app/actions/stamps");
      const r = await getQuickCatalogPriceContextAction(
        stampId,
        conditionId,
        certificateStatusId,
        displayFormatId
      );
      if (!active) return;
      if (r.status === "success") {
        setContext(r.context);
        setAmounts(
          Object.fromEntries(
            r.context.catalogs.flatMap((c) => (c.amount != null ? [[c.catalogNameId, c.amount]] : []))
          )
        );
      } else {
        setLoadError(r.message);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [stampId, conditionId, certificateStatusId, displayFormatId]);

  const filledEntries = useMemo(
    () =>
      (context?.catalogs ?? []).flatMap((c) => {
        const amount = (amounts[c.catalogNameId] ?? "").trim();
        return amount !== "" ? [{ catalogNameId: c.catalogNameId, amount }] : [];
      }),
    [context, amounts]
  );

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(filledEntries);
  }

  /**
   * The read-only line under one catalogue's input, saying what a copy in the *shown* format is
   * worth — null when the caller is showing singles, which is most of them, and there is nothing to
   * add.
   *
   * Three answers, and they are different:
   *
   * - an **explicit** price is already on file for that format, so the factor does not apply and
   *   nothing typed here moves it — named, with where to change it;
   * - a factor applies → the derivation, recomputed as the collector types, so the figure they are
   *   checking against the copy in their hand is on screen;
   * - no factor and no explicit price → said plainly, because a copy in that format stays *unpriced*
   *   however carefully the single is filled in here, and that is worth knowing before the dialog
   *   closes on a job that looks done.
   */
  function derivedLineFor(c: QuickCatalogPriceContext["catalogs"][number]): string | null {
    const fmt = context?.displayFormat;
    if (!fmt) return null;
    if (c.formatAmount != null) {
      return `${fmt.abbreviation}: ${c.formatAmount} ${c.currency} recorded explicitly — not derived from this value`;
    }
    if (fmt.factor == null) {
      return `${fmt.abbreviation}: no factor set, so it stays unpriced`;
    }
    // A blank or unparseable field shows the multiplier alone rather than a derived `0.00`, which
    // would read as a value.
    const raw = (amounts[c.catalogNameId] ?? "").trim();
    const typed = raw === "" ? NaN : Number(normalizeDecimalInput(raw));
    if (!Number.isFinite(typed)) return `${fmt.abbreviation}: × ${fmt.factor}`;
    return `${fmt.abbreviation}: × ${fmt.factor} = ${deriveFormatPrice(typed, fmt.factor).toFixed(2)} ${c.currency}`;
  }

  // The badge names every axis the value is keyed on — condition and certificate, at the single.
  // The shown format is deliberately **not** on it: it is not an axis of what is being written, and
  // a badge reading "MNH · 4-blk" over an input that files the single's price would be the exact
  // misreading #343's badge was added to prevent. The format gets its own derived line below.
  const condLabel = `${item.conditionAbbreviation}${
    item.certificateStatusName ? ` · ${item.certificateStatusName}` : ""
  }`;
  const hasCatalogs = (context?.catalogs.length ?? 0) > 0;
  const canSave = !isPending && !loading && !loadError && filledEntries.length > 0;

  const issueLabel = item.issueName
    ? `${item.issueName}${item.issueYear ? ` (${item.issueYear})` : ""}`
    : null;
  const catalogNumbers = [...item.catalogNumbers].sort((a, b) => {
    const ap = a.catalogVendorId === primaryVendorId ? 0 : 1;
    const bp = b.catalogVendorId === primaryVendorId ? 0 : 1;
    return ap - bp;
  });

  // Portalled to the document, the way every dialog that can be opened **from inside another
  // dialog** is: a fixed-position panel inside one of `DialogShell`'s own panels is positioned
  // against that panel — the shell centres itself with a transform, which makes it the containing
  // block — and clipped by its `overflow: hidden`. The listing wizard (#730) opens this one from its
  // first step, and the surfaces that opened it before are unaffected: the panel is fixed either way.
  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell title="Set catalog value" onClose={onClose} maxWidth="32rem">
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.625rem 0.75rem",
              borderRadius: "0.5rem",
              background: "var(--color-bg-page)",
              border: "1px solid var(--color-border)",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
              display: "flex",
              flexDirection: "column",
              gap: "0.375rem",
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
              {item.stampName || "This stamp"}
            </div>
            {issueLabel && <div style={{ color: "var(--color-text-muted)" }}>Issue: {issueLabel}</div>}
            {catalogNumbers.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.125rem" }}>
                {/* The chips carry the copy hint (#420) rather than a "Primary catalog" one: the
                    accent styling already says which catalogue leads, exactly as it does on every
                    list, and a chip cannot show two bubbles. */}
                {catalogNumbers.map((cn) => (
                  <CatalogNumberChip
                    key={cn.catalogVendorId}
                    number={cn.number}
                    vendor={vendorMap.get(cn.catalogVendorId)}
                    style={
                      cn.catalogVendorId === primaryVendorId
                        ? STAMP_PRIMARY_CHIP
                        : STAMP_SECONDARY_CHIP
                    }
                  />
                ))}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
              <span style={{ color: "var(--color-text-muted)" }}>Condition:</span>
              <span style={CONDITION_BADGE}>{condLabel}</span>
            </div>
            {(context?.areaName ?? areaName) && (
              <div style={{ color: "var(--color-text-muted)" }}>Area: {context?.areaName ?? areaName}</div>
            )}
            {item.photos.length > 0 && (
              <div style={{ marginTop: "0.25rem" }}>
                <PhotoStrip collectionId={collectionId} photos={item.photos} />
              </div>
            )}
          </div>

          {context && context.otherPrices.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--color-text-muted)",
                  marginBottom: "0.375rem",
                }}
              >
                Recorded prices
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                {context.otherPrices.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "0.5rem",
                      fontSize: "0.8125rem",
                      color: p.isTarget ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                      fontWeight: p.isTarget ? 600 : 400,
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                      {p.catalogLabel} {p.editionYear}
                    </span>
                    <span style={{ whiteSpace: "nowrap" }}>
                      {p.conditionAbbreviation}
                      {p.certificateStatusName ? ` · ${p.certificateStatusName}` : ""}
                      {p.formatAbbreviation ? ` · ${p.formatAbbreviation}` : ""}
                    </span>
                    <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {p.price} {p.currency}
                      {p.isTarget ? " ←" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loadError ? (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-error)" }}>{loadError}</p>
          ) : loading ? (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>Loading…</p>
          ) : !hasCatalogs ? (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              No catalog with an edition is set up for this stamp&apos;s area. Add a catalog edition on
              the Catalog screen to record a value.
            </p>
          ) : (
            <>
              <div
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--color-text-muted)",
                  marginBottom: "0.5rem",
                }}
              >
                Catalog value
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                {context!.catalogs.map((c) => (
                  <div
                    key={c.catalogNameId}
                    style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
                  >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <label
                      htmlFor={`quick-price-${c.catalogNameId}`}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.125rem",
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.375rem",
                          fontSize: "0.8125rem",
                          fontWeight: c.isPrimary ? 600 : 500,
                          color: "var(--color-text-primary)",
                        }}
                      >
                        {c.catalogLabel}
                        {c.isPrimary && (
                          <span
                            style={{
                              fontSize: "0.625rem",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              color: "var(--color-accent)",
                            }}
                          >
                            Primary
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                        {c.vendorAbbreviation} · {c.editionYear} · {c.currency}
                      </span>
                    </label>
                    <NumericInput
                      id={`quick-price-${c.catalogNameId}`}
                      ref={c.isPrimary ? primaryInputRef : undefined}
                      name={`amount-${c.catalogNameId}`}
                      value={amounts[c.catalogNameId] ?? ""}
                      onChange={(e) =>
                        setAmounts((prev) => ({ ...prev, [c.catalogNameId]: e.target.value }))
                      }
                      disabled={isPending}
                      placeholder="0.00"
                      style={{ ...INPUT_STYLE, width: "8rem", flexShrink: 0, textAlign: "right" }}
                    />
                  </div>
                    {/* What the copy on screen is worth, when it is not a single — read-only, and
                        right-aligned under the input it follows from. */}
                    {derivedLineFor(c) && (
                      <span
                        style={{
                          alignSelf: "flex-end",
                          fontSize: "0.6875rem",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        {derivedLineFor(c)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p style={{ margin: "0.625rem 0 0", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                Each value is saved on the latest edition of its catalog for this condition ×
                certificate, as the <strong>single&apos;s</strong> value — a multiple is derived from
                it by that format&apos;s factor. Leave a field blank to skip it. To price a multiple
                differently from its factor, edit the stamp&apos;s <strong>Prices</strong> tab.
              </p>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {/* Cancel stays enabled while no amount is entered — only saving is gated by
              `canSave`; disabling both (via DialogActions' single `disabled`) would trap the
              user in the dialog until they typed a value. */}
          <DialogSecondaryButton onClick={onClose} disabled={isPending}>
            Cancel
          </DialogSecondaryButton>
          <div style={{ position: "relative" }}>
            <ErrorBubble>{error}</ErrorBubble>
            <DialogPrimaryButton type="submit" disabled={!canSave}>
              {isPending ? "Saving…" : "Save"}
            </DialogPrimaryButton>
          </div>
        </DialogFooter>
      </form>
    </DialogShell>,
    document.body
  );
}
