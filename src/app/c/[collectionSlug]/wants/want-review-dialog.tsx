"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { DialogShell, DialogBody, DialogFooter, DialogSecondaryButton } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { ItemListItem } from "@/lib/items";
import type { LocationData } from "@/lib/locations";
import { formatItemNo } from "@/lib/item-number";
import { groupWantMatches, narrowConditionSeed, type ArrivingCopy } from "@/lib/want-rules";
import type { WantAcceptanceInput, WantListItem, WantMatchForCopy } from "@/lib/wants";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { StampIdentity } from "@/app/c/[collectionSlug]/shared/stamp-identity";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { WantAcceptanceFields } from "./want-acceptance-fields";
import { useInvalidateWants } from "./use-wants-query";

// The intake review (#532; ADR-0032 §7): the open wants the copies just taken in could satisfy,
// with **close / narrow / leave open** per want.
//
// Nothing here happens on its own. Auto-closing would silently discard a record of intent, and the
// common case — the want was "anything", a used copy arrived, so it becomes "any mint" — is a
// judgement the app cannot make, because nothing in the condition dictionary says which conditions
// are better. Dismissing the dialog leaves every want exactly as it was, which is why it closes with
// *Done* rather than with Cancel/Save: there is nothing staged to discard.

type RowState = "pending" | "closed" | "narrowed" | "left-open";

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  padding: "0.75rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const BUTTON: React.CSSProperties = {
  padding: "0.3125rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const MUTED: React.CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

/** The area path beside the wanted stamp, as the Stamps list draws it. */
const AREA_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "20rem",
  flexShrink: 0,
};

/** The matching copies under a want, drawn as the Copies list's own rows inside one frame. */
const COPY_ROWS: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  overflow: "hidden",
};

/** Wide enough for a copy row as the Copies list draws it (#1992) — the figure the sale-line
 *  dialog gives its copy rows. Narrower, a row's catalogue value and location wrap under its
 *  identity and the copies stop reading as a column. */
const DIALOG_WIDTH = "min(94vw, 78rem)";

/** Above this dialog's panel, so an acceptance menu opened inside it paints in front of it. */
const MENU_Z_INDEX = 200;

/** How many of a want's matching copies are named before the rest are counted — a bulk *Store* of
 *  a whole card can raise one want from dozens of copies, and the row is read, not scanned. */
const MATCHED_BY_NAMED = 5;

/** How a want reads in the review: what it will take, in the axis order the list row uses. An axis
 *  with nothing on it is stated as "any" rather than left out — a silent axis reads as a narrow
 *  one, which is the opposite of what an empty set means (ADR-0032 §1). */
function acceptanceSummary(
  want: WantListItem,
  name: {
    condition: (id: string) => string;
    certificate: (id: string | null) => string;
    format: (id: string | null) => string;
  }
): string {
  const conditions =
    want.conditionIds.length === 0
      ? "any condition"
      : want.conditionIds.map(name.condition).join(", ");
  const certificate =
    want.certificateStatusIds.length === 0
      ? "certificate: any"
      : want.certificateStatusIds.map(name.certificate).join(", ");
  const format =
    want.formatIds.length === 0 ? "any format" : want.formatIds.map(name.format).join(", ");
  return `Takes ${conditions} · ${certificate} · ${format}`;
}

export function WantReviewDialog({
  collectionId,
  areas,
  locations,
  baseCurrency,
  copies,
  matches,
  onClose,
}: {
  collectionId: string;
  /** For the wanted stamp's area path and catalogue numbers, and for the copy rows. */
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  /** The copies just taken in, so a want can be shown beside the copy that raised it. */
  copies: ArrivingCopy[];
  matches: WantMatchForCopy[];
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [narrowing, setNarrowing] = useState<Record<string, WantAcceptanceInput>>({});
  const [error, setError] = useState<string | undefined>();
  // An acceptance menu is a popover, not an escape layer (#361): while one is open this dialog must
  // stop dismissing itself, or one Escape closes both.
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: conditions } = useCollectionConditions(collectionId);
  const { data: certificateStatuses } = useCollectionCertificateStatuses(collectionId);
  const { data: formats } = useCollectionFormats(collectionId);
  const { invalidate } = useInvalidateWants();
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  // The list is refreshed once, on the way out: the wants screen may well be behind this dialog,
  // and a per-click invalidation would redraw it under the collector's hands.
  useEffect(
    () => () => {
      void invalidate(collectionId);
    },
    [collectionId, invalidate]
  );

  const copyByItemId = useMemo(() => new Map(copies.map((c) => [c.itemId, c])), [copies]);
  const conditionName = (id: string) => {
    const c = (conditions ?? []).find((x) => x.id === id);
    return c ? c.abbreviation || c.name : "?";
  };
  const axisNames = {
    condition: conditionName,
    // `null` is the axis's own "none" value, never "any" — see ADR-0032 §3.
    certificate: (id: string | null) =>
      id === null
        ? "no certificate"
        : ((certificateStatuses ?? []).find((c) => c.id === id)?.name ?? "?"),
    format: (id: string | null) =>
      id === null ? "single" : ((formats ?? []).find((f) => f.id === id)?.name ?? "?"),
  };

  /** One want may be raised by several arriving copies; it is asked once, naming them all (#1262). */
  const rows = useMemo(() => groupWantMatches(matches), [matches]);
  const matchedCopyCount = useMemo(() => new Set(matches.map((m) => m.itemId)).size, [matches]);

  // The matching copies as the Copies list knows them (#1992): the review is handed only what intake
  // created — an id, a number, a condition — and a copy row needs its picture, certificate and
  // location. Only the copies a row names are read. Until they arrive, and for one that does not,
  // the row falls back to naming the copy by number.
  const namedItemIds = useMemo(
    () => [...new Set(rows.flatMap((row) => row.itemIds.slice(0, MATCHED_BY_NAMED)))],
    [rows]
  );
  const { data: copyItems } = useQuery<ItemListItem[]>({
    queryKey: ["inventory", collectionId, "want-review", namedItemIds] as const,
    queryFn: async () => {
      const { getItemListItemsAction } = await import("@/app/actions/items");
      return getItemListItemsAction(collectionId, namedItemIds);
    },
    enabled: namedItemIds.length > 0,
  });
  const itemById = useMemo(
    () => new Map((copyItems ?? []).map((item) => [item.id, item])),
    [copyItems]
  );

  /** `#123 · U, #124 · U and 3 more` — each copy with the condition it arrived in. */
  function matchedBy(rowCopies: ArrivingCopy[]): string {
    const named = rowCopies
      .slice(0, MATCHED_BY_NAMED)
      .map((c) => `${formatItemNo(c.itemNo)} · ${conditionName(c.conditionId)}`)
      .join(", ");
    const rest = rowCopies.length - MATCHED_BY_NAMED;
    return rest > 0 ? `${named} and ${rest} more` : named;
  }

  function run(wantId: string, next: RowState, mutate: () => Promise<{ status: string; message?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await mutate();
      if (result.status === "success") {
        setStates((s) => ({ ...s, [wantId]: next }));
      } else {
        setError(result.message ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <DialogShell
      title={`${rows.length === 1 ? "A want" : "Wants"} ${matchedCopyCount === 1 ? "this copy" : "these copies"} could satisfy`}
      onClose={onClose}
      maxWidth={DIALOG_WIDTH}
      dismissable={!menuOpen}
    >
      <DialogBody>
        <p style={{ ...MUTED, margin: "0 0 1rem" }}>
          Nothing is closed automatically. Close a want that is now met, narrow one that is only
          partly met — a used copy against a want for “anything” leaves you looking for a mint one —
          or leave it open.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {rows.map(({ itemIds, want }) => {
            const rowCopies = itemIds.flatMap((id) => {
              const copy = copyByItemId.get(id);
              return copy ? [copy] : [];
            });
            const arrivedConditionIds = [...new Set(rowCopies.map((c) => c.conditionId))];
            const state = states[want.id] ?? "pending";
            const seed = narrowing[want.id];
            const copyRows = rowCopies
              .slice(0, MATCHED_BY_NAMED)
              .flatMap((c) => {
                const item = itemById.get(c.itemId);
                return item ? [item] : [];
              });
            const unshownCopies = rowCopies.length - copyRows.length;
            const areaPath = buildAreaPath(areas, want.areaId);
            const year = want.issueYear ?? want.issuedYear;
            const issueText = want.issueName
              ? year
                ? `${want.issueName} (${year})`
                : want.issueName
              : year
                ? String(year)
                : null;

            return (
              <div key={want.id} style={CARD}>
                {/* The wanted stamp as the Wants and Stamps lists draw it — picture, catalogue
                    numbers, area, issue and year. A stamp with no name of its own is read by its
                    catalogue number and its issue, both on the row, so nothing stands in for the
                    name: a placeholder there identifies nothing. */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
                  <PhotoThumb collectionId={collectionId} photos={want.photos} reserveWhenEmpty />
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.375rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <StampIdentity
                        stamp={{
                          name: want.stampName,
                          catalogNumbers: want.catalogNumbers,
                          colnectId: want.colnectId,
                          subtype: want.subtype,
                        }}
                        vendorMap={vendorMapFor(want.areaId, want.issueId)}
                        primaryVendorId={
                          want.areaId ? (primaryVendorByArea.get(want.areaId) ?? null) : null
                        }
                        size="small"
                        unnamed={want.catalogNumbers.length > 0 || issueText ? null : "(unnamed)"}
                      />
                      {want.unknownVariant && <span style={MUTED}>— any variant</span>}
                    </div>
                    {(areaPath || issueText) && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                        {areaPath && <span style={AREA_CHIP}>{areaPath}</span>}
                        {issueText && <span style={{ ...MUTED, fontSize: "0.75rem" }}>{issueText}</span>}
                      </div>
                    )}
                    <span style={MUTED}>{acceptanceSummary(want, axisNames)}</span>

                    {state === "closed" && (
                      <span style={{ fontSize: "0.8125rem", color: "var(--color-accent)" }}>
                        Closed. It stays on the list under <em>Closed</em>, and can be reopened.
                      </span>
                    )}
                    {state === "narrowed" && (
                      <span style={{ fontSize: "0.8125rem", color: "var(--color-accent)" }}>
                        Narrowed. The want stays open, now looking for something else.
                      </span>
                    )}
                    {state === "left-open" && <span style={MUTED}>Left open.</span>}

                    {state === "pending" && !seed && (
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          style={BUTTON}
                          disabled={isPending}
                          onClick={() =>
                            run(want.id, "closed", async () => {
                              const { closeWantAction } = await import("@/app/actions/wants");
                              return closeWantAction(want.id);
                            })
                          }
                        >
                          Close want
                        </button>
                        <button
                          type="button"
                          style={BUTTON}
                          disabled={isPending || rowCopies.length === 0}
                          onClick={() =>
                            rowCopies.length > 0 &&
                            setNarrowing((n) => ({
                              ...n,
                              [want.id]: {
                                // The one step that is certainly right: the conditions that just arrived
                                // are no longer wanted. Everything else is left for the collector.
                                conditionIds: narrowConditionSeed(
                                  (conditions ?? []).map((c) => c.id),
                                  arrivedConditionIds,
                                  want.conditionIds
                                ),
                                certificateStatusIds: want.certificateStatusIds,
                                formatIds: want.formatIds,
                              },
                            }))
                          }
                        >
                          Narrow it…
                        </button>
                        <button
                          type="button"
                          style={{ ...BUTTON, border: "none", background: "transparent", color: "var(--color-text-muted)" }}
                          disabled={isPending}
                          // Writes nothing — it only takes the row out of the way, which is the point:
                          // leaving a want open is the default, and saying so should cost one click,
                          // not a change to the record.
                          onClick={() => setStates((s) => ({ ...s, [want.id]: "left-open" }))}
                        >
                          Leave open
                        </button>
                      </div>
                    )}

                    {state === "pending" && seed && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <WantAcceptanceFields
                          collectionId={collectionId}
                          value={seed}
                          onChange={(next) => setNarrowing((n) => ({ ...n, [want.id]: next }))}
                          disabled={isPending}
                          menuZIndex={MENU_Z_INDEX}
                          onPopoverOpenChange={setMenuOpen}
                        />
                        <p style={{ ...MUTED, margin: 0 }}>
                          Suggested: everything except the{" "}
                          {arrivedConditionIds.length === 1 ? "condition" : "conditions"} that just
                          arrived. Nothing is saved until you press Save.
                        </p>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            type="button"
                            style={BUTTON}
                            disabled={isPending}
                            onClick={() =>
                              run(want.id, "narrowed", async () => {
                                const { narrowWantAction } = await import("@/app/actions/wants");
                                return narrowWantAction(want.id, seed);
                              })
                            }
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            style={{ ...BUTTON, border: "none", background: "transparent", color: "var(--color-text-muted)" }}
                            disabled={isPending}
                            onClick={() =>
                              setNarrowing((n) => {
                                const next = { ...n };
                                delete next[want.id];
                                return next;
                              })
                            }
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* The copies that raised it, each as its row on the Copies list — thumbnail,
                    number, condition, certificate, location. A copy is still named by number
                    while its row is read, and when more arrived than are drawn. */}
                {copyRows.length > 0 && (
                  <div style={COPY_ROWS}>
                    {copyRows.map((item, idx) => (
                      <InventoryItemRow
                        key={item.id}
                        collectionId={collectionId}
                        item={item}
                        areas={areas}
                        locations={locations}
                        baseCurrency={baseCurrency}
                        primaryVendorId={
                          item.areaId ? (primaryVendorByArea.get(item.areaId) ?? null) : null
                        }
                        vendorMap={vendorMapFor(item.areaId, item.issueId)}
                        isLast={idx === copyRows.length - 1}
                        readOnly
                      />
                    ))}
                  </div>
                )}
                {unshownCopies > 0 && (
                  <span style={MUTED}>
                    {copyRows.length > 0 ? "Also matched by " : "Matched by "}
                    {matchedBy(rowCopies.filter((c) => !copyRows.some((item) => item.id === c.itemId)))}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <p style={{ margin: "1rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Done
        </DialogSecondaryButton>
      </DialogFooter>
    </DialogShell>
  );
}
