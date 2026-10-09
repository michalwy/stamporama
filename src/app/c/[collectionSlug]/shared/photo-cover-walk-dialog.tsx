"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  ConfirmDialog,
  DIALOG_MAX_HEIGHT,
  DIALOG_MAX_WIDTH,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { photoFullUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { Tooltip } from "./tooltip";
import {
  carryAfterSave,
  NO_CARRIED_COVERS,
  proposedCovers,
  type CarriedCovers,
  type PhotoCover,
  type PhotoCoverStyle,
} from "@/lib/photo-cover-rules";
import { PhotoCoverEditor } from "./photo-cover-editor";
import { usePersistedFlag } from "./use-persisted-flag";

// The walk through photos to cover symbols on (#1665; ADR-0066): one photo at a time, as large as the
// window allows, the next one coming with Enter. Saving a photo — with covers, or with none, which is
// *nothing to cover* — marks it checked, so it is never asked about again.
//
// It walks a list it was handed and keeps that list for as long as it is open: a photo saved here
// stays in the walk (← goes back to it), rather than vanishing from under the counter the moment the
// plan is refetched.
//
// An offer's walk can also mark what is left *nothing to cover* in one action (#1701) — the rest of
// the current copy's photos, or every remaining one — for material that certainly shows nothing to
// hide. It is the same record as pressing *Nothing to cover* on each, so nothing is lost by it: a
// photo marked so can be revisited and given covers like any other.
//
// An offer's walk also carries covers on (#1703): listing a series, the symbols sit in the same
// places on every stamp, so the covers last saved on a front are proposed on the next unchecked
// front, and a back's on the next back. They are only proposed — shown as such, editable, and saved
// by moving on with Enter like anything drawn; Skip, Previous or closing leaves the photo unchecked.
// *Carry covers to the next photo* turns it off, remembered on this browser.

/** Where *Carry covers to the next photo* is remembered (#1703). */
const CARRY_COVERS_KEY = "stamporama:carry-photo-covers";

export interface CoverWalkEntry {
  photoId: string;
  /** The copy the photo belongs to — what *the rest of this copy* means (#1701). */
  itemId?: string;
  /** What the photo is of — the copy, and which side. */
  label: string;
  /** The side, which is where carried covers come from (#1703); null for an extra. */
  side?: "front" | "back" | null;
  checked: boolean;
  covers: PhotoCover[];
}

/** Marks unchecked photos *nothing to cover* (#1701): the copy's with an `itemId`, else every one
 *  remaining. Answers the ids it marked, or why it could not. */
export type MarkNothingToCover = (
  itemId: string | null
) => Promise<{ photoIds: string[] } | { error: string }>;

/** What *Nothing to cover on the remaining N photos* reads (#1701), on the offer and in the walk. */
export function nothingToCoverLabel(count: number, scope: "copy" | "all"): string {
  const photos = count === 1 ? "photo" : `${count} photos`;
  return scope === "copy"
    ? `Nothing to cover on this copy's remaining ${photos}`
    : `Nothing to cover on the remaining ${photos}`;
}

/** The one confirmation before photos are marked *nothing to cover* in bulk (#1701), naming the
 *  count — a cover skipped this way is a symbol left showing on a platform that objects to it. */
export function NothingToCoverConfirm({
  count,
  scope,
  isPending,
  error,
  zIndexBase,
  onConfirm,
  onClose,
}: {
  count: number;
  scope: "copy" | "all";
  isPending: boolean;
  error?: string;
  zIndexBase?: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const photos = count === 1 ? "1 photo" : `${count} photos`;
  const which = scope === "copy" ? `this copy's remaining ${photos}` : `the remaining ${photos}`;
  return (
    <ConfirmDialog
      title="Nothing to cover"
      message={
        <>
          Mark {which} as having nothing to cover, without looking at {count === 1 ? "it" : "each"}?
          Photos with covers keep them. Any photo can still be given covers later, from the
          offer&apos;s photos or the copy&apos;s page.
        </>
      }
      actionLabel={`Mark ${photos}`}
      pendingLabel="Marking…"
      variant="primary"
      isPending={isPending}
      error={error}
      zIndexBase={zIndexBase}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

export function PhotoCoverWalkDialog({
  collectionId,
  title,
  photos,
  defaultStyle,
  startIndex = 0,
  footerNote,
  onMarkNothingToCover,
  carryCovers = false,
  onSaved,
  onClose,
}: {
  collectionId: string;
  title: string;
  photos: CoverWalkEntry[];
  defaultStyle: PhotoCoverStyle;
  startIndex?: number;
  /** Something the caller says beside the buttons — the offer's *regenerate when done*. */
  footerNote?: ReactNode;
  /** Offered by an offer's walk (#1701): marking what is left *nothing to cover* in one action. */
  onMarkNothingToCover?: MarkNothingToCover;
  /** Offered by an offer's walk (#1703): covers saved on one photo proposed on the next of its side. */
  carryCovers?: boolean;
  /** After every save, so the caller can pick up the counts it shows. */
  onSaved?: () => void;
  /** `changed` is whether anything was saved while the walk was open. */
  onClose: (changed: boolean) => void;
}) {
  const [index, setIndex] = useState(() => Math.min(startIndex, Math.max(0, photos.length - 1)));
  const [entries, setEntries] = useState(photos);
  const entry = entries[index] ?? null;
  const [covers, setCovers] = useState<PhotoCover[]>(entry?.covers ?? []);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [changed, setChanged] = useState(false);
  const [isPending, startTransition] = useTransition();
  const primaryRef = useRef<HTMLButtonElement>(null);
  // The bulk *nothing to cover* waiting on its confirmation (#1701).
  const [bulk, setBulk] = useState<"copy" | "all" | null>(null);
  const [bulkError, setBulkError] = useState<string | undefined>();
  // What each side passes on, and whether the covers shown are a proposal not yet saved (#1703).
  const [carryOn, setCarryOn] = usePersistedFlag(CARRY_COVERS_KEY, true);
  const carrying = carryCovers && carryOn;
  const [carried, setCarried] = useState<CarriedCovers>(NO_CARRIED_COVERS);
  const [proposed, setProposed] = useState(false);

  const left = entries.filter((e) => !e.checked).length;
  const last = index >= entries.length - 1;
  // This copy's unchecked photos, the current one included. Offered apart from *all remaining* only
  // when the two would mark different photos.
  const copyLeft =
    entry?.itemId != null ? entries.filter((e) => !e.checked && e.itemId === entry.itemId).length : 0;

  /** Move to another photo, starting from what is stored for it, or from the covers its side carries
   *  when it is still unchecked — `from` and `carry` are the list and the carried covers to read,
   *  which a save has just updated. */
  const go = (next: number, from = entries, carry = carried) => {
    if (next < 0 || next >= from.length) return;
    const proposal = carrying ? proposedCovers(carry, from[next]) : null;
    setIndex(next);
    setCovers(proposal ?? from[next].covers);
    setProposed(proposal != null);
    setDirty(false);
    setError(undefined);
  };

  /** *Carry covers to the next photo* switched: the photo on screen gains or loses its proposal,
   *  unless the collector has already worked on what is drawn. */
  const switchCarry = (next: boolean) => {
    setCarryOn(next);
    if (!entry || dirty) return;
    if (!next && proposed) {
      setCovers(entry.covers);
      setProposed(false);
    } else if (next && covers.length === 0) {
      const proposal = proposedCovers(carried, entry);
      if (proposal) {
        setCovers(proposal);
        setProposed(true);
      }
    }
  };

  const save = () => {
    if (!entry || isPending) return;
    setError(undefined);
    startTransition(async () => {
      const { savePhotoCoversAction } = await import("@/app/actions/photo-covers");
      const result = await savePhotoCoversAction(entry.photoId, covers);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setChanged(true);
      const updated = entries.map((e) =>
        e.photoId === entry.photoId ? { ...e, checked: true, covers: result.state.covers } : e
      );
      setEntries(updated);
      // Kept whether or not carrying is on, so switching it on mid-walk proposes what was just used.
      const carry = carryAfterSave(carried, entry.side, result.state.covers);
      setCarried(carry);
      setDirty(false);
      onSaved?.();
      if (last) onClose(true);
      else go(index + 1, updated, carry);
    });
  };

  const markBulk = () => {
    if (!bulk || !onMarkNothingToCover || isPending) return;
    const scope = bulk;
    setBulkError(undefined);
    startTransition(async () => {
      const result = await onMarkNothingToCover(scope === "copy" ? (entry?.itemId ?? null) : null);
      if ("error" in result) {
        setBulkError(result.error);
        return;
      }
      const marked = new Set(result.photoIds);
      const updated = entries.map((e) => (marked.has(e.photoId) ? { ...e, checked: true, covers: [] } : e));
      setEntries(updated);
      setBulk(null);
      // The photos just marked are *nothing to cover*, and pass nothing on (#1703).
      setCarried(NO_CARRIED_COVERS);
      onSaved?.();
      // Nothing left to check closes the walk; otherwise it goes on from the next photo still
      // unchecked. Nothing drawn changed, so the images need no regenerating on its account.
      const next = [...updated.slice(index + 1), ...updated.slice(0, index + 1)].find((e) => !e.checked);
      if (!next) onClose(changed);
      else go(updated.indexOf(next), updated, NO_CARRIED_COVERS);
    });
  };

  // Enter saves and moves on; ← / → step without saving, while nothing is drawn but unsaved. Not
  // while the bulk confirmation is open — that is a dialog of its own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (bulk) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "SELECT" || target.tagName === "INPUT")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (e.key === "ArrowLeft" && !dirty) {
        go(index - 1);
      } else if (e.key === "ArrowRight" && !dirty) {
        go(index + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const primaryLabel = `${covers.length === 0 ? "Nothing to cover" : proposed ? "Accept covers" : "Save covers"}${last ? "" : " & next"}`;

  return (
    <>
      <DialogShell
        title={title}
        onClose={() => !isPending && onClose(changed)}
        maxWidth={DIALOG_MAX_WIDTH}
        height={DIALOG_MAX_HEIGHT}
        zIndexBase={300}
      >
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "0.5rem", padding: "1rem 1.5rem 0.5rem" }}>
          {entry ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", fontSize: "0.875rem" }}>
                <strong style={{ color: "var(--color-text-primary)" }}>{entry.label}</strong>
                {entry.checked && (
                  <span style={{ fontSize: "0.75rem", color: "var(--color-success)" }}>
                    {entry.covers.length === 0 ? "✓ nothing to cover" : `✓ ${entry.covers.length} covered`}
                  </span>
                )}
                {proposed && covers.length > 0 && (
                  <span style={{ fontSize: "0.75rem", color: "var(--color-info)" }}>
                    Proposed from the previous {entry.side} — correct them, Enter accepts
                  </span>
                )}
                <span style={{ marginLeft: "auto", color: "var(--color-text-muted)" }}>
                  Photo {index + 1} of {entries.length} · {left === 0 ? "all checked" : `${left} left to check`}
                </span>
                {carryCovers && (
                  <Tooltip content="Propose the covers just saved on a front to the next unchecked front, and a back's to the next back">
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", color: "var(--color-text-secondary)" }}>
                      <input type="checkbox" checked={carryOn} onChange={(e) => switchCarry(e.target.checked)} />
                      Carry covers to the next photo
                    </label>
                  </Tooltip>
                )}
              </div>
              <PhotoCoverEditor
                key={entry.photoId}
                src={photoFullUrl(collectionId, entry.photoId)}
                covers={covers}
                defaultStyle={defaultStyle}
                disabled={isPending}
                onChange={(next) => {
                  setCovers(next);
                  setDirty(true);
                  // Cleared, a proposal is no longer one: what is left is the collector's empty photo.
                  if (next.length === 0) setProposed(false);
                }}
              />
            </>
          ) : (
            <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>No photos to check.</p>
          )}
        </div>
        <DialogFooter error={error}>
          {footerNote && <span style={{ marginRight: "auto", fontSize: "0.8125rem" }}>{footerNote}</span>}
          {onMarkNothingToCover && copyLeft > 0 && copyLeft < left && (
            <DialogSecondaryButton disabled={isPending || dirty} onClick={() => setBulk("copy")}>
              {nothingToCoverLabel(copyLeft, "copy")}
            </DialogSecondaryButton>
          )}
          {onMarkNothingToCover && left > 0 && (
            <DialogSecondaryButton disabled={isPending || dirty} onClick={() => setBulk("all")}>
              {nothingToCoverLabel(left, "all")}
            </DialogSecondaryButton>
          )}
          <DialogSecondaryButton disabled={isPending || index === 0} onClick={() => go(index - 1)}>
            ← Previous
          </DialogSecondaryButton>
          <DialogSecondaryButton disabled={isPending || last} onClick={() => go(index + 1)}>
            Skip →
          </DialogSecondaryButton>
          <DialogPrimaryButton ref={primaryRef} type="button" disabled={isPending || !entry} onClick={save}>
            {isPending ? "Saving…" : `${primaryLabel} ⏎`}
          </DialogPrimaryButton>
        </DialogFooter>
      </DialogShell>
      {bulk && (
        <NothingToCoverConfirm
          count={bulk === "copy" ? copyLeft : left}
          scope={bulk}
          isPending={isPending}
          error={bulkError}
          zIndexBase={400}
          onConfirm={markBulk}
          onClose={() => {
            if (isPending) return;
            setBulk(null);
            setBulkError(undefined);
          }}
        />
      )}
    </>
  );
}
