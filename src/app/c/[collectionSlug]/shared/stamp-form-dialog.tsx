"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  type DialogAsideProps,
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
import type { StampAttributeLists, StampAttributeValues } from "@/lib/stamp-attributes";
import {
  STAMP_ATTRIBUTE_KINDS,
  STAMP_ATTRIBUTE_LABELS,
  STAMP_TEXT_ATTRIBUTE_LABELS,
} from "@/lib/stamp-attribute-kinds";
import { LS_LAST_SUBTYPE, readLast, writeLast } from "./add-copy-defaults";
import { computeIssueRangeExtension } from "@/lib/catalog-number";
import { StampCatalogPricesTab, formatPrice, priceCellKey } from "./stamp-catalog-prices-tab";
import { Segmented } from "./segmented";
import { CatalogDuplicateWarningIcon } from "./catalog-duplicate-warning";
import type { CatalogDuplicateGroup, DuplicateCatalogMode } from "@/lib/duplicate-catalog";
import type { StampFormatPricing } from "@/lib/format-pricing";
import { languageLabel } from "@/lib/languages";
import {
  fillTranslationValues,
  type TranslationField,
  type TranslationValues,
} from "./translations-dialog";
import { TranslationsField } from "./translations-field";
import { useTitleLanguages } from "./use-title-languages";
import { NO_AUTOFILL } from "./no-autofill";
import { DEFAULT_CHECKLIST } from "@/lib/checklist-vocabulary";
import { Icon } from "@/app/icons";

/** The stamp's one translatable field (#296). `defaultValue` is filled in at render time from the
 * live Name input, so the dialog's placeholder shows what a blank entry falls back to. Mirrors
 * `STAMP_TRANSLATION_FIELDS`, which the action parses the submitted values with. */
const NAME_TRANSLATION_FIELDS: TranslationField[] = [{ key: "name", label: "Name" }];

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

/** A stamp with no attributes stated — the normal case, and what an add starts from (#736). */
const BLANK_ATTRIBUTES: StampAttributeValues = {
  denomination: null,
  perforation: null,
  colorId: null,
  watermarkId: null,
  paperId: null,
  printingId: null,
};

const CHECKLIST_OPTION_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.875rem",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
  padding: "0.1rem 0",
};

export interface StampFormData {
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  /** The stamp's issue memberships, each carrying that issue's checklists with a tick (#531).
   *  Omitted by callers that reuse this dialog without issue context (the copy's stamp edit from
   *  Inventory / purchases, #243) — the picker is then hidden and no membership is touched. */
  issues?: {
    issueId: string;
    checklists: { id: string; name: string; on: boolean }[];
  }[];
  // Colnect item-ID (#247). `undefined` on an edit-mode stamp means the caller doesn't manage
  // the field — the input is then hidden and never submitted, so the stored value is untouched.
  colnectId?: string | null;
}

type StampFormDialogProps = DialogAsideProps & {
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
      /** The prefilled parent's own issued year (#360) — a variant or reprint is dated from the
       *  node it hangs under, not from the issue. Passed in because the members query is skipped
       *  when a parent is prefilled, so the dialog cannot look the parent up itself. */
      prefilledParentIssuedYear?: number | null;
      defaultCatalogNumbers?: { catalogVendorId: string; number: string }[];
      onSubmit: (issueId: string, formData: FormData) => void;
    }
);

export function StampFormDialog(props: StampFormDialogProps) {
  const { collectionId, areaVendors, isPending, error, onClose, aside, asideWidth } = props;
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
  // Formats and the multipliers resolved for *this* stamp (its area ancestry and issue decide
  // which factor rows apply), plus which format's slice of the grid is on screen. Null is the
  // single, which is what the grid showed before formats existed.
  const [formatPricing, setFormatPricing] = useState<StampFormatPricing>({
    formats: [],
    factors: {},
  });
  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
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

  // ── Per-language names (#296) ──
  // Fetched rather than drilled: this dialog opens from five call sites (issues, stamps, inventory,
  // stamp picker, purchase detail), and the answer is cached per collection.
  const { titleLanguages, defaultLanguage } = useTitleLanguages(collectionId);
  const translatable = titleLanguages.length > 0;
  // The Name input stays uncontrolled (it is read off the form on submit like the rest); its text
  // is mirrored here so the translations dialog shows the live default-language name as the
  // placeholder each blank entry falls back to.
  const [nameText, setNameText] = useState(props.mode === "edit" ? (props.stamp.name ?? "") : "");
  // Staged values, submitted as hidden `name:<lang>` inputs and written only when the stamp itself
  // is saved. `null` until the user edits them or (in edit mode) the stored rows arrive; the render
  // falls back to blanks meanwhile, which is also add mode's permanent state.
  const [translations, setTranslations] = useState<TranslationValues | null>(null);
  // While the translations dialog is up, this dialog must not close on Esc / backdrop click.
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);

  const vendors = Array.from(
    new Map(areaVendors.map((v) => [v.catalogVendorId, v])).values()
  );
  const hasPricesTab = areaVendors.length > 0;
  // Colnect ID (#247): editable when adding, or when the edited stamp carries the field.
  // A caller that omits `colnectId` (undefined) hides the input so its value is never clobbered.
  const showColnect = props.mode === "add" || editProps?.stamp.colnectId !== undefined;

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
      { getStampFormatPricingAction },
    ] = await Promise.all([
      import("@/app/actions/stamps"),
      import("@/app/actions/catalog"),
      import("@/app/actions/conditions"),
      import("@/app/actions/certificate-statuses"),
      import("@/app/actions/format-pricing"),
    ]);
    const [tree, conditions, certificateStatuses, prices, formatPricing] = await Promise.all([
      getCatalogTreeAction(collectionId),
      getStampConditionsAction(collectionId),
      getCertificateStatusesAction(collectionId),
      stampId ? getStampCatalogPricesAction(stampId) : Promise.resolve([]),
      getStampFormatPricingAction(collectionId, stampId ?? null),
    ]);
    return { tree, conditions, certificateStatuses, prices, formatPricing };
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
      setFormatPricing(data.formatPricing);
      for (const p of data.prices) {
        const key = priceCellKey(
          p.catalogEditionId,
          p.conditionId,
          p.certificateStatusId,
          p.formatId
        );
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
  // Which checklists the stamp is on (#531), replacing the single *Required for completeness*
  // box. In edit mode it is the first membership's issue that is edited — a stamp on two issues
  // answers for each separately, and the dialog is opened from one of them. In add mode the
  // default is {@link DEFAULT_CHECKLIST} for a root stamp and nothing for a variant, exactly the
  // rule the old checkbox defaulted to.
  const editedMembership = editProps?.stamp.issues?.[0] ?? null;
  const [checklistIds, setChecklistIds] = useState<Set<string>>(() =>
    editedMembership
      ? new Set(editedMembership.checklists.filter((c) => c.on).map((c) => c.id))
      : addProps?.prefilledParentStampId
        ? new Set<string>()
        : new Set<string>([DEFAULT_CHECKLIST])
  );
  const onAnyChecklist = checklistIds.size > 0;

  function toggleChecklist(id: string) {
    setChecklistIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
        // Adding: start from the last subtype used in this collection (#342), which is usually the
        // one the next stamp wants too. A remembered id that no longer exists — the subtype was
        // deleted or renamed away — falls back to the collection default rather than to a blank
        // select, exactly as the add-copy defaults drop a deleted condition.
        const remembered = readLast(LS_LAST_SUBTYPE, collectionId);
        setSelectedSubtypeId(list.some((s) => s.id === remembered) ? remembered : defId);
      }
    });
    return () => { cancelled = true; };
  }, [collectionId, editStampId]);

  // ── Catalogue attributes (#736) ──
  //
  // The six of #71/#72, on every stamp — root and variant alike, since nothing is inherited down
  // the variant tree and a child either states its own value or states none. The stored values are
  // fetched **by stampId**, like the subtype assignment, the translations and the photos, so none
  // of this dialog's nine callers has to carry six more fields on its row shape to edit one stamp.
  //
  // **Nothing is remembered between adds.** #342 remembers the subtype because a run of additions
  // shares one; colour and denomination differ from stamp to stamp *within* a series, so a
  // remembered value would pre-fill the wrong answer nearly every time.
  const [attributeLists, setAttributeLists] = useState<StampAttributeLists | null>(null);
  const [attributes, setAttributes] = useState<StampAttributeValues>(BLANK_ATTRIBUTES);
  const [attributesLoaded, setAttributesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("@/app/actions/stamp-attributes").then((m) =>
        m.getStampAttributeListsAction(collectionId)
      ),
      editStampId
        ? import("@/app/actions/stamp-attributes").then((m) =>
            m.getStampAttributeValuesAction(editStampId)
          )
        : Promise.resolve(null),
    ]).then(([lists, values]) => {
      if (cancelled) return;
      setAttributeLists(lists);
      if (values) setAttributes(values);
      setAttributesLoaded(true);
    });
    return () => { cancelled = true; };
  }, [collectionId, editStampId]);

  function setAttribute(key: keyof StampAttributeValues, value: string) {
    setAttributes((prev) => ({ ...prev, [key]: value }));
  }

  // Load the stamp's stored per-language names (#296), by id — the same way the subtype assignment
  // and the photos are, so no caller's row shape has to carry them. Add mode has nothing to load.
  useEffect(() => {
    if (!editStampId || titleLanguages.length === 0) return;
    let cancelled = false;
    import("@/app/actions/stamps")
      .then((m) => m.getStampTranslationsAction(editStampId))
      .then((nameByLanguage) => {
        if (cancelled) return;
        setTranslations(
          fillTranslationValues(titleLanguages, NAME_TRANSLATION_FIELDS, { name: nameByLanguage })
        );
      });
    return () => { cancelled = true; };
  }, [editStampId, titleLanguages]);

  const translationValues =
    translations ?? fillTranslationValues(titleLanguages, NAME_TRANSLATION_FIELDS, undefined);

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
  // That issue may also override its area's prefix (#377), which changes the identity being checked.
  const addIssueId = addAreaId ? (selectedIssueId ?? null) : null;
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
        checkStampId
          ? { stampId: checkStampId }
          : { contextAreaId: addAreaId, contextIssueId: addIssueId }
      );
      if (!cancelled) setDupCheck(res);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [catalogInputs, canCheckDuplicates, checkStampId, addAreaId, addIssueId, collectionId]);

  const blockDuplicates = dupCheck.mode === "block" && dupCheck.groups.length > 0;

  // ── Declared-range extension (add-to-issue only) ──
  // Only a stamp on a checklist defines an issue's range, so the prompt
  // fires only when at least one checklist is ticked. For each vendor whose entered number falls
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
        addProps && !autoCreateIssue && onAnyChecklist && selectedIssueId
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
  }, [addProps, autoCreateIssue, onAnyChecklist, selectedIssueId, catalogInputs, vendors]);

  const hasRangeExtension = rangeExtensions.length > 0;

  // The checklists on offer (#531). Edit mode has them on the membership already; add mode fetches
  // them for the chosen issue rather than reading `addProps.issues`, which the prefilled-issue call
  // sites do not always carry the row for.
  const { data: addChecklists } = useQuery({
    queryKey: ["checklists", collectionId, selectedIssueId],
    enabled: !!addProps && !!selectedIssueId && !autoCreateIssue,
    queryFn: async () => {
      const { getChecklistsForIssueAction } = await import("@/app/actions/checklists");
      return getChecklistsForIssueAction(collectionId, selectedIssueId);
    },
  });
  const offeredChecklists: { id: string; name: string }[] = editProps
    ? (editedMembership?.checklists ?? [])
    : autoCreateIssue
      ? []
      : (addChecklists ?? []);

  // Switching to another issue invalidates ids belonging to the previous one; a root stamp falls
  // back to the issue's own set, which is what the box meant before checklists existed. Adjusted
  // during render against the issue the current selection was made for, rather than in an effect —
  // the state is derived from the chosen issue, and an effect would render the stale ticks first.
  const [checklistIssue, setChecklistIssue] = useState(selectedIssueId);
  if (addProps && checklistIssue !== selectedIssueId) {
    setChecklistIssue(selectedIssueId);
    setChecklistIds(addProps.prefilledParentStampId ? new Set() : new Set([DEFAULT_CHECKLIST]));
  }

  const needsMembers =
    !!addProps && !!selectedIssueId && !autoCreateIssue && !addProps.prefilledParentStampId;
  const { data: members } = useIssueMembers(collectionId, selectedIssueId || "", needsMembers);
  const stampOptions = members ?? [];

  const showIssueStep = !!addProps && !addProps.prefilledIssueId;

  // Year a new stamp starts on (#360): the **parent node's** year when one is chosen — a variant
  // or reprint is dated from the node it hangs under, which may differ from the issue — falling
  // back to the issue's year for a root-level stamp (#70). Edit mode keeps the stamp's own year.
  const parentIssuedYear = addProps
    ? addProps.prefilledParentStampId
      ? (addProps.prefilledParentIssuedYear ?? null)
      : selectedParentId
        ? (stampOptions.find((m) => m.stampId === selectedParentId)?.issuedYear ?? null)
        : null
    : null;
  const defaultIssuedYear =
    parentIssuedYear ??
    addProps?.issues.find((i) => i.id === selectedIssueId)?.year ??
    null;

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

    // Remember the subtype just used, so the next child stamp starts there (#342). Written only
    // when the field was actually in play — a base stamp's save must not overwrite what the last
    // *child* was typed as. Editing counts too: re-typing a stamp as an overprint is exactly the
    // signal that the next one is one as well.
    if (isChildContext && selectedSubtypeId) {
      writeLast(LS_LAST_SUBTYPE, collectionId, selectedSubtypeId);
    }

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
      // Only send this when the checklist picker was actually shown — i.e. the caller passed the
      // stamp's issue memberships. Callers that reuse this dialog without that context (the copy's
      // stamp edit from Inventory/purchases, #243) must not rewrite membership; omitting the
      // fields leaves every checklist untouched server-side.
      if (editedMembership) {
        fd.set("checklistIds", [...checklistIds].join(","));
        fd.set("checklistIssueId", editedMembership.issueId);
      }
      props.onSubmit(fd);
      return;
    }

    if (autoCreateIssue) {
      fd.set("newIssueName", newIssueName.trim());
      fd.set("newIssueYear", newIssueYear.trim());
    }
    fd.set("checklistIds", [...checklistIds].join(","));
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

  // Portalled to the document, the way every dialog that can be opened **from inside another
  // dialog** is: a fixed-position panel inside one of `DialogShell`'s own panels is positioned
  // against that panel — the shell centres itself with a transform, which makes it the containing
  // block — and clipped by its `overflow: hidden`. The listing wizard (#730) opens this one from its
  // first step, and the surfaces that opened it before are unaffected: the panel is fixed either way.
  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title={title}
      onClose={onClose}
      dismissable={!nestedDialogOpen}
      minHeight="22rem"
      // Creating a stamp is the deepest point of identifying a piece, and the point the collector is
      // furthest from where they started — so the piece comes with it (#592). Absent for every
      // other opener of this dialog.
      aside={aside}
      asideWidth={asideWidth}
      maxWidth={aside ? "min(96vw, 78rem)" : "52rem"}
      height={aside ? "min(90vh, 52rem)" : undefined}
    >
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

            {/* Catalog numbers (Colnect item-ID rides along as another number cell, #247) */}
            {(vendors.length > 0 || showColnect) && (
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
                          {...NO_AUTOFILL}
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
                  {/* Colnect item-ID (#247): sits in the same grid, styled like a vendor number
                      row, but is a plain external identifier — no duplicate/prefix handling. */}
                  {showColnect && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                      <span style={{ width: "4rem", flexShrink: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)", fontFamily: "monospace", fontWeight: 600 }}>
                        Colnect
                      </span>
                      <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex" }}>
                        <input
                          name="colnectId"
                          type="text"
                          inputMode="numeric"
                          disabled={isPending}
                          defaultValue={editProps?.stamp.colnectId ?? ""}
                          placeholder="item-ID"
                          {...NO_AUTOFILL}
                          style={{ ...INPUT_STYLE, flex: 1 }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Checklists (#531). One box per checklist of the issue — a stamp counts towards as
                many sets as claim it. An issue with none yet keeps the old single box, which
                starts the issue's own set: that is what "required for completeness" always meant,
                and the dialog is often the very thing creating the issue. */}
            {(addProps || editedMembership) && (
              <div style={{ marginBottom: "0.875rem" }}>
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                    color: "var(--color-text-muted)",
                    marginBottom: "0.35rem",
                  }}
                >
                  Counts towards
                </div>
                {offeredChecklists.length === 0 ? (
                  <label style={CHECKLIST_OPTION_STYLE}>
                    <input
                      type="checkbox"
                      checked={checklistIds.has(DEFAULT_CHECKLIST)}
                      onChange={() => toggleChecklist(DEFAULT_CHECKLIST)}
                      disabled={isPending}
                    />
                    Required for completeness
                  </label>
                ) : (
                  offeredChecklists.map((c) => (
                    <label key={c.id} style={CHECKLIST_OPTION_STYLE}>
                      <input
                        type="checkbox"
                        checked={checklistIds.has(c.id)}
                        onChange={() => toggleChecklist(c.id)}
                        disabled={isPending}
                      />
                      {c.name}
                    </label>
                  ))
                )}
                <p
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--color-text-muted)",
                    margin: "0.35rem 0 0",
                  }}
                >
                  Leave every box clear for an extra the issue holds but no set counts — a block, a
                  variety.
                </p>
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
                    <Icon name="warning" size="sm" />
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
                <LabelWithError htmlFor="f-stamp-name">
                  {translatable
                    ? `Name — ${languageLabel(defaultLanguage)} (optional)`
                    : "Name (optional)"}
                </LabelWithError>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
                    onChange={(e) => setNameText(e.target.value)}
                    style={INPUT_STYLE}
                  />
                  {/* Per-language names (#296) live behind the shared translations dialog, so the
                      form keeps one Name field however many languages are in use. In edit mode the
                      stored values are fetched by stampId (like the subtype and the photos), so no
                      caller's row shape has to carry them. */}
                  {translatable && (
                    <TranslationsField
                      dialogTitle="Stamp name translations"
                      description={`The name each language's platforms use for this stamp. Leave one blank to fall back to the ${languageLabel(defaultLanguage)} name above. Saved together with the stamp.`}
                      languages={titleLanguages}
                      fields={[{ ...NAME_TRANSLATION_FIELDS[0], defaultValue: nameText }]}
                      values={translationValues}
                      onChange={setTranslations}
                      onOpenChange={setNestedDialogOpen}
                      ariaLabel="Edit stamp name translations"
                      disabled={isPending}
                    />
                  )}
                </div>
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
                  {/* Uncontrolled, so re-seed it by key when the derived default changes —
                      picking a different parent (or issue) must move the year with it. */}
                  <input
                    key={editProps ? "edit" : `add-${defaultIssuedYear ?? ""}`}
                    name="issuedYear"
                    type="number"
                    disabled={isPending}
                    placeholder="Year"
                    defaultValue={
                      editProps ? (editProps.stamp.issuedYear ?? "") : (defaultIssuedYear ?? "")
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
                    { value: "true", label: <Icon name="check" size="sm" />, title: "Acts as variant" },
                    { value: "false", label: <Icon name="reject" size="sm" />, title: "Not a variant" },
                  ]}
                />
              </div>
            )}

            {/* Catalogue attributes (#736): what the catalogue states about this stamp beyond its
                number. All six optional — an empty value is the normal case, not a gap to fill —
                and none of them inherited from the parent, because a variant is its own stamp.
                A dictionary select appears only once its dictionary has entries, the rule the
                subtype block above already follows: a select offering nothing but "—" is furniture,
                and the four lists are set up in Settings → Attributes. */}
            <div
              style={{
                marginTop: "1.25rem",
                paddingTop: "1.25rem",
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <LabelWithError>Attributes (optional)</LabelWithError>
              {!attributesLoaded ? (
                // Reserve the row's height so the dialog doesn't jump, and — the reason this is
                // gated at all — so a save made before the stored values arrive cannot submit the
                // blank fields over them.
                <div
                  style={{
                    minHeight: "3.75rem",
                    color: "var(--color-text-muted)",
                    fontSize: "0.875rem",
                  }}
                >
                  Loading attributes…
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))",
                    gap: "0.75rem 1rem",
                  }}
                >
                  {/* Denomination and perforation are recorded **as printed** — never parsed, never
                      translated — so they are text boxes and not dictionaries. */}
                  <div style={{ minWidth: 0 }}>
                    <LabelWithError htmlFor="f-stamp-denomination">
                      {STAMP_TEXT_ATTRIBUTE_LABELS.denomination.field}
                    </LabelWithError>
                    <input
                      id="f-stamp-denomination"
                      name="denomination"
                      type="text"
                      disabled={isPending}
                      value={attributes.denomination ?? ""}
                      onChange={(e) => setAttribute("denomination", e.target.value)}
                      placeholder={STAMP_TEXT_ATTRIBUTE_LABELS.denomination.example}
                      {...NO_AUTOFILL}
                      style={INPUT_STYLE}
                    />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <LabelWithError htmlFor="f-stamp-perforation">
                      {STAMP_TEXT_ATTRIBUTE_LABELS.perforation.field}
                    </LabelWithError>
                    <input
                      id="f-stamp-perforation"
                      name="perforation"
                      type="text"
                      disabled={isPending}
                      value={attributes.perforation ?? ""}
                      onChange={(e) => setAttribute("perforation", e.target.value)}
                      placeholder={STAMP_TEXT_ATTRIBUTE_LABELS.perforation.example}
                      {...NO_AUTOFILL}
                      style={INPUT_STYLE}
                    />
                  </div>
                  {STAMP_ATTRIBUTE_KINDS.map((kind) => {
                    const options = attributeLists?.[kind] ?? [];
                    if (options.length === 0) return null;
                    const field = `${kind}Id` as keyof StampAttributeValues;
                    return (
                      <div key={kind} style={{ minWidth: 0 }}>
                        <LabelWithError htmlFor={`f-stamp-${kind}`}>
                          {STAMP_ATTRIBUTE_LABELS[kind].field}
                        </LabelWithError>
                        <select
                          id={`f-stamp-${kind}`}
                          name={field}
                          value={attributes[field] ?? ""}
                          onChange={(e) => setAttribute(field, e.target.value)}
                          disabled={isPending}
                          style={INPUT_STYLE}
                        >
                          {/* The empty choice is the value most stamps have, so it leads. */}
                          <option value="">—</option>
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

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
                  formats={formatPricing.formats}
                  formatFactors={formatPricing.factors}
                  activeFormatId={activeFormatId}
                  onActiveFormatChange={setActiveFormatId}
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
    </DialogShell>,
    document.body
  );
}
