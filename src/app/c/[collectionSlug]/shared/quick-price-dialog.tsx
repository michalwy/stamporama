"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import type { ItemListItem } from "@/lib/items";
import type { QuickCatalogPriceContext } from "@/lib/stamps";
import {
  formatStampCN,
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { PhotoStrip } from "@/app/c/[collectionSlug]/inventory/photo-thumb";

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

/**
 * Inline "set catalog value" dialog (#147, #170): prices a copy's stamp on the latest edition
 * of every catalog active on its area — one input per vendor, the primary catalog focused by
 * default for fast entry, the rest optional. Shows the stamp's issue, catalog numbers (primary
 * highlighted), condition badge, area, this copy's photos, and any prices already recorded (the
 * target rows marked) so the user can price consistently. Shared by the purchase-order intake
 * view (#121) and the sale-lot composition view (#164). The dialog only loads the context and
 * reports the entered amounts; the caller performs the save.
 */
export function QuickPriceDialog({
  item,
  collectionId,
  areaName,
  primaryVendorId,
  vendorMap,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  item: ItemListItem;
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

  useEffect(() => {
    let active = true;
    (async () => {
      const { getQuickCatalogPriceContextAction } = await import("@/app/actions/stamps");
      const r = await getQuickCatalogPriceContextAction(
        item.stampId,
        item.conditionId,
        item.certificateStatusId
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
  }, [item]);

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

  return (
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
                {catalogNumbers.map((cn) => (
                  <span
                    key={cn.catalogVendorId}
                    style={cn.catalogVendorId === primaryVendorId ? STAMP_PRIMARY_CHIP : STAMP_SECONDARY_CHIP}
                    title={cn.catalogVendorId === primaryVendorId ? "Primary catalog" : undefined}
                  >
                    {formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId))}
                  </span>
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
                    style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}
                  >
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
                ))}
              </div>
              <p style={{ margin: "0.625rem 0 0", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                Each value is saved on the latest edition of its catalog for this condition ×
                certificate. Leave a field blank to skip it.
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
    </DialogShell>
  );
}
