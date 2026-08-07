"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  IssueCatalogPrefixData,
  DuplicateIssueMatch,
  IssueRangeSuggestion,
} from "@/lib/issues";
import { IssueRangeWarning } from "@/app/c/[collectionSlug]/shared/issue-range-warning";
import { advanceToLastOnSeparator } from "@/app/c/[collectionSlug]/shared/catalog-range-focus";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import {
  resolveCatalogRange,
  formatSchemeValue,
  parseCatalogNumberSpec,
  AUTO_CREATE_MAX_STAMPS,
  type CatalogNumberSpec,
} from "@/lib/catalog-number";
import type { CatalogDuplicateGroup, DuplicateCandidate, DuplicateCatalogMode } from "@/lib/duplicate-catalog";
import {
  effectiveVendorsForArea,
  effectivePrimaryVendorId,
} from "@/app/c/[collectionSlug]/shared/area-helpers";
import { AreaTreeSelect, buildAreaTree } from "@/app/area-tree-select";
import { languageLabel } from "@/lib/languages";
import {
  fillTranslationValues,
  type TranslationField,
  type TranslationValues,
} from "@/app/c/[collectionSlug]/shared/translations-dialog";
import { TranslationsField } from "@/app/c/[collectionSlug]/shared/translations-field";
import { useTitleLanguages } from "@/app/c/[collectionSlug]/shared/use-title-languages";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { CatalogDuplicateWarningIcon } from "@/app/c/[collectionSlug]/shared/catalog-duplicate-warning";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { Icon } from "@/app/icons";

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

// ── Catalog number specs (#452) ───────────────────────────────────────────────

// The create dialog holds one free-form spec per catalog — "2895A-2897A, 2895B-2897B" — from
// which both the stamps and the issue's declared range are derived. The edit dialog keeps its
// First/Last pair: there the pair *is* the declared range, and nothing is generated.

/** A vendor's spec field, straight from the (uncontrolled) form DOM. */
function numbersValueFromForm(form: HTMLFormElement, vendorId: string): string {
  const el = form.elements.namedItem(`issueCatalogNumbers_${vendorId}`);
  return el instanceof HTMLInputElement ? el.value : "";
}

/** A vendor's parsed spec, or null when the field is blank or does not parse. */
function specFromForm(form: HTMLFormElement, vendorId: string): CatalogNumberSpec | null {
  const raw = numbersValueFromForm(form, vendorId).trim();
  if (!raw) return null;
  const spec = parseCatalogNumberSpec(raw);
  return "error" in spec ? null : spec;
}

/** How many stamps a vendor's spec would generate, or null when there is no usable spec. */
function specCountFromForm(form: HTMLFormElement, vendorId: string): number | null {
  return specFromForm(form, vendorId)?.numbers.length ?? null;
}

// A spec that is a single number and nothing else — the shape #185's auto-fill completes.
const LONE_NUMBER = /^[^,\-–—]+$/;

// onBlur handler for a secondary catalog's spec field: once the primary catalog spans a run of
// stamps, entering a lone number for another catalog completes it to the same span (#185) —
// primary 2820-2823 plus a typed `200` becomes `200-203`. Deliberately narrow: it only fires on
// a lone number (never rewriting a list the collector composed themselves) and only from a
// single-segment primary, since there is no one way to stretch a number over several runs.
function autoFillSecondarySpan(
  form: HTMLFormElement,
  vendorId: string,
  primaryVendorId: string | null
): void {
  if (!primaryVendorId || vendorId === primaryVendorId) return;
  const el = form.elements.namedItem(`issueCatalogNumbers_${vendorId}`);
  if (!(el instanceof HTMLInputElement)) return;
  const own = el.value.trim();
  if (!own || !LONE_NUMBER.test(own)) return;
  const primary = specFromForm(form, primaryVendorId);
  if (!primary || primary.segments.length !== 1 || primary.numbers.length < 2) return;
  const range = resolveCatalogRange(own, null);
  if ("error" in range) return;
  const last = formatSchemeValue(range.scheme, range.scheme.from + primary.numbers.length - 1);
  el.value = `${own}-${last}`;
}

// ── Per-issue prefix overrides (#377) ─────────────────────────────────────────

// The prefix overrides currently typed into the (uncontrolled) form, as the duplicate check's
// `contextPrefixes`. On create the issue does not exist yet, so its own form is the only place its
// prefixes can be read from — and they decide the catalog identity being checked for a collision.
function prefixesFromForm(form: HTMLFormElement, vendorIds: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const catalogVendorId of vendorIds) {
    const el = form.elements.namedItem(`issueCatalogPrefix_${catalogVendorId}`);
    const value = el instanceof HTMLInputElement ? el.value.trim() : "";
    if (value) out[catalogVendorId] = value;
  }
  return out;
}

// ── Auto-create duplicate-catalog candidates (#85) ────────────────────────────

// Generate the catalog numbers auto-create would produce for the given vendors,
// reading each vendor's spec straight from the (uncontrolled) form. Mirrors the
// server generation in src/app/actions/issues.ts; vendors with an empty,
// unparseable, or over-limit spec are skipped for the advisory check.
function autoCreateCandidatesFromForm(
  form: HTMLFormElement,
  vendorIds: string[]
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  for (const catalogVendorId of vendorIds) {
    const spec = specFromForm(form, catalogVendorId);
    if (!spec || spec.numbers.length > AUTO_CREATE_MAX_STAMPS) continue;
    for (const number of spec.numbers) {
      out.push({ catalogVendorId, number });
    }
  }
  return out;
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

/** The issue's one translatable field (#295). `defaultValue` is filled in at render time from the
 * live Name input, so the dialog's placeholder shows what a blank entry falls back to. Mirrors
 * `ISSUE_TRANSLATION_FIELDS`, which the action parses the submitted values with. */
const NAME_TRANSLATION_FIELDS: TranslationField[] = [{ key: "name", label: "Name" }];

interface IssueFormProps {
  vendors: AreaCatalogEntry[];
  primaryVendorId?: string | null;
  defaultName?: string;
  defaultYear?: number;
  defaultCatalogNumbers?: IssueCatalogNumberData[];
  /** Stored per-vendor prefix overrides (#377); absent when creating. */
  defaultCatalogPrefixes?: IssueCatalogPrefixData[];
  isPending: boolean;
  autoFocusName?: boolean;
  /** Render the per-catalog "Assign to stamps" boxes (#451) — create mode only. There is no
   * master switch: the ticked catalogs *are* the auto-create decision. */
  showAutoCreate?: boolean;
  /** One free-form spec field per catalog instead of the First/Last pair (#452). On create the
   * numbers typed are a recipe for stamps; on edit they are the declared range itself. */
  specMode?: boolean;
  /** What a catalog's spec resolves to, or the error it carries — rendered under its field. */
  specNoteFor?: (vendorId: string) => React.ReactNode;
  vendorSelection?: Record<string, boolean>;
  onVendorToggle?: (vendorId: string, checked: boolean) => void;
  /** A "Last" filled in on blur (#185) changes no React state, so the parent is told to re-read
   * the form — the auto-selection (#451) is driven off those values. */
  onRangeAutoFilled?: () => void;
  /** Notify the parent as the (uncontrolled) name input changes, so it can run the
   * duplicate-name check (#178). */
  onNameChange?: (value: string) => void;
  /** Non-blocking warning rendered directly beneath the name field (#178). */
  nameWarning?: React.ReactNode;
  /** Languages needing a translation (#295); empty renders no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain Name field is written in (#295). */
  defaultLanguage: string;
  /** Stored per-language names, field-major (#295); absent when creating. */
  defaultTranslations?: { name: Record<string, string> };
  /** Told when the nested translations dialog opens/closes, so the issue dialog can stop
   * dismissing itself on Esc / backdrop click while it is up. */
  onNestedDialogOpenChange?: (open: boolean) => void;
  /** Duplicate-catalog warning icon shown inside a vendor's First field when its
   * auto-generated range collides with existing stamps (#85). */
  catalogWarningFor?: (vendorId: string) => React.ReactNode;
}

function IssueForm({
  vendors,
  primaryVendorId,
  defaultName,
  defaultYear,
  defaultCatalogNumbers = [],
  defaultCatalogPrefixes = [],
  isPending,
  autoFocusName,
  showAutoCreate,
  specMode,
  specNoteFor,
  vendorSelection,
  onVendorToggle,
  onRangeAutoFilled,
  onNameChange,
  nameWarning,
  titleLanguages,
  defaultLanguage,
  defaultTranslations,
  onNestedDialogOpenChange,
  catalogWarningFor,
}: IssueFormProps) {
  const sortedVendors = useMemo(() => {
    if (!primaryVendorId) return vendors;
    return [...vendors].sort((a, b) => {
      if (a.catalogVendorId === primaryVendorId) return -1;
      if (b.catalogVendorId === primaryVendorId) return 1;
      return 0;
    });
  }, [vendors, primaryVendorId]);

  const translatable = titleLanguages.length > 0;
  // The name input stays uncontrolled (the duplicate-name check and the catalog form both read the
  // DOM), but its text is mirrored here so the translations dialog can show the *live* default
  // -language name as the placeholder each blank entry falls back to.
  const [nameText, setNameText] = useState(defaultName ?? "");
  // Staged per-language names (#295): edited in the shared dialog, submitted as hidden `name:<lang>`
  // inputs, written only when the issue itself is saved.
  const [translations, setTranslations] = useState<TranslationValues>(() =>
    fillTranslationValues(titleLanguages, NAME_TRANSLATION_FIELDS, defaultTranslations)
  );

  return (
    <>
      <div style={SECTION_HEADER_STYLE}>Details</div>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-issue-name">
          {translatable
            ? `Name — ${languageLabel(defaultLanguage)} (optional)`
            : "Name (optional)"}
        </LabelWithError>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <input
              id="f-issue-name"
              name="name"
              type="text"
              defaultValue={defaultName}
              disabled={isPending}
              placeholder="e.g. First Issue"
              style={{ ...INPUT_STYLE, paddingRight: nameWarning ? "2rem" : undefined }}
              data-autofocus={autoFocusName || undefined}
              onChange={(e) => {
                setNameText(e.target.value);
                onNameChange?.(e.target.value);
              }}
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
          {/* Per-language names (#295) live behind the shared translations dialog, so the form keeps
              one field however many languages are in use. */}
          {translatable && (
            <TranslationsField
              dialogTitle="Issue name translations"
              description={`The name each language's platforms use for this issue. Leave one blank to fall back to the ${languageLabel(defaultLanguage)} name above. Saved together with the issue.`}
              languages={titleLanguages}
              fields={[{ ...NAME_TRANSLATION_FIELDS[0], defaultValue: nameText }]}
              values={translations}
              onChange={setTranslations}
              onOpenChange={onNestedDialogOpenChange}
              ariaLabel="Edit issue name translations"
              disabled={isPending}
            />
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
              const prefixOverride = defaultCatalogPrefixes.find(
                (p) => p.catalogVendorId === v.catalogVendorId
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
                    {/* Per-issue prefix override (#377). It sits *in front of* the numbers because
                        that is exactly where it renders — `Mi·SP 200`. Blank inherits the area's
                        prefix, which is what the placeholder shows.

                        Out of the tab order (#445): an override is the rare case, and one stop per
                        vendor stands between the collector and the numbers they came here to type. */}
                    <Tooltip
                      content={
                        v.prefix
                          ? `Catalog prefix for this issue's stamps. Leave blank to use the area's prefix (${v.prefix}).`
                          : "Catalog prefix for this issue's stamps. Leave blank to use the area's prefix, which is unset here."
                      }
                      placement="top"
                      align="start"
                      style={{ flexShrink: 0 }}
                    >
                      <input
                        name={`issueCatalogPrefix_${v.catalogVendorId}`}
                        type="text"
                        defaultValue={prefixOverride?.areaPrefix ?? ""}
                        disabled={isPending}
                        placeholder={v.prefix ?? "Prefix"}
                        aria-label={`${v.vendorAbbreviation} catalog prefix for this issue`}
                        tabIndex={-1}
                        {...NO_AUTOFILL}
                        style={{ ...INPUT_STYLE, width: "5.5rem" }}
                      />
                    </Tooltip>
                    {(() => {
                      const warning = catalogWarningFor?.(v.catalogVendorId);
                      const warningIcon = warning && (
                        <span
                          style={{
                            position: "absolute",
                            right: "0.5rem",
                            top: "50%",
                            transform: "translateY(-50%)",
                            display: "inline-flex",
                          }}
                        >
                          {warning}
                        </span>
                      );
                      // One spec field when the dialog generates stamps (#452), the stored
                      // First/Last pair when it edits the declared range instead.
                      if (specMode) {
                        return (
                          <div
                            style={{ position: "relative", flex: 1, minWidth: 0, display: "flex" }}
                          >
                            <input
                              name={`issueCatalogNumbers_${v.catalogVendorId}`}
                              type="text"
                              disabled={isPending}
                              placeholder="e.g. 2820-2822, 2823a"
                              aria-label={`${v.vendorAbbreviation} catalog numbers`}
                              {...NO_AUTOFILL}
                              onBlur={
                                isPrimary
                                  ? undefined
                                  : (e) => {
                                      const form = e.currentTarget.form;
                                      if (!form) return;
                                      autoFillSecondarySpan(
                                        form,
                                        v.catalogVendorId,
                                        primaryVendorId ?? null
                                      );
                                      onRangeAutoFilled?.();
                                    }
                              }
                              style={{
                                ...INPUT_STYLE,
                                flex: 1,
                                paddingRight: warning ? "2rem" : INPUT_STYLE.padding,
                              }}
                            />
                            {warningIcon}
                          </div>
                        );
                      }
                      return (
                        <>
                          <div
                            style={{ position: "relative", flex: 1, minWidth: 0, display: "flex" }}
                          >
                            <input
                              name={`issueCatalogFirst_${v.catalogVendorId}`}
                              type="text"
                              defaultValue={existing?.firstNumber ?? ""}
                              disabled={isPending}
                              placeholder="First"
                              {...NO_AUTOFILL}
                              onKeyDown={(e) =>
                                advanceToLastOnSeparator(e, `issueCatalogLast_${v.catalogVendorId}`)
                              }
                              style={{
                                ...INPUT_STYLE,
                                flex: 1,
                                paddingRight: warning ? "2rem" : INPUT_STYLE.padding,
                              }}
                            />
                            {warningIcon}
                          </div>
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
                            {...NO_AUTOFILL}
                            style={{ ...INPUT_STYLE, flex: 1 }}
                          />
                        </>
                      );
                    })()}
                  </div>
                  {/* What the spec resolves to, or why it does not (#452). Only drawn once
                      something is typed, so the card does not carry a blank line per catalog. */}
                  {specMode && specNoteFor?.(v.catalogVendorId)}
                  {/* The auto-create decision itself (#451): a ticked catalog generates stamps
                      from its range on save. It ticks itself as the range is typed, so the box is
                      normally read rather than clicked — but it stays in the tab order, since it
                      is the only place that decision can be overruled. */}
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
                      }}
                    >
                      <input
                        type="checkbox"
                        name={
                          vendorSelection?.[v.catalogVendorId]
                            ? `autoCreateVendor_${v.catalogVendorId}`
                            : undefined
                        }
                        checked={vendorSelection?.[v.catalogVendorId] ?? false}
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
        </div>
      )}
    </>
  );
}

// ── SpecNote ──────────────────────────────────────────────────────────────────

/** What a catalog's spec resolves to (#452), under its field: the stamps it would create and the
 * series range it declares, or the reason it cannot be read. Renders nothing for an untouched
 * field, so the card only grows around what is being typed. */
function SpecNote({ result }: { result?: CatalogNumberSpec | { error: string } }) {
  if (!result) return null;
  const style: React.CSSProperties = { marginTop: "0.25rem", fontSize: "0.75rem" };
  if ("error" in result) {
    return <div style={{ ...style, color: "var(--color-error)" }}>{result.error}</div>;
  }
  const { numbers, declared } = result;
  const shown = numbers.slice(0, 6).join(", ");
  const range = declared.lastNumber
    ? `${declared.firstNumber}–${declared.lastNumber}`
    : declared.firstNumber;
  return (
    <div style={{ ...style, color: "var(--color-text-muted)" }}>
      {numbers.length > AUTO_CREATE_MAX_STAMPS ? (
        <span style={{ color: "var(--color-error)" }}>
          {numbers.length} stamps — a range cannot exceed {AUTO_CREATE_MAX_STAMPS}.
        </span>
      ) : (
        <>
          {numbers.length} {numbers.length === 1 ? "stamp" : "stamps"} ({shown}
          {numbers.length > 6 ? ", …" : ""}) · series range {range}
        </>
      )}
    </div>
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
        <Icon name="warning" size="sm" />
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

  // Per-language names (#295). Fetched rather than drilled: this dialog is opened from the issues
  // list and from the inventory stamp picker, and the answer is cached per collection.
  const { titleLanguages, defaultLanguage } = useTitleLanguages(collectionId);
  // While the translations dialog is up, the issue dialog must not close on Esc / backdrop click.
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);

  const [selectedAreaId, setSelectedAreaId] = useState(() => {
    if (isCreate) {
      // Grouping-only areas (#263) can't hold issues, so never default to one — prefer the
      // requested area when it's assignable, else the first assignable area.
      const requested = props.defaultAreaId
        ? areas.find((a) => a.id === props.defaultAreaId)
        : undefined;
      if (requested?.assignable) return requested.id;
      return areas.find((a) => a.assignable)?.id ?? "";
    }
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
  // Per-vendor "Assign to stamps" selection (#451). This *is* the auto-create decision — there is
  // no master switch — and it is maintained by the auto-selection effect below as the ranges are
  // typed. `pinnedVendors` records the boxes the collector ticked or unticked by hand, which the
  // effect then never touches again: a deliberate choice outlives any amount of further typing.
  const [vendorSelection, setVendorSelection] = useState<Record<string, boolean>>({});
  const [pinnedVendors, setPinnedVendors] = useState<Record<string, boolean>>({});
  const autoCreate = useMemo(
    () => Object.values(vendorSelection).some(Boolean),
    [vendorSelection]
  );

  // Auto-create duplicate check (#85): the generated catalog numbers become real
  // stamps, so warn before creating when any collides. Reads the uncontrolled form
  // on change (bumping `formVersion`) and re-runs the debounced lookup.
  const formRef = useRef<HTMLFormElement>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [autoDup, setAutoDup] = useState<{
    mode: DuplicateCatalogMode;
    groups: CatalogDuplicateGroup[];
  }>({ mode: "warn", groups: [] });

  const vendors = useMemo(
    () => (selectedAreaId ? effectiveVendorsForArea(areas, selectedAreaId) : []),
    [areas, selectedAreaId]
  );

  const primaryVendorId = useMemo(
    () =>
      selectedAreaId ? effectivePrimaryVendorId(areas, selectedAreaId) : null,
    [areas, selectedAreaId]
  );

  const areaTree = useMemo(() => (isCreate ? buildAreaTree(areas) : []), [isCreate, areas]);

  // Tick the boxes the ranges imply (#451), re-read from the (uncontrolled) form on every edit
  // via `formVersion`. The primary follows whether its own range can generate stamps at all;
  // every other catalog follows the older rule — the primary is on and its range spans the same
  // number of stamps. Pinned vendors keep whatever the collector set.
  useEffect(() => {
    if (!isCreate) return;
    const form = formRef.current;
    if (!form || !primaryVendorId) return;
    setVendorSelection((prev) => {
      const primaryCount = specCountFromForm(form, primaryVendorId);
      const primaryOn = pinnedVendors[primaryVendorId]
        ? (prev[primaryVendorId] ?? false)
        : primaryCount !== null && primaryCount <= AUTO_CREATE_MAX_STAMPS;
      const next: Record<string, boolean> = {};
      for (const v of vendors) {
        const id = v.catalogVendorId;
        if (id === primaryVendorId) {
          next[id] = primaryOn;
        } else if (pinnedVendors[id]) {
          next[id] = prev[id] ?? false;
        } else {
          next[id] =
            primaryOn && primaryCount !== null && specCountFromForm(form, id) === primaryCount;
        }
      }
      const unchanged =
        Object.keys(next).length === Object.keys(prev).length &&
        Object.entries(next).every(([id, on]) => prev[id] === on);
      return unchanged ? prev : next;
    });
  }, [isCreate, vendors, primaryVendorId, pinnedVendors, formVersion]);

  function handleVendorToggle(vendorId: string, checked: boolean) {
    setVendorSelection((prev) => ({ ...prev, [vendorId]: checked }));
    setPinnedVendors((prev) => ({ ...prev, [vendorId]: true }));
  }

  // What each catalog's spec field currently holds (#452). The fields are uncontrolled, so this
  // mirrors them out of the DOM on every edit (`formVersion`) — parsing then happens off the
  // mirrored text, which is what the note under the field says and what blocks Save.
  const [specInputs, setSpecInputs] = useState<Record<string, string>>({});
  useEffect(() => {
    const form = formRef.current;
    if (!isCreate || !form) return;
    const next: Record<string, string> = {};
    for (const v of vendors) {
      const raw = numbersValueFromForm(form, v.catalogVendorId).trim();
      if (raw) next[v.catalogVendorId] = raw;
    }
    setSpecInputs((prev) => {
      const keys = Object.keys(next);
      const unchanged =
        keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]);
      return unchanged ? prev : next;
    });
  }, [isCreate, vendors, formVersion]);

  const specResults = useMemo(() => {
    const out: Record<string, CatalogNumberSpec | { error: string }> = {};
    for (const [vendorId, raw] of Object.entries(specInputs)) {
      out[vendorId] = parseCatalogNumberSpec(raw);
    }
    return out;
  }, [specInputs]);

  // A spec nobody can act on must not reach the server, whether or not its catalog generates
  // stamps: its numbers are also the range the issue would declare.
  const specInvalid = Object.values(specResults).some((r) => "error" in r);

  useEffect(() => {
    let cancelled = false;
    // formVersion (a dep) re-triggers this on any First/Last edit, since the inputs
    // are uncontrolled. All state updates happen in the debounced async callback.
    const timer = setTimeout(async () => {
      if (!isCreate || !autoCreate || !selectedAreaId || !formRef.current) {
        if (!cancelled) setAutoDup((prev) => ({ mode: prev.mode, groups: [] }));
        return;
      }
      const selected = vendors
        .filter((v) => vendorSelection[v.catalogVendorId])
        .map((v) => v.catalogVendorId);
      const candidates = autoCreateCandidatesFromForm(formRef.current, selected);
      if (candidates.length === 0) {
        if (!cancelled) setAutoDup((prev) => ({ mode: prev.mode, groups: [] }));
        return;
      }
      const { checkCatalogDuplicatesAction } = await import("@/app/actions/duplicate-catalog");
      const res = await checkCatalogDuplicatesAction(collectionId, candidates, {
        contextAreaId: selectedAreaId,
        // The issue being created has no row to read its prefixes from yet, so the fields in this
        // very form are the identity the generated numbers would carry (#377).
        contextPrefixes: prefixesFromForm(
          formRef.current,
          vendors.map((v) => v.catalogVendorId)
        ),
      });
      if (!cancelled) setAutoDup(res);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    isCreate,
    autoCreate,
    selectedAreaId,
    vendorSelection,
    primaryVendorId,
    vendors,
    formVersion,
    collectionId,
  ]);

  const autoDupBlocking = autoDup.mode === "block" && autoDup.groups.length > 0;

  // Declared-range coverage (edit only): the list already computed which vendors'
  // members extend the range. Applying a suggestion writes the widened range into
  // the (uncontrolled) First/Last inputs and drops it from the list; the user saves
  // the form normally to persist it.
  const [rangeSuggestions, setRangeSuggestions] = useState<IssueRangeSuggestion[]>(
    isCreate ? [] : props.issue.rangeSuggestions
  );

  function handleApplyRange(s: IssueRangeSuggestion) {
    const form = formRef.current;
    if (form) {
      const firstEl = form.elements.namedItem(`issueCatalogFirst_${s.catalogVendorId}`);
      const lastEl = form.elements.namedItem(`issueCatalogLast_${s.catalogVendorId}`);
      if (firstEl instanceof HTMLInputElement) firstEl.value = s.proposedFirst;
      if (lastEl instanceof HTMLInputElement) lastEl.value = s.proposedLast ?? "";
    }
    setRangeSuggestions((prev) => prev.filter((x) => x.catalogVendorId !== s.catalogVendorId));
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
      dismissable={!nestedDialogOpen}
      minHeight="32rem"
    >
      <form
        ref={formRef}
        style={FORM_STYLE}
        onSubmit={handleSubmit}
        onChange={() => setFormVersion((v) => v + 1)}
      >
        <DialogBody>
          {isCreate && (
            <div style={{ marginBottom: "1.25rem" }}>
              <LabelWithError htmlFor="issueAreaId-button">Area</LabelWithError>
              <AreaTreeSelect
                areas={areas}
                areaTree={areaTree}
                name="issueAreaId"
                selectedId={selectedAreaId}
                onSelectedIdChange={(id) => {
                  setSelectedAreaId(id);
                  setVendorSelection({});
                  setPinnedVendors({});
                }}
                disabled={isPending}
                onlyAssignableSelectable
                noneOptionLabel={
                  areas.length === 0 ? "— No areas yet —" : "— Select an area"
                }
              />
            </div>
          )}
          <IssueForm
            vendors={vendors}
            primaryVendorId={primaryVendorId}
            defaultName={isCreate ? undefined : (props.issue.name ?? "")}
            defaultYear={isCreate ? props.defaultYear : (props.issue.year ?? undefined)}
            defaultCatalogNumbers={isCreate ? undefined : props.issue.catalogNumbers}
            defaultCatalogPrefixes={isCreate ? undefined : props.issue.catalogPrefixes}
            isPending={isPending}
            autoFocusName={isCreate}
            showAutoCreate={isCreate && vendors.length > 0}
            specMode={isCreate}
            specNoteFor={isCreate ? (vendorId) => <SpecNote result={specResults[vendorId]} /> : undefined}
            vendorSelection={vendorSelection}
            onVendorToggle={handleVendorToggle}
            onRangeAutoFilled={() => setFormVersion((v) => v + 1)}
            onNameChange={isCreate ? setNameValue : undefined}
            nameWarning={nameWarning}
            titleLanguages={titleLanguages}
            defaultLanguage={defaultLanguage}
            defaultTranslations={isCreate ? undefined : { name: props.issue.nameByLanguage }}
            onNestedDialogOpenChange={setNestedDialogOpen}
            catalogWarningFor={
              isCreate && autoCreate
                ? (vendorId) => {
                    const vendorGroups = autoDup.groups.filter(
                      (g) => g.catalogVendorId === vendorId
                    );
                    return vendorGroups.length > 0 ? (
                      <CatalogDuplicateWarningIcon
                        groups={vendorGroups}
                        blocking={autoDup.mode === "block"}
                      />
                    ) : null;
                  }
                : undefined
            }
          />
          {!isCreate && (
            <IssueRangeWarning
              suggestions={rangeSuggestions}
              onApply={handleApplyRange}
              disabled={isPending}
            />
          )}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Save"}
          onCancel={onClose}
          disabled={
            isPending || (isCreate && !selectedAreaId) || specInvalid || autoDupBlocking
          }
          error={error}
        />
      </form>
    </DialogShell>
  );
}
