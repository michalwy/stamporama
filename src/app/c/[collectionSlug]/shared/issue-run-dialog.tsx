"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DialogActions,
  DialogSecondaryButton,
  DialogShell,
  LabelWithError,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { defaultTreeSelectButtonClassName } from "@/app/tree-select";
import { addStampToIssueAction } from "@/app/actions/issues";
import type { CollectionAreaData } from "@/lib/areas";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampConditionData } from "@/lib/conditions";
import type { IssueListItem, StampNodeData } from "@/lib/issues";
import type { LocationData } from "@/lib/locations";
import { perforationMatches } from "@/lib/perforation";
import {
  assignInTurn,
  changedRunPrices,
  overriddenFields,
  repeatedStamps,
  resolveRunCopyDetails,
  runBlockers,
  runChoices,
  runPriceSubjects,
  runValueSlots,
  runValueTabTarget,
  RUN_DETAIL_FIELDS,
  type IssueRunIdentification,
  type RunCopyDetails,
  type RunCopyOverrides,
  type RunDetailField,
} from "@/lib/issue-run";
import {
  useCollectionFormats,
  useInvalidateInventory,
  useIssuesMembers,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import {
  issueLabel,
  orderedCatalogLabels,
  pickedStampText,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import {
  PhotoThumb,
  THUMB_OBJECT_FIT,
  ThumbPreview,
} from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { catalogValueSubjectKey } from "@/lib/intake-catalog-value";
import { CREATE_LINK_STYLE } from "./chip-styles";
import { NumericInput } from "./numeric-input";
import { StampDetailLine, StampTitle } from "./issue-view";
import { StampFormDialog } from "./stamp-form-dialog";
import { Tooltip } from "./tooltip";
import { useAreaVendorMaps } from "./use-area-vendor-maps";
import { useInvalidateStampsAndIssues } from "./use-invalidate-stamps-and-issues";
import {
  DispositionChips,
  INPUT_STYLE,
  type IntakeConditionDialogProps,
} from "./intake-condition-dialog";
import { MeasuredMark, MeasuredNarrowing } from "./measured-marks";
import { TileZoomView, type IdentifiedPiece } from "./tile-zoom-view";
import {
  readLast,
  writeLast,
  LS_LAST_CERT,
  LS_LAST_CONDITION,
  LS_LAST_DISPOSITION,
  LS_LAST_LOCATION,
  LS_LAST_SCAN_LOT,
} from "./add-copy-defaults";

/**
 * A ticked run of scan tiles identified **as the stamps of a checklist, in turn** (#1220, #1225).
 *
 * The step after the checklist is picked, and the whole of what is new: the tiles have already taken
 * the checklist's stamps, in its own order, in the order they were ticked (`issue-run.ts` decides
 * which), so what the collector does here is **correct** — the tile that skips a value, the one that
 * is another stamp of the issue, the stray ticked by mistake — and answer the copy details once,
 * overriding them on the pieces that differ.
 *
 * **Three columns, because three things are looked at together.** The piece, at the size and with
 * the tools a single tile has (#585's viewer, #598's measuring, #625's watermark) — never a reduced
 * version for the bulk case, since telling `240a` from `240b` is the same act on the fifth tile of a
 * set as on a tile alone. The run, which is the sequence and every answer in it at a glance, with each
 * catalogue value typed on its own row (#1229). And the tile in hand: its stamp — the checklist's
 * first, then the rest of its issues' — marked by what was read off it (#740), and its own copy
 * details.
 *
 * **Nothing is created until every tile in the run has a stamp**, and the count is stated before
 * anything is. The write re-checks all of it and refuses the whole pass rather than half of it.
 */

export interface IssueRunDialogProps {
  collectionId: string;
  areas: CollectionAreaData[];
  scanDpi: number;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  locations: LocationData[];
  /** The checklist the run takes its stamps from (#1225). */
  checklistId: string;
  /** The issue row the checklist was picked from — where a stamp added during the run goes, when the
   * checklist is that issue's own. */
  issue: IssueListItem;
  /** The run, in the order the tiles were ticked. */
  pieces: IdentifiedPiece[];
  /** The lot question (#586), or absent where there is none — a card that belongs to no order. */
  lotChoice?: IntakeConditionDialogProps["lotChoice"];
  isPending: boolean;
  error?: string;
  /** Back to the checklist picker. */
  onBack: () => void;
  onClose: () => void;
  onSubmit: (input: IssueRunIdentification) => void;
}

const LOCATION_SELECT_BUTTON_CLASS = defaultTreeSelectButtonClassName
  .replace("min-h-8", "min-h-9")
  .replace("py-1", "py-2");

const FIELD_LABEL: Record<RunDetailField, string> = {
  conditionId: "Condition",
  certificateStatusId: "Certificate",
  formatId: "Format",
  lotId: "Lot",
  location: "Location",
  disposition: "Disposition",
};

const SECTION_HEADING: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

const MUTED: React.CSSProperties = {
  margin: 0,
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

export function IssueRunDialog({
  collectionId,
  areas,
  scanDpi,
  conditions,
  certificateStatuses,
  locations,
  checklistId,
  issue,
  pieces,
  lotChoice,
  isPending,
  error,
  onBack,
  onClose,
  onSubmit,
}: IssueRunDialogProps) {
  const maps = useAreaVendorMaps(areas, collectionId);
  /** The checklist as the run reads it: its stamps in its own order, and the issues it covers. */
  const runChecklist = useQuery({
    queryKey: ["checklists", collectionId, "run", checklistId] as const,
    queryFn: async () => {
      const { getRunChecklistAction } = await import("@/app/actions/checklists");
      return getRunChecklistAction(collectionId, checklistId);
    },
  });
  const checklist = runChecklist.data ?? null;
  const coveredIssues = useMemo(() => checklist?.issues ?? [], [checklist]);
  const coveredIssueIds = useMemo(() => coveredIssues.map((i) => i.id), [coveredIssues]);
  const { members: membersByIssue, isLoading: issuesLoading } = useIssuesMembers(
    collectionId,
    coveredIssueIds
  );
  const membersLoading = runChecklist.isLoading || issuesLoading;
  const checklistGone = !runChecklist.isLoading && !runChecklist.isError && checklist === null;
  const { data: formats = [] } = useCollectionFormats(collectionId);
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

  /** Every stamp of the covered issues, once, with the issue it is read under. */
  const members: StampNodeData[] = [];
  const issueOfStamp = new Map<string, (typeof coveredIssues)[number]>();
  for (const group of membersByIssue) {
    const owner = coveredIssues.find((i) => i.id === group.issueId);
    for (const m of group.members) {
      if (issueOfStamp.has(m.stampId) || !owner) continue;
      issueOfStamp.set(m.stampId, owner);
      members.push(m);
    }
  }
  const memberById = new Map(members.map((m) => [m.stampId, m]));
  /** A stamp's catalogue labels read through its own issue's area and prefix (#377) — a checklist
   * spanning issues may span areas too. */
  const vendorsOf = (stampId: string | null) => {
    const owner = (stampId ? issueOfStamp.get(stampId) : undefined) ?? coveredIssues[0];
    const areaId = owner?.collectionAreaId ?? issue.collectionAreaId;
    return {
      vendorMap: maps.vendorMapFor(areaId, owner?.id ?? issue.id),
      primaryVendorId: maps.primaryVendorByArea.get(areaId) ?? null,
    };
  };
  /** The stamps tiles take in turn — the checklist's own, in its own order, variants included. */
  const sequence = checklist?.stampIds ?? [];
  /** Every stamp a tile can be corrected to: the checklist's first, then the rest of its issues'. */
  const choices = runChoices(sequence, membersByIssue);
  const labelOf = (stampId: string | null): string | null => {
    const node = stampId ? memberById.get(stampId) : undefined;
    if (!node) return null;
    const { vendorMap, primaryVendorId } = vendorsOf(node.stampId);
    return pickedStampText({
      stampId: node.stampId,
      catalogLabels: orderedCatalogLabels(node.catalogNumbers, vendorMap, primaryVendorId),
      name: node.name,
      secondary: null,
      unknownVariant: false,
    });
  };
  const ownIssue = coveredIssues[0] ?? issue;
  const runTitle = !checklist
    ? "a checklist"
    : checklist.issueId
      ? `“${checklist.name}” — ${issueLabel(ownIssue.name, ownIssue.year)}`
      : `“${checklist.name}” — spanning ${coveredIssues.length} ${coveredIssues.length === 1 ? "issue" : "issues"}`;
  /** A stamp added during the run joins the checklist, which only the checklist's own issue can do. */
  const canAddStamp = checklist?.issueId != null && checklist.issueId === issue.id;

  // ── The run ──────────────────────────────────────────────────────────────────────────────────
  /** Tiles taken out of the run — kept in hand so one can be put back. */
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  /** A tile's stamp, where the collector chose it rather than the tile taking its turn. */
  const [corrections, setCorrections] = useState<ReadonlyMap<string, string>>(new Map());
  /** A tile's own copy details — only the fields it overrides. */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, RunCopyOverrides>>(new Map());
  const inRun = pieces.filter((p) => !removed.has(p.tileId));
  const assignments = assignInTurn(
    inRun.map((p) => p.tileId),
    sequence,
    corrections
  );
  const repeated = repeatedStamps(assignments);
  const blockers = runBlockers(assignments);
  const turnOf = new Map(inRun.map((p, i) => [p.tileId, i + 1]));

  /** The tile in hand. Follows the run when that tile is taken out of it. */
  const [activeId, setActiveId] = useState(pieces[0]?.tileId ?? "");
  const active = inRun.find((p) => p.tileId === activeId) ?? inRun[0] ?? null;
  const activeIndex = active ? inRun.indexOf(active) : -1;
  const activeAssignment = active ? assignments[activeIndex] : null;

  /** What the open viewer is gauging (#740), and the watermark the collector says they can see. */
  const [gauge, setGauge] = useState<number | null>(null);
  const [watermarkPick, setWatermarkPick] = useState("");
  const watermarks: { id: string; name: string }[] = [];
  for (const m of members) {
    const name = m.attributes.watermark;
    if (name && !watermarks.some((w) => w.id === name)) watermarks.push({ id: name, name });
  }
  const watermarkSeen = watermarks.some((w) => w.id === watermarkPick) ? watermarkPick : "";
  const anyPerforation = members.some((m) => m.attributes.perforation);

  // ── The shared details, remembered the way the condition step remembers them ────────────────
  const [conditionId, setConditionId] = useState(() => {
    const last = readLast(LS_LAST_CONDITION, collectionId);
    return conditions.some((c) => c.id === last) ? last : "";
  });
  const [certificateStatusId, setCertificateStatusId] = useState(() => {
    const last = readLast(LS_LAST_CERT, collectionId);
    return certificateStatuses.some((c) => c.id === last) ? last : "";
  });
  // Never remembered (#573): a sticky format would mark every later single as a block.
  const [formatId, setFormatId] = useState("");
  const [location, setLocation] = useState(() => {
    const last = readLast(LS_LAST_LOCATION, collectionId);
    return {
      locationId: locations.some((l) => l.id === last && l.assignable) ? last : "",
      locationRef: "",
    };
  });
  const [disposition, setDisposition] = useState(() => {
    const flags = new Set(readLast(LS_LAST_DISPOSITION, collectionId).split(",").filter(Boolean));
    return {
      inCollection: flags.has("inCollection"),
      forSale: flags.has("forSale"),
      forTrade: flags.has("forTrade"),
    };
  });
  const lotOptions = lotChoice?.lots ?? [];
  const [lotId, setLotId] = useState(() => {
    if (!lotChoice || lotOptions.length === 0) return "";
    const last = readLast(LS_LAST_SCAN_LOT, `${collectionId}:${lotChoice.purchaseId}`);
    return lotOptions.some((l) => l.id === last) ? last : lotOptions[0].id;
  });
  const asksForLot = lotChoice != null && lotOptions.length > 1;
  const shared: RunCopyDetails = {
    conditionId,
    certificateStatusId,
    formatId,
    lotId,
    location,
    disposition,
  };
  /** The fields this collection and this card ask at all. */
  const fields = RUN_DETAIL_FIELDS.filter(
    (f) => (f !== "formatId" || formats.length > 0) && (f !== "lotId" || asksForLot)
  );

  const resolved = assignments.map((a) => resolveRunCopyDetails(shared, overrides.get(a.tileId)));
  const withoutCondition = assignments.filter((_, i) => !resolved[i].conditionId);

  // ── Catalogue values (#1220's scope change, #593's rules) ───────────────────────────────────
  /** The prices this run can record — one per stamp × condition × certificate, never per tile. */
  const priceSubjects = runPriceSubjects(assignments, resolved);
  const priceSubjectsKey = priceSubjects.map((s) => s.key).join(",");
  /** One read for the whole run — the offer grid's bulk context (#720), which answers the primary
   * catalogue, its latest edition and what is on file at the single for every subject at once. */
  const prices = useQuery({
    queryKey: ["issueRunCatalogValues", priceSubjectsKey] as const,
    queryFn: async () => {
      const { getBulkQuickCatalogPriceContextAction } = await import("@/app/actions/stamps");
      const r = await getBulkQuickCatalogPriceContextAction(
        priceSubjects.map(({ stampId, conditionId, certificateStatusId }) => ({
          stampId,
          conditionId,
          certificateStatusId,
        }))
      );
      if (r.status === "error") throw new Error(r.message);
      return r;
    },
    enabled: priceSubjects.length > 0,
    staleTime: 0,
    gcTime: 0,
    // A changed condition re-reads the run; the rows whose subjects did not change keep their fields
    // meanwhile rather than all blinking out at once.
    placeholderData: (previous) => previous,
  });
  /** What was typed, by subject — so a figure typed on one tile is the figure of every tile sharing
   * its stamp and condition, and a change of condition leaves it under the subject it was typed for
   * rather than moving it onto another. */
  const [typedPrices, setTypedPrices] = useState<ReadonlyMap<string, string>>(new Map());
  const [savingPrices, setSavingPrices] = useState(false);
  const [priceError, setPriceError] = useState<string | undefined>();
  /** The field for one subject, or null where there is none — no primary catalogue, or the read for
   * it not in yet. */
  const priceField = (key: string | null) => {
    if (!key || !prices.data) return null;
    const row = prices.data.rows.find(
      (r) => catalogValueSubjectKey(r.stampId, r.conditionId, r.certificateStatusId ?? "") === key
    );
    if (!row?.primaryCatalogNameId) return null;
    const catalog = prices.data.catalogs.find((c) => c.catalogNameId === row.primaryCatalogNameId);
    const recorded = row.amounts[row.primaryCatalogNameId] ?? null;
    return {
      catalog,
      value: {
        catalogNameId: row.primaryCatalogNameId,
        amount: typedPrices.get(key) ?? recorded ?? "",
        recorded,
        loading: prices.isFetching,
      },
    };
  };
  const canConfirm =
    checklist !== null &&
    inRun.length > 0 &&
    blockers.length === 0 &&
    withoutCondition.length === 0 &&
    !membersLoading &&
    !savingPrices;

  /**
   * The values **on the run's own rows** (#1229): each row's field is the field — no row to select
   * first — and of the tiles sharing a stamp × condition × certificate only the first in run order
   * carries one, the rest showing its figure. All of them read and write `typedPrices` by subject.
   */
  const valueSlots = runValueSlots(assignments, resolved);
  const valueFields = valueSlots.map((slot) => priceField(slot.key));
  /** The editable fields in run order — what Tab walks. */
  const valueKeys = valueSlots.flatMap((slot, i) =>
    slot.key && slot.entryIndex === i && valueFields[i] ? [slot.key] : []
  );
  const priceInputs = useRef(new Map<string, HTMLInputElement | null>());
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  /** Tab walks the values and nothing else, and off the last one lands on Identify (#726). */
  function tabThroughValues(e: React.KeyboardEvent<HTMLInputElement>, key: string) {
    if (e.key !== "Tab") return;
    const confirm = confirmRef.current;
    const target = runValueTabTarget(
      valueKeys,
      key,
      e.shiftKey,
      confirm != null && !confirm.disabled
    );
    if (target === null) return;
    e.preventDefault();
    if (target === "confirm") {
      confirm?.focus();
      return;
    }
    const input = priceInputs.current.get(target.key);
    input?.focus();
    input?.select();
  }
  const runCatalogs = new Set(valueFields.flatMap((f) => (f ? [f.value.catalogNameId] : [])));
  const runCatalog = runCatalogs.size === 1 ? valueFields.find((f) => f != null)?.catalog : undefined;
  const valuesMissing = valueSlots.filter(
    (slot, i) => slot.entryIndex === i && valueFields[i]?.value.amount.trim() === ""
  ).length;

  const describe = (field: RunDetailField, d: RunCopyDetails): string => {
    switch (field) {
      case "conditionId":
        return conditions.find((c) => c.id === d.conditionId)?.name ?? "none chosen";
      case "certificateStatusId":
        return certificateStatuses.find((c) => c.id === d.certificateStatusId)?.name ?? "none";
      case "formatId":
        return formats.find((f) => f.id === d.formatId)?.name ?? "single";
      case "lotId":
        return lotOptions.find((l) => l.id === d.lotId)?.label ?? "—";
      case "location": {
        const name = locations.find((l) => l.id === d.location.locationId)?.name;
        if (!name) return "none";
        return d.location.locationRef ? `${name} · ${d.location.locationRef}` : name;
      }
      case "disposition": {
        const on = [
          d.disposition.inCollection && "in collection",
          d.disposition.forSale && "for sale",
          d.disposition.forTrade && "for trade",
        ].filter(Boolean);
        return on.length > 0 ? on.join(", ") : "none";
      }
    }
  };

  function setOwn<K extends RunDetailField>(
    tileId: string,
    field: K,
    value: RunCopyDetails[K] | undefined
  ) {
    setOverrides((prev) => {
      const next = new Map(prev);
      const own: RunCopyOverrides = { ...(next.get(tileId) ?? {}) };
      if (value === undefined) delete own[field];
      else own[field] = value;
      if (Object.keys(own).length === 0) next.delete(tileId);
      else next.set(tileId, own);
      return next;
    });
  }

  function correct(tileId: string, stampId: string | null) {
    setCorrections((prev) => {
      const next = new Map(prev);
      if (stampId) next.set(tileId, stampId);
      else next.delete(tileId);
      return next;
    });
  }

  function takeOut(tileId: string) {
    const index = inRun.findIndex((p) => p.tileId === tileId);
    const neighbour = inRun[index + 1] ?? inRun[index - 1];
    setRemoved((prev) => new Set(prev).add(tileId));
    if (tileId === active?.tileId && neighbour) setActiveId(neighbour.tileId);
  }

  function putBack(tileId: string) {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.delete(tileId);
      return next;
    });
  }

  async function submit() {
    // The prices go **first** and on their own (#593's rule): a figure read off the paper catalogue
    // must not be dropped in silence, so a failed write stops here and nothing is created. A retry
    // after a later refusal writes nothing twice — the fields now prefill from what is on file.
    const changed = changedRunPrices(priceSubjects, (key) => priceField(key)?.value ?? null);
    if (changed.length > 0) {
      setSavingPrices(true);
      setPriceError(undefined);
      const { quickSetCatalogPricesBulkAction } = await import("@/app/actions/stamps");
      const r = await quickSetCatalogPricesBulkAction(changed);
      setSavingPrices(false);
      if (r.savedRows > 0) void prices.refetch();
      if (r.status === "error") {
        setPriceError(r.message);
        return;
      }
    }
    writeLast(LS_LAST_CONDITION, collectionId, conditionId);
    writeLast(LS_LAST_CERT, collectionId, certificateStatusId);
    writeLast(LS_LAST_LOCATION, collectionId, location.locationId);
    writeLast(
      LS_LAST_DISPOSITION,
      collectionId,
      (["inCollection", "forSale", "forTrade"] as const).filter((k) => disposition[k]).join(",")
    );
    if (lotChoice && lotId) {
      writeLast(LS_LAST_SCAN_LOT, `${collectionId}:${lotChoice.purchaseId}`, lotId);
    }
    onSubmit({
      checklistId,
      shared,
      tiles: assignments.map((a) => ({
        tileId: a.tileId,
        stampId: a.stampId,
        overrides: overrides.get(a.tileId) ?? null,
      })),
    });
  }

  // ── Adding a stamp to the checklist without leaving the pass ─────────────────────────────────
  const [addingStamp, setAddingStamp] = useState(false);
  const [stampError, setStampError] = useState<string | undefined>();
  const [creatingStamp, startCreatingStamp] = useTransition();
  const { invalidatePickerData } = useInvalidateInventory();
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  function createStamp(issueId: string, fd: FormData) {
    startCreatingStamp(async () => {
      const result = await addStampToIssueAction(collectionId, issueId, fd);
      if (result.status === "success") {
        // The checklist and the members re-read, and a tile still waiting for its turn takes the new
        // stamp.
        setAddingStamp(false);
        setStampError(undefined);
        void runChecklist.refetch();
        invalidatePickerData(collectionId);
        void invalidateStampsAndIssues(collectionId);
      } else if (result.status === "error") {
        setStampError(result.message);
      }
    });
  }

  const tileName = (tileId: string) => {
    const piece = pieces.find((p) => p.tileId === tileId);
    return `#${turnOf.get(tileId) ?? "?"} (tile ${(piece?.position ?? 0) + 1})`;
  };
  const summary = checklistGone
    ? "That checklist no longer exists. Go back and pick another."
    : inRun.length === 0
      ? "Every tile has been taken out of the run."
      : membersLoading
        ? "Reading the checklist's stamps…"
        : blockers.length > 0
          ? `${blockers.map(tileName).join(", ")} ${blockers.length === 1 ? "has" : "have"} no stamp — give ${blockers.length === 1 ? "it one" : "each one"}, or take ${blockers.length === 1 ? "it" : "them"} out of the run.`
          : withoutCondition.length > 0
            ? "Choose a condition — for all tiles, or on each tile still without one."
            : `${inRun.length} ${inRun.length === 1 ? "copy" : "copies"} will be created — one per tile, each of its own stamp and keeping its own pictures.`;

  const activeOwn = active ? (overrides.get(active.tileId) ?? {}) : {};

  return (
    <>
      <DialogShell
        title={`Identify as the stamps of ${runTitle}`}
        onClose={onClose}
        // Wider since #1229, so a run row holds its value field on the same line as the rest.
        maxWidth="min(98vw, 122rem)"
        height="92vh"
        // A stamp being created over this dialog owns Escape, as the picker hands it over.
        dismissable={!addingStamp}
      >
        <div
          style={{ display: "flex", flex: 1, minHeight: 0, gap: "1rem", padding: "1rem 1.25rem" }}
        >
          {/* The piece in hand, with every tool a single tile has. */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {active ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginBottom: "0.5rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <span>
                    <strong>#{activeIndex + 1}</strong> of {inRun.length} · tile{" "}
                    {active.position + 1}
                  </span>
                  <span style={{ flex: 1 }} />
                  <DialogSecondaryButton
                    onClick={() => setActiveId(inRun[activeIndex - 1].tileId)}
                    disabled={activeIndex <= 0}
                  >
                    <Icon name="previous" size="sm" /> Previous
                  </DialogSecondaryButton>
                  <DialogSecondaryButton
                    onClick={() => setActiveId(inRun[activeIndex + 1].tileId)}
                    disabled={activeIndex >= inRun.length - 1}
                  >
                    Next <Icon name="next" size="sm" />
                  </DialogSecondaryButton>
                </div>
                {active.sides.length > 0 ? (
                  <TileZoomView
                    // Remounted per piece, so each opens fitted and its gauge starts empty.
                    key={active.tileId}
                    collectionId={collectionId}
                    sides={active.sides}
                    position={active.position}
                    scanDpi={scanDpi}
                    onGauge={setGauge}
                  />
                ) : (
                  <p style={MUTED}>This tile has no picture left to show.</p>
                )}
              </>
            ) : (
              <p style={MUTED}>No tile is left in the run.</p>
            )}
          </div>

          {/* The answers given once, and the run. */}
          <div
            style={{
              width: "39rem",
              flexShrink: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <p style={{ ...MUTED, fontSize: "0.8125rem" }}>
              The tiles take this checklist&rsquo;s stamps in its own order, in the order you ticked
              them. Correct a tile that skips a value, or is another stamp, on the right.
            </p>

            <section style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              <h3 style={SECTION_HEADING}>For all {inRun.length} tiles</h3>
              {asksForLot && (
                <div>
                  <LabelWithError htmlFor="run-lot">Lot</LabelWithError>
                  <select
                    id="run-lot"
                    value={lotId}
                    onChange={(e) => setLotId(e.target.value)}
                    disabled={isPending}
                    style={INPUT_STYLE}
                  >
                    {lotOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ display: "flex", gap: "0.625rem" }}>
                <div style={{ flex: 1 }}>
                  <LabelWithError htmlFor="run-condition">Condition</LabelWithError>
                  <ConditionSelect
                    id="run-condition"
                    conditions={conditions}
                    value={conditionId}
                    onChange={setConditionId}
                    disabled={isPending}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <LabelWithError htmlFor="run-cert">Certificate</LabelWithError>
                  <CertificateSelect
                    id="run-cert"
                    certificateStatuses={certificateStatuses}
                    value={certificateStatusId}
                    onChange={setCertificateStatusId}
                    disabled={isPending}
                  />
                </div>
                {formats.length > 0 && (
                  <div style={{ flex: 1 }}>
                    <LabelWithError htmlFor="run-format">Format</LabelWithError>
                    <FormatSelect
                      id="run-format"
                      formats={formats}
                      value={formatId}
                      onChange={setFormatId}
                      disabled={isPending}
                    />
                  </div>
                )}
              </div>
              <div>
                <LabelWithError htmlFor="run-location-button">Location (optional)</LabelWithError>
                <LocationFields
                  name="run-location"
                  locations={locations}
                  locationTree={locationTree}
                  value={location}
                  onChange={setLocation}
                  disabled={isPending}
                />
              </div>
              <div>
                <LabelWithError htmlFor="">Disposition (optional)</LabelWithError>
                <div style={{ marginTop: "0.25rem" }}>
                  <DispositionChips
                    values={disposition}
                    disabled={isPending}
                    onToggle={(flag, value) => setDisposition((d) => ({ ...d, [flag]: value }))}
                  />
                </div>
              </div>
            </section>

            <section style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <h3 style={SECTION_HEADING}>
                The run
                {runCatalog && (
                  <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>
                    {" "}
                    — values in {runCatalog.catalogLabel} {runCatalog.editionYear} ·{" "}
                    {runCatalog.currency}
                  </span>
                )}
              </h3>
              {/* The values are typed on the rows below (#1229); what the rows cannot say goes here. */}
              {priceSubjects.length > 0 ? (
                prices.isLoading || (prices.isFetching && valueKeys.length === 0) ? (
                  <p style={MUTED}>Reading the catalog values on file…</p>
                ) : prices.isError ? (
                  <p style={{ ...MUTED, color: "var(--color-error)" }}>
                    The catalog values on file could not be read: {prices.error.message}
                  </p>
                ) : valueKeys.length === 0 ? (
                  <p style={MUTED}>
                    This checklist&rsquo;s area has no primary catalog with an edition to record a
                    value on.
                  </p>
                ) : (
                  <p style={MUTED}>
                    Type each catalog value on its row and press Tab for the next; Tab from the last
                    goes to <em>Identify</em>. Tiles of one stamp in one condition share a value, typed
                    on the first of them.
                    {valuesMissing > 0 && (
                      <span style={{ color: "var(--color-warning)" }}>
                        {" "}
                        {valuesMissing} {valuesMissing === 1 ? "has" : "have"} no value yet.
                      </span>
                    )}
                  </p>
                )
              ) : assignments.some((a) => a.stampId) && withoutCondition.length > 0 ? (
                <p style={MUTED}>Choose a condition to record the run&rsquo;s catalog values.</p>
              ) : null}
              {!membersLoading && checklist && sequence.length === 0 && (
                <p style={{ ...MUTED, color: "var(--color-warning)" }}>
                  This checklist has no stamps yet. Add them, and the tiles take them in turn.
                </p>
              )}
              {checklistGone && (
                <p style={{ ...MUTED, color: "var(--color-error)" }}>
                  This checklist no longer exists.
                </p>
              )}
              {assignments.map((a, i) => {
                const piece = inRun[i];
                const front = piece.sides.find((s) => s.side === "front") ?? piece.sides[0];
                const thumb = front
                  ? `/api/collections/${collectionId}/photos/${front.photoId}/thumb`
                  : null;
                const own = overriddenFields(overrides.get(a.tileId));
                const isActive = piece.tileId === active?.tileId;
                const sameAs = a.stampId
                  ? assignments
                      .filter((b) => b.tileId !== a.tileId && b.stampId === a.stampId)
                      .map((b) => `#${turnOf.get(b.tileId)}`)
                  : [];
                const d = resolved[i];
                const condition = conditions.find((c) => c.id === d.conditionId);
                const certificate = certificateStatuses.find((c) => c.id === d.certificateStatusId);
                const notes = [
                  a.corrected ? "corrected" : null,
                  own.length > 0 ? `own ${own.map((f) => FIELD_LABEL[f].toLowerCase()).join(", ")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const slot = valueSlots[i];
                const field = valueFields[i];
                const label = labelOf(a.stampId) ?? "…";
                return (
                  <div key={a.tileId} style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                    <button
                      type="button"
                      onClick={() => setActiveId(a.tileId)}
                      aria-pressed={isActive}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        alignSelf: "stretch",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        textAlign: "left",
                        padding: "0.3rem 0.5rem",
                        borderRadius: "0.375rem",
                        border: `1px solid ${isActive ? "var(--color-accent)" : "var(--color-border)"}`,
                        background: isActive ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                        color: "var(--color-text-primary)",
                        font: "inherit",
                        fontSize: "0.8125rem",
                        cursor: "pointer",
                      }}
                    >
                      <strong style={{ width: "1.75rem", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                        #{i + 1}
                      </strong>
                      <span
                        // A press on the picture takes this tile in hand but leaves the cursor in the
                        // value being typed (#1223).
                        onMouseDown={(e) => e.preventDefault()}
                        style={{ width: "2.5rem", height: "2.5rem", flexShrink: 0 }}
                      >
                        {front && thumb && (
                          <ThumbPreview
                            src={`/api/collections/${collectionId}/photos/${front.photoId}/full`}
                            thumbSrc={thumb}
                            label={`Tile ${piece.position + 1}`}
                            style={{ width: "100%", height: "100%" }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={thumb}
                              alt={`Tile ${piece.position + 1}`}
                              draggable={false}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: THUMB_OBJECT_FIT,
                                display: "block",
                              }}
                            />
                          </ThumbPreview>
                        )}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        {a.stampId ? (
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {label}
                          </span>
                        ) : (
                          <span style={{ color: "var(--color-error)" }}>No stamp</span>
                        )}
                        {notes && (
                          <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                            {notes}
                          </span>
                        )}
                        {a.stampId && repeated.has(a.stampId) && (
                          <span style={{ fontSize: "0.6875rem", color: "var(--color-warning)" }}>
                            <Icon name="warning" size="xs" /> Same stamp as {sameAs.join(", ")}
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: "0.75rem",
                          color: "var(--color-text-muted)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        tile {piece.position + 1}
                      </span>
                      <span
                        style={{
                          width: "4.5rem",
                          flexShrink: 0,
                          fontSize: "0.75rem",
                          color: condition ? "var(--color-text-secondary)" : "var(--color-warning)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {condition
                          ? [condition.abbreviation, certificate?.abbreviation].filter(Boolean).join(" · ")
                          : "no condition"}
                      </span>
                    </button>
                    <RowValue
                      entry={slot.key != null && slot.entryIndex === i}
                      entryTurn={slot.entryIndex != null && slot.entryIndex !== i ? slot.entryIndex + 1 : null}
                      amount={field?.value.amount ?? null}
                      currency={runCatalog ? null : (field?.catalog?.currency ?? null)}
                      label={`#${i + 1} ${label} ${condition?.abbreviation ?? ""}${certificate ? ` ${certificate.abbreviation}` : ""} catalog value`}
                      disabled={isPending || savingPrices}
                      inputRef={(el) => {
                        if (slot.key) priceInputs.current.set(slot.key, el);
                      }}
                      onChange={(v) => {
                        const key = slot.key;
                        if (key) setTypedPrices((prev) => new Map(prev).set(key, v));
                      }}
                      onKeyDown={(e) => {
                        if (slot.key) tabThroughValues(e, slot.key);
                      }}
                    />
                    <Tooltip content="Take this tile out of the run — it stays ticked on the card">
                      <DialogSecondaryButton onClick={() => takeOut(a.tileId)} disabled={isPending}>
                        <Icon name="remove" size="sm" />
                      </DialogSecondaryButton>
                    </Tooltip>
                  </div>
                );
              })}
              {removed.size > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.375rem" }}>
                  <span style={MUTED}>Taken out:</span>
                  {pieces
                    .filter((p) => removed.has(p.tileId))
                    .map((p) => (
                      <DialogSecondaryButton
                        key={p.tileId}
                        onClick={() => putBack(p.tileId)}
                        disabled={isPending}
                      >
                        <Icon name="restore" size="sm" /> Tile {p.position + 1}
                      </DialogSecondaryButton>
                    ))}
                </div>
              )}
              {canAddStamp && (
                <div>
                  <button
                    type="button"
                    onClick={() => setAddingStamp(true)}
                    disabled={isPending}
                    style={CREATE_LINK_STYLE}
                  >
                    + New stamp on this checklist
                  </button>
                </div>
              )}
            </section>
          </div>

          {/* The tile in hand: its stamp, and what it holds of its own. */}
          <div
            style={{
              width: "25rem",
              flexShrink: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            {active && activeAssignment ? (
              <>
                <section style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                  <h3 style={SECTION_HEADING}>
                    #{activeIndex + 1} — its stamp
                  </h3>
                  {activeAssignment.corrected && (
                    <div>
                      <button
                        type="button"
                        onClick={() => correct(active.tileId, null)}
                        disabled={isPending}
                        style={CREATE_LINK_STYLE}
                      >
                        Back to its turn ({labelOf(sequence[activeIndex] ?? null) ?? "no stamp"})
                      </button>
                    </div>
                  )}
                  {(anyPerforation || watermarks.length > 0) && (
                    <MeasuredNarrowing
                      gauge={gauge}
                      anyPerforation={anyPerforation}
                      watermarks={watermarks}
                      watermarkId={watermarkSeen}
                      onWatermark={setWatermarkPick}
                    />
                  )}
                  {membersLoading && <p style={MUTED}>Loading the checklist&rsquo;s stamps…</p>}
                  {(() => {
                    const choice = (node: StampNodeData, depth: number) => {
                      const { vendorMap, primaryVendorId } = vendorsOf(node.stampId);
                      return (
                        <StampChoice
                          key={node.stampId}
                          collectionId={collectionId}
                          node={node}
                          depth={depth}
                          chosen={node.stampId === activeAssignment.stampId}
                          alsoOn={assignments
                            .filter((b) => b.tileId !== active.tileId && b.stampId === node.stampId)
                            .map((b) => `#${turnOf.get(b.tileId)}`)}
                          perforation={perforationMatches(gauge, node.attributes.perforation)}
                          watermark={
                            !watermarkSeen || !node.attributes.watermark
                              ? "unknown"
                              : node.attributes.watermark === watermarkSeen
                                ? "fits"
                                : "differs"
                          }
                          vendorMap={vendorMap}
                          primaryVendorId={primaryVendorId}
                          disabled={isPending}
                          onChoose={() => correct(active.tileId, node.stampId)}
                        />
                      );
                    };
                    // The checklist's stamps first, then every other stamp of the issues it covers
                    // (#1225): a tile that is not on the checklist still has somewhere to go.
                    return (
                      <>
                        {choices.onChecklist.length > 0 && <p style={MUTED}>On the checklist</p>}
                        {choices.onChecklist.map((node) => choice(node, 0))}
                        {choices.others
                          .filter((group) => group.nodes.length > 0)
                          .map((group) => {
                            const owner = coveredIssues.find((i) => i.id === group.issueId);
                            return (
                              <Fragment key={group.issueId}>
                                <p style={{ ...MUTED, marginTop: "0.5rem" }}>
                                  Other stamps of{" "}
                                  {owner ? issueLabel(owner.name, owner.year) : "the issue"}
                                </p>
                                {group.nodes.map(({ node, depth }) => choice(node, depth))}
                              </Fragment>
                            );
                          })}
                      </>
                    );
                  })()}
                </section>

                <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <h3 style={SECTION_HEADING}>#{activeIndex + 1} — its own details</h3>
                  <p style={MUTED}>
                    Everything follows <em>For all tiles</em> unless this tile has its own value — and
                    its own value stays when the shared one changes.
                  </p>
                  {fields.map((field) => {
                    const isOwn = activeOwn[field] !== undefined;
                    const value = resolveRunCopyDetails(shared, activeOwn);
                    const tileId = active.tileId;
                    return (
                      <OwnField
                        key={`${tileId}-${field}`}
                        label={FIELD_LABEL[field]}
                        own={isOwn}
                        sharedText={describe(field, shared)}
                        disabled={isPending}
                        onOwn={(on) => setOwn(tileId, field, on ? shared[field] : undefined)}
                      >
                        {field === "conditionId" ? (
                          <ConditionSelect
                            conditions={conditions}
                            value={value.conditionId}
                            onChange={(v) => setOwn(tileId, "conditionId", v)}
                            disabled={isPending}
                          />
                        ) : field === "certificateStatusId" ? (
                          <CertificateSelect
                            certificateStatuses={certificateStatuses}
                            value={value.certificateStatusId}
                            onChange={(v) => setOwn(tileId, "certificateStatusId", v)}
                            disabled={isPending}
                          />
                        ) : field === "formatId" ? (
                          <FormatSelect
                            formats={formats}
                            value={value.formatId}
                            onChange={(v) => setOwn(tileId, "formatId", v)}
                            disabled={isPending}
                          />
                        ) : field === "lotId" ? (
                          <select
                            value={value.lotId}
                            onChange={(e) => setOwn(tileId, "lotId", e.target.value)}
                            disabled={isPending}
                            style={INPUT_STYLE}
                          >
                            {lotOptions.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.label}
                              </option>
                            ))}
                          </select>
                        ) : field === "location" ? (
                          <LocationFields
                            name={`run-location-${tileId}`}
                            locations={locations}
                            locationTree={locationTree}
                            value={value.location}
                            onChange={(v) => setOwn(tileId, "location", v)}
                            disabled={isPending}
                          />
                        ) : (
                          <DispositionChips
                            values={value.disposition}
                            disabled={isPending}
                            onToggle={(flag, on) =>
                              setOwn(tileId, "disposition", { ...value.disposition, [flag]: on })
                            }
                          />
                        )}
                      </OwnField>
                    );
                  })}
                </section>
              </>
            ) : null}
          </div>
        </div>
        <DialogActions
          actionLabel={
            isPending
              ? "Working…"
              : savingPrices
                ? "Saving the catalog values…"
                : `Identify ${inRun.length} ${inRun.length === 1 ? "tile" : "tiles"}`
          }
          cancelLabel="Back"
          onCancel={onBack}
          onAction={() => void submit()}
          actionRef={confirmRef}
          disabled={isPending || !canConfirm}
          cancelDisabled={isPending}
          error={priceError ?? error}
          leading={
            <span
              style={{
                fontSize: "0.8125rem",
                color: canConfirm ? "var(--color-text-secondary)" : "var(--color-warning)",
              }}
            >
              {summary}
            </span>
          }
        />
      </DialogShell>

      {addingStamp && (
        <StampFormDialog
          mode="add"
          collectionId={collectionId}
          issues={[issue]}
          areaVendors={[...maps.vendorMapFor(issue.collectionAreaId, issue.id).values()]}
          prefilledIssueId={issue.id}
          prefilledParentStampId={null}
          prefilledChecklistIds={[checklistId]}
          prefilledParentIssuedYear={null}
          isPending={creatingStamp}
          error={stampError}
          onClose={() => {
            if (!creatingStamp) {
              setAddingStamp(false);
              setStampError(undefined);
            }
          }}
          onSubmit={createStamp}
        />
      )}
    </>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────

/**
 * A run row's catalogue value (#1229).
 *
 * **The entry row** — the first tile in run order of its stamp × condition × certificate — carries the
 * field, framed in amber while it is empty. **A sharing row** shows the same figure read-only and
 * names the row it is typed on, so nothing asks for one value twice. A row with nothing to record, or
 * whose field is not read yet, keeps the slot empty so the rows stay aligned.
 */
function RowValue({
  entry,
  entryTurn,
  amount,
  currency,
  label,
  disabled,
  inputRef,
  onChange,
  onKeyDown,
}: {
  entry: boolean;
  /** The position of the row the value is typed on, for a sharing row; null otherwise. */
  entryTurn: number | null;
  /** Null where there is no field — nothing to record, or the read not in yet. */
  amount: string | null;
  /** Named per row only where the run's catalogs differ; otherwise it is in the heading. */
  currency: string | null;
  label: string;
  disabled: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const empty = amount != null && amount.trim() === "";
  return (
    <span
      style={{
        width: "9.5rem",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        fontSize: "0.75rem",
      }}
    >
      {amount == null ? null : entry ? (
        <>
          <NumericInput
            kind="amount"
            ref={inputRef}
            aria-label={label}
            value={amount}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            placeholder="—"
            autoComplete="off"
            style={{
              ...INPUT_STYLE,
              width: "6.5rem",
              padding: "0.375rem 0.5rem",
              textAlign: "right",
              border: `1px solid ${empty ? "var(--color-warning)" : "var(--color-border-strong)"}`,
            }}
          />
          {currency && <span style={{ color: "var(--color-text-muted)" }}>{currency}</span>}
        </>
      ) : entryTurn != null ? (
        <>
          <span
            style={{
              width: "6.5rem",
              flexShrink: 0,
              boxSizing: "border-box",
              padding: "0 0.5rem",
              textAlign: "right",
              fontSize: "0.875rem",
              fontVariantNumeric: "tabular-nums",
              color: empty ? "var(--color-warning)" : "var(--color-text-secondary)",
            }}
          >
            {empty ? "—" : amount}
          </span>
          <span style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>as #{entryTurn}</span>
        </>
      ) : null}
    </span>
  );
}

/** One field of a tile's own details: the shared value while it follows the run, the control once
 * it is the tile's own. */
function OwnField({
  label,
  own,
  sharedText,
  disabled,
  onOwn,
  children,
}: {
  label: string;
  own: boolean;
  sharedText: string;
  disabled: boolean;
  onOwn: (own: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "0.375rem 0.5rem",
        borderRadius: "0.375rem",
        border: `1px solid ${own ? "var(--color-accent)" : "var(--color-border)"}`,
        background: own ? "var(--color-accent-soft)" : "transparent",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          fontSize: "0.8125rem",
          color: "var(--color-text-secondary)",
        }}
      >
        <input
          type="checkbox"
          checked={own}
          disabled={disabled}
          onChange={(e) => onOwn(e.target.checked)}
        />
        <strong>{label}</strong>
        <span style={{ color: "var(--color-text-muted)" }}>
          {own ? "— this tile's own" : `— as for all: ${sharedText}`}
        </span>
      </label>
      {own && <div style={{ marginTop: "0.375rem" }}>{children}</div>}
    </div>
  );
}

function ConditionSelect({
  id,
  conditions,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  conditions: StampConditionData[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={INPUT_STYLE}
    >
      <option value="">— Select —</option>
      {conditions.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({c.abbreviation})
        </option>
      ))}
    </select>
  );
}

function CertificateSelect({
  id,
  certificateStatuses,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  certificateStatuses: CertificateStatusData[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={INPUT_STYLE}
    >
      <option value="">— None —</option>
      {certificateStatuses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({c.abbreviation})
        </option>
      ))}
    </select>
  );
}

function FormatSelect({
  id,
  formats,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  formats: { id: string; name: string; abbreviation: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={INPUT_STYLE}
    >
      <option value="">— Single —</option>
      {formats.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name} ({f.abbreviation})
        </option>
      ))}
    </select>
  );
}

/** A location and the ref inside it — one answer, since a ref means nothing without its place. */
function LocationFields({
  name,
  locations,
  locationTree,
  value,
  onChange,
  disabled,
}: {
  name: string;
  locations: LocationData[];
  locationTree: ReturnType<typeof buildLocationTree>;
  value: { locationId: string; locationRef: string };
  onChange: (value: { locationId: string; locationRef: string }) => void;
  disabled: boolean;
}) {
  if (locations.length === 0) {
    return (
      <p style={MUTED}>No locations defined yet. Add some on the Locations screen to file copies away.</p>
    );
  }
  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
      <div style={{ flex: 3, minWidth: 0 }}>
        <LocationTreeSelect
          locations={locations}
          locationTree={locationTree}
          name={name}
          selectedId={value.locationId}
          onSelectedIdChange={(locationId) =>
            onChange({ locationId, locationRef: locationId ? value.locationRef : "" })
          }
          onlyAssignableSelectable
          disabled={disabled}
          noneOptionLabel="— None"
          buttonClassName={LOCATION_SELECT_BUTTON_CLASS}
        />
      </div>
      <input
        type="text"
        placeholder="Ref, e.g. A234"
        value={value.locationRef}
        onChange={(e) => onChange({ ...value, locationRef: e.target.value })}
        disabled={disabled || !value.locationId}
        autoComplete="off"
        style={{ ...INPUT_STYLE, flex: 1, minWidth: 0 }}
      />
    </div>
  );
}

/** One stamp a tile can be given — drawn as the picker draws it, with what was read off the piece
 * marked on it (#740). A press gives the tile in hand this stamp. */
function StampChoice({
  collectionId,
  node,
  depth,
  chosen,
  alsoOn,
  perforation,
  watermark,
  vendorMap,
  primaryVendorId,
  disabled,
  onChoose,
}: {
  collectionId: string;
  node: StampNodeData;
  depth: number;
  chosen: boolean;
  /** The other tiles of the run already on this stamp. */
  alsoOn: string[];
  perforation: ReturnType<typeof perforationMatches>;
  watermark: ReturnType<typeof perforationMatches>;
  vendorMap: ReturnType<ReturnType<typeof useAreaVendorMaps>["vendorMapFor"]>;
  primaryVendorId: string | null;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={disabled}
      aria-pressed={chosen}
      style={{
        marginLeft: `${depth * 1.25}rem`,
        textAlign: "left",
        padding: "0.35rem 0.5rem",
        borderRadius: "0.375rem",
        border: `1px solid ${chosen ? "var(--color-accent)" : "var(--color-border)"}`,
        background: chosen ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
        color: "var(--color-text-primary)",
        font: "inherit",
        fontSize: "0.8125rem",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
        <PhotoThumb collectionId={collectionId} photos={node.photos} reserveWhenEmpty />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
            <StampTitle node={node} />
            {chosen && <span style={{ color: "var(--color-accent)" }}> — this tile</span>}
            {alsoOn.length > 0 && (
              <span style={{ color: "var(--color-text-muted)" }}> — also on {alsoOn.join(", ")}</span>
            )}
          </span>
          <StampDetailLine node={node} vendorMap={vendorMap} primaryVendorId={primaryVendorId} />
          {(perforation !== "unknown" || watermark !== "unknown") && (
            <span style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.2rem" }}>
              {perforation !== "unknown" && node.attributes.perforation && (
                <MeasuredMark match={perforation} label={node.attributes.perforation} what="perforation" />
              )}
              {watermark !== "unknown" && node.attributes.watermark && (
                <MeasuredMark match={watermark} label={node.attributes.watermark} what="watermark" />
              )}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
