"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import {
  PhotoEditor,
  type PhotoEditorValue,
} from "@/app/c/[collectionSlug]/inventory/photo-editor";
import type { PhotoSummary } from "@/lib/photos";
import { useIssueMembers } from "@/app/c/[collectionSlug]/issues/use-issues-query";
import type { IssueListItem } from "@/lib/issues";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { CatalogVendorData } from "@/lib/catalog";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampSubtypeData } from "@/lib/subtypes";
import { computeIssueRangeExtension } from "@/lib/catalog-number";
import { StampCatalogPricesTab, formatPrice, priceCellKey } from "./stamp-catalog-prices-tab";
import { Segmented } from "./segmented";
import { CatalogDuplicateWarningIcon } from "./catalog-duplicate-warning";
import type { CatalogDuplicateGroup, DuplicateCatalogMode } from "@/lib/duplicate-catalog";

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
  issues?: { requiredForCompleteness: boolean }[];
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
  const [conditions, setConditions] = useState<StampConditionData[]>([]);
  const [certificateStatuses, setCertificateStatuses] = useState<CertificateStatusData[]>([]);
  // Keyed by `${editionId}~${conditionId}~${certId}` (certId "" = no certificate).
  const [priceEdits, setPriceEdits] = useState<Map<string, string>>(new Map());
  // Cell keys (`${editionId}~${conditionId}~${certId}`) that had a price at load,
  // used to decide which older edition/condition rows to show. Snapshotted so the
  // grid doesn't jump around as the user types.
  const [pricedCells, setPricedCells] = useState<Set<string>>(new Set());
  const [pricesLoaded, setPricesLoaded] = useState(false);

  // ── Photos (#137): direct stamp-photo upload, add + edit modes ──
  // Pending change-set held in a ref so PhotoEditor's derive-on-change loop never re-renders
  // this dialog; serialized into the form on Save (one logical action), applied server-side
  // (edit: updateStampWithCatalog; add: addStampToIssue) after the stamp exists.
  const photoValueRef = useRef<PhotoEditorValue>({
    changeSet: { add: [], update: [], remove: [] },
    uploading: false,
  });
  const [photosUploading, setPhotosUploading] = useState(false);
  const handlePhotoChange = useCallback((value: PhotoEditorValue) => {
    photoValueRef.current = value;
    setPhotosUploading(value.uploading);
  }, []);
  // Existing stamp photos (edit only); add mode starts empty.
  const [initialPhotos, setInitialPhotos] = useState<PhotoSummary[]>([]);
  const [photosLoaded, setPhotosLoaded] = useState(props.mode === "add");

  const vendors = Array.from(
    new Map(areaVendors.map((v) => [v.catalogVendorId, v])).values()
  );
  const hasPricesTab = areaVendors.length > 0;

  // ── Live duplicate-catalog detection (#85) ──
  // Catalog-number inputs are controlled so their values can be checked against
  // existing stamps as the user types (debounced). The warning is advisory in
  // "warn" mode; in "block" mode the same conflicts also disable the save.
  const [catalogInputs, setCatalogInputs] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const v of vendors) {
      m[v.catalogVendorId] = editProps
        ? (editProps.stamp.catalogNumbers.find((cn) => cn.catalogVendorId === v.catalogVendorId)
            ?.number ?? "")
        : (addProps?.defaultCatalogNumbers?.find((cn) => cn.catalogVendorId === v.catalogVendorId)
            ?.number ?? "");
    }
    return m;
  });
  const [dupCheck, setDupCheck] = useState<{
    mode: DuplicateCatalogMode;
    groups: CatalogDuplicateGroup[];
  }>({ mode: "warn", groups: [] });

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
    const [
      { getStampCatalogPricesAction },
      { getCatalogTreeAction },
      { getStampConditionsAction },
      { getCertificateStatusesAction },
    ] = await Promise.all([
      import("@/app/actions/stamps"),
      import("@/app/actions/catalog"),
      import("@/app/actions/conditions"),
      import("@/app/actions/certificate-statuses"),
    ]);
    const [tree, conditions, certificateStatuses, prices] = await Promise.all([
      getCatalogTreeAction(collectionId),
      getStampConditionsAction(collectionId),
      getCertificateStatusesAction(collectionId),
      stampId ? getStampCatalogPricesAction(stampId) : Promise.resolve([]),
    ]);
    return { tree, conditions, certificateStatuses, prices };
  }, [collectionId, stampId]);

  useEffect(() => {
    if (!hasPricesTab) return;
    let cancelled = false;
    fetchPriceData().then((data) => {
      if (cancelled) return;
      setCatalogTree(data.tree);
      setConditions(data.conditions);
      setCertificateStatuses(data.certificateStatuses);
      const edits = new Map<string, string>();
      const priced = new Set<string>();
      for (const p of data.prices) {
        const key = priceCellKey(p.catalogEditionId, p.conditionId, p.certificateStatusId);
        edits.set(key, formatPrice(p.price));
        priced.add(key);
      }
      setPriceEdits(edits);
      setPricedCells(priced);
      setPricesLoaded(true);
    });
    return () => { cancelled = true; };
  }, [fetchPriceData, hasPricesTab]);

  function handlePriceChange(cellKey: string, value: string) {
    setPriceEdits((prev) => {
      const next = new Map(prev);
      next.set(cellKey, value);
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
    editProps
      ? (editProps.stamp.issues?.some((m) => m.requiredForCompleteness) ?? false)
      : !addProps?.prefilledParentStampId
  );

  // ── Subtype classification (child stamps only) ──
  const [subtypes, setSubtypes] = useState<StampSubtypeData[]>([]);
  const [selectedSubtypeId, setSelectedSubtypeId] = useState<string>("");
  // "" = use subtype setting, "true" = acts as variant, "false" = not a variant.
  const [overrideValue, setOverrideValue] = useState<string>("");
  // In edit mode the current classification is fetched fresh by stampId so it does
  // not depend on the caller's row shape (issue members, list rows, …) carrying it.
  const [editParentId, setEditParentId] = useState<string | null | undefined>(undefined);

  const editStampId = props.mode === "edit" ? editProps!.stampId : undefined;
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("@/app/actions/subtypes").then((m) => m.getStampSubtypesAction(collectionId)),
      editStampId
        ? import("@/app/actions/stamps").then((m) => m.getStampSubtypeAssignmentAction(editStampId))
        : Promise.resolve(null),
    ]).then(([list, assignment]) => {
      if (cancelled) return;
      setSubtypes(list);
      const defId = list.find((s) => s.isDefault)?.id ?? list[0]?.id ?? "";
      if (assignment) {
        setEditParentId(assignment.parentId);
        setSelectedSubtypeId(assignment.subtypeId ?? defId);
        setOverrideValue(
          assignment.actsAsVariantOverride === true
            ? "true"
            : assignment.actsAsVariantOverride === false
              ? "false"
              : ""
        );
      } else {
        setSelectedSubtypeId(defId);
      }
    });
    return () => { cancelled = true; };
  }, [collectionId, editStampId]);

  // Load the stamp's committed photos for the edit dialog's Photos tab.
  useEffect(() => {
    if (!editStampId) return;
    let cancelled = false;
    import("@/app/actions/stamps")
      .then((m) => m.listStampPhotosAction(editStampId))
      .then((photos) => {
        if (cancelled) return;
        setInitialPhotos(photos);
        setPhotosLoaded(true);
      });
    return () => { cancelled = true; };
  }, [editStampId]);

  // Duplicate check context: the edited stamp's own primary area (edit), or the
  // selected existing issue's area (add). Skipped while auto-creating a new issue,
  // since its area — and thus the catalog prefix — isn't known yet.
  const checkStampId = editProps?.stampId ?? null;
  const addAreaId =
    addProps && !autoCreateIssue
      ? (addProps.issues.find((i) => i.id === selectedIssueId)?.collectionAreaId ?? null)
      : null;
  const canCheckDuplicates = !!checkStampId || !!addAreaId;

  useEffect(() => {
    let cancelled = false;
    // All state updates happen inside the debounced async callback (never
    // synchronously in the effect body) to avoid cascading renders.
    const timer = setTimeout(async () => {
      if (!canCheckDuplicates) {
        if (!cancelled) setDupCheck((prev) => ({ mode: prev.mode, groups: [] }));
        return;
      }
      const candidates = Object.entries(catalogInputs)
        .map(([catalogVendorId, number]) => ({ catalogVendorId, number: number.trim() }))
        .filter((c) => c.number);
      if (candidates.length === 0) {
        if (!cancelled) setDupCheck((prev) => ({ mode: prev.mode, groups: [] }));
        return;
      }
      const { checkCatalogDuplicatesAction } = await import("@/app/actions/duplicate-catalog");
      const res = await checkCatalogDuplicatesAction(
        collectionId,
        candidates,
        checkStampId ? { stampId: checkStampId } : { contextAreaId: addAreaId }
      );
      if (!cancelled) setDupCheck(res);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [catalogInputs, canCheckDuplicates, checkStampId, addAreaId, collectionId]);

  const blockDuplicates = dupCheck.mode === "block" && dupCheck.groups.length > 0;

  // ── Declared-range extension (add-to-issue only) ──
  // Only a required-for-completeness stamp defines an issue's range, so the prompt
  // fires only when Required is checked. For each vendor whose entered number falls
  // beyond the selected issue's declared First–Last (same numbering family), we
  // surface the proposed widened range and force an explicit widen/keep choice
  // before the stamp can be saved. Debounced so transient values while typing don't
  // flash a prompt (mirrors the duplicate check above).
  const [rangeExtensions, setRangeExtensions] = useState<
    { catalogVendorId: string; current: string; proposed: string }[]
  >([]);
  // Explicit choice: "widen" the issue range on save, or "keep" the stamp outside it.
  const [rangeChoice, setRangeChoice] = useState<"widen" | "keep" | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const issue =
        addProps && !autoCreateIssue && requiredForCompleteness && selectedIssueId
          ? addProps.issues.find((i) => i.id === selectedIssueId)
          : undefined;
      const out: { catalogVendorId: string; current: string; proposed: string }[] = [];
      for (const declared of issue?.catalogNumbers ?? []) {
        const entered = (catalogInputs[declared.catalogVendorId] ?? "").trim();
        if (!entered) continue;
        const ext = computeIssueRangeExtension(declared.firstNumber, declared.lastNumber, [entered]);
        if (!ext) continue;
        const abbr =
          vendors.find((v) => v.catalogVendorId === declared.catalogVendorId)?.vendorAbbreviation ?? "";
        const fmt = (first: string, last: string | null) => {
          const range = last ? `${first}–${last}` : first;
          return abbr ? `${abbr} ${range}` : range;
        };
        out.push({
          catalogVendorId: declared.catalogVendorId,
          current: fmt(declared.firstNumber, declared.lastNumber),
          proposed: fmt(ext.proposedFirst, ext.proposedLast),
        });
      }
      setRangeExtensions(out);
      // No extension pending → clear any stale choice so a fresh one re-asks.
      if (out.length === 0) setRangeChoice(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [addProps, autoCreateIssue, requiredForCompleteness, selectedIssueId, catalogInputs, vendors]);

  const hasRangeExtension = rangeExtensions.length > 0;

  const needsMembers =
    !!addProps && !!selectedIssueId && !autoCreateIssue && !addProps.prefilledParentStampId;
  const { data: members } = useIssueMembers(collectionId, selectedIssueId || "", needsMembers);
  const stampOptions = members ?? [];

  const showIssueStep = !!addProps && !addProps.prefilledIssueId;

  // Subtype classification applies to child stamps only: in edit mode when the stamp
  // has a parent; in add mode when a parent is chosen or prefilled.
  const isChildContext =
    props.mode === "edit"
      ? editParentId != null
      : !!selectedParentId || !!addProps?.prefilledParentStampId;
  const selectedSubtype = subtypes.find((s) => s.id === selectedSubtypeId);
  const inheritLabel = selectedSubtype
    ? ` (${selectedSubtype.actsAsVariant ? "variant" : "not a variant"})`
    : "";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    // Photo change-set (#137): applied server-side after the stamp is created/updated.
    fd.set("photoChangeSet", JSON.stringify(photoValueRef.current.changeSet));

    if (pricesLoaded) {
      for (const [cellKey, price] of priceEdits) {
        const editionId = cellKey.split("~")[0];
        const currency = currencyByEdition.get(editionId);
        if (!currency) continue;
        if (props.mode === "edit") {
          // Send every touched cell (incl. cleared) so removals are applied.
          fd.set(`catalogPrice_${cellKey}`, price);
          fd.set(`catalogCurrency_${editionId}`, currency);
        } else if (price.trim()) {
          fd.set(`catalogPrice_${cellKey}`, price);
          fd.set(`catalogCurrency_${editionId}`, currency);
        }
      }
    }

    if (props.mode === "edit") {
      // Only send this when the "Required for completeness" checkbox was actually shown — i.e. the
      // caller passed the stamp's issue memberships. Callers that reuse this dialog without that
      // context (the copy's stamp edit from Inventory/purchases, #243) must not clobber the flag on
      // every membership; omitting the field leaves it untouched server-side.
      if ((editProps?.stamp.issues?.length ?? 0) > 0) {
        fd.set("requiredForCompleteness", requiredForCompleteness ? "true" : "false");
      }
      props.onSubmit(fd);
      return;
    }

    if (autoCreateIssue) {
      fd.set("newIssueName", newIssueName.trim());
      fd.set("newIssueYear", newIssueYear.trim());
    }
    fd.set("requiredForCompleteness", requiredForCompleteness ? "true" : "false");
    if (hasRangeExtension && rangeChoice === "widen") {
      fd.set("widenIssueRange", "true");
    }
    props.onSubmit(autoCreateIssue ? "" : selectedIssueId, fd);
  }

  const title = props.mode === "edit" ? "Edit stamp" : "Add stamp";
  const actionLabel = isPending
    ? "Saving…"
    : photosUploading
      ? "Uploading photos…"
      : props.mode === "edit"
        ? "Save"
        : "Add stamp";
  const actionDisabled =
    isPending ||
    photosUploading ||
    blockDuplicates ||
    (props.mode === "add" && !autoCreateIssue && !selectedIssueId) ||
    (hasRangeExtension && rangeChoice === null);

  return (
    <DialogShell title={title} onClose={onClose} minHeight="22rem" maxWidth="52rem">
      {/* Tab bar only when the area has catalogs to price. Photos are inline on the Details
          tab (like the copy dialog), not a separate tab. */}
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
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: "0.375rem 0.75rem",
                  }}
                >
                  {vendors.map((v, i) => {
                    const vendorGroups = dupCheck.groups.filter(
                      (g) => g.catalogVendorId === v.catalogVendorId
                    );
                    return (
                    <div key={v.catalogVendorId} style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                      <span style={{ width: "4rem", flexShrink: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)", fontFamily: "monospace", fontWeight: 600 }}>
                        {v.vendorAbbreviation}{v.prefix ? `·${v.prefix}` : ""}
                      </span>
                      <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex" }}>
                        <input
                          name={`catalogNumber_${v.catalogVendorId}`}
                          type="text"
                          disabled={isPending}
                          placeholder="e.g. 1"
                          value={catalogInputs[v.catalogVendorId] ?? ""}
                          onChange={(e) =>
                            setCatalogInputs((prev) => ({
                              ...prev,
                              [v.catalogVendorId]: e.target.value,
                            }))
                          }
                          data-autofocus={(skipToFields && i === 0) || undefined}
                          style={{
                            ...INPUT_STYLE,
                            flex: 1,
                            paddingRight: vendorGroups.length > 0 ? "2rem" : INPUT_STYLE.padding,
                          }}
                        />
                        {vendorGroups.length > 0 && (
                          <span
                            style={{
                              position: "absolute",
                              right: "0.5rem",
                              top: "50%",
                              transform: "translateY(-50%)",
                              display: "inline-flex",
                            }}
                          >
                            <CatalogDuplicateWarningIcon
                              groups={vendorGroups}
                              blocking={dupCheck.mode === "block"}
                            />
                          </span>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Required for completeness */}
            {(addProps || (editProps?.stamp.issues?.length ?? 0) > 0) && (
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

            {/* Declared-range extension prompt: forces an explicit widen/keep choice
                before a required stamp that overruns the issue's range can be saved. */}
            {hasRangeExtension && (
              <div
                role="group"
                aria-label="Declared range extension"
                style={{
                  marginBottom: "0.875rem",
                  border: "1px solid var(--color-warning-border)",
                  background: "var(--color-warning-soft)",
                  borderRadius: "0.5rem",
                  padding: "0.75rem 0.875rem",
                  fontSize: "0.8125rem",
                  color: "var(--color-text-primary)",
                }}
              >
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                  <span aria-hidden style={{ color: "var(--color-warning)", lineHeight: 1.3 }}>
                    ⚠
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: "0 0 0.5rem", fontWeight: 600, color: "var(--color-warning)" }}>
                      This stamp changes the issue&rsquo;s declared catalog range
                    </p>
                    <ul
                      style={{
                        margin: "0 0 0.5rem",
                        padding: 0,
                        listStyle: "none",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.25rem",
                      }}
                    >
                      {rangeExtensions.map((e) => (
                        <li key={e.catalogVendorId}>
                          <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{e.current}</span>
                          <span style={{ color: "var(--color-text-muted)" }}> → </span>
                          <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{e.proposed}</span>
                        </li>
                      ))}
                    </ul>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="rangeChoice"
                          checked={rangeChoice === "widen"}
                          onChange={() => setRangeChoice("widen")}
                          disabled={isPending}
                        />
                        Update the issue&rsquo;s declared range as shown above
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="rangeChoice"
                          checked={rangeChoice === "keep"}
                          onChange={() => setRangeChoice("keep")}
                          disabled={isPending}
                        />
                        Keep this stamp outside the declared range
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Name + issued date on one row */}
            <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
              {/* Name */}
              <div style={{ flex: 1, minWidth: 0 }}>
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
              <div style={{ flexShrink: 0 }}>
                <LabelWithError>Issued date (optional)</LabelWithError>
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
                    style={{ ...INPUT_STYLE, width: "5.5rem", flex: "none" }}
                  />
                </div>
              </div>
            </div>

            {/* Subtype classification (child stamps only) */}
            {isChildContext && subtypes.length > 0 && (
              <div
                style={{
                  marginTop: "1.25rem",
                  display: "flex",
                  gap: "1rem",
                  alignItems: "flex-end",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <LabelWithError htmlFor="f-stamp-subtype">Subtype</LabelWithError>
                  <select
                    id="f-stamp-subtype"
                    name="subtypeId"
                    value={selectedSubtypeId}
                    onChange={(e) => setSelectedSubtypeId(e.target.value)}
                    disabled={isPending}
                    style={INPUT_STYLE}
                  >
                    {subtypes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}{s.actsAsVariant ? " (variant)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <input type="hidden" name="actsAsVariantOverride" value={overrideValue} />
                <Segmented
                  label="Acts as variant"
                  value={overrideValue}
                  onChange={setOverrideValue}
                  disabled={isPending}
                  options={[
                    { value: "", label: "↳", title: `Use subtype setting${inheritLabel}` },
                    { value: "true", label: "✓", title: "Acts as variant" },
                    { value: "false", label: "✕", title: "Not a variant" },
                  ]}
                />
              </div>
            )}

            {/* Photos (#137) — inline on the Details tab, exactly like the copy dialog. Mounted
                only once the stamp's existing photos have loaded (edit mode); PhotoEditor seeds
                its state from initialPhotos once on mount, so it must not mount before they arrive. */}
            <div
              style={{
                marginTop: "1.25rem",
                paddingTop: "1.25rem",
                borderTop: "1px solid var(--color-border)",
              }}
            >
              {!photosLoaded ? (
                // Reserve roughly the editor's height so the dialog doesn't jump on load.
                <div
                  style={{
                    minHeight: "12rem",
                    color: "var(--color-text-muted)",
                    fontSize: "0.875rem",
                  }}
                >
                  Loading photos…
                </div>
              ) : (
                <PhotoEditor
                  collectionId={collectionId}
                  initialPhotos={initialPhotos}
                  disabled={isPending}
                  roleMode="main"
                  onChange={handlePhotoChange}
                />
              )}
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
                  conditions={conditions}
                  certificateStatuses={certificateStatuses}
                  priceEdits={priceEdits}
                  pricedCells={pricedCells}
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
