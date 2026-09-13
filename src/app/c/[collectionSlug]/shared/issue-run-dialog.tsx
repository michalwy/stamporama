"use client";

import { useMemo, useRef, useState, useTransition } from "react";
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
  issueRunSequence,
  overriddenFields,
  priceListTabTarget,
  repeatedStamps,
  resolveRunCopyDetails,
  runBlockers,
  runPriceLines,
  runPriceSubjects,
  treeOrder,
  RUN_DETAIL_FIELDS,
  type IssueRunIdentification,
  type RunCopyDetails,
  type RunCopyOverrides,
  type RunDetailField,
} from "@/lib/issue-run";
import {
  useCollectionFormats,
  useInvalidateInventory,
  useIssueMembers,
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
 * A ticked run of scan tiles identified **as the stamps of one issue, in turn** (#1220).
 *
 * The step after the issue is picked, and the whole of what is new: the tiles have already taken the
 * issue's main stamps in the order they were ticked (`issue-run.ts` decides which), so what the
 * collector does here is **correct** — the tile that skips a value, the one that is a variant, the
 * stray ticked by mistake — and answer the copy details once, overriding them on the pieces that
 * differ.
 *
 * **Three columns, because three things are looked at together.** The piece, at the size and with
 * the tools a single tile has (#585's viewer, #598's measuring, #625's watermark) — never a reduced
 * version for the bulk case, since telling `240a` from `240b` is the same act on the fifth tile of a
 * set as on a tile alone. The run, which is the sequence and every answer in it at a glance. And the
 * tile in hand: its stamp among the issue's, marked by what was read off it (#740), and its own copy
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
  /** The issue the run takes its stamps from. */
  issue: IssueListItem;
  /** The run, in the order the tiles were ticked. */
  pieces: IdentifiedPiece[];
  /** The lot question (#586), or absent where there is none — a card that belongs to no order. */
  lotChoice?: IntakeConditionDialogProps["lotChoice"];
  isPending: boolean;
  error?: string;
  /** Back to the issue picker. */
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
  const vendorMap = maps.vendorMapFor(issue.collectionAreaId, issue.id);
  const primaryVendorId = maps.primaryVendorByArea.get(issue.collectionAreaId) ?? null;
  const { data: members = [], isLoading: membersLoading } = useIssueMembers(
    collectionId,
    issue.id
  );
  const { data: formats = [] } = useCollectionFormats(collectionId);
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.stampId, m])), [members]);
  /** The stamps tiles take in turn — the issue's main stamps, in catalogue order. */
  const sequence = useMemo(
    () => issueRunSequence(members, primaryVendorId),
    [members, primaryVendorId]
  );
  /** Every stamp a tile can be corrected to — variants included — as the issue's tree draws them. */
  const choices = useMemo(() => {
    const ids = new Set(members.map((m) => m.stampId));
    const byId = new Map(members.map((m) => [m.stampId, m]));
    return treeOrder(members).map((node) => {
      let depth = 0;
      let parentId = node.parentId;
      const seen = new Set<string>();
      while (parentId && ids.has(parentId) && !seen.has(parentId)) {
        seen.add(parentId);
        depth += 1;
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return { node, depth };
    });
  }, [members]);
  const labelOf = (stampId: string | null): string | null => {
    const node = stampId ? memberById.get(stampId) : undefined;
    if (!node) return null;
    return pickedStampText({
      stampId: node.stampId,
      catalogLabels: orderedCatalogLabels(node.catalogNumbers, vendorMap, primaryVendorId),
      name: node.name,
      secondary: null,
      unknownVariant: false,
    });
  };

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
  const priceKeyOf = (i: number): string | null => {
    const a = assignments[i];
    const d = resolved[i];
    return a?.stampId && d?.conditionId
      ? catalogValueSubjectKey(a.stampId, d.conditionId, d.certificateStatusId)
      : null;
  };

  const canConfirm =
    inRun.length > 0 &&
    blockers.length === 0 &&
    withoutCondition.length === 0 &&
    !membersLoading &&
    !savingPrices;

  /**
   * The same values as **one list, typed down** (#1223): a line per subject in catalogue order, each
   * field the field — no row to select first. It edits `typedPrices` exactly as the tile's own field
   * does, so the two always show the same figure.
   */
  const priceLines = runPriceLines(
    assignments,
    resolved,
    members,
    primaryVendorId,
    conditions.map((c) => c.id),
    certificateStatuses.map((c) => c.id)
  ).flatMap((line) => {
    const field = priceField(line.key);
    return field ? [{ line, field }] : [];
  });
  const priceInputs = useRef(new Map<string, HTMLInputElement | null>());
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  /** Tab walks the values and nothing else, and off the last one lands on Identify (#726). */
  function tabThroughPrices(e: React.KeyboardEvent<HTMLInputElement>, key: string) {
    if (e.key !== "Tab") return;
    const confirm = confirmRef.current;
    const target = priceListTabTarget(
      priceLines.map((p) => p.line.key),
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
  const priceListCatalogs = new Set(priceLines.map((p) => p.field.value.catalogNameId));
  const priceListCatalog = priceListCatalogs.size === 1 ? priceLines[0]?.field.catalog : undefined;
  const priceListMissing = priceLines.filter((p) => p.field.value.amount.trim() === "").length;

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
      issueId: issue.id,
      shared,
      tiles: assignments.map((a) => ({
        tileId: a.tileId,
        stampId: a.stampId,
        overrides: overrides.get(a.tileId) ?? null,
      })),
    });
  }

  // ── Adding a stamp to the issue without leaving the pass ─────────────────────────────────────
  const [addingStamp, setAddingStamp] = useState(false);
  const [stampError, setStampError] = useState<string | undefined>();
  const [creatingStamp, startCreatingStamp] = useTransition();
  const { invalidatePickerData } = useInvalidateInventory();
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  function createStamp(issueId: string, fd: FormData) {
    startCreatingStamp(async () => {
      const result = await addStampToIssueAction(collectionId, issueId, fd);
      if (result.status === "success") {
        // The members re-read, and a tile still waiting for its turn takes the new stamp.
        setAddingStamp(false);
        setStampError(undefined);
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
  const summary =
    inRun.length === 0
      ? "Every tile has been taken out of the run."
      : membersLoading
        ? "Reading the issue's stamps…"
        : blockers.length > 0
          ? `${blockers.map(tileName).join(", ")} ${blockers.length === 1 ? "has" : "have"} no stamp — give ${blockers.length === 1 ? "it one" : "each one"}, or take ${blockers.length === 1 ? "it" : "them"} out of the run.`
          : withoutCondition.length > 0
            ? "Choose a condition — for all tiles, or on each tile still without one."
            : `${inRun.length} ${inRun.length === 1 ? "copy" : "copies"} will be created — one per tile, each of its own stamp and keeping its own pictures.`;

  const activeOwn = active ? (overrides.get(active.tileId) ?? {}) : {};

  return (
    <>
      <DialogShell
        title={`Identify as the stamps of ${issueLabel(issue.name, issue.year)}`}
        onClose={onClose}
        maxWidth="min(98vw, 110rem)"
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
              width: "27rem",
              flexShrink: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <p style={{ ...MUTED, fontSize: "0.8125rem" }}>
              The tiles take this issue&rsquo;s stamps in catalogue order, in the order you ticked
              them. Correct a tile that skips a value, or is a variant, on the right.
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

            {/* Every value the run can record, typed down one list (#1223). Here rather than beside
                the tile in hand, because it is about the whole run and needs no tile selected. */}
            {priceSubjects.length > 0 ? (
              <section style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                <h3 style={SECTION_HEADING}>
                  Catalog values
                  {priceListCatalog && (
                    <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>
                      {" "}
                      — {priceListCatalog.catalogLabel} {priceListCatalog.editionYear} ·{" "}
                      {priceListCatalog.currency}
                    </span>
                  )}
                </h3>
                {prices.isLoading ? (
                  <p style={MUTED}>Reading the catalog values on file…</p>
                ) : prices.isError ? (
                  <p style={{ ...MUTED, color: "var(--color-error)" }}>
                    The catalog values on file could not be read: {prices.error.message}
                  </p>
                ) : priceLines.length === 0 ? (
                  <p style={MUTED}>
                    This issue&rsquo;s area has no primary catalog with an edition to record a value
                    on.
                  </p>
                ) : (
                  <>
                    <p style={MUTED}>
                      One line per stamp in a condition, in catalogue order. Type a value and press
                      Tab for the next; Tab from the last goes to <em>Identify</em>.
                      {priceListMissing > 0 && (
                        <span style={{ color: "var(--color-warning)" }}>
                          {" "}
                          {priceListMissing} {priceListMissing === 1 ? "has" : "have"} no value yet.
                        </span>
                      )}
                    </p>
                    {priceLines.map(({ line, field }) => {
                      const node = memberById.get(line.stampId);
                      const tiles = line.tileIds
                        .map((id) => inRun.find((p) => p.tileId === id))
                        .filter((p): p is IdentifiedPiece => p != null);
                      const condition = conditions.find((c) => c.id === line.conditionId);
                      const certificate = certificateStatuses.find(
                        (c) => c.id === line.certificateStatusId
                      );
                      const number = node
                        ? (orderedCatalogLabels(node.catalogNumbers, vendorMap, primaryVendorId)[0] ||
                          node.name ||
                          "No catalog number")
                        : "…";
                      return (
                        <PriceLine
                          key={line.key}
                          collectionId={collectionId}
                          piece={tiles[0] ?? null}
                          moreTiles={Math.max(0, tiles.length - 1)}
                          number={number}
                          condition={condition ? `${condition.name} (${condition.abbreviation})` : ""}
                          certificate={certificate?.name ?? null}
                          currency={priceListCatalog ? null : (field.catalog?.currency ?? null)}
                          amount={field.value.amount}
                          disabled={isPending || savingPrices}
                          inputRef={(el) => {
                            priceInputs.current.set(line.key, el);
                          }}
                          onChange={(v) => setTypedPrices((prev) => new Map(prev).set(line.key, v))}
                          onKeyDown={(e) => tabThroughPrices(e, line.key)}
                        />
                      );
                    })}
                  </>
                )}
              </section>
            ) : assignments.some((a) => a.stampId) && withoutCondition.length > 0 ? (
              <p style={MUTED}>Choose a condition to record the run&rsquo;s catalog values.</p>
            ) : null}

            <section style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <h3 style={SECTION_HEADING}>The run</h3>
              {!membersLoading && members.length === 0 && (
                <p style={{ ...MUTED, color: "var(--color-warning)" }}>
                  This issue has no stamps yet. Add them, and the tiles take them in turn.
                </p>
              )}
              {assignments.map((a, i) => {
                const piece = inRun[i];
                const front = piece.sides.find((s) => s.side === "front") ?? piece.sides[0];
                const own = overriddenFields(overrides.get(a.tileId));
                const isActive = piece.tileId === active?.tileId;
                const sameAs = a.stampId
                  ? assignments
                      .filter((b) => b.tileId !== a.tileId && b.stampId === a.stampId)
                      .map((b) => `#${turnOf.get(b.tileId)}`)
                  : [];
                return (
                  <div key={a.tileId} style={{ display: "flex", alignItems: "stretch", gap: "0.25rem" }}>
                    <button
                      type="button"
                      onClick={() => setActiveId(a.tileId)}
                      aria-pressed={isActive}
                      style={{
                        flex: 1,
                        minWidth: 0,
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
                      {front ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/collections/${collectionId}/photos/${front.photoId}/thumb`}
                          alt={`Tile ${piece.position + 1}`}
                          draggable={false}
                          style={{ width: "2.5rem", height: "2.5rem", objectFit: "contain", flexShrink: 0 }}
                        />
                      ) : (
                        <span style={{ width: "2.5rem", flexShrink: 0 }} />
                      )}
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        {a.stampId ? (
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {labelOf(a.stampId) ?? "…"}
                          </span>
                        ) : (
                          <span style={{ color: "var(--color-error)" }}>No stamp</span>
                        )}
                        <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                          {[
                            `tile ${piece.position + 1}`,
                            a.corrected ? "corrected" : null,
                            own.length > 0
                              ? `own ${own.map((f) => FIELD_LABEL[f].toLowerCase()).join(", ")}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {(() => {
                          // Whether this tile's stamp has a value for its condition — the gap closing
                          // a lot would otherwise find a month from now.
                          const field = priceField(priceKeyOf(i));
                          if (!field) return null;
                          const amount = field.value.amount.trim();
                          return (
                            <span
                              style={{
                                fontSize: "0.6875rem",
                                color: amount ? "var(--color-text-muted)" : "var(--color-warning)",
                              }}
                            >
                              {amount
                                ? `${field.catalog?.vendorAbbreviation ?? "CV"} ${amount} ${field.catalog?.currency ?? ""}`
                                : "no catalog value"}
                            </span>
                          );
                        })()}
                        {a.stampId && repeated.has(a.stampId) && (
                          <span style={{ fontSize: "0.6875rem", color: "var(--color-warning)" }}>
                            <Icon name="warning" size="xs" /> Same stamp as {sameAs.join(", ")}
                          </span>
                        )}
                      </span>
                    </button>
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
              <div>
                <button
                  type="button"
                  onClick={() => setAddingStamp(true)}
                  disabled={isPending}
                  style={CREATE_LINK_STYLE}
                >
                  + New stamp in this issue
                </button>
              </div>
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
                  {membersLoading && <p style={MUTED}>Loading the issue&rsquo;s stamps…</p>}
                  {choices.map(({ node, depth }) => (
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
                  ))}
                </section>

                {(() => {
                  const key = priceKeyOf(activeIndex);
                  const field = priceField(key);
                  if (!key) {
                    return activeAssignment.stampId ? (
                      <p style={MUTED}>Choose a condition to record this stamp&rsquo;s catalog value.</p>
                    ) : null;
                  }
                  if (!field) return null;
                  const d = resolved[activeIndex];
                  const subject = [
                    conditions.find((c) => c.id === d.conditionId)?.abbreviation,
                    certificateStatuses.find((c) => c.id === d.certificateStatusId)?.abbreviation,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  const sharing = assignments.filter((_, j) => priceKeyOf(j) === key).length;
                  return (
                    <section style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                      <h3 style={SECTION_HEADING}>
                        <label htmlFor="run-catalog-value">#{activeIndex + 1} — catalog value</label>
                      </h3>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <NumericInput
                          id="run-catalog-value"
                          // One input per subject, so moving to a tile of another stamp starts
                          // clean rather than carrying a caret across.
                          key={key}
                          value={field.value.amount}
                          onChange={(e) => {
                            const v = e.target.value;
                            setTypedPrices((prev) => new Map(prev).set(key, v));
                          }}
                          disabled={isPending || savingPrices || prices.isFetching}
                          placeholder="0.00"
                          style={{ ...INPUT_STYLE, width: "8rem", textAlign: "right" }}
                        />
                        <span style={{ ...MUTED, minWidth: 0 }}>
                          {field.catalog
                            ? `${field.catalog.catalogLabel} ${field.catalog.editionYear} · ${field.catalog.currency}`
                            : null}
                          {" — for "}
                          <strong style={{ color: "var(--color-text-secondary)" }}>{subject}</strong>
                          {field.value.recorded != null ? ", already on file" : ""}
                        </span>
                      </div>
                      {sharing > 1 && (
                        <p style={MUTED}>
                          The same value for all {sharing} tiles of this stamp in this condition.
                        </p>
                      )}
                    </section>
                  );
                })()}

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
          areaVendors={[...vendorMap.values()]}
          prefilledIssueId={issue.id}
          prefilledParentStampId={null}
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
 * One line of the run's price list (#1223): the tile's picture, what is being priced, and the field.
 *
 * **The picture is the tile's own**, the first of the line's tiles in tick order — every line is
 * guaranteed one, and it is what gets matched against the catalogue page. It enlarges on hover
 * (#632's `ThumbPreview`) and is **never focusable**: nothing in it is a button, and a press on it
 * keeps the cursor in the value being typed, since a picture that took focus would bring back the
 * clicking the list exists to remove.
 */
function PriceLine({
  collectionId,
  piece,
  moreTiles,
  number,
  condition,
  certificate,
  currency,
  amount,
  disabled,
  inputRef,
  onChange,
  onKeyDown,
}: {
  collectionId: string;
  piece: IdentifiedPiece | null;
  /** The line's tiles past the one pictured. */
  moreTiles: number;
  number: string;
  condition: string;
  certificate: string | null;
  /** Named per line only where the list's catalogs differ; otherwise it is in the heading. */
  currency: string | null;
  amount: string;
  disabled: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const front = piece ? (piece.sides.find((s) => s.side === "front") ?? piece.sides[0]) : undefined;
  const empty = amount.trim() === "";
  const thumb = front ? `/api/collections/${collectionId}/photos/${front.photoId}/thumb` : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.25rem 0.5rem",
        borderRadius: "0.375rem",
        border: `1px solid ${empty ? "var(--color-warning)" : "var(--color-border)"}`,
        background: "var(--color-bg-elevated)",
      }}
    >
      <span
        // A press on the picture must not take the cursor out of the value being typed.
        onMouseDown={(e) => e.preventDefault()}
        style={{ flexShrink: 0, width: "2.75rem", height: "2.75rem" }}
      >
        {front && thumb && (
          <ThumbPreview
            src={`/api/collections/${collectionId}/photos/${front.photoId}/full`}
            thumbSrc={thumb}
            label={`Tile ${(piece?.position ?? 0) + 1}`}
            style={{ width: "100%", height: "100%" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt={`Tile ${(piece?.position ?? 0) + 1}`}
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
            />
          </ThumbPreview>
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <strong
          style={{
            fontSize: "0.875rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {number}
        </strong>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
          {[condition, certificate].filter(Boolean).join(" · ")}
        </span>
        {(moreTiles > 0 || empty) && (
          <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
            {moreTiles > 0 && `+${moreTiles} more ${moreTiles === 1 ? "tile" : "tiles"}`}
            {moreTiles > 0 && empty && " · "}
            {empty && <span style={{ color: "var(--color-warning)" }}>no value yet</span>}
          </span>
        )}
      </span>
      <NumericInput
        ref={inputRef}
        aria-label={`${number} ${condition}${certificate ? ` ${certificate}` : ""} catalog value`}
        value={amount}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder="—"
        autoComplete="off"
        style={{ ...INPUT_STYLE, width: "6.5rem", textAlign: "right" }}
      />
      {currency && <span style={{ ...MUTED, flexShrink: 0 }}>{currency}</span>}
    </div>
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
