"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import type {
  IssueListItem,
  IssueCatalogNumberData,
  DuplicateIssueMatch,
} from "@/lib/issues";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import { resolveCatalogRange } from "@/lib/catalog-number";
import {
  effectiveVendorsForArea,
  effectivePrimaryVendorId,
  flattenAreaTree,
} from "@/app/c/[collectionSlug]/shared/area-helpers";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

// ── Styles ──────────────────────────────────────────────────────────────────

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

const SECTION_HEADER_STYLE: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: "0.75rem",
};

// ── Range helpers ─────────────────────────────────────────────────────────────

// Number of stamps a vendor's entered range spans, mirroring the auto-create
// generation logic in src/app/actions/issues.ts. Returns null when the range is
// unrecognizable for comparison. Handles numeric, prefixed ("BL120"–"BL123"),
// and suffix-sequence ("423a"–"423c", "12I"–"12II") ranges.
function rangeCount(first: string, last: string): number | null {
  if (!first.trim()) return null;
  const range = resolveCatalogRange(first, last.trim() ? last : null);
  if ("error" in range) return null;
  return range.span ?? 1;
}

// Reads a vendor's current range inputs straight from the form DOM (the inputs
// are uncontrolled) and returns its stamp count.
function rangeCountFromForm(form: HTMLFormElement, vendorId: string): number | null {
  const firstEl = form.elements.namedItem(`issueCatalogFirst_${vendorId}`);
  const lastEl = form.elements.namedItem(`issueCatalogLast_${vendorId}`);
  const first = firstEl instanceof HTMLInputElement ? firstEl.value : "";
  const last = lastEl instanceof HTMLInputElement ? lastEl.value : "";
  return rangeCount(first, last);
}

// ── Duplicate-name check (#178) ───────────────────────────────────────────────

/** Debounce a rapidly-changing value so the duplicate-name lookup only fires once the
 * user pauses typing, not on every keystroke. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Existing issues in `areaId` whose name matches `name` (trimmed, case-insensitive), backing
 * the non-blocking duplicate-name warning (#178). Disabled for a blank name or missing area. */
function useIssueNameCheck(collectionId: string, areaId: string, name: string) {
  const trimmed = name.trim();
  return useQuery<DuplicateIssueMatch[]>({
    queryKey: ["issue-name-check", collectionId, areaId, trimmed.toLowerCase()] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ areaId, name: trimmed });
      const res = await fetch(
        `/api/collections/${collectionId}/issues/name-check?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to check issue name");
      const data = await res.json();
      return data.matches as DuplicateIssueMatch[];
    },
    enabled: !!collectionId && !!areaId && trimmed.length > 0,
    staleTime: 30_000,
  });
}

// ── IssueForm ───────────────────────────────────────────────────────────────

interface IssueFormProps {
  vendors: AreaCatalogEntry[];
  primaryVendorId?: string | null;
  defaultName?: string;
  defaultYear?: number;
  defaultCatalogNumbers?: IssueCatalogNumberData[];
  isPending: boolean;
  autoFocusName?: boolean;
  showAutoCreate?: boolean;
  autoCreate?: boolean;
  onAutoCreateChange?: (checked: boolean, form: HTMLFormElement | null) => void;
  vendorSelection?: Record<string, boolean>;
  onVendorToggle?: (vendorId: string, checked: boolean) => void;
  /** Notify the parent as the (uncontrolled) name input changes, so it can run the
   * duplicate-name check (#178). */
  onNameChange?: (value: string) => void;
  /** Non-blocking warning rendered directly beneath the name field (#178). */
  nameWarning?: React.ReactNode;
}

function IssueForm({
  vendors,
  primaryVendorId,
  defaultName,
  defaultYear,
  defaultCatalogNumbers = [],
  isPending,
  autoFocusName,
  showAutoCreate,
  autoCreate,
  onAutoCreateChange,
  vendorSelection,
  onVendorToggle,
  onNameChange,
  nameWarning,
}: IssueFormProps) {
  const sortedVendors = useMemo(() => {
    if (!primaryVendorId) return vendors;
    return [...vendors].sort((a, b) => {
      if (a.catalogVendorId === primaryVendorId) return -1;
      if (b.catalogVendorId === primaryVendorId) return 1;
      return 0;
    });
  }, [vendors, primaryVendorId]);

  return (
    <>
      <div style={SECTION_HEADER_STYLE}>Details</div>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-issue-name">Name (optional)</LabelWithError>
        <div style={{ position: "relative" }}>
          <input
            id="f-issue-name"
            name="name"
            type="text"
            defaultValue={defaultName}
            disabled={isPending}
            placeholder="e.g. First Issue"
            style={{ ...INPUT_STYLE, paddingRight: nameWarning ? "2rem" : undefined }}
            data-autofocus={autoFocusName || undefined}
            onChange={(e) => onNameChange?.(e.target.value)}
          />
          {nameWarning && (
            <span
              style={{
                position: "absolute",
                right: "0.5rem",
                top: "50%",
                transform: "translateY(-50%)",
                display: "inline-flex",
              }}
            >
              {nameWarning}
            </span>
          )}
        </div>
      </div>
      <div>
        <LabelWithError htmlFor="f-issue-year">Year (optional)</LabelWithError>
        <input
          id="f-issue-year"
          name="year"
          type="number"
          defaultValue={defaultYear}
          disabled={isPending}
          placeholder="e.g. 1860"
          min={1840}
          max={2100}
          style={INPUT_STYLE}
        />
      </div>
      {sortedVendors.length > 0 && (
        <div
          style={{
            marginTop: "1.25rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            padding: "1rem",
          }}
        >
          <div style={SECTION_HEADER_STYLE}>Catalog numbers</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {sortedVendors.map((v) => {
              const isPrimary = v.catalogVendorId === primaryVendorId;
              const existing = defaultCatalogNumbers.find(
                (cn) => cn.catalogVendorId === v.catalogVendorId
              );
              return (
                <div key={v.catalogVendorId}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                      marginBottom: "0.25rem",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.8125rem",
                        color: "var(--color-text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      {v.vendorName} ({v.vendorAbbreviation})
                      {v.prefix ? ` · ${v.prefix}` : ""}
                    </span>
                    {isPrimary && (
                      <span
                        style={{
                          fontSize: "0.6875rem",
                          color: "var(--color-accent)",
                          border: "1px solid var(--color-accent)",
                          borderRadius: "0.2rem",
                          padding: "0.05rem 0.3rem",
                          fontWeight: 600,
                          lineHeight: 1.5,
                        }}
                      >
                        Primary
                      </span>
                    )}
                  </span>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      name={`issueCatalogFirst_${v.catalogVendorId}`}
                      type="text"
                      defaultValue={existing?.firstNumber ?? ""}
                      disabled={isPending}
                      placeholder="First"
                      style={{ ...INPUT_STYLE, flex: 1 }}
                    />
                    <span
                      style={{
                        color: "var(--color-text-muted)",
                        fontSize: "0.875rem",
                        flexShrink: 0,
                      }}
                    >
                      –
                    </span>
                    <input
                      name={`issueCatalogLast_${v.catalogVendorId}`}
                      type="text"
                      defaultValue={existing?.lastNumber ?? ""}
                      disabled={isPending}
                      placeholder="Last (optional)"
                      style={{ ...INPUT_STYLE, flex: 1 }}
                    />
                  </div>
                  {showAutoCreate && (
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        marginTop: "0.25rem",
                        fontSize: "0.75rem",
                        color: "var(--color-text-muted)",
                        cursor: "pointer",
                        visibility: autoCreate ? "visible" : "hidden",
                      }}
                    >
                      <input
                        type="checkbox"
                        name={autoCreate ? `autoCreateVendor_${v.catalogVendorId}` : undefined}
                        checked={vendorSelection?.[v.catalogVendorId] ?? isPrimary}
                        onChange={(e) =>
                          onVendorToggle?.(v.catalogVendorId, e.target.checked)
                        }
                        disabled={isPending}
                      />
                      Assign to stamps
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {showAutoCreate && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                marginTop: "0.75rem",
                paddingTop: "0.75rem",
                borderTop: "1px solid var(--color-border)",
                fontSize: "0.8125rem",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                name="autoCreateStamps"
                value="true"
                checked={autoCreate}
                onChange={(e) => onAutoCreateChange?.(e.target.checked, e.currentTarget.form)}
                disabled={isPending}
              />
              Auto-create stamps from catalog number range
            </label>
          )}
        </div>
      )}
    </>
  );
}

// ── DuplicateNameWarning ──────────────────────────────────────────────────────

/** Small warning icon shown inside the name field when issues with the same name already exist
 * in the selected area (#178). Hovering reveals a tooltip naming them. Purely advisory — the
 * user can still create the issue, since the same name may legitimately recur across areas. */
function DuplicateNameWarning({ matches }: { matches: DuplicateIssueMatch[] }) {
  const label = (m: DuplicateIssueMatch) =>
    [m.name || "(unnamed)", m.year ? `(${m.year})` : null].filter(Boolean).join(" ");
  const content = (
    <span>
      {matches.length === 1
        ? "An issue with this name already exists in this area:"
        : `${matches.length} issues with this name already exist in this area:`}{" "}
      <span style={{ fontWeight: 600 }}>{matches.map(label).join(", ")}</span>. You can still
      create it if this is intentional.
    </span>
  );
  return (
    <Tooltip content={content} align="end">
      <span
        role="img"
        aria-label="An issue with this name already exists in this area"
        style={{
          color: "var(--color-warning)",
          fontSize: "0.9375rem",
          lineHeight: 1,
          cursor: "help",
        }}
      >
        ⚠
      </span>
    </Tooltip>
  );
}

// ── IssueDialog ─────────────────────────────────────────────────────────────

type IssueDialogProps =
  | {
      mode: "create";
      /** Owning collection, used for the duplicate-name lookup (#178). */
      collectionId: string;
      areas: CollectionAreaData[];
      defaultAreaId?: string;
      /** Prefill the year field, e.g. from an active year filter (#142). */
      defaultYear?: number;
      isPending: boolean;
      error?: string;
      onClose: () => void;
      onSubmit: (areaId: string, formData: FormData) => void;
    }
  | {
      mode: "edit";
      collectionId: string;
      areas: CollectionAreaData[];
      issue: IssueListItem;
      isPending: boolean;
      error?: string;
      onClose: () => void;
      onSubmit: (formData: FormData) => void;
    };

export function IssueDialog(props: IssueDialogProps) {
  const { areas, collectionId, isPending, error, onClose } = props;
  const isCreate = props.mode === "create";

  const [selectedAreaId, setSelectedAreaId] = useState(() => {
    if (isCreate) return props.defaultAreaId ?? areas[0]?.id ?? "";
    return props.issue.collectionAreaId;
  });

  // Duplicate-name warning (#178): track the (uncontrolled) name input, debounce it, and look
  // up same-area issues with that name. Create-only — the guard is about accidental new dupes.
  const [nameValue, setNameValue] = useState("");
  const debouncedName = useDebouncedValue(nameValue, 300);
  const { data: duplicates } = useIssueNameCheck(
    collectionId,
    isCreate ? selectedAreaId : "",
    isCreate ? debouncedName : ""
  );
  const nameWarning =
    isCreate && duplicates && duplicates.length > 0 ? (
      <DuplicateNameWarning matches={duplicates} />
    ) : null;
  const [autoCreate, setAutoCreate] = useState(false);
  // Per-vendor "Assign to stamps" selection. Empty until the user interacts;
  // each checkbox falls back to "primary only" while unset.
  const [vendorSelection, setVendorSelection] = useState<Record<string, boolean>>({});

  const vendors = useMemo(
    () => (selectedAreaId ? effectiveVendorsForArea(areas, selectedAreaId) : []),
    [areas, selectedAreaId]
  );

  const primaryVendorId = useMemo(
    () =>
      selectedAreaId ? effectivePrimaryVendorId(areas, selectedAreaId) : null,
    [areas, selectedAreaId]
  );

  const flatTree = useMemo(() => (isCreate ? flattenAreaTree(areas) : []), [isCreate, areas]);

  // On toggling auto-create on, pre-select every vendor whose entered range
  // spans the same number of stamps as the primary catalog's range (the primary
  // is always selected). Vendors with a mismatched or unusable range stay
  // unchecked; the user can still adjust any of them manually.
  function handleAutoCreateChange(checked: boolean, form: HTMLFormElement | null) {
    setAutoCreate(checked);
    if (!checked || !form || !primaryVendorId) return;
    const primaryCount = rangeCountFromForm(form, primaryVendorId);
    const next: Record<string, boolean> = {};
    for (const v of vendors) {
      const id = v.catalogVendorId;
      if (id === primaryVendorId) {
        next[id] = true;
        continue;
      }
      const count = rangeCountFromForm(form, id);
      next[id] = primaryCount !== null && count === primaryCount;
    }
    setVendorSelection(next);
  }

  function handleVendorToggle(vendorId: string, checked: boolean) {
    setVendorSelection((prev) => ({ ...prev, [vendorId]: checked }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isCreate) {
      if (!selectedAreaId) return;
      props.onSubmit(selectedAreaId, new FormData(e.currentTarget));
    } else {
      props.onSubmit(new FormData(e.currentTarget));
    }
  }

  return (
    <DialogShell
      title={isCreate ? "Add issue" : "Edit issue"}
      onClose={onClose}
      minHeight="32rem"
    >
      <form style={FORM_STYLE} onSubmit={handleSubmit}>
        <DialogBody>
          {isCreate && (
            <div style={{ marginBottom: "1.25rem" }}>
              <LabelWithError htmlFor="f-issue-area">Area</LabelWithError>
              <select
                id="f-issue-area"
                value={selectedAreaId}
                onChange={(e) => {
                  setSelectedAreaId(e.target.value);
                  setVendorSelection({});
                }}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                {areas.length === 0 && (
                  <option value="">— No areas yet —</option>
                )}
                {flatTree.map(({ area, depth }) => (
                  <option key={area.id} value={area.id}>
                    {"  ".repeat(depth)}
                    {area.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <IssueForm
            vendors={vendors}
            primaryVendorId={primaryVendorId}
            defaultName={isCreate ? undefined : (props.issue.name ?? "")}
            defaultYear={isCreate ? props.defaultYear : (props.issue.year ?? undefined)}
            defaultCatalogNumbers={isCreate ? undefined : props.issue.catalogNumbers}
            isPending={isPending}
            autoFocusName={isCreate}
            showAutoCreate={isCreate && vendors.length > 0}
            autoCreate={autoCreate}
            onAutoCreateChange={handleAutoCreateChange}
            vendorSelection={vendorSelection}
            onVendorToggle={handleVendorToggle}
            onNameChange={isCreate ? setNameValue : undefined}
            nameWarning={nameWarning}
          />
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Save"}
          onCancel={onClose}
          disabled={isPending || (isCreate && !selectedAreaId)}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
