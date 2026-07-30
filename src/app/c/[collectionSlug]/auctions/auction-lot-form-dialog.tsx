"use client";

import { useMemo, useState, useTransition } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { PurchaseContactSelect } from "@/app/c/[collectionSlug]/purchases/purchase-contact-select";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { STAMP_SECONDARY_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import type { CollectionAreaData } from "@/lib/areas";
import { deriveAuctionSaleName } from "@/lib/auction-rules";
import type { AuctionLotLineRaw, AuctionLotRaw, AuctionSaleRaw } from "@/app/actions/auctions";
import { AuctionLotLineDialog, type LineSelectionSummary } from "./auction-lot-line-dialog";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import {
  useAuctionSales,
  useOpenAuctionSale,
  type AuctionLotView,
} from "./use-auctions-query";
import {
  formatAmountInput,
  formatDay,
  fromLocalInputValue,
  toLocalInputValue,
} from "./auction-format";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const FIELD_GAP: React.CSSProperties = { marginBottom: "1rem" };

/** The two-column template the dialog's paired fields share, so a short field always sits above a
 * short one and a long one above a long one. */
const GRID_TWO: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 2fr",
  columnGap: "0.75rem",
};

const NOTE: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.4,
};

interface AuctionLotFormDialogProps {
  mode: "add" | "edit";
  collectionId: string;
  /** The lot being edited; absent when adding. */
  lot?: AuctionLotView;
  /** Adding **into a known sale** — from that sale's own screen, where the settlement is the thing
   * on screen already. The seller/platform pickers and the matching are then beside the point: the
   * question they answer has been answered by where the collector is standing. */
  fixedSale?: { id: string; name: string; currency: string; endsAt: string | null };
  /** For the composition section's stamp picker and catalog-number formatting (#353). Absent on
   * screens that do not load areas — the section is then simply not offered. */
  areas?: CollectionAreaData[];
  onClose: () => void;
  onSaved: () => void;
}

/** A line the collector has entered but that does not exist yet — the lot is created with it. */
interface PendingLine {
  key: string;
  raw: AuctionLotLineRaw;
  /** How to render it before it exists — a whole-issue pick has no stamp to read back from. */
  summary: LineSelectionSummary;
}

/**
 * Add or edit a lot (#352).
 *
 * Adding **never starts by picking a sale**. A sale is a settlement bucket — one parcel from one
 * seller — and it is not what the collector has in mind while looking at a listing; seller and
 * platform are. So those two are the first fields, and the sale follows: the open sale for that
 * pair is *proposed*, visibly, with the option to start a new one instead. Proposing rather than
 * attaching silently is the point — winning something from a seller after their parcel has already
 * shipped has to start a second sale, and only the collector knows that has happened.
 *
 * Editing keeps the same fields and swaps the matching for a plain sale picker: by then the sale
 * exists, and moving a lot into the right parcel is the whole reason to touch it.
 */
export function AuctionLotFormDialog({
  mode,
  collectionId,
  lot,
  fixedSale,
  areas,
  onClose,
  onSaved,
}: AuctionLotFormDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  const [sellerId, setSellerId] = useState(lot?.sellerId ?? "");
  const [sellerName, setSellerName] = useState(lot?.sellerName ?? "");
  const [platformId, setPlatformId] = useState(lot?.platformId ?? "");
  const [platformName, setPlatformName] = useState(lot?.platformName ?? "");
  /** Bumped whenever the platform is pre-filled for the collector: the picker is a create-on-type
   * text input that seeds its own state once, so re-seeding it means remounting it. */
  const [platformSeed, setPlatformSeed] = useState(0);
  /** Set as soon as the collector types in or picks a platform themselves. A remembered platform is
   * a suggestion, and a suggestion must never overwrite an answer. */
  const [platformTouched, setPlatformTouched] = useState(false);
  /** The seller whose remembered platform has already been poured in, so it happens once per
   * seller rather than on every render the query settles. */
  const [platformSeededFor, setPlatformSeededFor] = useState("");
  /** The sale whose closing date has already been poured into the Closes field, and whether the
   * collector has since answered that field themselves. */
  const [endsAtSeededFor, setEndsAtSeededFor] = useState("");
  const [endsAtTouched, setEndsAtTouched] = useState(false);
  /** Explicitly refusing the proposed sale — a second parcel from the same seller. */
  const [startNewSale, setStartNewSale] = useState(false);

  const [saleId, setSaleId] = useState(lot?.saleId ?? "");
  const [lotNo, setLotNo] = useState(lot?.lotNo ?? "");
  const [title, setTitle] = useState(lot?.title ?? "");
  const [url, setUrl] = useState(lot?.url ?? "");
  const [endsAt, setEndsAt] = useState(toLocalInputValue(lot?.endsAt));
  const [startingPrice, setStartingPrice] = useState(lot?.startingPrice ?? "");
  const [currentBid, setCurrentBid] = useState(lot?.currentBid ?? "");
  const [myBid, setMyBid] = useState(lot?.myBid ?? "");
  const [maxBid, setMaxBid] = useState(lot?.maxBid ?? "");
  const [notes, setNotes] = useState(lot?.notes ?? "");

  // The composition, built in memory and written **with** the lot (#353). Capturing a listing and
  // saying what is in it is one act — the collector is reading the description as they type — so
  // making them save an empty lot and go find it again is the shape that leaves lots undescribed.
  // Only while adding: growing a lot afterwards happens on the sale's screen, where the lines are
  // already on display.
  const composing = mode === "add" && !!areas;
  const [lines, setLines] = useState<PendingLine[]>([]);
  const [addingLine, setAddingLine] = useState(false);
  // The three dictionaries are read here only to *name* what the pending lines hold — the entry
  // dialog loads its own.
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const { data: certificateStatuses = [] } = useCollectionCertificateStatuses(collectionId);
  const { data: formats = [] } = useCollectionFormats(collectionId);
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas ?? [], collectionId);
  const nameById = (rows: { id: string; name: string }[], id: string) =>
    rows.find((r) => r.id === id)?.name ?? null;

  // The matching lookup. Only meaningful while adding, and only once both parties resolve to a
  // contact — a name typed but not matched has no id yet, and no sale can be proposed for it.
  const { data: match, isFetching: matching } = useOpenAuctionSale(
    collectionId,
    sellerId,
    platformId,
    mode === "add" && !fixedSale
  );
  const proposal = match?.proposal ?? null;
  const sellerDefaults = match?.sellerDefaults ?? null;

  // Every sale, for the edit-mode move. Fetched only in edit mode.
  const { data: sales = [] } = useAuctionSales(collectionId);

  // Pre-fill the platform this seller was last tracked on — stored on the seller itself, so it
  // holds across devices and sessions. Adjusted **during render** rather than in an effect (the
  // value arrives with a query), once per seller, and never over a platform the collector has
  // already answered for themselves.
  const rememberedPlatform =
    mode === "add" && !fixedSale ? (sellerDefaults?.defaultPlatform ?? null) : null;
  if (rememberedPlatform && sellerId && platformSeededFor !== sellerId && !platformTouched) {
    setPlatformSeededFor(sellerId);
    setPlatformId(rememberedPlatform.id);
    setPlatformName(rememberedPlatform.name);
    setPlatformSeed((n) => n + 1);
  }

  // The settlement this lot is going into: the one the collector opened, the one proposed for the
  // seller + platform pair, or none yet.
  const attachingTo =
    mode === "add" && !fixedSale && proposal && !startNewSale ? proposal : null;
  const currency =
    mode === "edit"
      ? (lot?.currency ?? "")
      : (fixedSale?.currency ?? attachingTo?.currency ?? sellerDefaults?.defaultCurrency ?? "");

  // A sale's own `endsAt` exists for exactly this: it is a **default for new lots in the sale**,
  // never the sale's own outcome date. A house sale closes all its lots on one evening, so
  // attaching to one should fill the closing time in — the collector then adjusts it only for the
  // marketplace case, where every lot closes at its own moment. Once per proposed sale, and never
  // over a time already typed.
  const closingFrom = fixedSale ?? attachingTo;
  if (closingFrom?.endsAt && endsAtSeededFor !== closingFrom.id && !endsAtTouched) {
    setEndsAtSeededFor(closingFrom.id);
    setEndsAt(toLocalInputValue(closingFrom.endsAt));
  }

  const derivedSaleName = useMemo(
    () => deriveAuctionSaleName(sellerName.trim() || "Seller", platformName.trim() || "Platform"),
    [sellerName, platformName]
  );

  const saleRaw: AuctionSaleRaw = {
    sellerId: sellerId || null,
    sellerName: sellerName || null,
    platformId: platformId || null,
    platformName: platformName || null,
    // A sale started from here takes the derived name and the seller's own defaults; both are
    // edited on the sale itself, which is where a house sale gets its real name.
    name: "",
    url: "",
    endsAt: "",
    currency: "",
    shippingCost: "",
    premiumPercent: "",
    premiumFixed: "",
  };

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    const raw: AuctionLotRaw = {
      auctionSaleId: mode === "edit" ? saleId : (fixedSale?.id ?? null),
      sale: mode === "edit" || fixedSale ? null : saleRaw,
      startNewSale: mode === "add" && !fixedSale && startNewSale,
      lotNo,
      url,
      title,
      // Converted here, in the browser: the collector's own time zone is known nowhere else.
      endsAt: fromLocalInputValue(endsAt),
      startingPrice,
      currentBid,
      myBid,
      maxBid,
      notes,
      lines: composing ? lines.map((l) => l.raw) : undefined,
    };
    startTransition(async () => {
      const actions = await import("@/app/actions/auctions");
      const result =
        mode === "add"
          ? await actions.createAuctionLotAction(collectionId, raw)
          : await actions.updateAuctionLotAction(collectionId, lot!.id, raw);
      if (result.status === "success") onSaved();
      else setError(result.message);
    });
  }

  // Wider than the default cap: the closing time and three amounts share one row, and a
  // `datetime-local` field is the widest control in the app.
  return (
    <DialogShell title={mode === "add" ? "Add auction lot" : "Edit lot"} onClose={onClose} maxWidth="40rem">
      {/* A real form, so Enter in any field saves the lot — the pattern every other dialog here
          follows. The action button is the form's submit; a textarea keeps Enter for itself. */}
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={submit}
      >
        <DialogBody>
          {fixedSale ? (
            /* Nothing to decide: the sale is the screen this was opened from. Stated rather than
               silently assumed, because every other way of adding a lot shows which parcel it lands
               in. */
            <p
              style={{
                ...NOTE,
                margin: "0 0 1rem",
                color: "var(--color-text-primary)",
                fontSize: "0.8125rem",
              }}
            >
              Adding to <strong>{fixedSale.name}</strong>
              {fixedSale.currency ? ` · ${fixedSale.currency}` : ""}.
            </p>
          ) : mode === "add" ? (
            <>
              {/* The pair that decides the settlement, side by side: they are one question — who is
                  this being bought from, and through what — and the proposal below answers it. */}
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <LabelWithError htmlFor="auction-seller">Seller</LabelWithError>
                  <PurchaseContactSelect
                    collectionId={collectionId}
                    idFieldName="sellerId"
                    nameFieldName="sellerName"
                    initialContactId={sellerId}
                    initialContactName={sellerName}
                    inputId="auction-seller"
                    placeholder="Auction house or seller"
                    role="seller"
                    onSelectionChange={(id, name) => {
                      setSellerId(id);
                      setSellerName(name);
                      // A different pair is a different question; a refusal of the old proposal must
                      // not carry over to the new one.
                      setStartNewSale(false);
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <LabelWithError htmlFor="auction-platform">Platform</LabelWithError>
                  <PurchaseContactSelect
                    // Remounted when a remembered platform is poured in: the picker seeds its own
                    // state from these props once, on mount.
                    key={platformSeed}
                    collectionId={collectionId}
                    idFieldName="platformId"
                    nameFieldName="platformName"
                    initialContactId={platformId}
                    initialContactName={platformName}
                    inputId="auction-platform"
                    placeholder="Where it is listed"
                    role="platform"
                    onSelectionChange={(id, name) => {
                      setPlatformId(id);
                      setPlatformName(name);
                      setPlatformTouched(true);
                      setStartNewSale(false);
                    }}
                  />
                </div>
              </div>
              <p style={{ ...NOTE, marginBottom: "1rem" }}>
                A house selling directly is both. A house listing through an aggregator is the seller;
                the aggregator is the platform.
              </p>

              {/* The proposal. Shown as soon as both parties resolve to a contact. */}
              <div
                style={{
                  ...FIELD_GAP,
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.5rem",
                  padding: "0.75rem",
                  background: "var(--color-bg-page)",
                }}
              >
                <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-text-secondary)" }}>
                  Settlement
                </div>
                {!sellerId || !platformId ? (
                  <p style={NOTE}>
                    Pick a seller and a platform and the parcel this lot settles into follows from
                    them — you never have to go and find it.
                  </p>
                ) : matching && !match ? (
                  <p style={NOTE}>Looking for an open sale…</p>
                ) : attachingTo ? (
                  <>
                    <p style={{ ...NOTE, color: "var(--color-text-primary)" }}>
                      Adding to <strong>{attachingTo.name}</strong> — {attachingTo.lotCount} lot
                      {attachingTo.lotCount === 1 ? "" : "s"}, {attachingTo.currency}
                      {attachingTo.endsAt ? `, closes ${formatDay(attachingTo.endsAt)}` : ""}.
                    </p>
                    <button
                      type="button"
                      onClick={() => setStartNewSale(true)}
                      style={{
                        marginTop: "0.5rem",
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        color: "var(--color-accent)",
                        textDecoration: "underline",
                      }}
                    >
                      Start a new sale instead
                    </button>
                    <p style={NOTE}>
                      Do that when the previous parcel has already shipped — it settles separately, so
                      its shipping is distributed separately.
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ ...NOTE, color: "var(--color-text-primary)" }}>
                      Starting a new sale: <strong>{derivedSaleName}</strong>
                      {sellerDefaults?.defaultCurrency ? ` · ${sellerDefaults.defaultCurrency}` : ""}
                      {sellerDefaults?.buyerPremiumPercent
                        ? ` · ${sellerDefaults.buyerPremiumPercent}% premium`
                        : ""}
                      {sellerDefaults?.defaultShippingCost
                        ? ` · ${sellerDefaults.defaultShippingCost} shipping`
                        : ""}
                    </p>
                    <p style={NOTE}>
                      Seeded from the seller&apos;s defaults and editable on the sale itself. Changing
                      the seller later never re-prices a parcel already tracked.
                    </p>
                    {proposal && startNewSale && (
                      <button
                        type="button"
                        onClick={() => setStartNewSale(false)}
                        style={{
                          marginTop: "0.5rem",
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          fontSize: "0.75rem",
                          color: "var(--color-accent)",
                          textDecoration: "underline",
                        }}
                      >
                        Use {proposal.name} after all
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div style={FIELD_GAP}>
              <LabelWithError htmlFor="auction-sale">Sale</LabelWithError>
              <select
                id="auction-sale"
                value={saleId}
                onChange={(e) => setSaleId(e.target.value)}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {sales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.currency}
                  </option>
                ))}
              </select>
              <p style={NOTE}>
                Move the lot into another parcel when the one it landed in turned out to be the wrong
                one. Amounts are in the sale&apos;s currency.
              </p>
            </div>
          )}

          {/* The link comes first: it is what the collector has in hand — pasted straight off the
              listing they are looking at — and the lot number and title are read out of it. */}


          {/* Three lines, each one question. **When and where** the lot is, then **what** it is,
              then every amount side by side — the prices are read and typed as one pass off the
              listing, and splitting them across lines made the dialog look like five unrelated
              groups. The first two lines share a template, so the short fields stack in one column
              and the long ones in the other. */}
          <div style={GRID_TWO}>
            <div style={{ minWidth: 0 }}>
              <LabelWithError htmlFor="auction-ends-at">Closes</LabelWithError>
              <input
                id="auction-ends-at"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => {
                  setEndsAtTouched(true);
                  setEndsAt(e.target.value);
                }}
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <LabelWithError htmlFor="auction-url">Listing URL</LabelWithError>
              <input
                id="auction-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                style={INPUT_STYLE}
              />
            </div>
          </div>

          <p style={{ ...NOTE, marginBottom: "1rem" }}>
            The closing time is in your own time zone. The watchlist is ordered by it, and it is what
            a bid&apos;s age is measured against.
          </p>

          <div style={{ ...GRID_TWO, marginBottom: "1rem" }}>
            <div style={{ minWidth: 0 }}>
              <LabelWithError htmlFor="auction-lot-no">Lot number</LabelWithError>
              <input
                id="auction-lot-no"
                value={lotNo}
                onChange={(e) => setLotNo(e.target.value)}
                placeholder="385"
                {...NO_AUTOFILL}
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <LabelWithError htmlFor="auction-title">Title</LabelWithError>
              <input
                id="auction-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                // Blank is not nameless: the lot is called after what it holds (#353), and the
                // placeholder shows the very string the lists will use.
                placeholder={lot?.derivedTitle ?? "What the listing calls it"}
                style={INPUT_STYLE}
              />
            </div>
          </div>

          {/* Every amount on one line: the auction's two, then yours. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              columnGap: "0.75rem",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <LabelWithError htmlFor="auction-start">Starting price</LabelWithError>
              <NumericInput
                id="auction-start"
                value={startingPrice}
                onChange={(e) => setStartingPrice(e.target.value)}
                // Committing the field is committing the amount: show it the way it will be stored.
                onBlur={(e) => setStartingPrice(formatAmountInput(e.target.value))}
                placeholder="—"
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <LabelWithError htmlFor="auction-bid">Current bid</LabelWithError>
              <NumericInput
                id="auction-bid"
                value={currentBid}
                onChange={(e) => setCurrentBid(e.target.value)}
                onBlur={(e) => setCurrentBid(formatAmountInput(e.target.value))}
                placeholder="—"
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <LabelWithError htmlFor="auction-my-bid">My bid</LabelWithError>
              <NumericInput
                id="auction-my-bid"
                value={myBid}
                onChange={(e) => setMyBid(e.target.value)}
                onBlur={(e) => setMyBid(formatAmountInput(e.target.value))}
                placeholder="—"
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <LabelWithError htmlFor="auction-max">My ceiling</LabelWithError>
              <NumericInput
                id="auction-max"
                value={maxBid}
                onChange={(e) => setMaxBid(e.target.value)}
                onBlur={(e) => setMaxBid(formatAmountInput(e.target.value))}
                placeholder="—"
                style={INPUT_STYLE}
              />
            </div>
          </div>
          <p style={{ ...NOTE, marginBottom: "1rem" }}>
            Amounts are in {currency || "the sale's currency"}: the current bid is what the lot
            stands at, <em>my bid</em> is what you have placed at the platform, and the ceiling is
            what the lot is worth to you all-in, premium included.
          </p>

          {composing && (
            <div style={FIELD_GAP}>
              <LabelWithError>Contents</LabelWithError>
              {lines.length > 0 && (
                <div
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: "0.5rem",
                    overflow: "clip",
                    marginBottom: "0.5rem",
                  }}
                >
                  {lines.map((entry, idx) => (
                    <div
                      key={entry.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.5rem 0.75rem",
                        borderBottom:
                          idx === lines.length - 1 ? undefined : "1px solid var(--color-border)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: "0.3rem",
                          }}
                        >
                          {entry.summary.catalogLabels.map((label) => (
                            <span key={label} style={STAMP_SECONDARY_CHIP}>
                              {label}
                            </span>
                          ))}
                          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-primary)" }}>
                            {entry.summary.label}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                          {[
                            nameById(conditions, entry.raw.conditionId),
                            entry.raw.certificateStatusId
                              ? nameById(certificateStatuses, entry.raw.certificateStatusId)
                              : null,
                            entry.raw.formatId ? nameById(formats, entry.raw.formatId) : null,
                            Number(entry.raw.quantity || "1") > 1 ? `×${entry.raw.quantity}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="Remove this line"
                        onClick={() => setLines(lines.filter((l) => l.key !== entry.key))}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--color-text-muted)",
                          fontSize: "0.875rem",
                          lineHeight: 1,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => setAddingLine(true)}
                style={{
                  padding: "0.375rem 0.75rem",
                  border: "1px dashed var(--color-border-strong)",
                  borderRadius: "0.375rem",
                  background: "none",
                  cursor: "pointer",
                  fontSize: "0.8125rem",
                  fontWeight: 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                + Add line
              </button>
              <p style={NOTE}>
                What the lot holds, saved together with it. Optional — a lot can always be described
                later from the sale&apos;s screen. Its catalogue value follows from these lines —
                and so does its name, when you leave the title blank.
              </p>
            </div>
          )}

          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="auction-notes">Notes</LabelWithError>
            <textarea
              id="auction-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Condition doubts, what to check before bidding…"
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>
        </DialogBody>

        <DialogActions
          actionLabel={isPending ? "Saving…" : mode === "add" ? "Add lot" : "Save"}
          disabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>

      {/* Entering a line is its own two modals — the stamp browser, then condition and the rest.
          It sits **outside the `<form>` above**, and that placement is load-bearing rather than
          tidy: a React portal propagates events along the *React* tree, not the DOM one, so a
          nested dialog's own submit would bubble into this form's `onSubmit` and create the lot —
          with the line it was submitting not yet in state, i.e. an empty lot, the moment the
          collector confirmed a condition. Nothing is written here either way: the lot and its lines
          are saved together by this dialog's own action. */}
      {addingLine && areas && (
        <AuctionLotLineDialog
          collectionId={collectionId}
          areas={areas}
          vendorMapFor={vendorMapFor}
          primaryVendorByArea={primaryVendorByArea}
          isPending={isPending}
          onClose={() => setAddingLine(false)}
          onSubmit={(raw, summary) => {
            setLines((prev) => [...prev, { key: `${Date.now()}-${prev.length}`, raw, summary }]);
            setAddingLine(false);
          }}
        />
      )}
    </DialogShell>
  );
}
