"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  createChecklistAction,
  renameChecklistAction,
  deleteChecklistAction,
  reorderChecklistsAction,
  reorderChecklistStampsAction,
  setChecklistStampsAction,
  getSpanningChecklistOverviewAction,
  getRunChecklistAction,
  type ChecklistActionState,
} from "@/app/actions/checklists";
import { addAlbumEntryAction } from "@/app/actions/albums";
import type { SpanningChecklistOverview } from "@/lib/spanning-checklists";
import type { CollectionAreaData } from "@/lib/areas";
import type { AlbumSummary } from "@/lib/albums";
import type { TranslationValueMap } from "@/lib/translations";
import { moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
import { Icon } from "@/app/icons";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { StalePriceIcon } from "@/app/c/[collectionSlug]/shared/stale-price-icon";
import {
  PRICE_MAIN,
  PRICE_CONVERTED,
  SET_COMPLETENESS_CHIP,
  SET_COMPLETENESS_CHIP_COMPLETE,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import {
  useReorderList,
  InsertionLine,
  DragGrip,
  showLineAt,
  dragStyle,
} from "@/app/c/[collectionSlug]/shared/reorder-list";
import { ChecklistNameDialog } from "@/app/c/[collectionSlug]/shared/checklist-name-dialog";
import { ChecklistUsageNote } from "@/app/c/[collectionSlug]/shared/checklist-usage-note";
import { StampLabel } from "@/app/c/[collectionSlug]/shared/use-checklists-action";
import { ApplySizePresetDialog } from "@/app/c/[collectionSlug]/shared/apply-size-preset-dialog";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { useInvalidateStampsAndIssues } from "@/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues";
import { useIssuesMembers } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { issueLabel } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { AddIssueWantsDialog } from "@/app/c/[collectionSlug]/wants/use-add-issue-wants-action";

// The Checklists screen (#1416): the checklists that span issues, each with the figures an issue's
// checklist shows on its own page (#1278) — how complete, what it is worth — and the actions a
// checklist has elsewhere where they apply.
//
// Stamps are **added** from the Issues list's stamp selection (#808), which reaches every issue and
// area, and **ordered and taken off** here. That split is deliberate: picking needs the whole
// catalogue tree to browse, which the Issues list already is, while what is on the set is a flat
// list in its own order (#764) and belongs with the set.

const COUNT_TEXT: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const PRIMARY_BUTTON: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "var(--color-action-primary)",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  cursor: "pointer",
};

const LIST_STYLE: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  overflow: "hidden",
};

type Dialog =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "rename"; checklist: SpanningChecklistOverview }
  | { kind: "stamps"; checklist: SpanningChecklistOverview }
  | { kind: "wants"; checklist: SpanningChecklistOverview }
  | { kind: "album"; checklist: SpanningChecklistOverview }
  | { kind: "size"; checklist: SpanningChecklistOverview }
  | { kind: "delete"; checklist: SpanningChecklistOverview };

export function ChecklistsPanel({
  collectionId,
  collectionSlug,
  initialChecklists,
  areas,
  albums,
}: {
  collectionId: string;
  collectionSlug: string;
  initialChecklists: SpanningChecklistOverview[];
  areas: CollectionAreaData[];
  albums: AlbumSummary[];
}) {
  const queryClient = useQueryClient();
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [error, setError] = useState<string | undefined>();

  // Under the `checklists` prefix, beside the run picker's list of the same checklists (#1225), so
  // one invalidation after any write here — or after the Issues list's *Add to checklist…* — reaches
  // both.
  const { data: checklists = initialChecklists } = useQuery({
    queryKey: ["checklists", collectionId, "spanning-overview"] as const,
    queryFn: () => getSpanningChecklistOverviewAction(collectionId),
    initialData: initialChecklists,
    staleTime: 0,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["checklists", collectionId] });
    // A stamp's checklist membership rides on the Stamps list's rows and the Issues tree's bolding.
    void invalidateStampsAndIssues(collectionId);
    void queryClient.invalidateQueries({ queryKey: ["checklistPriceDetails", collectionId] });
  }

  function run(fn: () => Promise<ChecklistActionState>, onDone: () => void) {
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        setError(undefined);
        refresh();
        onDone();
      } else if (result.status === "error") {
        setError(result.message);
      }
    });
  }

  function close() {
    if (isPending) return;
    setDialog({ kind: "none" });
    setError(undefined);
  }

  // Order is the collector's, as an issue's checklists' is: it is the order the run picker offers
  // them in (#1225), and the order they are listed in here.
  function move(from: number, to: number) {
    const ids = checklists.map((c) => c.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    queryClient.setQueryData(
      ["checklists", collectionId, "spanning-overview"],
      ids.map((id) => checklists.find((c) => c.id === id)!)
    );
    run(() => reorderChecklistsAction(collectionId, null, ids), () => {});
  }
  const drag = useReorderList(checklists.length > 1 && !isPending, move, { handleOnly: true });

  function submitName(name: string, translations: TranslationValueMap) {
    const current = dialog;
    run(
      () =>
        current.kind === "rename"
          ? renameChecklistAction(current.checklist.id, name, translations)
          : createChecklistAction(collectionId, null, name, translations),
      () => setDialog({ kind: "none" })
    );
  }

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => {
            setError(undefined);
            setDialog({ kind: "add" });
          }}
          disabled={isPending}
          style={PRIMARY_BUTTON}
        >
          + New checklist
        </button>
      </div>

      {error && dialog.kind === "none" && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      {checklists.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No checklists spanning issues yet. Make one here, or tick stamps on the{" "}
          <Link href={`/c/${collectionSlug}/issues`} style={{ color: "var(--color-accent)" }}>
            Issues
          </Link>{" "}
          list and choose <strong>Add to checklist…</strong> to start one from them.
        </p>
      ) : (
        <div {...(drag?.containerProps ?? {})} style={LIST_STYLE}>
          {checklists.map((checklist, i) => (
            <div key={checklist.id}>
              {showLineAt(drag, i) && <InsertionLine />}
              <div
                {...(drag?.itemProps(i) ?? {})}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.625rem 0.875rem",
                  background: "var(--color-bg-elevated)",
                  borderBottom:
                    i < checklists.length - 1 ? "1px solid var(--color-border)" : "none",
                  ...dragStyle(drag, i),
                }}
              >
                {drag && (
                  <span {...drag.handleProps(i)}>
                    <DragGrip label="Reorder checklist" />
                  </span>
                )}
                <ChecklistRowBody checklist={checklist} />
                <RowActionsMenu
                  ariaLabel="Checklist actions"
                  actions={[
                    {
                      key: "stamps",
                      label: "Stamps and order…",
                      icon: "reorder",
                      onSelect: () => setDialog({ kind: "stamps", checklist }),
                    },
                    {
                      key: "wants",
                      label: "Add missing to want list…",
                      icon: "wants",
                      disabled: checklist.stampIds.length === 0,
                      hint: checklist.stampIds.length === 0 ? "This checklist has no stamps" : undefined,
                      onSelect: () => setDialog({ kind: "wants", checklist }),
                    },
                    {
                      key: "album",
                      label: "Add to album…",
                      icon: "albums",
                      disabled: albums.length === 0,
                      hint: albums.length === 0 ? "There are no albums yet" : undefined,
                      onSelect: () => setDialog({ kind: "album", checklist }),
                    },
                    {
                      key: "apply-size-preset",
                      label: "Apply size…",
                      icon: "sizePreset",
                      disabled: checklist.stampIds.length === 0,
                      hint: checklist.stampIds.length === 0 ? "This checklist has no stamps" : undefined,
                      onSelect: () => setDialog({ kind: "size", checklist }),
                    },
                    {
                      key: "rename",
                      label: "Rename…",
                      icon: "edit",
                      onSelect: () => setDialog({ kind: "rename", checklist }),
                    },
                    {
                      key: "delete",
                      label: "Delete",
                      icon: "delete",
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => setDialog({ kind: "delete", checklist }),
                    },
                  ]}
                />
              </div>
            </div>
          ))}
          {showLineAt(drag, checklists.length) && <InsertionLine />}
        </div>
      )}

      {(dialog.kind === "add" || dialog.kind === "rename") && (
        <ChecklistNameDialog
          collectionId={collectionId}
          title={dialog.kind === "add" ? "New checklist" : "Rename checklist"}
          initial={dialog.kind === "rename" ? dialog.checklist : undefined}
          siblings={checklists}
          siblingsLabel="among the checklists spanning issues"
          placeholder="e.g. Grosik 1928–1932, Birds, Castles definitives"
          isPending={isPending}
          error={error}
          onCancel={close}
          onSubmit={submitName}
        />
      )}

      {dialog.kind === "stamps" && (
        <SpanningStampsDialog
          collectionId={collectionId}
          areas={areas}
          checklist={dialog.checklist}
          isPending={isPending}
          error={error}
          onClose={close}
          onReorder={(stampIds) =>
            run(() => reorderChecklistStampsAction(dialog.checklist.id, stampIds), () => {})
          }
          onRemove={(stampIds) =>
            run(() => setChecklistStampsAction(dialog.checklist.id, stampIds), () => {})
          }
        />
      )}

      {dialog.kind === "wants" && (
        <AddIssueWantsDialog
          collectionId={collectionId}
          issueId={null}
          checklistId={dialog.checklist.id}
          onClose={() => {
            setDialog({ kind: "none" });
            refresh();
          }}
        />
      )}

      {dialog.kind === "album" && (
        <AddToAlbumDialog
          collectionSlug={collectionSlug}
          // The live row, so an album just added to reads as added.
          checklist={checklists.find((c) => c.id === dialog.checklist.id) ?? dialog.checklist}
          albums={albums}
          isPending={isPending}
          error={error}
          onClose={close}
          onAdd={(albumId) => run(() => addAlbumEntryAction(albumId, dialog.checklist.id), () => {})}
        />
      )}

      {dialog.kind === "size" && (
        <ApplySizePresetDialog
          scope={{
            collectionId,
            subject: { kind: "checklist", checklistId: dialog.checklist.id },
            subjectLabel: dialog.checklist.name,
          }}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete checklist"
          message={
            <>
              Delete <strong>{dialog.checklist.name}</strong>? Its stamps stay in their issues —
              only the goal they were a set for goes, along with its completeness figures.
              <ChecklistUsageNote checklistId={dialog.checklist.id} usage={dialog.checklist} />
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={close}
          onConfirm={() =>
            run(() => deleteChecklistAction(dialog.checklist.id), () => setDialog({ kind: "none" }))
          }
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

/**
 * A checklist's row: its name, how big it is and how many issues it reaches, then the issue page's
 * own two figures (#1278) — completeness by the grid's any × any cell, and the catalogue value with
 * its caveats — and the albums it is in.
 */
function ChecklistRowBody({ checklist }: { checklist: SpanningChecklistOverview }) {
  const count = checklist.stampIds.length;
  const { owned, completeSets } = checklist.completeness;
  const complete = count > 0 && owned === count;
  const total = checklist.priceTotal;
  return (
    <>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.1rem" }}>
        <span
          style={{
            fontSize: "0.9375rem",
            fontWeight: 500,
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {checklist.name}
        </span>
        <span style={COUNT_TEXT}>
          {count} stamp{count !== 1 ? "s" : ""}
          {checklist.issueCount > 0 &&
            ` · from ${checklist.issueCount} issue${checklist.issueCount !== 1 ? "s" : ""}`}
          {checklist.albums.length > 0 && (
            <Tooltip content={`In ${checklist.albums.map((a) => a.name).join(", ")}.`}>
              <span>
                {" · "}in {checklist.albums.length} album{checklist.albums.length !== 1 ? "s" : ""}
              </span>
            </Tooltip>
          )}
        </span>
      </span>
      {count > 0 && (
        <Tooltip
          content={`${owned} of ${count} stamps held, in any disposition and condition · ${completeSets} complete ${
            completeSets === 1 ? "set" : "sets"
          }.`}
        >
          <span style={complete ? SET_COMPLETENESS_CHIP_COMPLETE : SET_COMPLETENESS_CHIP}>
            {complete && <Icon name="check" size="sm" style={{ marginRight: "0.2rem" }} />}
            {owned}/{count}
            {completeSets > 0 && ` ×${completeSets}`}
          </span>
        </Tooltip>
      )}
      {total && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <span style={PRICE_MAIN}>{moneyPrimaryText(total)}</span>
          {moneySecondaryText(total) && (
            <span style={PRICE_CONVERTED}>{moneySecondaryText(total)}</span>
          )}
          {checklist.priceStale && <StalePriceIcon />}
          <Tooltip
            content={`${total.pricedCount} of ${total.requiredCount} stamps on this checklist are priced, each on its own area's leading catalogue${
              total.estimatedCount
                ? `; ${total.estimatedCount} rolled up from a variant child (estimate)`
                : ""
            }.`}
          >
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              {total.pricedCount}/{total.requiredCount} priced
            </span>
          </Tooltip>
        </span>
      )}
    </>
  );
}

/**
 * What is on one checklist, in the order it reads (#764) — dragged into shape, or taken off.
 *
 * Each stamp is named as its own issue's rows name it: its catalogue numbers through its area and
 * issue (#377), then the issue it belongs to, since a set spanning issues is read by knowing where
 * each piece comes from. The stamps and the issues come from the run reader (#1225), which already
 * answers *which issues does this checklist reach*.
 *
 * Every drop and every removal **saves**, as the issue editor's order list does: a drag is a gesture,
 * not a form. Adding is not here — that is the Issues list's selection (#808).
 */
function SpanningStampsDialog({
  collectionId,
  areas,
  checklist,
  isPending,
  error,
  onClose,
  onReorder,
  onRemove,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  checklist: SpanningChecklistOverview;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onReorder: (stampIds: string[]) => void;
  /** The stamps that stay. */
  onRemove: (remaining: string[]) => void;
}) {
  const { vendorMapFor, primaryVendorByArea } = useAreaVendorMaps(areas, collectionId);
  const [order, setOrder] = useState<string[]>(checklist.stampIds);
  const { data: reach } = useQuery({
    queryKey: ["checklists", collectionId, "reach", checklist.id] as const,
    queryFn: () => getRunChecklistAction(collectionId, checklist.id),
  });
  const issues = useMemo(() => reach?.issues ?? [], [reach]);
  const { members, isLoading } = useIssuesMembers(
    collectionId,
    issues.map((i) => i.id)
  );
  // Each stamp's node and the issue it is read through — the first issue, in the reader's order,
  // that holds it.
  const byStamp = useMemo(() => {
    const out = new Map<
      string,
      { node: (typeof members)[number]["members"][number]; issue: (typeof issues)[number] }
    >();
    for (const { issueId, members: nodes } of members) {
      const issue = issues.find((i) => i.id === issueId);
      if (!issue) continue;
      for (const node of nodes) if (!out.has(node.stampId)) out.set(node.stampId, { node, issue });
    }
    return out;
  }, [members, issues]);

  function move(from: number, to: number) {
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    onReorder(next);
  }
  const drag = useReorderList(order.length > 1 && !isPending, move, { handleOnly: true });

  function remove(stampId: string) {
    const next = order.filter((id) => id !== stampId);
    setOrder(next);
    onRemove(next);
  }

  return (
    <DialogShell
      title={`Stamps on “${checklist.name}”`}
      onClose={() => {
        if (!isPending) onClose();
      }}
      maxWidth="min(96vw, 44rem)"
    >
      <DialogBody>
        <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", margin: "0 0 0.75rem" }}>
          Drag the ⠿ grip to say what order this set reads in — every screen that lists it, and an
          album printing it, follows. To add stamps, tick them on the Issues list and choose{" "}
          <strong>Add to checklist…</strong>.
        </p>

        {order.length === 0 ? (
          <p style={{ fontSize: "0.9375rem", color: "var(--color-text-muted)" }}>
            Nothing on this checklist yet.
          </p>
        ) : isLoading || !reach ? (
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading stamps…</p>
        ) : (
          <div {...(drag?.containerProps ?? {})} style={LIST_STYLE}>
            {order.map((stampId, i) => {
              const found = byStamp.get(stampId);
              return (
                <div key={stampId}>
                  {showLineAt(drag, i) && <InsertionLine />}
                  <div
                    {...(drag?.itemProps(i) ?? {})}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                      padding: "0.4rem 0.75rem",
                      background: "var(--color-bg-elevated)",
                      borderTop: i > 0 ? "1px solid var(--color-border)" : "none",
                      fontSize: "0.875rem",
                      ...dragStyle(drag, i),
                    }}
                  >
                    {drag && (
                      <span {...drag.handleProps(i)}>
                        <DragGrip label="Reorder stamp" />
                      </span>
                    )}
                    <span style={{ ...COUNT_TEXT, minWidth: "1.75rem", textAlign: "right" }}>
                      {i + 1}
                    </span>
                    {found ? (
                      <>
                        <StampLabel
                          stamp={found.node}
                          vendorMap={vendorMapFor(found.issue.collectionAreaId, found.issue.id)}
                          primaryVendorId={
                            primaryVendorByArea.get(found.issue.collectionAreaId) ?? null
                          }
                        />
                        <span
                          style={{
                            ...COUNT_TEXT,
                            maxWidth: "14rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {issueLabel(found.issue.name, found.issue.year)}
                        </span>
                      </>
                    ) : (
                      // A stamp on no issue still has its place in the set; it keeps its row.
                      <span style={{ flex: 1, color: "var(--color-text-muted)" }}>
                        (a stamp on no issue)
                      </span>
                    )}
                    <Tooltip content="Take this stamp off the checklist. It stays in its issue.">
                      <button
                        type="button"
                        aria-label="Take off the checklist"
                        onClick={() => remove(stampId)}
                        disabled={isPending}
                        style={{
                          display: "inline-flex",
                          padding: "0.2rem",
                          border: "none",
                          background: "transparent",
                          color: "var(--color-text-muted)",
                          cursor: isPending ? "default" : "pointer",
                        }}
                      >
                        <Icon name="remove" size="sm" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
            {showLineAt(drag, order.length) && <InsertionLine />}
          </div>
        )}

        {error && (
          <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginTop: "0.75rem" }}>
            {error}
          </p>
        )}
      </DialogBody>
      {/* One button: each drop and each removal is already saved. */}
      <DialogFooter>
        <DialogPrimaryButton type="button" onClick={onClose} disabled={isPending}>
          Done
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>
  );
}

/**
 * Put a checklist into an album by hand (#767) — the only way one spanning issues gets into an album,
 * since it has no area for the album to gather it from. The albums it is already in say so rather
 * than offering a second card for the same set.
 */
function AddToAlbumDialog({
  collectionSlug,
  checklist,
  albums,
  isPending,
  error,
  onClose,
  onAdd,
}: {
  collectionSlug: string;
  checklist: SpanningChecklistOverview;
  albums: AlbumSummary[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onAdd: (albumId: string) => void;
}) {
  const inAlbum = new Set(checklist.albums.map((a) => a.id));
  return (
    <DialogShell
      title={`Add “${checklist.name}” to an album`}
      onClose={() => {
        if (!isPending) onClose();
      }}
      maxWidth="min(96vw, 34rem)"
    >
      <DialogBody>
        <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", margin: "0 0 0.75rem" }}>
          An album gathers the checklists of its own area. A checklist spanning issues has no area,
          so it joins an album only when added here — as one card, at the end of the album, to be
          moved from there.
        </p>
        <div style={LIST_STYLE}>
          {albums.map((album, i) => {
            const already = inAlbum.has(album.id);
            return (
              <div
                key={album.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.5rem 0.875rem",
                  background: "var(--color-bg-elevated)",
                  borderTop: i > 0 ? "1px solid var(--color-border)" : "none",
                }}
              >
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <Link
                    href={`/c/${collectionSlug}/albums/${album.id}`}
                    style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}
                  >
                    {album.name}
                  </Link>
                  <span style={COUNT_TEXT}>{album.areaName}</span>
                </span>
                {already ? (
                  <span style={{ ...COUNT_TEXT, display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                    <Icon name="check" size="sm" /> In this album
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAdd(album.id)}
                    disabled={isPending}
                    style={{ ...PRIMARY_BUTTON, padding: "0.3rem 0.75rem", fontSize: "0.8125rem" }}
                  >
                    Add
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {error && (
          <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginTop: "0.75rem" }}>
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogPrimaryButton type="button" onClick={onClose} disabled={isPending}>
          Done
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>
  );
}
