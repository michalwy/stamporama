"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import {
  createCollectionAreaAction,
  type AreaActionState,
} from "@/app/actions/areas";
import type { CollectionAreaData, AreaCatalogEntry, AreaVendorEntry } from "@/lib/areas";
import { resolveInheritedAreaValues, type AreaInheritedValues } from "@/lib/area-inheritance";
import { languageLabel } from "@/lib/languages";
import {
  fillTranslationValues,
  type TranslationField,
  type TranslationValues,
} from "./translations-dialog";
import { TranslationsField } from "./translations-field";
import type { CatalogNameFlat } from "@/lib/catalog";
import { AreaTreeSelect, buildAreaTree } from "@/app/area-tree-select";
import { getDescendantIds } from "./area-helpers";
import { Tooltip } from "./tooltip";
import { NO_AUTOFILL } from "./no-autofill";
import { Icon } from "@/app/icons";

/**
 * The collection-area form and the **Add area** dialog around it.
 *
 * Both used to live in the areas management panel, which was the only screen that could create an
 * area. #776 added the same action to the area filter facet, and *reusing* the dialog rather than
 * writing a second one is the whole point of that issue: an area carries the numbering and the
 * price sources everything beneath it inherits, so a reduced quick-add form would create areas that
 * differ from managed ones in ways only visible later, on a stamp's catalog number.
 */

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

/** The dialog form's own layout — a column that owns the dialog's height so the body scrolls
 *  inside it rather than the page. Exported for the areas panel's *Edit area* dialog, which
 *  wraps the same form. */
export const AREA_FORM_STYLE: React.CSSProperties = {
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

export function CollectionAreaForm({
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

/** What the *Add area* dialog needs beyond the form: where to write, and who to tell. */
interface AddAreaDialogProps {
  collectionId: string;
  /** Every area in the collection — the parent picker's tree, and the chain the inherited
   *  placeholders are resolved off. */
  areas: CollectionAreaData[];
  /** Pre-selected parent. The facet passes the area currently filtered to (#776); the management
   *  panel passes the row the action was taken on, or nothing for a top-level area. */
  defaultParentId?: string;
  catalogNames: CatalogNameFlat[];
  catalogVendors: AreaFormVendor[];
  titleLanguages: string[];
  defaultLanguage: string;
  onClose: () => void;
  /**
   * Called **after the action reported success**, and only then. The dialog cannot own what happens
   * next: like `StampFormDialog` (#918), its submit handler runs before the server action does, so
   * anything it did itself would also run on a validation error and a failed save. The opener reads
   * the result, so the opener refreshes.
   */
  onCreated: () => void;
}

/**
 * Create a collection area. One component, opened from the areas management panel and from the area
 * filter facet, so the two cannot drift — #776 exists because the second opener was missing, not
 * because it needed a form of its own.
 */
export function AddAreaDialog({
  collectionId,
  areas,
  defaultParentId,
  catalogNames,
  catalogVendors,
  titleLanguages,
  defaultLanguage,
  onClose,
  onCreated,
}: AddAreaDialogProps) {
  const [actionState, setActionState] = useState<AreaActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  // The form can open the translations dialog on top of this one (#293); while it is up this
  // dialog must not close on Esc / backdrop click.
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);

  // Resolved once, from the parent the dialog opened on — the same reading the management panel
  // took, and the reason it lives in `@/lib/area-inheritance` rather than in either opener.
  const inherited: AreaInheritedValues = useMemo(
    () => resolveInheritedAreaValues(areas, defaultParentId),
    [areas, defaultParentId]
  );

  function handleClose() {
    if (isPending) return;
    setNestedDialogOpen(false);
    onClose();
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createCollectionAreaAction(collectionId, formData);
      setActionState(result);
      if (result.status === "success") {
        setNestedDialogOpen(false);
        onCreated();
      }
    });
  }

  return (
    <DialogShell title="Add area" onClose={handleClose} dismissable={!nestedDialogOpen}>
      <form style={AREA_FORM_STYLE} onSubmit={handleSubmit}>
        <DialogBody>
          <CollectionAreaForm
            defaultParentId={defaultParentId}
            inheritedPrimaryId={inherited.inheritedPrimaryId}
            inheritedPrimaryVendorId={inherited.inheritedPrimaryVendorId}
            inheritedCatalogPrefix={inherited.inheritedCatalogPrefix}
            inheritedPrefixes={inherited.inheritedPrefixes}
            areas={areas}
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
          onCancel={handleClose}
          disabled={isPending}
          error={actionState.status === "error" ? actionState.message : undefined}
        />
      </form>
    </DialogShell>
  );
}
