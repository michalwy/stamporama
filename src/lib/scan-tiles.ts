import "server-only";
import { prisma } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { formatItemNo } from "./item-number";
import { updateItem } from "./items";
import { intakeStamps } from "./lots";
import { autoSeedStampMainFromFront } from "./photos";
import {
  OPEN_TILE_STATES,
  ScanAuthError,
  ScanValidationError,
  assertScanPurchaseOwner,
  isOpenTileState,
} from "./scan-sheets";
import { conflictingPhotoRoles, photoRolesPresent } from "./tile-photo-roles";

/**
 * Turning a scan tile into something (#567, ADR-0033) — the second half of the scan-first intake.
 *
 * #566 leaves an order holding tiles: images of stamps nobody has identified yet. Each one has
 * exactly **three ends**, and this module is all three of them.
 *
 * - **A new copy** — the stockbook path. The stamp is identified from the catalogue and the tile's
 *   images move onto the created copy. Ordinary intake, entered from a tile instead of from a
 *   stamp picker, so it goes through `intakeStamps` rather than around it: the arrived-order rule
 *   (#121), the internal copy number (#268), the format (#573) and the dispositions (#160) are
 *   that function's, and a second implementation of them here would be a second set to keep right.
 *
 * - **An existing copy on the order** — the auction path. A purchase settled from a won auction
 *   sale already holds identified copies, because the contents were described in order to bid;
 *   those copies need **photographs, not identification**, and picking from named lines is less
 *   desk work than identifying from scratch. Settlement is deliberately not changed to produce tiles
 *   instead (see the issue): a tile has no stamp, so it can be counted against no want (ADR-0032),
 *   carries no catalogue price, so lot closing before arrival would be blocked, and the order's
 *   own catalogue-value bar would read zero until delivery.
 *
 * - **A discard, leaving a trace** — junk, damaged beyond interest, unidentifiable. The tile keeps
 *   its image, carries a note, drops out of the unidentified count so it stops nagging before lot
 *   close, and survives the close. For a stockbook bought sight-unseen it is the only record of
 *   what was actually inside: **a discarded tile is evidence, not a queue item.**
 *
 * #597 adds a fourth destination that is not an end at all — **parked**: a piece still to be
 * identified, set aside because the answer is not at the desk (a watermark, two shades of one blue,
 * a paper difference). It keeps every door a waiting tile has, because it *is* a waiting tile; what
 * it leaves is the sweep, so working through a card stops re-offering the one piece that cannot be
 * settled now. See {@link parkTile}.
 *
 * A consumed tile is an end, but not an irrevocable one: {@link reidentifyTileCopy} runs the whole
 * identification again over the copy it became, because the mis-identification is discovered on the
 * card and the correction should not cost a trip to the copies list to find one row among a parcel's
 * hundreds.
 *
 * #607 gives that waiting tile a **shortlist** — what the piece could be, kept so the return sitting
 * does not repeat the narrowing that discovered the picture could not settle it. See
 * {@link addTileCandidate}; the rule about when a shortlist is the wrong answer altogether lives in
 * the pure `tile-candidates.ts`.
 *
 * Two rules run through all three:
 *
 * - **Images move, they are never copied.** A tile's crops are `Photo` rows under the fourth owner
 *   (ADR-0033 §2), so handing them to a copy is `tileId → itemId` on the same row. No second row,
 *   no second bytes, and nothing for a cleanup to disagree about later.
 * - **The batch is stamped when its last outstanding tile reaches an end** — `unidentified` and,
 *   since #597, `parked`. From that moment it can never be re-cut, so its retained original has no
 *   remaining function. Nothing here reads the stamp; #578's retention sweep does.
 *
 * Since #586 a tile belongs to the **purchase**, so this module carries the one question that move
 * left behind: **a copy still belongs to a lot**, and it is identification — not scanning — that
 * can answer which. `assignTileToCopy` asks nothing, the copy having a lot already; only
 * `identifyTileAsNewCopy` needs one, and a purchase with a single lot answers it without asking.
 */

/** What a tile became, for the caller to say so on screen. */
export interface TileOutcome {
  itemId: string;
  itemNo: number;
}

// ── Creating a copy from a tile ───────────────────────────────────────────────────────────────

/**
 * Identify a tile into a **new copy** and hand that copy the tile's images.
 *
 * Everything about the copy itself is `intakeStamps`' — including the refusal to identify into a
 * closed lot, and the rule that an already-arrived order produces `to_sort` rather than `ordered`.
 * What is added here is the two writes that make it a *tile's* copy: the `Photo` rows change owner,
 * and the tile records what it became.
 *
 * No photo change-set is accepted, deliberately. The tile's crops **are** this copy's front and
 * back; a second front arriving from an upload would collide with the partial unique on
 * `(itemId, role)`, and the collector reaching for a file picker at the exact moment a photograph
 * of the stamp is already on screen is not a flow worth building a merge for.
 *
 * **Which lot** is the one thing #586 left to be asked here. A copy takes its cost basis from a
 * lot, and a card of a settled auction holds pieces belonging to a dozen of them, so the lot cannot
 * come from the sheet any more. `lotId` is therefore the caller's to supply — and optional, because
 * a purchase with **one** lot answers it on its own: the stockbook case must not grow a question it
 * never had. Several with none named is a refusal rather than a guess, since guessing here files a
 * stamp against the wrong money.
 *
 * Since #596 the same answer can be given for **several** tiles at once, so what this asks for lives
 * in `TileIdentification` and both entries take it: one tile is the many-tile pass with one tile in
 * it, not a second copy of these rules.
 */
export interface TileIdentification {
  /** The lot the created copies belong to. Omitted when the purchase has exactly one, which is
   * then used silently. */
  lotId?: string | null;
  stampId: string;
  conditionId: string;
  certificateStatusId?: string | null;
  locationId?: string | null;
  locationRef?: string | null;
  formatId?: string | null;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
}

export async function identifyTileAsNewCopy(
  ownerId: string,
  tileId: string,
  input: TileIdentification
): Promise<TileOutcome> {
  // One tile is the pass below with one tile in it (#596), not a second implementation of it: the
  // ordinary case must keep behaving identically, and it does so by *being* the same call.
  const [outcome] = await identifyTilesAsNewCopies(ownerId, [tileId], input);
  return outcome;
}

/**
 * Identify **several tiles as the same stamp in one pass** (#596) — one answer, one copy per tile.
 *
 * A card commonly holds a run of the same stamp in the same condition, and walking each piece
 * through the picker and the condition step is that many passes over a decision taken once. Ticking
 * the tiles is the collector *asserting* they are the same; nothing here verifies that assertion,
 * and nothing anywhere offers to find duplicates on its own — telling two shades or two
 * perforations apart is the work being done, not something to guess from a thumbnail.
 *
 * **Every copy gets its own tile's pictures.** These are N photographs of N pieces of paper: the
 * copies are paired with the tiles in order and each pairing runs the same `tileId → itemId`
 * reassignment the single-tile path does. N copies pointing at one tile's photo would be worse than
 * no photos at all, because nothing on screen would say so.
 *
 * **The whole pass is refused before anything is created, or it runs.** Every tile is loaded and
 * checked first — still waiting, and all on the one purchase — so a stale strip in a second tab
 * costs a sentence rather than a half-done identification with no way to tell which half. After
 * that the copies exist, and the per-tile reassignments are ordinary writes on rows created a
 * moment ago.
 *
 * The internal numbers come out as one consecutive range because `intakeStamps` is asked for the
 * copies **once** (`copies: N`) rather than called in a loop, which is also what makes the arrived
 * order rule, the format and the dispositions stay that function's.
 */
export async function identifyTilesAsNewCopies(
  ownerId: string,
  tileIds: string[],
  input: TileIdentification
): Promise<TileOutcome[]> {
  if (tileIds.length === 0) throw new ScanValidationError("Pick at least one tile to identify.");
  if (!input.stampId) {
    throw new ScanValidationError(
      tileIds.length === 1
        ? "Pick a stamp to identify this tile as."
        : "Pick a stamp to identify these tiles as."
    );
  }

  // Loaded and checked in full before a copy exists — `loadSelectedTiles` is that rule, shared with
  // the outcomes that followed this one. The duplicate guard inside it matters most here: the same
  // tile named twice would otherwise create two copies and give the second one no images, the images
  // having moved to the first.
  const tiles = await loadSelectedTiles(ownerId, tileIds);
  const lotId = await resolveTileLot(tiles[0].purchaseId, input.lotId);

  const copies = await intakeStamps(ownerId, lotId, {
    stampId: input.stampId,
    copies: tiles.length,
    conditionId: input.conditionId,
    certificateStatusId: input.certificateStatusId,
    locationId: input.locationId,
    locationRef: input.locationRef,
    formatId: input.formatId,
    inCollection: input.inCollection,
    forSale: input.forSale,
    forTrade: input.forTrade,
  });
  if (copies.length !== tiles.length) {
    throw new ScanValidationError("The copies could not be created.");
  }

  // One tile, one copy, in the order the pieces are laid out on the card — which is the order their
  // internal numbers were allocated in, so the strip and the copy list read the same way round.
  //
  // No role clash is possible on any of them: the copies were created a moment ago and this path
  // refuses a photo change-set, so both slots are free. That is why the check lives on the assign
  // path, which is the one that can meet an occupied slot.
  const outcomes: TileOutcome[] = [];
  for (const [i, tile] of tiles.entries()) {
    const copy = copies[i];
    await consumeTile(tile.id, copy.itemId);
    await seedStampImage(ownerId, copy.itemId);
    outcomes.push({ itemId: copy.itemId, itemNo: copy.itemNo });
  }
  return outcomes;
}

/**
 * The lot a tile's new copy goes onto (#586).
 *
 * Three answers, and the middle one is the whole reason this is a function rather than a required
 * argument: a purchase with **one** lot is the stockbook case, which had no such question before
 * this move and must not gain one. Several lots and no answer is a refusal — a default lot on the
 * batch was considered and rejected because a parcel of many small lots puts a dozen of them on one
 * card, and a pointer from the card to a lot would then be *false* rather than merely unhelpful.
 *
 * A named lot is checked against the tile's own purchase, so a stale remembered answer — the
 * previous parcel's lot, still in the browser — is refused rather than filing a stamp against
 * another order's money.
 */
async function resolveTileLot(
  purchaseId: string,
  lotId: string | null | undefined
): Promise<string> {
  if (lotId) {
    const lot = await prisma.purchaseLot.findFirst({
      where: { id: lotId, purchaseId },
      select: { id: true },
    });
    if (!lot) throw new ScanValidationError("That lot is not on this order.");
    return lot.id;
  }
  const lots = await prisma.purchaseLot.findMany({
    where: { purchaseId },
    select: { id: true },
    take: 2,
  });
  if (lots.length === 0) {
    throw new ScanValidationError("This order has no lots yet. Add one to identify tiles into.");
  }
  if (lots.length > 1) {
    throw new ScanValidationError("Choose which lot this copy belongs to.");
  }
  return lots[0].id;
}

// ── Assigning a tile to a copy that already exists ────────────────────────────────────────────

/**
 * Give the tile's images to a copy **already on this order** — the auction path.
 *
 * Allowed on a **closed** lot, unlike creating a copy. Closing freezes the money (ADR-0009 §3),
 * and a photograph is not money: it changes no catalogue price, no weight and no cost basis. What
 * a closed lot refuses is a *new* copy, because that would change the set the pool was split
 * across — and that refusal is `intakeStamps`', where it belongs.
 *
 * The target must be on the same **purchase** (#586), which is the improvement rather than the
 * concession: at a settlement the copies that need photographs are every line of every won lot,
 * arriving in one envelope and scanned on one card, and the old same-lot rule made most of them
 * unreachable from the tile in front of the collector. This path asks nothing about lots because
 * the copy already has one — it is only *creating* a copy that has to name one.
 */
export async function assignTileToCopy(
  ownerId: string,
  tileId: string,
  itemId: string
): Promise<TileOutcome> {
  const tile = await loadOpenTile(ownerId, tileId);

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      itemNo: true,
      lot: { select: { purchaseId: true } },
      photos: { select: { role: true } },
    },
  });
  if (!item) throw new ScanAuthError("Copy not found or access denied.");
  if (item.lot?.purchaseId !== tile.purchaseId) {
    throw new ScanValidationError("That copy is not on this order.");
  }

  // Front and back are singleton slots per owner. A copy that already holds one of the roles this
  // tile carries is refused rather than resolved by demoting the crop to an extra — an image quietly
  // filed where the copy's front is looked for is worse than a sentence saying which slot is taken.
  //
  // `tile-photo-roles.ts` owns this comparison, and the **candidate list reads the same rule** so it
  // cannot offer what this refuses.
  const clash = conflictingPhotoRoles(
    photoRolesPresent(tile.photos),
    photoRolesPresent(item.photos)
  );
  if (clash.length > 0) {
    throw new ScanValidationError(
      `Copy ${formatItemNo(item.itemNo)} already has ${clash.length === 2 ? "front and back images" : `a ${clash[0]} image`}. Remove ${clash.length === 2 ? "them" : "it"} first, or pick another copy.`
    );
  }

  await consumeTile(tile.id, item.id);
  await seedStampImage(ownerId, item.id);
  return { itemId: item.id, itemNo: item.itemNo };
}

// ── Correcting an identification ──────────────────────────────────────────────────────────────

/**
 * What a correction answers — **the identification's own questions**, asked again.
 *
 * Deliberately the same shape as {@link TileIdentification} minus `lotId`, because the two are the
 * same act: identifying a piece is answering *which stamp, in what condition, with what certificate,
 * in what format, filed where, held for what* — and being wrong about the first of those does not
 * make the rest unaskable. A correction that took only a stamp id would have been a second, poorer
 * vocabulary for one question, and the collector who re-identifies a piece has it in the tweezers:
 * the condition read off the wrong stamp is very often wrong with it.
 *
 * **`lotId` is absent, and that is the one real difference.** A copy takes its cost basis from a lot
 * (ADR-0009 §3), so moving one between lots is a decision about *money* rather than about what the
 * piece is; the copy already has a lot, and this path leaves it exactly where it is.
 */
export interface TileReidentification {
  stampId: string;
  conditionId: string;
  certificateStatusId?: string | null;
  locationId?: string | null;
  locationRef?: string | null;
  formatId?: string | null;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
}

/**
 * Identify the copy a consumed tile became **again** — the identification corrected from the tile it
 * was made on.
 *
 * The correction was always possible; what it cost was the problem. A tile whose stamp turns out to
 * be wrong is discovered *on this card* — the piece beside it settles the shade, the perforation
 * gauge says 14 rather than 14½ — and until now the only way to act on it was to leave the card,
 * find that one copy among a parcel's hundreds in the copies list, and edit it there. On a card of
 * forty that is the same cost as the mis-identification itself, so the answer is put where the
 * doubt is: the tile's own dialog, running **the whole identification chain** — picker, the issue
 * and stamp dialogs it can open, then the condition step — with the piece on screen throughout
 * (#592), exactly as identifying it the first time did.
 *
 * **It re-answers the copy; it does not create one.** The copy's number, its lot, its delivery state
 * and its images are not questions the identification asks, so they are untouched — and running
 * `intakeStamps` again would produce a *second* copy rather than correct the one that exists. So
 * this is `updateItem`, which is also what makes a changed stamp land in `ItemVariantHistory`
 * exactly as the same correction made from the copies list does: one write, one record of it,
 * whichever screen it was reached from.
 *
 * **No new refusal on a closed lot.** Closing splits the pool across the copies the lot had
 * (ADR-0009 §3) and this creates no copy and removes none, so the set the split was over is
 * unchanged; re-pointing an existing copy's stamp is already allowed from the copies list on a
 * closed lot, and a rule invented here would be a second answer to one question.
 *
 * The new stamp is offered the tile's front as its catalogue image on the same terms the original
 * identification offered it (#149's auto-seed, {@link seedStampImage}): the guard is *that stamp
 * has no picture at all*, so it is a no-op in every case but the one it exists for. The stamp that
 * was wrong keeps whatever it was seeded with — deleting a catalogue photo is a decision of its own,
 * and one this path must not take on the collector's behalf.
 */
export async function reidentifyTileCopy(
  ownerId: string,
  tileId: string,
  input: TileReidentification
): Promise<TileOutcome> {
  if (!input.stampId) throw new ScanValidationError("Pick the stamp this piece actually is.");
  if (!input.conditionId) throw new ScanValidationError("A condition must be selected.");
  const tile = await loadTileForOwner(ownerId, tileId);
  if (tile.state !== "consumed") {
    throw new ScanValidationError("This tile has not become a copy, so there is nothing to correct.");
  }
  // A copy deleted after the tile was worked through leaves the tile `consumed` with nothing behind
  // it (`SetNull`). There is no copy to re-identify and no images to re-identify it with — they left
  // with the copy — so this says so rather than failing on a null id.
  if (!tile.itemId) {
    throw new ScanValidationError(
      "The copy this tile became has been deleted, so there is nothing to re-identify."
    );
  }
  // Every field the step asked for is written, including the ones left empty: the condition dialog
  // opens on **what the copy is now**, so a blank is the collector clearing an answer rather than
  // declining to give one. Absent instead of null would make *remove the certificate* impossible
  // from the one surface that shows it.
  const { item } = await updateItem(ownerId, tile.itemId, {
    stampId: input.stampId,
    conditionId: input.conditionId,
    certificateStatusId: input.certificateStatusId ?? null,
    formatId: input.formatId ?? null,
    locationId: input.locationId ?? null,
    locationRef: input.locationRef ?? null,
    inCollection: input.inCollection ?? false,
    forSale: input.forSale ?? false,
    forTrade: input.forTrade ?? false,
  });
  await seedStampImage(ownerId, item.id);
  return { itemId: item.id, itemNo: item.itemNo };
}

// ── Discarding ────────────────────────────────────────────────────────────────────────────────

/**
 * Record that a tile became **nothing**, and why.
 *
 * The images stay on the tile: a discard is not a delete. It leaves the unidentified count — it
 * has been dealt with, and a count that kept nagging about junk would be a count nobody reads —
 * and it survives the lot closing, because for a stockbook bought sight-unseen the discarded tiles
 * are the only record of what the parcel actually held.
 *
 * The note is optional and the screen does not stop to ask for one: *junk* is a complete answer,
 * and demanding a sentence for it would make the cheap outcome the expensive one, which is how a
 * queue stops being worked through. `noteDiscardedTile` is where a note is added afterwards, on
 * the rare tile that deserves one.
 */
export async function discardTile(
  ownerId: string,
  tileId: string,
  note?: string | null
): Promise<void> {
  await discardTiles(ownerId, [tileId], note);
}

/**
 * Discard a **run of tiles** — the answer a card of junk needs most, and the one the selection bar
 * could not give.
 *
 * One tile is this call with one tile in it, exactly as {@link identifyTilesAsNewCopies} is the one
 * door for identification. The pass is **refused before anything is written**
 * ({@link loadSelectedTiles}), so a stale strip in a second tab costs a sentence rather than half a
 * card discarded with nothing saying which half.
 */
export async function discardTiles(
  ownerId: string,
  tileIds: string[],
  note?: string | null
): Promise<void> {
  const tiles = await loadSelectedTiles(ownerId, tileIds);
  for (const tile of tiles) {
    await prisma.scanTile.update({
      where: { id: tile.id },
      data: {
        state: "discarded",
        // A blank note leaves whatever is already there, which matters for exactly one tile: a
        // **parked** one (#597), whose note says what the doubt was. Discarding it is the answer to
        // that doubt turning out to be "nothing worth keeping", so *dark or light blue?* is a fair
        // record of why it went — and the screen sends a blank note on every discard, so clearing it
        // here would silently throw away the only sentence the collector wrote about the piece.
        note: note?.trim() || tile.note,
      },
    });
    await stampBatchIfFinished(tile.purchaseId, tile.batchNo);
  }
}

// ── Parking (#597) ────────────────────────────────────────────────────────────────────────────

/**
 * Set a tile aside as **still to be identified** — the piece that cannot be told apart from its
 * picture.
 *
 * Some variants are not settled on screen at all: a watermark, two shades of the same blue, a paper
 * difference. Settling one means leaving the desk for the colour key, the UV lamp or the reference
 * album, and doing that the moment each such piece turns up pays for the trip once per stamp. **The
 * value is not the flag; it is that the parked pieces collect**, so the trip is made once for
 * thirty of them — the same batching the whole scan-first pass is built on.
 *
 * So it is **neither of the two states it sits between**. Not `discarded`: that piece deliberately
 * became nothing and leaves the queue for good, while this one is still going to become a copy. Not
 * plain `unidentified` either, or working through the card would keep offering it, which is
 * precisely the interruption being avoided. It therefore keeps every door a waiting tile has —
 * {@link identifyTilesAsNewCopies} and {@link assignTileToCopy} take it, the strip's tick box
 * offers it, a back can still be paired onto it — and only leaves the *sweep*.
 *
 * **The note is the point, and it is optional.** *Watermark?* — *dark or light blue?* — *check perf
 * against Mi 200*: written while the doubt is fresh, read when the collector comes back and would
 * otherwise have to derive the doubt again from the picture that could not answer it. Optional for
 * the discard note's own reason: *something is off here* is a complete thought. The two differ in
 * **when** the sentence is asked for, and that difference is a fact about which case is ordinary: a
 * discard's note is the rare one, so it acts first and the note follows; a parked tile's is the
 * usual one, so the screen asks at the button and passes whatever was typed — blank included —
 * straight into this one write. {@link noteTile} is where it is changed afterwards.
 *
 * A parked tile can never finish a batch, which {@link stampBatchIfFinished} enforces by counting
 * it as outstanding: were it not, #578 would sweep the card's retained scan after thirty days and
 * the collector would come back to the doubtful piece to find the picture they came back for is
 * gone.
 */
export async function parkTile(
  ownerId: string,
  tileId: string,
  note?: string | null
): Promise<void> {
  await parkTiles(ownerId, [tileId], note);
}

/**
 * Set a **run of tiles** aside under one sentence.
 *
 * The state's whole value is that the parked pieces collect, so a run of them is the ordinary case
 * rather than a bulk convenience: a card of one definitive in two shades is thirty pieces posing one
 * question, and the note answers it once — *dark or light blue?* is as true of the thirtieth piece as
 * of the first. The note is written to **each** tile rather than kept anywhere shared: it is read
 * from the tile the collector opens months later, and a note that lived on a selection would be gone
 * by then.
 */
export async function parkTiles(
  ownerId: string,
  tileIds: string[],
  note?: string | null
): Promise<void> {
  const tiles = await loadSelectedTiles(ownerId, tileIds);
  for (const tile of tiles) {
    if (tile.state === "parked") {
      // Already where it is being asked to go — not an error worth a sentence, the note being all a
      // second park could be saying. It **fills a blank note and never replaces one**: this is only
      // reachable from a mixed run (the single tile's button is absent once it is parked), where the
      // parked pieces may be carrying doubts written on another day, and a sentence overwritten by a
      // press aimed at the pieces beside it would be gone with nothing saying so. Changing one is
      // the tile's own note field.
      if (note?.trim() && !tile.note?.trim()) await noteTile(ownerId, tile.id, note);
      continue;
    }
    await prisma.scanTile.update({
      where: { id: tile.id },
      data: { state: "parked", note: note?.trim() || null },
    });
    // No `stampBatchIfFinished`: a parked tile is outstanding, so it cannot be what finishes a
    // batch. Stated rather than left to the count, because this is the write the guarantee is about.
  }
}

// ── The shortlist a parked tile carries (#607) ────────────────────────────────────────────────

/**
 * Add a stamp to a tile's shortlist — one of the things this piece **could be**.
 *
 * Discovering that a piece cannot be identified from its picture is not free: to know that a
 * watermark or a shade decides it, the collector has already worked out which stamps it could be.
 * #597 kept the note and threw that narrowing away, so the return sitting started from the catalogue
 * again. This keeps it, and {@link listPurchaseScans} hands it back as one-press identifications.
 *
 * **Only on a tile still to be identified** (`loadOpenTile`), which is the same gate every other
 * working verb here passes: a shortlist on a tile that has already become a copy would be a
 * possibility list for a question with an answer. In practice it is the parked tile's, parking being
 * where the narrowing happens — but the state is not checked separately, because a candidate written
 * a moment before the tile is parked is the same fact as one written a moment after, and a refusal
 * there would only make the collector do the two in the app's preferred order.
 *
 * The stamp must be in the tile's **own collection**: a shortlist that could name another
 * collection's stamp would be offering to identify a piece as something this order cannot hold.
 *
 * Re-adding is a no-op rather than an error — `(tileId, stampId)` is the primary key, so the row
 * *is* the fact, and a second press of the same stamp in the picker means what the first did.
 */
export async function addTileCandidate(
  ownerId: string,
  tileIds: string[],
  stampId: string
): Promise<void> {
  const tiles = await loadSelectedTiles(ownerId, tileIds);
  const purchase = await prisma.purchase.findUniqueOrThrow({
    where: { id: tiles[0].purchaseId },
    select: { collectionId: true },
  });
  const stamp = await prisma.stamp.findFirst({
    where: { id: stampId, collectionId: purchase.collectionId },
    select: { id: true },
  });
  if (!stamp) throw new ScanValidationError("That stamp is not in this collection.");
  // Written to every ticked tile, because a shortlist built through a selection is a statement about
  // the run: five pieces narrowed to the same pair is one trip to the colour key, and it is read off
  // whichever of them the collector opens when they get back. The upsert is what makes a stamp
  // pressed twice — or pressed onto a run one tile already carries it on — mean what the first press
  // did.
  for (const tile of tiles) {
    await prisma.scanTileCandidate.upsert({
      where: { tileId_stampId: { tileId: tile.id, stampId } },
      create: { tileId: tile.id, stampId },
      update: {},
    });
  }
}

/** Take a stamp off a tile's shortlist. A possibility ruled out is the ordinary progress of the
 * work this state exists for, so removing one costs exactly what adding it did — and a stamp that
 * is not on the list is not an error, the end state being what was asked for either way. */
export async function removeTileCandidate(
  ownerId: string,
  tileIds: string[],
  stampId: string
): Promise<void> {
  const tiles = await loadSelectedTiles(ownerId, tileIds);
  // Off all of them, the mirror of adding: ruling a possibility out is a conclusion about the run,
  // and a stamp left standing on one tile of five would be the shortlist disagreeing with itself.
  await prisma.scanTileCandidate.deleteMany({
    where: { tileId: { in: tiles.map((t) => t.id) }, stampId },
  });
}

/**
 * Write (or clear) a tile's note.
 *
 * Two states carry one, for the same reason and in the same shape. A **discard** takes one click
 * and asks for nothing, because on a parcel full of junk it is the frequent answer and a note form
 * in front of it would make the cheap outcome the expensive one; the note is reachable afterwards —
 * here — on the tile that earns one. **Parking** (#597) is the same bargain: the doubt is written
 * while it is fresh, but never demanded.
 *
 * What a note is *for* differs by state and is worth keeping straight: a discard's says what the
 * parcel held (*thinned*), for the sight-unseen stockbook where the tiles are the only record; a
 * parked one's says what to check (*watermark?*), for the collector returning to it with the lamp.
 */
export async function noteTile(
  ownerId: string,
  tileId: string,
  note: string | null
): Promise<void> {
  const tile = await loadTileForOwner(ownerId, tileId);
  if (tile.state !== "discarded" && tile.state !== "parked") {
    throw new ScanValidationError("Only a discarded or parked tile carries a note.");
  }
  await prisma.scanTile.update({
    where: { id: tile.id },
    data: { note: note?.trim() || null },
  });
}

/**
 * Put a discarded or a parked tile back in the queue.
 *
 * One door for both, because it is one move: the tile returns to `unidentified` and its note goes
 * with the state that carried it. For a **discard** it is the undo that makes the one-click discard
 * safe — its images never left, so there is nothing to restore, and a mis-click on a card of forty
 * should not need a re-cut. For a **parked** tile (#597) it is the *ordinary* end of the wait: the
 * answer is known, so the piece rejoins the queue and the doubt it was carrying is spent.
 *
 * A **consumed** tile has no such door — its images belong to a copy now, and the way back is to
 * delete that copy.
 */
export async function returnTilesToQueue(ownerId: string, tileIds: string[]): Promise<void> {
  // Loaded and checked in full first, the rule every plural verb here follows: a run of parked
  // pieces put back together is one act, and one of them having been discarded in another tab is a
  // sentence rather than half a run restored.
  const tiles = [];
  for (const tileId of [...new Set(tileIds)]) {
    const tile = await loadTileForOwner(ownerId, tileId);
    if (tile.state !== "discarded" && tile.state !== "parked") {
      throw new ScanValidationError("Only a discarded or parked tile can be put back.");
    }
    tiles.push(tile);
  }
  for (const tile of tiles) await restoreTile(tile);
}

async function restoreTile(tile: { id: string; purchaseId: string; batchNo: number }) {
  await prisma.scanTile.update({
    where: { id: tile.id },
    data: { state: "unidentified", note: null },
  });
  // The shortlist goes with the note, and for the same reason (#607): putting a piece back is the
  // collector saying the doubt is spent — either it was a mis-click or the answer is now known — so
  // what was written *about the doubt* is spent with it. A discard is the other case and keeps both,
  // being the only record of what a sight-unseen parcel held.
  await prisma.scanTileCandidate.deleteMany({ where: { tileId: tile.id } });
  // The batch has something waiting again, so it is no longer finished with. Clearing this is what
  // keeps #578 from sweeping the original out from under a batch still being worked. A parked tile
  // never let it be stamped in the first place, so this is a no-op on that path and the guard on
  // `batchDoneAt: { not: null }` says so.
  await prisma.scanSheet.updateMany({
    where: { purchaseId: tile.purchaseId, batchNo: tile.batchNo, batchDoneAt: { not: null } },
    data: { batchDoneAt: null },
  });
}

// ── The two writes every outcome shares ───────────────────────────────────────────────────────

/** Hand the tile's `Photo` rows to the copy, mark the tile consumed, and stamp the batch if that
 * was the last one waiting — one transaction, because a tile whose images moved but whose state
 * did not would be a tile the re-cut guard no longer protects. */
async function consumeTile(tileId: string, itemId: string): Promise<void> {
  const tile = await prisma.$transaction(async (tx) => {
    await movePhotosToItem(tx, tileId, itemId);
    // **Nothing survives the identification** (#607). What the copy became is the record, and
    // refinement history (#101/#130) is where a later change of mind is written — a shortlist left
    // standing beside it would be a second, staler account of the same question, and the first place
    // it would be read is the tile dialog of a piece that is already in the box.
    await tx.scanTileCandidate.deleteMany({ where: { tileId } });
    return tx.scanTile.update({
      where: { id: tileId },
      data: { state: "consumed", itemId },
      select: { purchaseId: true, batchNo: true },
    });
  });
  await stampBatchIfFinished(tile.purchaseId, tile.batchNo);
}

/**
 * Reassign a tile's crops to a copy — **one column on the row that already exists**.
 *
 * This is what ADR-0033 §2 bought by making a tile's images `Photo` rows under a fourth owner
 * rather than something of their own: no bytes are copied, no second row is created, and the
 * storage total, the serving route and every cleanup keep working because nothing about the photo
 * changed except who owns it.
 *
 * `sortOrder` is set to the copy's own convention (front before back), since a tile's rows were
 * written in cut order and a copy reads them in role order.
 */
async function movePhotosToItem(
  tx: Prisma.TransactionClient,
  tileId: string,
  itemId: string
): Promise<void> {
  const photos = await tx.photo.findMany({
    where: { tileId },
    select: { id: true, role: true },
  });
  for (const photo of photos) {
    await tx.photo.update({
      where: { id: photo.id },
      data: { tileId: null, itemId, sortOrder: photo.role === "back" ? 1 : 0 },
    });
  }
}

/** #149's auto-seed, reached from the scan path: the first photograph of a stamp identifies the
 * catalogue entry too. Best-effort — the copy and its images are already committed, and a stamp
 * that stays imageless is a smaller thing to go wrong than a failed identification. */
async function seedStampImage(ownerId: string, itemId: string): Promise<void> {
  const front = await prisma.photo.findFirst({
    where: { itemId, role: "front" },
    select: { id: true },
  });
  if (!front) return;
  await autoSeedStampMainFromFront(ownerId, itemId, front.id).catch((err) => {
    console.error("Auto-promote tile front → stamp main failed", err);
  });
}

/**
 * Stamp the batch when its **last** tile leaves `unidentified`.
 *
 * From that moment the batch can never be re-cut — a consumed tile refuses it (#566), because
 * re-cutting would delete `Photo` rows a copy now owns — so the retained original, the largest
 * object the app stores, has no remaining function. Nothing in #567 reads this; #578's retention
 * sweep does, on the closed-offer photos' TTL-after-a-terminal-state pattern (#512).
 *
 * Written on the batch's **sheets** because that is what the sweep will delete, and only where it
 * is not already set, so a batch finished with twice keeps the first moment.
 */
async function stampBatchIfFinished(purchaseId: string, batchNo: number): Promise<void> {
  // **A batch with a parked tile is not finished with** (#597). That tile is still going to become
  // a copy, and the retention sweep taking the card's scan would remove the very picture the
  // collector is coming back to it for — so both outstanding states count here, and the list is
  // `scan-sheets.ts`' one rather than a second reading of what "still waiting" means.
  const waiting = await prisma.scanTile.count({
    where: { purchaseId, batchNo, state: { in: [...OPEN_TILE_STATES] } },
  });
  if (waiting > 0) return;
  await prisma.scanSheet.updateMany({
    where: { purchaseId, batchNo, batchDoneAt: null },
    data: { batchDoneAt: new Date() },
  });
}

// ── Loading ───────────────────────────────────────────────────────────────────────────────────

async function loadTileForOwner(ownerId: string, tileId: string) {
  const tile = await prisma.scanTile.findUnique({
    where: { id: tileId },
    select: {
      id: true,
      purchaseId: true,
      batchNo: true,
      state: true,
      note: true,
      // Only a consumed tile has one, and only `reidentifyTileCopy` reads it — the copy the tile
      // became, which is what a correction re-points.
      itemId: true,
      photos: { select: { id: true, role: true } },
    },
  });
  if (!tile) throw new ScanAuthError("Tile not found or access denied.");
  await assertScanPurchaseOwner(ownerId, tile.purchaseId);
  return tile;
}

/**
 * A tile can only be worked on while it is still outstanding. Consumed twice would give two copies
 * the same images — except that the second move would find none, so the second copy would simply
 * get nothing and nobody would be told.
 *
 * **Parked counts as outstanding** (#597), and that is the whole point of the state: the return
 * sitting is exactly when several settle at once — five parked pieces that turn out to be the same
 * variant are identified in one pass — so every path that works a waiting tile takes a parked one
 * unchanged. Only the two real ends are refused.
 */
/**
 * The tiles a **selection** names, every one of them checked before any of them is written to.
 *
 * The rule {@link identifyTilesAsNewCopies} states for identification, applied to the outcomes that
 * followed it: a stale strip in a second tab should cost a sentence rather than a half-worked
 * selection with nothing on screen saying which half. A tile named twice is refused rather than
 * quietly de-duplicated, since a count on the bar that is not the number of tiles written to is the
 * kind of disagreement nobody notices, and everything here must stay on **one order** — the pass is
 * about a card on the desk.
 */
async function loadSelectedTiles(ownerId: string, tileIds: string[]) {
  if (tileIds.length === 0) throw new ScanValidationError("Pick at least one tile.");
  if (new Set(tileIds).size !== tileIds.length) {
    throw new ScanValidationError("The same tile was named twice.");
  }
  const tiles: Awaited<ReturnType<typeof loadOpenTile>>[] = [];
  for (const tileId of tileIds) tiles.push(await loadOpenTile(ownerId, tileId));
  if (tiles.some((t) => t.purchaseId !== tiles[0].purchaseId)) {
    throw new ScanValidationError("Those tiles are not all on this order.");
  }
  return tiles;
}

async function loadOpenTile(ownerId: string, tileId: string) {
  const tile = await loadTileForOwner(ownerId, tileId);
  if (!isOpenTileState(tile.state)) {
    throw new ScanValidationError(
      tile.state === "consumed"
        ? "That tile has already become a copy."
        : "That tile was discarded. Put it back first if you want to identify it."
    );
  }
  return tile;
}
