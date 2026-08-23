"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import {
  createCollectionAreaAction,
  updateCollectionAreaAction,
  deleteCollectionAreaAction,
  reorderCollectionAreasAction,
  type AreaActionState,
} from "@/app/actions/areas";
import type { CollectionAreaData, AreaCatalogEntry, AreaVendorEntry } from "@/lib/areas";
import { languageLabel } from "@/lib/languages";
import {
  fillTranslationValues,
  type TranslationField,
  type TranslationValues,
} from "@/app/c/[collectionSlug]/shared/translations-dialog";
import { TranslationsField } from "@/app/c/[collectionSlug]/shared/translations-field";
import type { CatalogNameFlat } from "@/lib/catalog";
import { effectivePrimaryVendorId, effectiveVendorsForArea } from "@/lib/area-vendor";
import { AreaTreeSelect, buildAreaTree } from "@/app/area-tree-select";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { FormatFactorsDialog } from "@/app/c/[collectionSlug]/shared/use-format-factors-action";
import { useCollapsedSet } from "@/app/c/[collectionSlug]/shared/use-collapsed-set";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { Icon } from "@/app/icons";

// Persisted collapse state for the area management tree, consistent with the area
// filter tree (#81). Distinct key so the two trees collapse independently (#237).
const COLLAPSE_STORAGE_KEY = "stamporama:area-mgmt-collapsed";

interface AreasPanelProps {
  collectionId: string;
  collectionSlug: string;
  initialAreas: CollectionAreaData[];
  catalogNames: CatalogNameFlat[];
  /** Every vendor in the collection, book or no book (#675) — the *Numbering* section lists them
   * independently of the price sources. */
  catalogVendors: AreaFormVendor[];
  /** Languages needing a translation (#293): the platforms' listing languages minus the
   * collection's default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain `titleName` is written in (#293); labels the field once translations
   * are in play. */
  defaultLanguage: string;
}

type DialogState =
  | { kind: "none" }
  | ({ kind: "add-area"; defaultParentId?: string } & InheritedValues)
  | ({ kind: "edit-area"; area: CollectionAreaData } & InheritedValues)
  | { kind: "delete-area"; area: CollectionAreaData }
  | { kind: "format-factors"; area: CollectionAreaData };

/** Everything an area resolves off its ancestors, so a row can be read — and a dialog filled in —
 * without opening the parent (#675). One shape for both, since the list marks own-vs-inherited by
 * comparing the area's own declarations against exactly these. */
interface InheritedValues {
  inheritedPrimaryId: string | null;
  inheritedPrimaryVendorId: string | null;
  inheritedCatalogPrefix: string | null;
  inheritedPrefixes: AreaCatalogEntry[];
}

interface TreeNode {
  area: CollectionAreaData;
  depth: number;
  effectivePrimaryCatalogNameId: string | null;
  /** The vendor that leads numbering here, own or inherited (#675). */
  effectivePrimaryVendorId: string | null;
  /** The area-level prefix in force here, own or inherited (#675); a per-vendor row may still
   * override it for one vendor, which is what {@link effectivePrefixEntries} reports. */
  effectiveCatalogPrefix: string | null;
  effectivePrefixEntries: AreaCatalogEntry[];
}

/** The nearest ancestor-or-self value of the area-level prefix. `''` at any level is a stated
 * *no prefix* and reads as none. */
function resolveEffectiveCatalogPrefix(
  areas: CollectionAreaData[],
  areaId: string
): string | null {
  const byId = new Map(areas.map((a) => [a.id, a]));
  let current: CollectionAreaData | undefined = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    if (current.catalogPrefix !== null) return current.catalogPrefix || null;
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return null;
}

function buildFlatTree(areas: CollectionAreaData[]): TreeNode[] {
  const byId = new Map<string, CollectionAreaData>();
  for (const a of areas) byId.set(a.id, a);

  function effectivePrimary(area: CollectionAreaData): string | null {
    let current: CollectionAreaData | undefined = area;
    let depth = 0;
    while (current && depth < 50) {
      if (current.primaryCatalogNameId) return current.primaryCatalogNameId;
      current = current.parentId ? byId.get(current.parentId) : undefined;
      depth++;
    }
    return null;
  }

  function collectChildren(parentId: string | null, depth: number): TreeNode[] {
    const nodes: TreeNode[] = [];
    const children = areas.filter((a) => a.parentId === parentId);
    for (const child of children) {
      nodes.push({
        area: child,
        depth,
        effectivePrimaryCatalogNameId: effectivePrimary(child),
        effectivePrimaryVendorId: effectivePrimaryVendorId(areas, child.id),
        effectiveCatalogPrefix: resolveEffectiveCatalogPrefix(areas, child.id),
        // The shared resolution (#675), not a walk of this file's own — the prefix is catalog
        // identity, so the badges on these rows must agree with every chip drawn elsewhere.
        effectivePrefixEntries: effectiveVendorsForArea(areas, child.id),
      });
      nodes.push(...collectChildren(child.id, depth + 1));
    }
    return nodes;
  }

  return collectChildren(null, 0);
}

function getDescendantIds(areas: CollectionAreaData[], areaId: string): Set<string> {
  const result = new Set<string>();
  const queue = [areaId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const a of areas) {
      if (a.parentId === id) {
        result.add(a.id);
        queue.push(a.id);
      }
    }
  }
  return result;
}

// ── Shared styles ────────────────────────────────────────────────────────────

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

const addBtnStyle: React.CSSProperties = {
  padding: "0.25rem 0.625rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  border: "1px solid var(--color-border)",
  borderRadius: "0.3rem",
  cursor: "pointer",
  background: "transparent",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

const catalogBadgeStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
  // A chip is one token and stays on one line (#691): a prefix broken across two lines inside a
  // single-line row reads as two chips. It never gives up width either — the area name beside it is
  // what yields when a deeply nested row runs out of room, since a shortened name is still the row's
  // identity while half a catalog prefix is nothing.
  whiteSpace: "nowrap",
  flexShrink: 0,
};

/** The area's one translatable field (#293). `defaultValue` is filled in at render time from the
 * live default-language input, so the dialog's placeholders show what a blank entry falls back to. */
const TITLE_NAME_FIELDS: TranslationField[] = [{ key: "titleName", label: "Title name" }];

/** A titled block inside the area dialog. The catalog settings are two sections rather than one
 * list (#675), and without a heading each the fields read as one long column of boxes. */
function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <div
        style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          color: "var(--color-text-secondary)",
        }}
      >
        {title}
      </div>
      <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.125rem 0 0" }}>
        {hint}
      </p>
    </div>
  );
}

const groupingBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  whiteSpace: "nowrap",
};

// ── CollectionAreaForm ────────────────────────────────────────────────────────

/** One vendor row in the *Numbering* section (#675). `prefix` is what is typed in the box, and
 * `noPrefix` is the explicit exception — the two together are the column's three states: the box
 * blank and unmarked means *inherit* (the box shows the inherited value as its placeholder), marked
 * means *no prefix here*, and text means that prefix. */
interface VendorRowState {
  catalogVendorId: string;
  prefix: string;
  noPrefix: boolean;
}

/** A vendor as the *Numbering* section lists it — every vendor in the collection, whether or not
 * this area attaches any of its books. */
export interface AreaFormVendor {
  id: string;
  name: string;
  abbreviation: string;
}

interface CollectionAreaFormProps {
  defaultName?: string;
  defaultParentId?: string | null;
  defaultDescription?: string | null;
  defaultTitleName?: string | null;
  defaultTitleNameByLanguage?: Record<string, string>;
  defaultPrimaryCatalogNameId?: string | null;
  defaultPrimaryCatalogVendorId?: string | null;
  defaultCatalogPrefix?: string | null;
  defaultCatalogEntries?: AreaCatalogEntry[];
  defaultVendorEntries?: AreaVendorEntry[];
  defaultAssignable?: boolean;
  inheritedPrimaryId: string | null;
  /** What the parent chain already answers, so every field on this form can show its inherited
   * value as a placeholder rather than copying it in (#377's idiom, #675). */
  inheritedPrimaryVendorId: string | null;
  inheritedCatalogPrefix: string | null;
  inheritedPrefixes: AreaCatalogEntry[];
  areas: CollectionAreaData[];
  currentAreaId?: string;
  catalogNames: CatalogNameFlat[];
  catalogVendors: AreaFormVendor[];
  /** Languages needing a translation (#293); edited in the translations dialog opened from
   * this form. */
  titleLanguages: string[];
  /** The language the plain `titleName` field holds (#293). */
  defaultLanguage: string;
  /** Told when the nested translations dialog opens/closes, so the enclosing dialog can stop
   * dismissing itself on Esc / backdrop click while it is up. */
  onNestedDialogOpenChange?: (open: boolean) => void;
  isPending: boolean;
}

function CollectionAreaForm({
  defaultName,
  defaultParentId,
  defaultDescription,
  defaultTitleName,
  defaultTitleNameByLanguage,
  defaultPrimaryCatalogNameId,
  defaultPrimaryCatalogVendorId,
  defaultCatalogPrefix,
  defaultCatalogEntries,
  defaultVendorEntries,
  defaultAssignable = true,
  inheritedPrimaryId,
  inheritedPrimaryVendorId,
  inheritedCatalogPrefix,
  inheritedPrefixes,
  areas,
  currentAreaId,
  catalogNames,
  catalogVendors,
  titleLanguages,
  defaultLanguage,
  onNestedDialogOpenChange,
  isPending,
}: CollectionAreaFormProps) {
  const catalogById = useMemo(() => {
    const m = new Map<string, CatalogNameFlat>();
    for (const c of catalogNames) m.set(c.id, c);
    return m;
  }, [catalogNames]);

  const excludedIds = useMemo(
    () => (currentAreaId ? getDescendantIds(areas, currentAreaId) : new Set<string>()),
    [areas, currentAreaId]
  );

  const selectableAreas = useMemo(
    () => areas.filter((a) => a.id !== currentAreaId && !excludedIds.has(a.id)),
    [areas, currentAreaId, excludedIds]
  );

  const selectableTree = useMemo(() => buildAreaTree(selectableAreas), [selectableAreas]);

  const [parentId, setParentId] = useState(defaultParentId ?? "");

  // Name and title name (#210) are edited together: the title name mirrors the name while the two
  // are equal (the common case — every area's title defaults to its own name), and stops mirroring
  // once the user gives the title name its own value. So renaming an area keeps its title in sync
  // unless it was deliberately customised or cleared (cleared = roll up to a parent).
  const [name, setName] = useState(defaultName ?? "");
  const [titleName, setTitleName] = useState(defaultTitleName ?? "");
  function handleNameChange(next: string) {
    setTitleName((tn) => (tn === name ? next : tn));
    setName(next);
  }

  // Per-language title names (#293) are edited in the shared translations dialog rather than as a
  // field per language on this form, which would grow it without bound as languages are added.
  // They are held here and submitted through hidden `titleName:<lang>` inputs, so the existing
  // form-data save path is unchanged. Unlike the default title name they never mirror `name` — a
  // translation is only ever typed deliberately, and a blank one falls back to the default.
  const [translations, setTranslations] = useState<TranslationValues>(() =>
    fillTranslationValues(titleLanguages, TITLE_NAME_FIELDS, {
      titleName: defaultTitleNameByLanguage,
    })
  );

  // ── Price sources: the books this area attaches ────────────────────────────
  const [bookIds, setBookIds] = useState<string[]>(() =>
    (defaultCatalogEntries ?? []).flatMap((e) => (e.catalogNameId ? [e.catalogNameId] : []))
  );
  const [addCatalogId, setAddCatalogId] = useState("");

  const usedIds = new Set(bookIds);
  const availableCatalogs = catalogNames.filter((cn) => !usedIds.has(cn.id));

  const [primaryCatalogNameId, setPrimaryCatalogNameId] = useState(
    defaultPrimaryCatalogNameId ?? ""
  );

  // ── Numbering: the area's own prefix, and the vendors it records numbers for ─
  const [catalogPrefix, setCatalogPrefix] = useState(defaultCatalogPrefix ?? "");
  const [vendorRows, setVendorRows] = useState<VendorRowState[]>(() =>
    (defaultVendorEntries ?? []).map((v) => ({
      catalogVendorId: v.catalogVendorId,
      prefix: v.areaPrefix ?? "",
      noPrefix: v.areaPrefix === "",
    }))
  );
  const [primaryVendorId, setPrimaryVendorId] = useState(defaultPrimaryCatalogVendorId ?? "");
  const [addVendorId, setAddVendorId] = useState("");

  const vendorById = useMemo(() => {
    const m = new Map<string, AreaFormVendor>();
    for (const v of catalogVendors) m.set(v.id, v);
    return m;
  }, [catalogVendors]);

  // A vendor is ticked by default from the books this area attaches — that is what the derived rows
  // used to do, kept as a *default* now that the list is written. Rows the collector added without a
  // book stay in the list on their own.
  const bookVendorIds = useMemo(() => {
    const byName = new Map(catalogNames.map((cn) => [cn.id, cn.vendorId]));
    return new Set(bookIds.flatMap((id) => (byName.has(id) ? [byName.get(id)!] : [])));
  }, [bookIds, catalogNames]);

  const listedVendorIds = useMemo(() => {
    const ids = new Set(vendorRows.map((r) => r.catalogVendorId));
    for (const id of bookVendorIds) ids.add(id);
    return catalogVendors.filter((v) => ids.has(v.id)).map((v) => v.id);
  }, [vendorRows, bookVendorIds, catalogVendors]);

  const addableVendors = catalogVendors.filter((v) => !listedVendorIds.includes(v.id));

  function vendorRow(catalogVendorId: string): VendorRowState {
    return (
      vendorRows.find((r) => r.catalogVendorId === catalogVendorId) ?? {
        catalogVendorId,
        prefix: "",
        noPrefix: false,
      }
    );
  }

  function setVendorRow(catalogVendorId: string, patch: Partial<VendorRowState>) {
    setVendorRows((rows) => {
      const existing = rows.find((r) => r.catalogVendorId === catalogVendorId);
      if (existing) {
        return rows.map((r) => (r.catalogVendorId === catalogVendorId ? { ...r, ...patch } : r));
      }
      return [...rows, { catalogVendorId, prefix: "", noPrefix: false, ...patch }];
    });
  }

  function addVendor() {
    if (!addVendorId || listedVendorIds.includes(addVendorId)) return;
    setVendorRows([...vendorRows, { catalogVendorId: addVendorId, prefix: "", noPrefix: false }]);
    setAddVendorId("");
  }

  function removeVendor(catalogVendorId: string) {
    setVendorRows(vendorRows.filter((r) => r.catalogVendorId !== catalogVendorId));
    setBookIds(bookIds.filter((id) => catalogNames.find((cn) => cn.id === id)?.vendorId !== catalogVendorId));
    if (primaryVendorId === catalogVendorId) setPrimaryVendorId("");
  }

  function addBook() {
    const id = addCatalogId || availableCatalogs[0]?.id;
    if (!id || usedIds.has(id)) return;
    setBookIds([...bookIds, id]);
    setAddCatalogId("");
  }

  function removeBook(catalogNameId: string) {
    setBookIds(bookIds.filter((id) => id !== catalogNameId));
    if (primaryCatalogNameId === catalogNameId) setPrimaryCatalogNameId("");
  }

  /** What a vendor's prefix box shows when it is left blank: this area's own prefix if one is being
   * typed, else whatever the parent chain already resolves for that vendor. */
  function inheritedPrefixFor(catalogVendorId: string): string {
    if (catalogPrefix.trim()) return catalogPrefix.trim();
    if (inheritedCatalogPrefix) return inheritedCatalogPrefix;
    const inherited = inheritedPrefixes.find((p) => p.catalogVendorId === catalogVendorId);
    return inherited?.prefix ?? "";
  }

  // What the form submits: the books as ids, and one row per listed vendor carrying the three-state
  // prefix — null for the ordinary tick, `""` for the stated "no prefix", text for a prefix.
  const submittedVendors = listedVendorIds.map((id) => {
    const row = vendorRow(id);
    return {
      catalogVendorId: id,
      areaPrefix: row.noPrefix ? "" : row.prefix.trim() || null,
    };
  });

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-area-name">Name</LabelWithError>
        <input
          id="f-area-name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          disabled={isPending}
          placeholder="e.g. Germany"
          style={INPUT_STYLE}
          required
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-area-parent-button">Parent area</LabelWithError>
        <AreaTreeSelect
          areas={selectableAreas}
          areaTree={selectableTree}
          name="parentId"
          selectedId={parentId}
          onSelectedIdChange={setParentId}
          disabled={isPending}
          noneOptionLabel="— None (top-level)"
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-area-description">Description (optional)</LabelWithError>
        <textarea
          id="f-area-description"
          name="description"
          rows={3}
          defaultValue={defaultDescription ?? ""}
          disabled={isPending}
          style={{ ...INPUT_STYLE, resize: "vertical", minHeight: "4.5rem" }}
        />
      </div>

      {/* Title name (#210): the name to use for this area in auto-generated listing titles. Blank
          rolls up to the nearest ancestor that sets one, else the area's own name — so internal
          grouping levels can defer to a public parent. */}
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-area-title-name">
          {titleLanguages.length > 0
            ? `Title name — ${languageLabel(defaultLanguage)} (optional)`
            : "Title name (optional)"}
        </LabelWithError>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            id="f-area-title-name"
            name="titleName"
            type="text"
            value={titleName}
            onChange={(e) => setTitleName(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Poland"
            style={INPUT_STYLE}
          />
          {/* Per-language title names (#293) live behind the shared translations dialog, opened
              from this icon so the form keeps one field however many languages are in use. Only
              rendered once a platform has a listing language. The badge counts languages still
              missing a translation. Values ride along as hidden inputs; a cleared one submits
              blank, which drops that language's translation. */}
          {titleLanguages.length > 0 && (
            <TranslationsField
              dialogTitle="Title name translations"
              description={`The title name each language's platforms use for this area. Leave one blank to fall back to the ${languageLabel(defaultLanguage)} title name above. They are saved together with the area.`}
              languages={titleLanguages}
              fields={[
                { ...TITLE_NAME_FIELDS[0], defaultValue: titleName || name },
              ]}
              values={translations}
              onChange={setTranslations}
              onOpenChange={onNestedDialogOpenChange}
              ariaLabel="Edit title name translations"
              disabled={isPending}
            />
          )}
        </div>
        <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
          Used for the <code>{"{area}"}</code> token in listing titles. Defaults to (and stays in sync
          with) this area&apos;s name. <strong>Clear it</strong> to roll this area up to the nearest
          parent that has a title name — handy for internal grouping levels.
          {titleLanguages.length > 0 && (
            <> Translations (<Icon name="translations" size="xs" />) are saved together with the area.</>
          )}
        </p>
      </div>

      {/* Grouping-only areas (#263): organize children but can't receive issues directly. */}
      <div style={{ marginBottom: "1rem" }}>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            fontSize: "0.875rem",
            color: "var(--color-text-primary)",
            cursor: isPending ? "not-allowed" : "pointer",
          }}
        >
          {/* An unchecked checkbox submits nothing, so the action reads `assignable` as
              false when off and "true" when on — no hidden companion field. */}
          <input
            type="checkbox"
            name="assignable"
            value="true"
            defaultChecked={defaultAssignable}
            disabled={isPending}
            style={{ marginTop: "0.2rem" }}
          />
          <span>
            Can hold issues
            <span
              style={{
                display: "block",
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Leave unchecked for a grouping-only area (e.g. &ldquo;Europe&rdquo;) that just
              organizes the areas inside it. Catalog settings still pass down to children.
            </span>
          </span>
        </label>
      </div>

      {/* **Numbering** (#675): whose numbers this area's stamps carry, and what they are prefixed
          with. Separate from the price sources below — the schema always had them apart, and the one
          list keyed by book is what made `PL` a thing you typed once per vendor. */}
      <div style={{ marginBottom: "1.25rem" }}>
        <SectionHeading
          title="Numbering"
          hint="Whose catalog numbers this area's stamps carry, and the prefix they show."
        />

        <div style={{ marginBottom: "0.75rem" }}>
          <LabelWithError htmlFor="f-area-catalog-prefix">Area prefix</LabelWithError>
          <input
            id="f-area-catalog-prefix"
            type="text"
            value={catalogPrefix}
            onChange={(e) => setCatalogPrefix(e.target.value)}
            disabled={isPending}
            placeholder={inheritedCatalogPrefix ?? "none"}
            {...NO_AUTOFILL}
            style={{ ...INPUT_STYLE, width: "8rem", fontFamily: "monospace" }}
          />
          <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
            Used for <strong>every</strong> vendor below unless one overrides it. Leave blank to
            inherit from the parent area
            {inheritedCatalogPrefix ? <> (<code>{inheritedCatalogPrefix}</code>)</> : null}.
          </p>
        </div>

        {listedVendorIds.length > 0 && (
          <div style={{ marginBottom: "0.5rem" }}>
            {listedVendorIds.map((vendorId) => {
              const vendor = vendorById.get(vendorId);
              const row = vendorRow(vendorId);
              const bookCount = bookIds.filter(
                (id) => catalogNames.find((cn) => cn.id === id)?.vendorId === vendorId
              ).length;
              return (
                <div
                  key={vendorId}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}
                >
                  <Tooltip content="Leads numbering here — the catalog sort key, the primary chip and the leading label">
                    <input
                      type="radio"
                      name="f-area-primary-vendor"
                      checked={primaryVendorId === vendorId}
                      onChange={() => setPrimaryVendorId(vendorId)}
                      disabled={isPending}
                      aria-label={`${vendor?.name ?? vendorId} leads numbering`}
                    />
                  </Tooltip>
                  <span
                    style={{ flex: 1, fontSize: "0.875rem", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {vendor ? `${vendor.name} (${vendor.abbreviation})` : vendorId}
                    <span style={{ marginLeft: "0.375rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      {bookCount === 0
                        ? "no book here"
                        : bookCount === 1
                          ? "1 book"
                          : `${bookCount} books`}
                    </span>
                  </span>
                  <input
                    type="text"
                    value={row.noPrefix ? "" : row.prefix}
                    onChange={(e) => setVendorRow(vendorId, { prefix: e.target.value })}
                    disabled={isPending || row.noPrefix}
                    placeholder={row.noPrefix ? "none" : inheritedPrefixFor(vendorId) || "none"}
                    {...NO_AUTOFILL}
                    style={{ ...INPUT_STYLE, width: "6rem", flex: "none", padding: "0.375rem 0.5rem", minHeight: "2rem", fontFamily: "monospace" }}
                  />
                  <Tooltip content="No prefix for this vendor here — stops the area prefix reaching it">
                    <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--color-text-muted)", cursor: isPending ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                      <input
                        type="checkbox"
                        checked={row.noPrefix}
                        onChange={(e) => setVendorRow(vendorId, { noPrefix: e.target.checked })}
                        disabled={isPending}
                      />
                      none
                    </label>
                  </Tooltip>
                  <button
                    type="button"
                    onClick={() => removeVendor(vendorId)}
                    disabled={isPending}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-error)", fontSize: "0.875rem", padding: "0.25rem", lineHeight: 1 }}
                    aria-label={`Remove ${vendor?.name ?? vendorId}`}
                  >
                    <Icon name="close" size="sm" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {inheritedPrimaryVendorId && !primaryVendorId && (
          <p style={{ margin: "0.25rem 0 0.5rem", fontSize: "0.8125rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>
            Leading vendor inherited:{" "}
            {vendorById.get(inheritedPrimaryVendorId)?.name ?? inheritedPrimaryVendorId}
          </p>
        )}

        {addableVendors.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <select
              value={addVendorId}
              onChange={(e) => setAddVendorId(e.target.value)}
              disabled={isPending}
              aria-label="Add a numbering vendor"
              style={{ ...INPUT_STYLE, flex: 1, minHeight: "2rem", padding: "0.375rem 0.5rem" }}
            >
              <option value="">— Add a vendor —</option>
              {addableVendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.abbreviation})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addVendor}
              disabled={isPending || !addVendorId}
              style={addBtnStyle}
            >
              + Add
            </button>
          </div>
        )}
        <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.5rem 0 0" }}>
          A vendor needs no book here — record its numbers even where you own none of its volumes.
        </p>
      </div>

      {/* **Price sources** (#675): the books that price this area, and which of them a copy's
          catalogue value is read from. Attaching none inherits the nearest ancestor's whole list. */}
      <div>
        <SectionHeading
          title="Price sources"
          hint="The catalogues whose prices apply here. Attach none to use the parent area's."
        />

        {bookIds.length > 0 && (
          <div style={{ marginBottom: "0.5rem" }}>
            {bookIds.map((catalogNameId) => {
              const cn = catalogById.get(catalogNameId);
              return (
                <div
                  key={catalogNameId}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}
                >
                  <Tooltip content="Gives a copy in this area its catalogue value">
                    <input
                      type="radio"
                      name="f-area-primary-catalog"
                      checked={primaryCatalogNameId === catalogNameId}
                      onChange={() => setPrimaryCatalogNameId(catalogNameId)}
                      disabled={isPending}
                      aria-label={`${cn ? `${cn.vendorName} / ${cn.name}` : catalogNameId} is the valuing volume`}
                    />
                  </Tooltip>
                  <span
                    style={{ flex: 1, fontSize: "0.875rem", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {cn ? `${cn.vendorName} / ${cn.name}` : catalogNameId}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeBook(catalogNameId)}
                    disabled={isPending}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-error)", fontSize: "0.875rem", padding: "0.25rem", lineHeight: 1 }}
                    aria-label="Remove"
                  >
                    <Icon name="close" size="sm" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* What this area falls back to while it attaches nothing of its own. */}
        {bookIds.length === 0 && inheritedPrefixes.length > 0 && (
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>
            Inherits:{" "}
            {inheritedPrefixes
              .filter((ip) => !!ip.catalogName)
              .map((ip) => `${ip.vendorName} / ${ip.catalogName}`)
              .join(", ") || "nothing"}
          </p>
        )}

        {availableCatalogs.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <select
              value={addCatalogId}
              onChange={(e) => setAddCatalogId(e.target.value)}
              disabled={isPending}
              aria-label="Add a price source"
              style={{ ...INPUT_STYLE, flex: 1, minHeight: "2rem", padding: "0.375rem 0.5rem" }}
            >
              <option value="">— Select catalog —</option>
              {availableCatalogs.map((cn) => (
                <option key={cn.id} value={cn.id}>
                  {cn.vendorName} / {cn.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addBook}
              disabled={isPending || !addCatalogId}
              style={addBtnStyle}
            >
              + Add
            </button>
          </div>
        )}

        {inheritedPrimaryId && !primaryCatalogNameId && (() => {
          const inh = catalogById.get(inheritedPrimaryId);
          return inh ? (
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>
              Valuing volume inherited: {inh.vendorName} / {inh.name}
            </p>
          ) : null;
        })()}
        {!inheritedPrimaryId && !primaryCatalogNameId && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            A valuing volume is required for top-level areas (or set one on a parent area).
          </p>
        )}
      </div>

      {/* Everything the two sections above decide rides to the action as hidden fields, so the
          existing form-data save path is unchanged. */}
      <input type="hidden" name="catalogPrefix" value={catalogPrefix.trim()} />
      <input type="hidden" name="primaryCatalogNameId" value={primaryCatalogNameId} />
      <input type="hidden" name="primaryCatalogVendorId" value={primaryVendorId} />
      <input type="hidden" name="catalogNameIds" value={JSON.stringify(bookIds)} />
      <input type="hidden" name="areaVendors" value={JSON.stringify(submittedVendors)} />
    </>
  );
}

// ── AreasPanel ────────────────────────────────────────────────────────────────

export function AreasPanel({
  collectionId,
  collectionSlug,
  initialAreas,
  catalogNames,
  catalogVendors,
  titleLanguages,
  defaultLanguage,
}: AreasPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  // The area form can open the translations dialog on top of the area dialog (#293); while it is
  // up the area dialog must not close on Esc / backdrop click.
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);
  const [actionState, setActionState] = useState<AreaActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  const catalogById = useMemo(() => {
    const m = new Map<string, CatalogNameFlat>();
    for (const c of catalogNames) m.set(c.id, c);
    return m;
  }, [catalogNames]);

  const flatTree = useMemo(() => buildFlatTree(initialAreas), [initialAreas]);

  const nodeByAreaId = useMemo(() => {
    const m = new Map<string, TreeNode>();
    for (const node of flatTree) m.set(node.area.id, node);
    return m;
  }, [flatTree]);

  // Ids of areas that have at least one child (only these get an expand/collapse toggle).
  const parentIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of initialAreas) if (a.parentId) set.add(a.parentId);
    return set;
  }, [initialAreas]);

  // Default (nothing stored yet): collapse nested parents, mirroring the filter tree (#81).
  const computeDefaultCollapsed = useCallback(() => {
    const defaults = new Set<string>();
    for (const { area, depth } of flatTree) {
      if (depth > 0 && parentIds.has(area.id)) defaults.add(area.id);
    }
    return defaults;
  }, [flatTree, parentIds]);

  const { collapsed, loaded, toggle } = useCollapsedSet(
    COLLAPSE_STORAGE_KEY,
    computeDefaultCollapsed
  );

  // Hide every descendant of a collapsed node.
  const visibleTree = useMemo(() => {
    const hidden = new Set<string>();
    for (const { area } of flatTree) {
      if (collapsed.has(area.id)) {
        for (const id of getDescendantIds(initialAreas, area.id)) hidden.add(id);
      }
    }
    return flatTree.filter(({ area }) => !hidden.has(area.id));
  }, [flatTree, collapsed, initialAreas]);

  // ── Drag-and-drop reordering within a sibling group (#78) ──────────────────
  const areaById = useMemo(() => {
    const m = new Map<string, CollectionAreaData>();
    for (const a of initialAreas) m.set(a.id, a);
    return m;
  }, [initialAreas]);

  // `dragId` is the area being dragged (drag is armed only from its grip handle so the
  // name link and actions menu still work). `dropTarget` marks the row and edge the
  // indicator line renders on.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragArmedId, setDragArmedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);

  function clearDrag() {
    setDragId(null);
    setDragArmedId(null);
    setDropTarget(null);
  }

  // True when `targetId` is a valid drop for the current drag: a different area under the
  // same parent (reordering is sibling-scoped only).
  function isSiblingDropTarget(targetId: string): boolean {
    if (!dragId || dragId === targetId) return false;
    const dragged = areaById.get(dragId);
    const target = areaById.get(targetId);
    return !!dragged && !!target && dragged.parentId === target.parentId;
  }

  function handleReorderDrop(targetId: string) {
    const dragged = dragId ? areaById.get(dragId) : undefined;
    const target = dropTarget ?? null;
    if (!dragged || !target || !isSiblingDropTarget(targetId) || target.id !== targetId) {
      clearDrag();
      return;
    }

    const siblingIds = initialAreas
      .filter((a) => a.parentId === dragged.parentId)
      .map((a) => a.id);
    const without = siblingIds.filter((id) => id !== dragged.id);
    const targetIdx = without.indexOf(targetId);
    const insertIdx = target.position === "after" ? targetIdx + 1 : targetIdx;
    without.splice(insertIdx, 0, dragged.id);

    // No-op if the order is unchanged.
    if (without.length === siblingIds.length && without.every((id, i) => id === siblingIds[i])) {
      clearDrag();
      return;
    }

    const parentId = dragged.parentId;
    clearDrag();
    startTransition(async () => {
      const result = await reorderCollectionAreasAction(collectionId, parentId, without);
      setActionState(result);
      if (result.status === "success") router.refresh();
    });
  }

  function inheritedValuesFor(parentId: string | undefined | null): InheritedValues {
    if (!parentId) {
      return {
        inheritedPrimaryId: null,
        inheritedPrimaryVendorId: null,
        inheritedCatalogPrefix: null,
        inheritedPrefixes: [],
      };
    }
    const node = nodeByAreaId.get(parentId);
    return {
      inheritedPrimaryId: node?.effectivePrimaryCatalogNameId ?? null,
      inheritedPrimaryVendorId: node?.effectivePrimaryVendorId ?? null,
      inheritedCatalogPrefix: node?.effectiveCatalogPrefix ?? null,
      inheritedPrefixes: node?.effectivePrefixEntries ?? [],
    };
  }

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setNestedDialogOpen(false);
    }
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    setNestedDialogOpen(false);
    router.refresh();
  }

  function submitAction(
    action: (fd: FormData) => Promise<AreaActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<AreaActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;

  return (
    <>
      <div style={{ marginBottom: "1.5rem" }}>
        <button
          type="button"
          onClick={() => openDialog({ kind: "add-area", ...inheritedValuesFor(null) })}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--color-action-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          + Add area
        </button>
      </div>

      {flatTree.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No collection areas yet. Add one to get started.
        </p>
      )}

      {flatTree.length > 0 && loaded && (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          {visibleTree.map((node, idx) => {
            const {
              area,
              depth,
              effectivePrimaryCatalogNameId,
              effectivePrimaryVendorId: leadingVendorId,
              effectiveCatalogPrefix,
              effectivePrefixEntries,
            } = node;
            const hasChildren = parentIds.has(area.id);
            const isCollapsed = collapsed.has(area.id);

            // A row reads the whole catalog configuration off the tree (#675): the area prefix, the
            // vendor that leads numbering, the volume a copy is valued from, and the remaining
            // numbering vendors — each marked own or inherited, so a leaf that declares nothing
            // still says where its settings come from without opening the dialog.
            const primaryCatalog = effectivePrimaryCatalogNameId
              ? catalogById.get(effectivePrimaryCatalogNameId)
              : null;
            const isPrimaryInherited =
              primaryCatalog != null &&
              area.primaryCatalogNameId !== effectivePrimaryCatalogNameId;
            const isAreaPrefixInherited = area.catalogPrefix === null;
            // A vendor is this area's own when it declares a row for it or attaches one of its
            // books; otherwise the row came down the tree.
            const declaresVendor = (vendorId: string) =>
              area.vendorEntries.some((v) => v.catalogVendorId === vendorId) ||
              area.catalogEntries.some((e) => e.catalogVendorId === vendorId);

            const leadingVendorEntry = leadingVendorId
              ? (effectivePrefixEntries.find((e) => e.catalogVendorId === leadingVendorId) ?? null)
              : null;
            const isLeadingVendorInherited =
              leadingVendorId != null && area.primaryCatalogVendorId !== leadingVendorId;
            const otherPrefixEntries = effectivePrefixEntries.filter(
              (e) => e.catalogVendorId !== leadingVendorId
            );

            const isDragging = dragId === area.id;
            // Subtle depth shading: the top level sits on the clean elevated surface (white),
            // and each deeper level mixes a bit more neutral gray in, so nesting reads as a gentle
            // fade — scales to any depth (capped). Theme-safe — both surfaces are tokens.
            const shadePct = Math.min(depth, 6) * 22;
            const rowBackground = `color-mix(in srgb, var(--color-bg-muted) ${shadePct}%, var(--color-bg-elevated))`;
            const showDropBefore =
              dropTarget?.id === area.id && dropTarget.position === "before";
            const showDropAfter =
              dropTarget?.id === area.id && dropTarget.position === "after";

            return (
              <div
                key={area.id}
                draggable={dragArmedId === area.id}
                onDragStart={(e) => {
                  setDragId(area.id);
                  e.dataTransfer.effectAllowed = "move";
                  // Firefox requires data to be set for a drag to start.
                  e.dataTransfer.setData("text/plain", area.id);
                }}
                onDragOver={(e) => {
                  if (!isSiblingDropTarget(area.id)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                  setDropTarget((prev) =>
                    prev?.id === area.id && prev.position === position
                      ? prev
                      : { id: area.id, position }
                  );
                }}
                onDragLeave={(e) => {
                  // Ignore leave events bubbling from children still within the row.
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setDropTarget((prev) => (prev?.id === area.id ? null : prev));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleReorderDrop(area.id);
                }}
                onDragEnd={clearDrag}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.75rem 1.25rem",
                  paddingLeft: `${1.25 + depth * 1.5}rem`,
                  background: rowBackground,
                  borderBottom:
                    idx < visibleTree.length - 1 ? "1px solid var(--color-border)" : undefined,
                  opacity: isDragging ? 0.4 : undefined,
                  boxShadow: showDropBefore
                    ? "inset 0 2px 0 0 var(--color-accent)"
                    : showDropAfter
                      ? "inset 0 -2px 0 0 var(--color-accent)"
                      : undefined,
                }}
              >
                {/* Drag handle (#78): arms dragging so the name link and actions menu stay
                    clickable. Grouping and leaf areas both reorder among their siblings. */}
                <button
                  type="button"
                  aria-label={`Drag to reorder ${area.name}`}
                  onMouseDown={() => setDragArmedId(area.id)}
                  onMouseUp={() => setDragArmedId((prev) => (dragId ? prev : null))}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "1rem",
                    flexShrink: 0,
                    background: "none",
                    border: "none",
                    cursor: "grab",
                    color: "var(--color-text-muted)",
                    fontSize: "0.875rem",
                    padding: 0,
                    lineHeight: 1,
                    touchAction: "none",
                  }}
                >
                  <Icon name="dragGrip" size="sm" />
                </button>

                {/* Expand/collapse toggle for nodes with children; a reserved spacer
                    otherwise so every row's name lines up (#237). */}
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(area.id)}
                    aria-label={isCollapsed ? "Expand" : "Collapse"}
                    aria-expanded={!isCollapsed}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "1rem",
                      height: "1rem",
                      flexShrink: 0,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--color-text-muted)",
                      fontSize: "0.625rem",
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    <Icon name={isCollapsed ? "expand" : "collapse"} size="sm" />
                  </button>
                ) : (
                  <span style={{ width: "1rem", flexShrink: 0 }} />
                )}

                <a
                  href={`/c/${collectionSlug}/issues?areaId=${area.id}`}
                  draggable={false}
                  style={{
                    flex: 1,
                    fontSize: "0.9375rem",
                    fontWeight: depth === 0 ? 600 : 500,
                    color: "var(--color-text-primary)",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration: "none",
                  }}
                  onMouseOver={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                  onMouseOut={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                >
                  {area.name}
                </a>

                {/* Grouping-only marker (#263): this area organizes children but holds no issues. */}
                {!area.assignable && <span style={groupingBadgeStyle}>Grouping</span>}

                {/* The area prefix in force here (#675) — the one value that used to be typed once
                    per vendor, so it earns its own badge rather than only showing inside them. */}
                {effectiveCatalogPrefix && (
                  <Tooltip
                    content={
                      isAreaPrefixInherited
                        ? "Area prefix (inherited from a parent area)"
                        : "Area prefix — used for every vendor that does not override it"
                    }
                  >
                    <span
                      style={{
                        ...catalogBadgeStyle,
                        fontStyle: isAreaPrefixInherited ? "italic" : undefined,
                      }}
                    >
                      {effectiveCatalogPrefix}
                    </span>
                  </Tooltip>
                )}

                {/* The vendor that leads numbering, and then the rest. */}
                {leadingVendorEntry && (
                  <Tooltip
                    content={
                      isLeadingVendorInherited
                        ? "Leading catalog vendor (inherited)"
                        : "Leading catalog vendor"
                    }
                  >
                    <span
                      style={{
                        ...catalogBadgeStyle,
                        fontStyle: isLeadingVendorInherited ? "italic" : undefined,
                        color: "var(--color-accent)",
                        borderColor: "var(--color-accent)",
                      }}
                    >
                      {leadingVendorEntry.prefix
                        ? `${leadingVendorEntry.vendorAbbreviation}·${leadingVendorEntry.prefix}`
                        : leadingVendorEntry.vendorAbbreviation}
                    </span>
                  </Tooltip>
                )}

                {otherPrefixEntries.length > 0 && (
                  <span style={{ display: "flex", gap: "0.25rem", flexShrink: 0 }}>
                    {otherPrefixEntries.map((entry) => {
                      const isInherited = !declaresVendor(entry.catalogVendorId);
                      return (
                        <Tooltip
                          key={entry.catalogVendorId}
                          content={
                            isInherited
                              ? `${entry.vendorName} — inherited from a parent area`
                              : entry.vendorName
                          }
                        >
                          <span
                            style={{
                              ...catalogBadgeStyle,
                              fontStyle: isInherited ? "italic" : undefined,
                            }}
                          >
                            {entry.prefix
                              ? `${entry.vendorAbbreviation}·${entry.prefix}`
                              : entry.vendorAbbreviation}
                          </span>
                        </Tooltip>
                      );
                    })}
                  </span>
                )}

                {/* The volume a copy here is valued from — a different question from who leads the
                    numbering (#675), so it is a different badge. */}
                {primaryCatalog && (
                  <Tooltip
                    content={
                      isPrimaryInherited
                        ? `Valuing volume (inherited): ${primaryCatalog.vendorName} / ${primaryCatalog.name}`
                        : `Valuing volume: ${primaryCatalog.vendorName} / ${primaryCatalog.name}`
                    }
                  >
                    <span
                      style={{
                        ...catalogBadgeStyle,
                        fontFamily: "inherit",
                        fontStyle: isPrimaryInherited ? "italic" : undefined,
                        // The one chip holding a catalog *name* rather than an abbreviation
                        // ("Deutschland Spezial - Band 1"), so it is the one allowed to take the
                        // room it needs and the one that shrinks when there is none (#691). The
                        // fixed 10rem it used to have cut every long volume name short even on a
                        // row with space to spare; the tooltip still carries the full value.
                        flexShrink: 1,
                        minWidth: "4rem",
                        maxWidth: "24rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {primaryCatalog.name}
                    </span>
                  </Tooltip>
                )}

                {area.stampCount > 0 && (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--color-text-muted)",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {area.stampCount} stamp{area.stampCount !== 1 ? "s" : ""}
                  </span>
                )}

                <RowActionsMenu
                  ariaLabel="Area actions"
                  actions={[
                    {
                      key: "add-sub",
                      label: "Add sub-area",
                      icon: "add",
                      onSelect: () =>
                        openDialog({ kind: "add-area", defaultParentId: area.id, ...inheritedValuesFor(area.id) }),
                    },
                    {
                      key: "edit",
                      label: "Edit",
                      icon: "edit",
                      onSelect: () =>
                        openDialog({ kind: "edit-area", area, ...inheritedValuesFor(area.parentId) }),
                    },
                    {
                      key: "format-multipliers",
                      label: "Format multipliers…",
                      icon: "factors",
                      onSelect: () => openDialog({ kind: "format-factors", area }),
                    },
                    {
                      key: "delete",
                      label: "Delete",
                      icon: "delete",
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => openDialog({ kind: "delete-area", area }),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* ── Dialogs ── */}

      {/* Multipliers for the pairs and blocks of this area, edited where the area lives rather
          than picked out of a collection-wide list (Settings keeps that overview). */}
      {dialog.kind === "format-factors" && (
        <FormatFactorsDialog
          collectionId={collectionId}
          scope={{ kind: "area", id: dialog.area.id }}
          scopeLabel={dialog.area.name}
          onClose={closeDialog}
        />
      )}

      {dialog.kind === "add-area" && (
        <DialogShell title="Add area" onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => createCollectionAreaAction(collectionId, fd), e)
            }
          >
            <DialogBody>
              <CollectionAreaForm
                defaultParentId={dialog.defaultParentId}
                inheritedPrimaryId={dialog.inheritedPrimaryId}
                inheritedPrimaryVendorId={dialog.inheritedPrimaryVendorId}
                inheritedCatalogPrefix={dialog.inheritedCatalogPrefix}
                inheritedPrefixes={dialog.inheritedPrefixes}
                areas={initialAreas}
                catalogNames={catalogNames}
                catalogVendors={catalogVendors}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
                onNestedDialogOpenChange={setNestedDialogOpen}
                isPending={isPending}
              />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit-area" && (
        <DialogShell title="Edit area" onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => updateCollectionAreaAction(dialog.area.id, fd), e)
            }
          >
            <DialogBody>
              <CollectionAreaForm
                defaultName={dialog.area.name}
                defaultParentId={dialog.area.parentId}
                defaultDescription={dialog.area.description}
                defaultTitleName={dialog.area.titleName}
                defaultTitleNameByLanguage={dialog.area.titleNameByLanguage}
                defaultPrimaryCatalogNameId={dialog.area.primaryCatalogNameId}
                defaultPrimaryCatalogVendorId={dialog.area.primaryCatalogVendorId}
                defaultCatalogPrefix={dialog.area.catalogPrefix}
                defaultCatalogEntries={dialog.area.catalogEntries}
                defaultVendorEntries={dialog.area.vendorEntries}
                defaultAssignable={dialog.area.assignable}
                inheritedPrimaryId={dialog.inheritedPrimaryId}
                inheritedPrimaryVendorId={dialog.inheritedPrimaryVendorId}
                inheritedCatalogPrefix={dialog.inheritedCatalogPrefix}
                inheritedPrefixes={dialog.inheritedPrefixes}
                areas={initialAreas}
                currentAreaId={dialog.area.id}
                catalogNames={catalogNames}
                catalogVendors={catalogVendors}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
                onNestedDialogOpenChange={setNestedDialogOpen}
                isPending={isPending}
              />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete-area" && (() => {
        const { area } = dialog;
        const blocked = area.childCount > 0 || area.stampCount > 0;

        let blockMessage = "";
        if (area.childCount > 0 && area.stampCount > 0) {
          blockMessage = `Cannot delete "${area.name}" because it has ${area.childCount} child area${area.childCount !== 1 ? "s" : ""} and ${area.stampCount} assigned stamp${area.stampCount !== 1 ? "s" : ""}. Remove them first.`;
        } else if (area.childCount > 0) {
          blockMessage = `Cannot delete "${area.name}" because it has ${area.childCount} child area${area.childCount !== 1 ? "s" : ""}. Move or delete them first.`;
        } else {
          blockMessage = `Cannot delete "${area.name}" because it has ${area.stampCount} assigned stamp${area.stampCount !== 1 ? "s" : ""}. Unassign them first.`;
        }

        return (
          <DialogShell title="Delete area" onClose={closeDialog}>
            <DialogBody>
              <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.6 }}>
                {blocked ? blockMessage : `Delete area "${area.name}"? This cannot be undone.`}
              </p>
            </DialogBody>
            {blocked ? (
              <div style={{ padding: "1rem 1.5rem", display: "flex", justifyContent: "flex-end" }}>
                <DialogSecondaryButton onClick={closeDialog}>Close</DialogSecondaryButton>
              </div>
            ) : (
              <DialogActions
                actionLabel={isPending ? "Deleting…" : "Delete"}
                variant="destructive"
                onCancel={closeDialog}
                onAction={() => submitDelete(() => deleteCollectionAreaAction(area.id))}
                disabled={isPending}
                error={error}
              />
            )}
          </DialogShell>
        );
      })()}
    </>
  );
}
