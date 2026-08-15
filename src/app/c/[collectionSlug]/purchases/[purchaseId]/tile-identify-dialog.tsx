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
  parkTileAction,
  returnTileToQueueAction,
} from "@/app/actions/scans";
import { formatItemNo } from "@/lib/item-number";
import type { ItemListItem } from "@/lib/items";
import type { ScanTileData } from "@/lib/scan-sheets";
import { tileSideViews, type TileSheetRef, type TileSideView } from "@/lib/scan-tile-view";
import { tilePhotoRoles, describeFreeSlots, type TilePhotoRole } from "@/lib/tile-photo-roles";
import { TileZoomView } from "./tile-zoom-view";
import { usePurchaseCopiesInfinite, type LotCopiesParams } from "./use-lot-copies-query";

/**
 * One tile, and what can become of it (#567) — three ends, and since #597 one waiting room.
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
 * **Set aside to check** (#597) sits beside it and says the opposite — a discard became nothing, a
 * parked piece is still going to become a copy — so a parked tile keeps every outcome this dialog
 * offers a waiting one, and what it gains is a note saying what to look for and a way back. It is
 * the one action here that **asks a question first**, and the reason is that its note is the
 * ordinary case rather than the rare one: the field opens in the footer where the button was, under
 * the cursor that just pressed it. Enter sets the tile aside, Escape abandons the question and not
 * the tile, and an empty field is a complete answer.
 *
 * **Every state opens this dialog, and none of them navigates on the click itself** (#584). A
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
   * *Same as the last* (#595): identify this tile the way the previous one of this sitting was
   * identified. Null until something has been, so the action is never offered with nothing to
   * repeat — and it carries `summary`, the stamp and condition it will apply, because a button that
   * does not name what it repeats is a blind one.
   *
   * It **skips the picker and stops at the condition step's ordinary confirm**, which is the whole
   * of its saving: the stamp is the one answer the intake step does not remember, and everything
   * around it already comes back on its own. One extra press buys sight of what is about to be
   * created, and a consumed tile has no undo short of deleting the copy.
   */
  repeatLast?: { summary: string; onRepeat: (sides: TileSideView[]) => void } | null;
  /**
   * An outcome was written. `touchedCopy` says whether a **copy** changed, which decides what has to
   * be re-read: assigning gives a copy the tile's photos, so the copies list is stale; discarding
   * touches no copy at all, so invalidating them would be re-fetching a lot's whole copy list to
   * learn that nothing about it moved.
   */
  onDone: (touchedCopy: boolean) => void;
  /**
   * A write landed and the dialog **stays open** (#597) — editing the note on a tile that is already
   * parked.
   *
   * That note is not an outcome: the tile is still to be identified and this dialog is still where
   * it would be, so closing on a saved sentence would put the collector back where they started for
   * nothing. Parking itself does close, its question having been answered at the button.
   */
  onChanged: (touchedCopy: boolean) => void;
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
  repeatLast,
  onDone,
  onChanged,
  onClose,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Reached an end. A **parked** tile (#597) has not: it is a waiting tile whose answer is not at
   * this desk, so this dialog stays the working surface it is for a waiting one — identify, assign,
   * discard — with the note and the way back added. */
  const settled = tile.state === "consumed" || tile.state === "discarded";
  const parked = tile.state === "parked";

  /** Whether *Set aside to check* has been pressed and is asking what to check (#597) — the note
   * being the ordinary case, not the exception, so it is asked for at the button rather than left
   * to be found afterwards on a surface the collector would have to cross the screen to reach. */
  const [parking, setParking] = useState(false);
  const [parkNote, setParkNote] = useState("");

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
   *  the only thing that knows whether a copy changed hands. `keepOpen` is the parking path (#597),
   *  where the write is not the end of what the collector is doing with this tile. */
  const run = (
    fn: () => Promise<{ status: string; message?: string }>,
    touchedCopy: boolean,
    keepOpen = false
  ) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "error") setError(result.message ?? "That did not work.");
      else if (keepOpen) onChanged(touchedCopy);
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

  /**
   * *Set aside to check* (#597) — the piece whose variant a picture cannot settle.
   *
   * Beside *Discard*, and it is the one outcome here that is **two presses rather than one**,
   * because a parked piece nearly always comes with a doubt to name: *watermark?*, *dark or light
   * blue?*, *check perf against Mi 200*. That sentence is the whole value of the state — it is what
   * the collector reads when they come back with the lamp instead of deriving the doubt again from
   * the picture that could not settle it — so the field opens **where the button was**, under the
   * cursor that just pressed it, and not somewhere else on a screen this wide.
   *
   * A discard is the opposite bargain and keeps its one press: it is the frequent answer on a parcel
   * of junk and its note is the rare one, so it acts and the note is written afterwards. Here the
   * note is the ordinary case, so it is asked for — but never *required*: Enter on an empty field
   * parks the tile, because *something is off here* is a complete thought.
   *
   * The prompt **replaces the other actions** while it is open rather than sitting among them. It is
   * a question with two answers, and leaving *Discard* next to a focused field would put the one
   * irreversible-ish outcome one stray click from a piece being set aside.
   */
  const park = !parked ? (
    <DialogSecondaryButton onClick={() => setParking(true)} disabled={pending}>
      <Icon name="pause" size="sm" /> Set aside to check
    </DialogSecondaryButton>
  ) : null;

  const commitPark = () => run(() => parkTileAction(tile.id, parkNote), false);

  const parkPrompt = (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
      <label style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        What to check?
        <input
          autoFocus
          value={parkNote}
          onChange={(e) => setParkNote(e.target.value)}
          disabled={pending}
          placeholder="watermark? · dark or light blue? · perf vs Mi 200"
          // Enter sets it aside and Escape abandons the whole thing: the collector's hands are on
          // the keyboard the moment this opens, and a note this short should never need the mouse
          // to be picked up again.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitPark();
            } else if (e.key === "Escape") {
              // Reaches here because the dialog steps out of the escape layer while this is open
              // (see `dismissable` below) — otherwise the shared document-level listener would have
              // closed the whole dialog before this ran.
              e.preventDefault();
              setParking(false);
              setParkNote("");
            }
          }}
          style={{
            marginLeft: "0.5rem",
            width: "22rem",
            padding: "0.3125rem 0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border-strong)",
            background: "var(--color-bg-page)",
            color: "var(--color-text-primary)",
            font: "inherit",
            fontSize: "0.8125rem",
          }}
        />
      </label>
      <DialogSecondaryButton onClick={commitPark} disabled={pending}>
        <Icon name="pause" size="sm" /> {pending ? "Working…" : "Set aside"}
      </DialogSecondaryButton>
      <DialogSecondaryButton
        onClick={() => {
          setParking(false);
          setParkNote("");
        }}
        disabled={pending}
      >
        Cancel
      </DialogSecondaryButton>
    </div>
  );

  /** The way back out of both waiting-room states — a mis-clicked discard, or a parked piece whose
   * answer is now known. On a parked tile it is the *ordinary* end of the wait rather than an undo,
   * which is why it says what it says rather than *Un-park*. */
  const putBack = (
    <DialogSecondaryButton
      onClick={() => run(() => returnTileToQueueAction(tile.id), false)}
      disabled={pending}
    >
      <Icon name="restore" size="sm" /> Put back in the queue
    </DialogSecondaryButton>
  );

  /** *Same as the last* (#595), beside *Identify as a new copy* in both footers, because it is that
   * answer with its first question already answered — and offered under the same `canIdentify`, since
   * an order whose every lot is closed takes no new copy however it is asked for. It names the stamp
   * and the condition it will apply: this is the one control on the screen that acts on a decision
   * taken minutes ago, so what it will do has to be readable before it is pressed. */
  const repeat = repeatLast ? (
    <DialogSecondaryButton
      onClick={() => repeatLast.onRepeat(viewSides)}
      disabled={pending || !canIdentify}
    >
      <Icon name="duplicate" size="sm" /> Same as the last: {repeatLast.summary}
    </DialogSecondaryButton>
  ) : null;

  return (
    <DialogShell
      title={`Tile ${tile.position + 1}`}
      onClose={onClose}
      // Sized for the picture rather than for the text beside it, and the same shape as the cut
      // editor: the two surfaces that show a scan large are the two that are worth a whole screen.
      maxWidth="min(96vw, 82rem)"
      height="90vh"
      // While the *what to check* field is open, Escape belongs to **it** (#597): abandoning the
      // note is not abandoning the tile, and a collector three words into a doubt who presses
      // Escape means "not like that", not "close everything". The shared layer stack listens on the
      // document in the capture phase, so a handler on the input cannot stop it — stepping this
      // dialog out of the stack is the documented way to hand the key over. It also stops a stray
      // backdrop click from taking the sentence with it.
      dismissable={!parking}
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
          {/* A parked tile's note sits **above** the outcomes, not instead of them (#597): it is
              what the collector wrote to themselves about this piece, so it is the first thing to
              read on coming back — and the identification it was waiting for is right underneath,
              which is the whole point of the tile staying workable while parked. */}
          {parked && (
            <ParkedNote
              note={tile.note}
              disabled={pending}
              onSave={(n) => run(() => noteTileAction(tile.id, n), false, true)}
            />
          )}
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
          {tile.state === "discarded" && <div style={{ marginRight: "auto" }}>{putBack}</div>}
          {tile.state === "consumed" && copyHref && (
            <div style={{ marginRight: "auto" }}>
              <DialogLinkButton href={copyHref}>
                <Icon name="open" size="sm" /> Open copy
              </DialogLinkButton>
            </div>
          )}
          <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
        </DialogFooter>
      ) : parking ? (
        // The whole footer while the question is open (#597): it is a question, and a question with
        // the other outcomes still standing beside it is a row of buttons one stray click from
        // discarding the piece that was about to be set aside.
        <DialogFooter>{parkPrompt}</DialogFooter>
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
            <DialogSecondaryButton
              onClick={() => onIdentifyNew(viewSides)}
              disabled={pending || !canIdentify}
            >
              <Icon name="add" size="sm" /> Identify as new copy
            </DialogSecondaryButton>
            {repeat}
            {parked ? putBack : park}
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
              {repeat}
              {parked ? putBack : park}
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

// ── A tile parked to be checked (#597) ───────────────────────────────────────────────────────

/**
 * What the collector wrote about a parked piece, and where they change it.
 *
 * **The note is the point of the state.** *Watermark?* — *dark or light blue?* — *check perf against
 * Mi 200*: written while the doubt is fresh, read months later by someone who would otherwise have
 * to derive the doubt again from the very picture that could not settle it. So it leads this panel
 * rather than sitting under the outcomes, and it is a field rather than a line of text, because the
 * doubt narrows as it is worked on.
 *
 * **Optional, and it stays optional.** *Something is off here* is a complete thought — the same
 * call the discard note makes, and for the same reason: parking has to stay cheaper than the
 * interruption it prevents.
 */
function ParkedNote({
  note,
  disabled,
  onSave,
}: {
  note: string | null;
  disabled: boolean;
  onSave: (note: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        marginBottom: "0.875rem",
        padding: "0.625rem 0.75rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-warning-border)",
        background: "var(--color-warning-soft)",
      }}
    >
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        <strong>Set aside to check.</strong> It is still to be identified — it is only out of the
        queue until you have the answer. Identify it below when you do, or put it back.
      </p>
      <TileNote
        label="What to check (optional)"
        placeholder="e.g. watermark? · dark or light blue? · check perf against Mi 200"
        note={note}
        disabled={disabled}
        onSave={onSave}
      />
    </div>
  );
}

/**
 * The note field both waiting-room states carry — a discard's *what the parcel held*, a parked
 * tile's *what to check*. One component, because they are one control: a small textarea that only
 * offers to save once what is in it differs from what is stored, so a tile whose note has not been
 * touched shows no button to press.
 */
function TileNote({
  label,
  placeholder,
  note,
  disabled,
  onSave,
}: {
  label: string;
  placeholder: string;
  note: string | null;
  disabled: boolean;
  onSave: (note: string) => void;
}) {
  const [draft, setDraft] = useState(note ?? "");
  // Re-seeded when the stored note moves underneath — a save that landed, or the tile being
  // re-read — so the box never sits on a value the tile no longer has.
  const [seed, setSeed] = useState(note);
  if (seed !== note) {
    setSeed(note);
    setDraft(note ?? "");
  }
  const dirty = draft.trim() !== (note ?? "");

  return (
    <label style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
      {label}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={disabled}
        rows={2}
        placeholder={placeholder}
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
      {dirty && (
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={disabled}
          style={{
            marginTop: "0.375rem",
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
    </label>
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
      <TileNote
        label="Note (optional)"
        placeholder="e.g. thinned, heavy crease, faked overprint"
        note={tile.note}
        disabled={disabled}
        onSave={onSaveNote}
      />
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
