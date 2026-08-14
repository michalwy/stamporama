"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/app/icons";
import {
  DialogActions,
  DialogFooter,
  DialogLinkButton,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import {
  assignTileAction,
  discardTileAction,
  noteTileAction,
  undiscardTileAction,
} from "@/app/actions/scans";
import { formatItemNo } from "@/lib/item-number";
import type { ItemListItem } from "@/lib/items";
import type { ScanTileData } from "@/lib/scan-sheets";
import { tileSideViews, type TileSheetRef, type TileSideView } from "@/lib/scan-tile-view";
import { tilePhotoRoles, describeFreeSlots, type TilePhotoRole } from "@/lib/tile-photo-roles";
import { TileZoomView } from "./tile-zoom-view";
import { usePurchaseCopiesInfinite, type LotCopiesParams } from "./use-lot-copies-query";

/**
 * One tile, and the three ends it can reach (#567).
 *
 * **The tile is the dialog** (#585), not a thumbnail above the controls: a picture large enough to
 * be zoomed and panned, with the outcome beside it. That is the dialog's entire reason for
 * existing — the intake step that follows never shows the images, and a crop that took half a stamp
 * or a piece nobody could identify is only visible at this size. Since #585 it answers the harder
 * question too: at 1200 dpi the perforations, the watermark and the plate flaw are already in the
 * tile's own photo, so telling two variants apart is a pass at the keyboard rather than one under a
 * loupe. `tile-zoom-view.tsx` is the picture and `scan-viewport.ts` all of its arithmetic — this
 * file only decides what is *asked* about the tile.
 *
 * So the dialog **opens on an outcome, never on a menu of them**, and which one is *derived from
 * whether there is anything **this tile** can be assigned to* — not from where the order came from.
 * The candidate list is copies holding none of the roles the tile carries, so a non-empty one means
 * assigning is genuinely available: every line of a freshly settled auction sale, the handful of
 * hand-entered copies on a stockbook order, and nothing at all once they have been photographed.
 * That is right in both places the `fromAuction` flag was wrong — an auction order whose lines are
 * already photographed goes straight to identify, and a stockbook order with two hand-entered
 * copies offers them. The list is empty more often than a looser one would be, and lands on
 * identify more often as a result; that is the correct answer, not a reason to loosen it.
 *
 * Since #586 the list is the whole **order's** copies rather than one lot's, which is the point of
 * that move rather than a side effect: at a settlement the copies waiting for photographs are every
 * line of every won lot, they arrive in one envelope, and they are scanned on one card. Assigning
 * therefore asks nothing about lots — the copy already has one. Only *identify as a new copy* does,
 * and that question is asked one screen on, where every other intake answer is.
 *
 * The other two answers sit in the footer, one click from wherever it opened. A chooser standing in
 * front of them would be a screen whose whole content is three buttons, and a card of forty would
 * mean forty of them showing nothing.
 *
 * The candidate query is keyed by the order **and the slots asked for**, so a card of like tiles —
 * the ordinary case — is one fetch, served from cache for every tile after the first. The dialog
 * therefore **settles once and never jumps**: on the first tile it waits for the answer rather than
 * opening on identify and switching under the collector's hand when the list arrives.
 *
 * **Discard acts immediately**, with no note asked for. On a parcel full of junk it is the frequent
 * answer, and it is safe to make it cheap precisely because it is reversible — *Put back in the
 * queue* is right there, and the note can be written afterwards on the rare tile that earns one.
 *
 * **All three states open this dialog, and none of them navigates on the click itself** (#584). A
 * consumed tile used to be an `<a>` straight to its copy, which left the tile itself impossible to
 * inspect — which batch, which position, what it became — and threw the collector out of the
 * purchase mid-pass, when a card of forty is being worked in one sitting and getting back is most
 * expensive. So it settles here like a discard does, showing the copy it became, and *Open copy* is
 * a deliberate action in the footer: leaving is a choice, never a side effect of looking at a tile.
 */

interface Props {
  collectionId: string;
  purchaseId: string;
  tile: ScanTileData;
  /** The batch's two scans, for the deeper look past the tile photo's own resolution (#585). A
   * missing or swept sheet (#578) is not an error here — it is the absence of a second source, and
   * the tile's photo carries the pass on its own. */
  sheets: { front: TileSheetRef | null; back: TileSheetRef | null };
  /** Whether **any** lot of this order is still open (#586). A closed lot takes no new copies (its
   * pool has been split across the copies it had), but a photograph is not money — assigning and
   * discarding stay. Which lot the new copy goes onto is asked at the condition step, so all this
   * decides is whether creating one is possible at all. */
  canIdentify: boolean;
  /** Whether this order was settled from a won auction sale. Used **only to word** the assign
   * list's explanation — that those copies are the lines that were described in order to bid.
   * It decides nothing, which was always its real job. */
  fromAuction: boolean;
  /** Where the copy a consumed tile became lives (#584). Null for every other state, and for a
   * consumed tile whose copy has since been deleted — there is nothing to open. */
  copyHref: string | null;
  /**
   * *Identify as a new copy*, carrying **the sides this dialog is already showing** (#592). The
   * chain that follows — picker, sometimes a create-issue and a create-stamp dialog, then the
   * condition step — keeps the piece on screen throughout, and `tileSideViews` has already answered
   * which sides there are and which still have a retained card behind them. Handing that answer on
   * rather than a tile id keeps it computed once, where the batch's sheets are in hand.
   */
  onIdentifyNew: (sides: TileSideView[]) => void;
  /**
   * An outcome was written. `touchedCopy` says whether a **copy** changed, which decides what has to
   * be re-read: assigning gives a copy the tile's photos, so the copies list is stale; discarding
   * touches no copy at all, so invalidating them would be re-fetching a lot's whole copy list to
   * learn that nothing about it moved.
   */
  onDone: (touchedCopy: boolean) => void;
  onClose: () => void;
}

/** The outcome the dialog is *showing*. Discard is not one of them — it is a button that acts. */
type Mode = "identify" | "assign";

/**
 * How long the candidate list stays fresh, so tile after tile opens from cache instead of pausing
 * on a refetch the latch below would wait for.
 *
 * Short on purpose. Every write **on this screen** invalidates the namespace and so beats this
 * outright (`isInvalidated` short-circuits ahead of `staleTime`) — intake, attach, assign, removing
 * a copy. What does not reach it is a photo added to one of these copies from the *Copies* screen,
 * since nothing there invalidates `lot-copies`. Half a minute keeps a card's tiles instant while
 * bounding that window to something shorter than walking between two screens; the cost of being
 * wrong is one candidate offered that the write then refuses by name, or one missing that a reopen
 * brings back.
 */
const ASSIGN_LIST_STALE_MS = 30 * 1000;

/**
 * The copies a tile could be assigned to: this **order's**, holding **none of the roles this tile
 * carries**.
 *
 * Derived from the tile rather than restated, and it is the same question `assignTileToCopy` asks
 * before it refuses (`tile-photo-roles.ts` owns the comparison). A list that offers what the write
 * refuses is the defect: asking the weaker *"has any free slot"* offered a front-only tile copies
 * that merely lacked a back, and picking one failed.
 *
 * Not `no-photos` either, which is a different and wrong set — a copy with a back and no front can
 * take a front-only tile, and `no-photos` would hide it.
 *
 * The params object is what the query is keyed by, so tiles needing the same slots — a whole card of
 * front-only tiles, the ordinary case — share one fetch, and a tile needing different slots gets its
 * own list rather than a wrongly cached one.
 */
function assignParams(tile: ScanTileData): LotCopiesParams {
  return {
    sort: "catalog",
    sortDir: "asc",
    freePhotoSlots: tilePhotoRoles(tile),
  };
}

export function TileIdentifyDialog({
  collectionId,
  purchaseId,
  tile,
  sheets,
  canIdentify,
  fromAuction,
  copyHref,
  onIdentifyNew,
  onDone,
  onClose,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const settled = tile.state !== "unidentified";

  /** The sides there are to look at, and which of them still have a retained scan behind them.
   * Decided in a pure module, so a swept batch (#578) is a case a unit test reaches rather than one
   * that first runs on a collector's screen. */
  const viewSides = tileSideViews(tile, sheets);

  // Lifted out of the assign list, because *whether the list holds anything* is what chooses the
  // opening mode. TanStack hashes the key structurally, so rebuilding the params per render is
  // free: two tiles needing the same slots hash to the same key and share one fetch.
  //
  // The `staleTime` is what keeps that true now the latch below waits for a fetch to finish: at the
  // screen's default of 0 the cached answer is stale the instant it arrives, so every tile of a card
  // would re-ask and wait on it.
  const roles = tilePhotoRoles(tile);
  const copies = usePurchaseCopiesInfinite(
    collectionId,
    purchaseId,
    assignParams(tile),
    !settled,
    ASSIGN_LIST_STALE_MS
  );
  const candidates = copies.data?.pages.flatMap((p) => p.items) ?? [];

  // Latched, never re-derived: the query could refetch and answer differently, and a dialog that
  // changed mode under the collector's hand mid-tile is exactly what waiting for the first answer
  // exists to avoid. A query error latches as "nothing to assign to", which is the safe reading.
  //
  // **`isFetching`, not just `isPending`.** A closed dialog leaves an *inactive* query, and
  // invalidating one only marks it stale — nothing refetches until an observer mounts again. So
  // reopening the dialog after copies were added elsewhere ("Add stamps") hands this render the old
  // answer with `isPending` already false, and latching there pinned the mode to the state of the
  // lot before those copies existed: the list stayed empty until a full page reload. Waiting for the
  // refetch that the mount itself kicks off is what makes the answer current.
  //
  // Race-free rather than hopefully-ordered: the observer computes its optimistic result with
  // `fetchState` applied whenever it will fetch on mount, so `isFetching` is already true on the
  // first render after an invalidation — never briefly false with stale data in hand.
  const [mode, setMode] = useState<Mode | null>(null);
  if (mode === null && !copies.isPending && !copies.isFetching) {
    setMode(candidates.length > 0 ? "assign" : "identify");
  }

  /** `touchedCopy` rides with each call rather than being inferred afterwards: the action itself is
   *  the only thing that knows whether a copy changed hands. */
  const run = (
    fn: () => Promise<{ status: string; message?: string }>,
    touchedCopy: boolean
  ) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "error") setError(result.message ?? "That did not work.");
      else onDone(touchedCopy);
    });
  };

  const discard = (
    <DialogSecondaryButton
      // A discard changes the tile and nothing else — its images stay where they are.
      onClick={() => run(() => discardTileAction(tile.id, ""), false)}
      disabled={pending}
    >
      <Icon name="delete" size="sm" /> {pending ? "Working…" : "Discard"}
    </DialogSecondaryButton>
  );

  return (
    <DialogShell
      title={`Tile ${tile.position + 1}`}
      onClose={onClose}
      // Sized for the picture rather than for the text beside it, and the same shape as the cut
      // editor: the two surfaces that show a scan large are the two that are worth a whole screen.
      maxWidth="min(96vw, 82rem)"
      height="90vh"
    >
      {/* The picture takes the room and the outcome sits beside it in a column of its own, which
          scrolls on its own so a lot's whole copy list can never push the tile off screen. */}
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          gap: "1.25rem",
          padding: "1.25rem 1.5rem",
        }}
      >
        {viewSides.length > 0 && (
          <TileZoomView collectionId={collectionId} sides={viewSides} position={tile.position} />
        )}

        <div
          style={{
            width: viewSides.length > 0 ? "24rem" : "100%",
            flexShrink: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {settled ? (
            <SettledTile tile={tile} disabled={pending} onSaveNote={(n) => run(() => noteTileAction(tile.id, n), false)} />
          ) : mode === null ? (
            // The first tile of a card, waiting on the one lot-wide query. Deliberately not opening
            // on identify meanwhile: a mode that arrives a moment later is a dialog that moves under
            // the hand of someone already reading it.
            <Muted>Checking what this lot already holds…</Muted>
          ) : mode === "assign" ? (
            <AssignList
              copies={candidates}
              roles={roles}
              fromAuction={fromAuction}
              disabled={pending}
              hasMore={copies.hasNextPage ?? false}
              loadingMore={copies.isFetchingNextPage}
              onLoadMore={() => void copies.fetchNextPage()}
              onPick={(itemId) => run(() => assignTileAction(tile.id, itemId), true)}
            />
          ) : (
            <IdentifyIntro canIdentify={canIdentify} />
          )}

          {error && (
            <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
              {error}
            </p>
          )}
        </div>
      </div>

      {settled ? (
        <DialogFooter>
          {/* The settled states' one way onward, each on the left where the other outcomes sit:
              a discard goes back into the queue, and a consumed tile leads to what it became
              (#584) — the click that used to happen by itself, now asked for. */}
          {tile.state === "discarded" && (
            <div style={{ marginRight: "auto" }}>
              <DialogSecondaryButton
                onClick={() => run(() => undiscardTileAction(tile.id), false)}
                disabled={pending}
              >
                Put back in the queue
              </DialogSecondaryButton>
            </div>
          )}
          {tile.state === "consumed" && copyHref && (
            <div style={{ marginRight: "auto" }}>
              <DialogLinkButton href={copyHref}>
                <Icon name="open" size="sm" /> Open copy
              </DialogLinkButton>
            </div>
          )}
          <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
        </DialogFooter>
      ) : mode === null ? (
        // Nothing to offer until the mode is known — offering an action that might be the wrong one
        // is what waiting is for.
        <DialogFooter>
          <DialogSecondaryButton onClick={onClose}>Cancel</DialogSecondaryButton>
        </DialogFooter>
      ) : mode === "assign" ? (
        // Assign is the *showing* outcome, so picking a copy row is the action and the footer
        // carries only the two ways out of it — each one click, not a round trip through a menu.
        <DialogFooter>
          <div
            style={{ marginRight: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <DialogSecondaryButton onClick={() => onIdentifyNew(viewSides)} disabled={pending || !canIdentify}>
              <Icon name="add" size="sm" /> Identify as new copy
            </DialogSecondaryButton>
            {discard}
          </div>
          <DialogSecondaryButton onClick={onClose} disabled={pending}>
            Cancel
          </DialogSecondaryButton>
        </DialogFooter>
      ) : (
        <DialogActions
          actionLabel="Identify as a new copy"
          cancelLabel="Cancel"
          disabled={pending || !canIdentify}
          cancelDisabled={pending}
          onCancel={onClose}
          onAction={() => onIdentifyNew(viewSides)}
          leading={
            <>
              {discard}
              {/* Only when there is something to assign to — which is the very condition that chose
                  identify over assign, so this is one expression rather than a second rule. Without
                  it the button is always here and always opens an empty list. */}
              {candidates.length > 0 && (
                <DialogSecondaryButton onClick={() => setMode("assign")} disabled={pending}>
                  <Icon name="link" size="sm" /> Assign to a copy on this order
                </DialogSecondaryButton>
              )}
            </>
          }
        />
      )}
    </DialogShell>
  );
}

// ── The identify outcome, as it arrives ──────────────────────────────────────────────────────

/** What the dialog says when it opens on *identify*: one line, because the images above it are the
 * thing being read and the action is in the footer. */
function IdentifyIntro({ canIdentify }: { canIdentify: boolean }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: "0.8125rem",
        color: canIdentify ? "var(--color-text-secondary)" : "var(--color-error)",
      }}
    >
      {canIdentify
        ? "Identify the piece from the catalogue — the lot it belongs to, condition, certificate and location follow, and these images move onto the copy it creates."
        : "Every lot on this order is closed, so none of them takes a new copy. Reopen one to identify this tile, or assign the images to a copy the order already holds."}
    </p>
  );
}

// ── Assigning to a copy already on the lot ───────────────────────────────────────────────────

function AssignList({
  copies,
  roles,
  fromAuction,
  disabled,
  hasMore,
  loadingMore,
  onLoadMore,
  onPick,
}: {
  /** Already narrowed to copies holding none of `roles` — the dialog above owns the query, because
   * whether this list holds anything is what chose to show it. */
  copies: ItemListItem[];
  /** The slots this tile needs, for the sentence that explains who is missing and why. */
  roles: TilePhotoRole[];
  fromAuction: boolean;
  disabled: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onPick: (itemId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        {fromAuction
          ? "This order was settled from an auction sale, so its copies are the lines that were described in order to bid — across every lot won. Pick the one this tile shows."
          : "Pick the copy this tile shows. Its images move onto that copy."}
      </p>
      {/* Why a copy the collector knows is on this order may not be here — and it is about *this*
          tile, not about free slots in general. Said up front, because the alternative is
          concluding the list is broken and going looking for a bug. */}
      <Muted>{listScope(roles)}</Muted>
      {copies.length === 0 && (
        <Muted>
          No copy on this order can take it. Identify the tile as a new copy instead.
        </Muted>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {copies.map((copy) => (
          <CopyRow key={copy.id} copy={copy} disabled={disabled} onPick={() => onPick(copy.id)} />
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          style={{
            alignSelf: "flex-start",
            background: "none",
            border: "none",
            padding: 0,
            fontSize: "0.8125rem",
            color: "var(--color-action-primary)",
            cursor: "pointer",
          }}
        >
          {loadingMore ? "Loading…" : "Show more copies"}
        </button>
      )}
      {/* A tile that matches none of the lines is the parcel disagreeing with its description —
          which is information, not a problem to hide, so the way out of this list says so. */}
      {fromAuction && (
        <Muted>
          None of these? Then the parcel holds something its description never listed — press{" "}
          <em>Identify as new copy</em> below.
        </Muted>
      )}
    </div>
  );
}

/** What this tile carries, and therefore which copies cannot take it. Worded from the roles in
 * hand, so it says the same thing the filter did rather than a general claim about free slots. */
function listScope(roles: TilePhotoRole[]): string {
  if (roles.length === 2) {
    return "This tile carries a front and a back, so only copies with neither are listed — one that already has either side cannot take it.";
  }
  if (roles[0] === "back") {
    return "This tile carries a back, so only copies without one are listed — a copy that already has a back cannot take it.";
  }
  return "This tile carries a front, so only copies without one are listed — a copy that already has a front cannot take it.";
}

function CopyRow({
  copy,
  disabled,
  onPick,
}: {
  copy: ItemListItem;
  disabled: boolean;
  onPick: () => void;
}) {
  const numbers = copy.catalogNumbers.map((n) => n.number).join(" · ");
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        textAlign: "left",
        padding: "0.375rem 0.625rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          fontSize: "0.75rem",
          fontVariantNumeric: "tabular-nums",
          color: "var(--color-text-muted)",
        }}
      >
        {formatItemNo(copy.itemNo)}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: "0.8125rem" }}>
        {numbers && <strong>{numbers}</strong>}
        {numbers && copy.stampName ? " — " : ""}
        {copy.stampName ?? (numbers ? "" : "Unnamed stamp")}
        <span style={{ color: "var(--color-text-muted)" }}>
          {" "}
          · {copy.conditionAbbreviation}
        </span>
      </span>
      {/* What the copy already holds — the reason this path exists at all. From the shared helper,
          so the row and the filter above it describe slots the same way. */}
      <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
        {describeFreeSlots(copy.photos)}
      </span>
    </button>
  );
}

// ── A tile that is already done with ─────────────────────────────────────────────────────────

/** Where a discard's note is written, since discarding itself never stopped to ask for one. Also
 * where a consumed tile says what it became. */
function SettledTile({
  tile,
  disabled,
  onSaveNote,
}: {
  tile: ScanTileData;
  disabled: boolean;
  onSaveNote: (note: string) => void;
}) {
  const [note, setNote] = useState(tile.note ?? "");
  const dirty = note.trim() !== (tile.note ?? "");

  if (tile.state === "consumed") {
    return (
      <div
        style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}
      >
        {tile.item ? (
          <>
            <p style={{ margin: 0 }}>
              This tile became copy <strong>{formatItemNo(tile.item.itemNo)}</strong>, which now owns
              the images above.
            </p>
            {/* **Which** copy, not merely that there is one (#584). A number alone cannot be
                checked against the piece in the tweezers; the stamp it was identified as can, and
                that is what makes opening the copy a decision rather than a way of finding out. The
                numbers are the copy's own, drawn the way the assign list one screen back draws
                them. */}
            <ConsumedIdentity item={tile.item} />
          </>
        ) : (
          <p style={{ margin: 0 }}>
            This tile became a copy that has since been <strong>deleted</strong>, and its images went
            with it. There is nothing to restore — the tile stays as the record that it was worked
            through.
          </p>
        )}
        {tile.outsideDescription && (
          <p style={{ margin: "0.5rem 0 0" }}>
            Its stamp is on <strong>none of the auction lot&rsquo;s lines</strong> — the parcel holds
            something its description never listed.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        <strong>Discarded.</strong> The image is kept and the tile no longer counts as
        unidentified. It survives the lot closing: for a card bought sight-unseen these tiles are
        the only record of what was actually inside.
      </p>
      <label style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        Note (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={disabled}
          rows={2}
          placeholder="e.g. thinned, heavy crease, faked overprint"
          style={{
            marginTop: "0.25rem",
            width: "100%",
            padding: "0.375rem 0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border-strong)",
            background: "var(--color-bg-page)",
            color: "var(--color-text-primary)",
            fontSize: "0.8125rem",
            resize: "vertical",
          }}
        />
      </label>
      {dirty && (
        <button
          type="button"
          onClick={() => onSaveNote(note)}
          disabled={disabled}
          style={{
            alignSelf: "flex-start",
            padding: "0.25rem 0.625rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border-strong)",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-secondary)",
            fontSize: "0.8125rem",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {disabled ? "Saving…" : "Save the note"}
        </button>
      )}
    </div>
  );
}

/** What the copy a tile became *is*, in one line — its numbers, its name and its condition, the
 *  three the assign list's own rows lead with, so a tile before and after being worked through
 *  describes its copy the same way. */
function ConsumedIdentity({ item }: { item: NonNullable<ScanTileData["item"]> }) {
  const numbers = item.catalogNumbers.join(" · ");
  return (
    <p style={{ margin: "0.375rem 0 0", color: "var(--color-text-primary)" }}>
      {numbers && <strong>{numbers}</strong>}
      {numbers && item.stampName ? " — " : ""}
      {item.stampName ?? (numbers ? "" : "Unnamed stamp")}
      <span style={{ color: "var(--color-text-muted)" }}> · {item.conditionAbbreviation}</span>
    </p>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>{children}</p>
  );
}
