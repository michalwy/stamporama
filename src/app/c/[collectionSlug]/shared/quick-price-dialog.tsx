"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  ErrorBubble,
  LabelWithError,
} from "@/app/dialog-shell";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { ItemListItem } from "@/lib/items";
import type { QuickCatalogPriceContext } from "@/lib/stamps";
import { formatStampCN } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { PhotoStrip } from "@/app/c/[collectionSlug]/inventory/photo-thumb";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

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

/**
 * Inline "set catalog value" dialog (#147): prices a copy's stamp on the latest edition of its
 * primary catalog for the copy's condition × certificate, without leaving the list. Shows the
 * stamp's issue, catalog numbers, condition, area, this copy's photos, and any prices already
 * recorded (the target row marked) so the user can price consistently. Shared by the
 * purchase-order intake view (#121) and the sale-lot composition view (#164). The dialog only
 * loads the context and reports the entered `amount`; the caller performs the save.
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
  onSubmit: (amount: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [context, setContext] = useState<QuickCatalogPriceContext | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the amount field once it is enabled (autoFocus can't fire while it is disabled
  // during the context load).
  useEffect(() => {
    if (!loading && !loadError) inputRef.current?.focus();
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
        if (r.context.amount != null) setAmount(r.context.amount);
      } else {
        setLoadError(r.message);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [item]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(amount.trim());
  }

  const condLabel = `${item.conditionAbbreviation}${
    item.certificateStatusName ? ` · ${item.certificateStatusName}` : ""
  }`;
  const canSave = !isPending && !loading && !loadError && amount.trim() !== "";

  const issueLabel = item.issueName
    ? `${item.issueName}${item.issueYear ? ` (${item.issueYear})` : ""}`
    : null;
  const catalogNumbers = [...item.catalogNumbers].sort((a, b) => {
    const ap = a.catalogVendorId === primaryVendorId ? 0 : 1;
    const bp = b.catalogVendorId === primaryVendorId ? 0 : 1;
    return ap - bp;
  });

  return (
    <DialogShell title="Set catalog value" onClose={onClose} maxWidth="24rem">
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
              gap: "0.25rem",
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
              {item.stampName || "This stamp"}
            </div>
            {issueLabel && <div style={{ color: "var(--color-text-muted)" }}>Issue: {issueLabel}</div>}
            {catalogNumbers.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.125rem" }}>
                {catalogNumbers.map((cn) => (
                  <span key={cn.catalogVendorId} style={CHIP}>
                    {formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId))}
                  </span>
                ))}
              </div>
            )}
            <div>Condition: {condLabel}</div>
            {(context?.areaName ?? areaName) && (
              <div style={{ color: "var(--color-text-muted)" }}>Area: {context?.areaName ?? areaName}</div>
            )}
            {context && (
              <div style={{ color: "var(--color-text-muted)" }}>
                Primary catalog: {context.catalogLabel} {context.editionYear} · {context.currency}
              </div>
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
          ) : (
            <>
              <LabelWithError htmlFor="quick-price">
                Catalog value {context ? `(${context.currency})` : ""}
              </LabelWithError>
              <input
                id="quick-price"
                ref={inputRef}
                name="amount"
                type="number"
                step="0.01"
                min="0"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isPending || loading}
                placeholder={loading ? "Loading…" : "0.00"}
                style={INPUT_STYLE}
              />
              <p style={{ margin: "0.375rem 0 0", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                Saved on the latest edition of the primary catalog for this condition × certificate.
              </p>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {/* Cancel stays enabled while the amount is empty — only saving is gated by
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
