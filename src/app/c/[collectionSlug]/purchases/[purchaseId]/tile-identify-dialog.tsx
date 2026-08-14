"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/app/icons";
import {
  DialogActions,
  DialogBody,
  DialogFooter,
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
import { useLotCopiesInfinite } from "./use-lot-copies-query";

/**
 * One tile, and the three ends it can reach (#567).
 *
 * The tile's own images fill the dialog, and that is its entire reason for existing: the intake
 * step that follows never shows them, and a crop that took half a stamp or a piece nobody could
 * identify is only visible at this size. Reviewing tiles rather than trusting the cut is the whole
 * point of the pass.
 *
 * So the dialog **opens on an outcome, never on a menu of them**. It arrives showing the answer its
 * provenance makes likely, and the other two sit in the footer where they cost one click from
 * wherever it opened:
 *
 * - a tile from an **auction settlement** opens on *assign* — the lot's copies are the lines that
 *   were described and bid on, and they want photographs rather than identification;
 * - every **other** tile opens on *identify*, the stockbook answer.
 *
 * A chooser standing in front of these would be a screen whose whole content is three buttons, and
 * a card of forty would mean forty of them showing nothing.
 *
 * **Discard acts immediately**, with no note asked for. On a parcel full of junk it is the frequent
 * answer, and it is safe to make it cheap precisely because it is reversible — *Put back in the
 * queue* is right there, and the note can be written afterwards on the rare tile that earns one.
 */

interface Props {
  collectionId: string;
  lotId: string;
  tile: ScanTileData;
  /** Whether the lot is still open. A closed lot takes no new copies (its pool has been split
   * across the copies it had), but a photograph is not money — assigning and discarding stay. */
  lotOpen: boolean;
  /** Whether this lot was transcribed from a won auction lot, which is what makes assigning the
   * ordinary path rather than the exception. */
  fromAuction: boolean;
  onIdentifyNew: () => void;
  onDone: () => void;
  onClose: () => void;
}

/** The outcome the dialog is *showing*. Discard is not one of them — it is a button that acts. */
type Mode = "identify" | "assign";

export function TileIdentifyDialog({
  collectionId,
  lotId,
  tile,
  lotOpen,
  fromAuction,
  onIdentifyNew,
  onDone,
  onClose,
}: Props) {
  const [mode, setMode] = useState<Mode>(fromAuction ? "assign" : "identify");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const settled = tile.state !== "unidentified";

  const run = (fn: () => Promise<{ status: string; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "error") setError(result.message ?? "That did not work.");
      else onDone();
    });
  };

  const discard = (
    <DialogSecondaryButton
      onClick={() => run(() => discardTileAction(tile.id, ""))}
      disabled={pending}
    >
      <Icon name="delete" size="sm" /> {pending ? "Working…" : "Discard"}
    </DialogSecondaryButton>
  );

  return (
    <DialogShell
      title={`Tile ${tile.position + 1}`}
      onClose={onClose}
      maxWidth={!settled && mode === "assign" ? "44rem" : "32rem"}
    >
      <DialogBody>
        <TileImages tile={tile} collectionId={collectionId} />

        {settled ? (
          <SettledTile tile={tile} disabled={pending} onSaveNote={(n) => run(() => noteTileAction(tile.id, n))} />
        ) : mode === "assign" ? (
          <AssignList
            collectionId={collectionId}
            lotId={lotId}
            fromAuction={fromAuction}
            disabled={pending}
            onPick={(itemId) => run(() => assignTileAction(tile.id, itemId))}
          />
        ) : (
          <IdentifyIntro lotOpen={lotOpen} />
        )}

        {error && (
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
            {error}
          </p>
        )}
      </DialogBody>

      {settled ? (
        <DialogFooter>
          {tile.state === "discarded" && (
            <div style={{ marginRight: "auto" }}>
              <DialogSecondaryButton
                onClick={() => run(() => undiscardTileAction(tile.id))}
                disabled={pending}
              >
                Put back in the queue
              </DialogSecondaryButton>
            </div>
          )}
          <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
        </DialogFooter>
      ) : mode === "assign" ? (
        // Assign is the *showing* outcome, so picking a copy row is the action and the footer
        // carries only the two ways out of it — each one click, not a round trip through a menu.
        <DialogFooter>
          <div style={{ marginRight: "auto", display: "flex", gap: "0.5rem" }}>
            <DialogSecondaryButton onClick={onIdentifyNew} disabled={pending || !lotOpen}>
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
          disabled={pending || !lotOpen}
          cancelDisabled={pending}
          onCancel={onClose}
          onAction={onIdentifyNew}
          leading={
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {discard}
              <DialogSecondaryButton onClick={() => setMode("assign")} disabled={pending}>
                <Icon name="link" size="sm" /> Assign to a copy on this lot
              </DialogSecondaryButton>
            </div>
          }
        />
      )}
    </DialogShell>
  );
}

// ── The images ───────────────────────────────────────────────────────────────────────────────

function TileImages({ tile, collectionId }: { tile: ScanTileData; collectionId: string }) {
  const shots = [
    { id: tile.frontPhotoId, label: "Front" },
    { id: tile.backPhotoId, label: "Back" },
  ].filter((s) => s.id != null);
  if (shots.length === 0) {
    // A consumed tile has handed its crops to its copy, so there is nothing left to show here.
    return null;
  }
  return (
    <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
      {shots.map((shot) => (
        <figure key={shot.label} style={{ margin: 0, textAlign: "center" }}>
          {/* Served by an authenticated route at whatever size the stamp was — the call every
              other photo on this screen makes. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/collections/${collectionId}/photos/${shot.id}/full`}
            alt={`Tile ${tile.position + 1}, ${shot.label.toLowerCase()}`}
            style={{
              display: "block",
              maxWidth: "14rem",
              maxHeight: "16rem",
              objectFit: "contain",
              border: "1px solid var(--color-border)",
              borderRadius: "0.375rem",
              background: "var(--color-bg-subtle)",
            }}
          />
          <figcaption style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            {shot.label}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

// ── The identify outcome, as it arrives ──────────────────────────────────────────────────────

/** What the dialog says when it opens on *identify*: one line, because the images above it are the
 * thing being read and the action is in the footer. */
function IdentifyIntro({ lotOpen }: { lotOpen: boolean }) {
  return (
    <p
      style={{
        margin: "1rem 0 0",
        fontSize: "0.8125rem",
        color: lotOpen ? "var(--color-text-secondary)" : "var(--color-error)",
      }}
    >
      {lotOpen
        ? "Identify the piece from the catalogue — condition, certificate and location follow, and these images move onto the copy it creates."
        : "This lot is closed, so it takes no new copies. Reopen it to identify this tile, or assign the images to a copy it already holds."}
    </p>
  );
}

// ── Assigning to a copy already on the lot ───────────────────────────────────────────────────

function AssignList({
  collectionId,
  lotId,
  fromAuction,
  disabled,
  onPick,
}: {
  collectionId: string;
  lotId: string;
  fromAuction: boolean;
  disabled: boolean;
  onPick: (itemId: string) => void;
}) {
  // The lot's own copies, in catalogue order. Unfiltered on purpose: a copy that already has a
  // front but no back is exactly one this tile might complete, and the `no-photos` filter would
  // hide it.
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useLotCopiesInfinite(
    collectionId,
    lotId,
    { sort: "catalog", sortDir: "asc", filter: "none" }
  );
  const copies = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        {fromAuction
          ? "This lot came from an auction sale, so its copies are the lines that were described. Pick the one this tile shows."
          : "Pick the copy this tile shows. Its images move onto that copy."}
      </p>
      {isLoading && <Muted>Loading the lot&rsquo;s copies…</Muted>}
      {!isLoading && copies.length === 0 && (
        <Muted>
          This lot holds no copies yet. Identify the tile as a new copy instead.
        </Muted>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {copies.map((copy) => (
          <CopyRow key={copy.id} copy={copy} disabled={disabled} onPick={() => onPick(copy.id)} />
        ))}
      </div>
      {hasNextPage && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
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
          {isFetchingNextPage ? "Loading…" : "Show more copies"}
        </button>
      )}
      {/* A tile that matches none of the lines is the parcel disagreeing with its description —
          which is information, not a problem to hide, so the way out of this list says so. */}
      {fromAuction && copies.length > 0 && (
        <Muted>
          None of these? Then the parcel holds something its description never listed — press{" "}
          <em>Identify as new copy</em> below.
        </Muted>
      )}
    </div>
  );
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
  const hasFront = copy.photos.some((p) => p.role === "front");
  const hasBack = copy.photos.some((p) => p.role === "back");
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
      {/* What the copy is still missing — the reason this path exists at all. */}
      <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
        {hasFront && hasBack
          ? "front + back"
          : hasFront
            ? "front only"
            : hasBack
              ? "back only"
              : "no photos"}
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
        style={{ marginTop: "1rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}
      >
        <p style={{ margin: 0 }}>
          {tile.item ? (
            <>
              This tile became copy <strong>{formatItemNo(tile.item.itemNo)}</strong>, which now owns
              its images.
            </>
          ) : (
            // The one case that reaches this view: on the card a consumed tile is a link to its
            // copy, so only a tile whose copy has been deleted still opens a dialog.
            <>
              This tile became a copy that has since been <strong>deleted</strong>, and its images
              went with it. There is nothing to restore — the tile stays as the record that it was
              worked through.
            </>
          )}
          {tile.outsideDescription && (
            <>
              {" "}
              Its stamp is on <strong>none of the auction lot&rsquo;s lines</strong> — the parcel
              holds something its description never listed.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
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

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>{children}</p>
  );
}
