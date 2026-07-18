"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { useIssueMembers } from "@/app/c/[collectionSlug]/issues/use-issues-query";
import type { IssueListItem } from "@/lib/issues";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { CatalogVendorData } from "@/lib/catalog";
import { StampCatalogPricesTab, formatPrice } from "./stamp-catalog-prices-tab";

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

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

const TAB_STYLE: React.CSSProperties = {
  padding: "0.625rem 1rem",
  fontSize: "0.875rem",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  marginBottom: "-1px",
};

type TabKey = "details" | "prices";

export interface StampFormData {
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  catalogNumbers: { catalogVendorId: string; number: string }[];
}

type StampFormDialogProps = {
  collectionId: string;
  areaVendors: AreaCatalogEntry[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
} & (
  | {
      mode: "edit";
      stampId: string;
      stamp: StampFormData;
      onSubmit: (formData: FormData) => void;
    }
  | {
      mode: "add";
      issues: IssueListItem[];
      prefilledIssueId?: string | null;
      prefilledParentStampId?: string | null;
      defaultCatalogNumbers?: { catalogVendorId: string; number: string }[];
      onSubmit: (issueId: string, formData: FormData) => void;
    }
);

export function StampFormDialog(props: StampFormDialogProps) {
  const { collectionId, areaVendors, isPending, error, onClose } = props;
  const editProps = props.mode === "edit" ? props : null;
  const addProps = props.mode === "add" ? props : null;

  const [activeTab, setActiveTab] = useState<TabKey>("details");
  const [catalogTree, setCatalogTree] = useState<CatalogVendorData[]>([]);
  const [priceEdits, setPriceEdits] = useState<Map<string, string>>(new Map());
  const [pricesLoaded, setPricesLoaded] = useState(false);

  const vendors = Array.from(
    new Map(areaVendors.map((v) => [v.catalogVendorId, v])).values()
  );
  const hasPricesTab = areaVendors.length > 0;

  // Currency is fixed per catalog edition — derived from the catalog, not editable.
  const currencyByEdition = useMemo(() => {
    const m = new Map<string, string>();
    for (const vendor of catalogTree) {
      for (const name of vendor.catalogNames) {
        for (const ed of name.catalogEditions) {
          m.set(ed.id, name.currency);
        }
      }
    }
    return m;
  }, [catalogTree]);

  // ── Prices data: catalog tree (both modes) + existing prices (edit only) ──
  const stampId = editProps?.stampId;
  const fetchPriceData = useCallback(async () => {
    const [{ getStampCatalogPricesAction }, { getCatalogTreeAction }] =
      await Promise.all([
        import("@/app/actions/stamps"),
        import("@/app/actions/catalog"),
      ]);
    const tree = await getCatalogTreeAction(collectionId);
    const prices = stampId ? await getStampCatalogPricesAction(stampId) : [];
    return { tree, prices };
  }, [collectionId, stampId]);

  useEffect(() => {
    if (!hasPricesTab) return;
    let cancelled = false;
    fetchPriceData().then((data) => {
      if (cancelled) return;
      setCatalogTree(data.tree);
      const edits = new Map<string, string>();
      for (const p of data.prices) {
        edits.set(p.catalogEditionId, formatPrice(p.price));
      }
      setPriceEdits(edits);
      setPricesLoaded(true);
    });
    return () => { cancelled = true; };
  }, [fetchPriceData, hasPricesTab]);

  function handlePriceChange(editionId: string, value: string) {
    setPriceEdits((prev) => {
      const next = new Map(prev);
      next.set(editionId, value);
      return next;
    });
  }

  // ── Add-mode state (unused in edit mode) ──
  const skipToFields = !!addProps?.prefilledIssueId;
  const [selectedIssueId, setSelectedIssueId] = useState(
    addProps ? (addProps.prefilledIssueId ?? addProps.issues[0]?.id ?? "") : ""
  );
  const [autoCreateIssue, setAutoCreateIssue] = useState(
    !!addProps && !addProps.prefilledIssueId && addProps.issues.length === 0
  );
  const [newIssueName, setNewIssueName] = useState("");
  const [newIssueYear, setNewIssueYear] = useState("");
  const [selectedParentId, setSelectedParentId] = useState(
    addProps?.prefilledParentStampId ?? ""
  );
  const [requiredForCompleteness, setRequiredForCompleteness] = useState(
    !addProps?.prefilledParentStampId
  );

  const needsMembers =
    !!addProps && !!selectedIssueId && !autoCreateIssue && !addProps.prefilledParentStampId;
  const { data: members } = useIssueMembers(collectionId, selectedIssueId || "", needsMembers);
  const stampOptions = members ?? [];

  const showIssueStep = !!addProps && !addProps.prefilledIssueId;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    if (pricesLoaded) {
      for (const [editionId, price] of priceEdits) {
        const currency = currencyByEdition.get(editionId);
        if (!currency) continue;
        if (props.mode === "edit") {
          // Send every row (incl. cleared) so removals are applied.
          fd.set(`catalogPrice_${editionId}`, price);
          fd.set(`catalogCurrency_${editionId}`, currency);
        } else if (price.trim()) {
          fd.set(`catalogPrice_${editionId}`, price);
          fd.set(`catalogCurrency_${editionId}`, currency);
        }
      }
    }

    if (props.mode === "edit") {
      props.onSubmit(fd);
      return;
    }

    if (autoCreateIssue) {
      fd.set("newIssueName", newIssueName.trim());
      fd.set("newIssueYear", newIssueYear.trim());
    }
    fd.set("requiredForCompleteness", requiredForCompleteness ? "true" : "false");
    props.onSubmit(autoCreateIssue ? "" : selectedIssueId, fd);
  }

  function catalogNumberDefault(catalogVendorId: string): string {
    if (editProps) {
      return editProps.stamp.catalogNumbers.find((cn) => cn.catalogVendorId === catalogVendorId)?.number ?? "";
    }
    return addProps?.defaultCatalogNumbers?.find((cn) => cn.catalogVendorId === catalogVendorId)?.number ?? "";
  }

  const title = props.mode === "edit" ? "Edit stamp" : "Add stamp";
  const actionLabel = isPending
    ? "Saving…"
    : props.mode === "edit"
      ? "Save"
      : "Add stamp";
  const actionDisabled =
    isPending || (props.mode === "add" && !autoCreateIssue && !selectedIssueId);

  return (
    <DialogShell title={title} onClose={onClose} minHeight="22rem">
      {/* Tab bar (only when the area has catalogs to price) */}
      {hasPricesTab && (
        <div
          style={{
            display: "flex",
            gap: 0,
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
            padding: "0 1.5rem",
          }}
        >
          {(["details", "prices"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                ...TAB_STYLE,
                fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? "var(--color-accent)" : "var(--color-text-secondary)",
                borderBottom: activeTab === tab ? "2px solid var(--color-accent)" : "2px solid transparent",
              }}
            >
              {tab === "details" ? "Details" : "Prices"}
            </button>
          ))}
        </div>
      )}

      <form style={FORM_STYLE} onSubmit={handleSubmit}>
        <DialogBody>
          {/* Details stays in flow to dictate dialog height; Prices overlays it. */}
          <div style={{ position: "relative" }}>
          {/* ── Details tab ── */}
          <div style={{ visibility: activeTab === "details" ? "visible" : "hidden" }}>
            {/* Issue selection (add only) */}
            {showIssueStep && addProps && (
              <div style={{ marginBottom: "1.25rem", paddingBottom: "1.25rem", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ marginBottom: "0.75rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Issue
                </div>

                {!autoCreateIssue && (
                  <div style={{ marginBottom: "0.75rem" }}>
                    <LabelWithError htmlFor="f-stamp-issue">Select issue</LabelWithError>
                    <select
                      id="f-stamp-issue"
                      value={selectedIssueId}
                      onChange={(e) => { setSelectedIssueId(e.target.value); setSelectedParentId(""); }}
                      disabled={isPending || addProps.issues.length === 0}
                      style={INPUT_STYLE}
                    >
                      {addProps.issues.length === 0 && <option value="">— No issues yet —</option>}
                      {addProps.issues.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name ?? "(unnamed)"}{i.year ? ` (${i.year})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={autoCreateIssue}
                    onChange={(e) => setAutoCreateIssue(e.target.checked)}
                    disabled={isPending}
                  />
                  Create new issue
                </label>

                {autoCreateIssue && (
                  <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.75rem" }}>
                    <div style={{ flex: 1 }}>
                      <LabelWithError htmlFor="f-new-issue-name">Issue name</LabelWithError>
                      <input
                        id="f-new-issue-name"
                        type="text"
                        value={newIssueName}
                        onChange={(e) => setNewIssueName(e.target.value)}
                        disabled={isPending}
                        placeholder="e.g. First Issue"
                        style={INPUT_STYLE}
                      />
                    </div>
                    <div style={{ width: "6rem", flexShrink: 0 }}>
                      <LabelWithError htmlFor="f-new-issue-year">Year</LabelWithError>
                      <input
                        id="f-new-issue-year"
                        type="number"
                        value={newIssueYear}
                        onChange={(e) => setNewIssueYear(e.target.value)}
                        disabled={isPending}
                        placeholder="1860"
                        min={1840}
                        max={2100}
                        style={INPUT_STYLE}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Parent node (add only) */}
            {addProps && !addProps.prefilledParentStampId && !autoCreateIssue && stampOptions.length > 0 && (
              <div style={{ marginBottom: "1.25rem" }}>
                <LabelWithError htmlFor="f-stamp-parent">Parent node (optional)</LabelWithError>
                <select
                  id="f-stamp-parent"
                  name="parentStampId"
                  value={selectedParentId}
                  onChange={(e) => setSelectedParentId(e.target.value)}
                  disabled={isPending}
                  style={INPUT_STYLE}
                >
                  <option value="">— No parent (root node) —</option>
                  {stampOptions.map((m) => (
                    <option key={m.stampId} value={m.stampId}>
                      {m.name ?? "(unnamed)"}{m.issuedYear ? ` (${m.issuedYear})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {addProps?.prefilledParentStampId && (
              <input type="hidden" name="parentStampId" value={addProps.prefilledParentStampId} />
            )}

            {/* Catalog numbers */}
            {vendors.length > 0 && (
              <div style={{ marginBottom: "0.875rem" }}>
                <LabelWithError>Catalog numbers</LabelWithError>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                  {vendors.map((v, i) => (
                    <div key={v.catalogVendorId} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ width: "4rem", flexShrink: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)", fontFamily: "monospace", fontWeight: 600 }}>
                        {v.vendorAbbreviation}{v.prefix ? `·${v.prefix}` : ""}
                      </span>
                      <input
                        name={`catalogNumber_${v.catalogVendorId}`}
                        type="text"
                        disabled={isPending}
                        placeholder="e.g. 1"
                        defaultValue={catalogNumberDefault(v.catalogVendorId)}
                        data-autofocus={(skipToFields && i === 0) || undefined}
                        style={{ ...INPUT_STYLE, flex: 1 }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Required for completeness (add only) */}
            {addProps && (
              <div style={{ marginBottom: "0.875rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={requiredForCompleteness}
                    onChange={(e) => setRequiredForCompleteness(e.target.checked)}
                    disabled={isPending}
                  />
                  Required for completeness
                </label>
              </div>
            )}

            {/* Name */}
            <div style={{ marginBottom: "0.875rem" }}>
              <LabelWithError htmlFor="f-stamp-name">Name (optional)</LabelWithError>
              <input
                id="f-stamp-name"
                name="name"
                type="text"
                disabled={isPending}
                defaultValue={editProps?.stamp.name ?? ""}
                placeholder="e.g. 5 kr blue"
                data-autofocus={
                  props.mode === "edit"
                    ? true
                    : (skipToFields && vendors.length === 0) || undefined
                }
                style={INPUT_STYLE}
              />
            </div>

            {/* Issued date */}
            <div>
              <LabelWithError>Issued date (optional — any part)</LabelWithError>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  name="issuedDay"
                  type="number"
                  disabled={isPending}
                  placeholder="Day"
                  defaultValue={editProps?.stamp.issuedDay ?? ""}
                  min={1}
                  max={31}
                  style={{ ...INPUT_STYLE, width: "4.5rem", flex: "none" }}
                />
                <input
                  name="issuedMonth"
                  type="number"
                  disabled={isPending}
                  placeholder="Month"
                  defaultValue={editProps?.stamp.issuedMonth ?? ""}
                  min={1}
                  max={12}
                  style={{ ...INPUT_STYLE, width: "5rem", flex: "none" }}
                />
                <input
                  name="issuedYear"
                  type="number"
                  disabled={isPending}
                  placeholder="Year"
                  defaultValue={
                    editProps
                      ? (editProps.stamp.issuedYear ?? "")
                      : (addProps?.issues.find((i) => i.id === selectedIssueId)?.year ?? undefined)
                  }
                  min={1840}
                  max={2100}
                  style={{ ...INPUT_STYLE, flex: 1 }}
                />
              </div>
            </div>
          </div>

          {/* ── Prices tab (overlays Details; own scroll if taller) ── */}
          {hasPricesTab && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                overflowY: "auto",
                display: activeTab === "prices" ? "block" : "none",
              }}
            >
              {!pricesLoaded ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
                  Loading prices…
                </div>
              ) : (
                <StampCatalogPricesTab
                  catalogTree={catalogTree}
                  areaVendors={areaVendors}
                  priceEdits={priceEdits}
                  onPriceChange={handlePriceChange}
                  disabled={isPending}
                />
              )}
            </div>
          )}
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          onCancel={onClose}
          disabled={actionDisabled}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
