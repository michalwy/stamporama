"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { OfferPlatformItemsCard } from "./offer-platform-items-card";
import { AssistantOutcome, ListViaAssistantButton } from "../assistant-listing";
import type { AssistantHandoff } from "../assistant-handoff";
import { useOfferNeighbours } from "../use-offers-query";
import { offerListContextQuery, type OfferListContext } from "../list-context";
import { hasItemGaps, itemGapSummary, listingItemGaps } from "@/lib/offer-listing-wizard";
import { isAuctionListing } from "@/lib/offer-rules";
import { isListedState } from "@/lib/offer-listing-drift";
import type { ReadyBlocker } from "@/lib/offer-photo-readiness";
import type { OfferDetail } from "@/lib/offers";
import type { ItemListItem } from "@/lib/items";
import type { CollectionAreaData } from "@/lib/areas";

// The **listing wizard** (#730): one guided walk from an assembled offer to a live listing, over the
// three questions a listing session actually asks in order — *are the items answered for*, *what is
// it worth*, *post it* — each of which is today a card, a field and a button scattered down a long
// detail screen.
//
// It is a **dialog** and not a screen of its own. Every step is a view onto something the offer's own
// page already draws, and the two other shapes both cost more than they give: a sub-route would
// re-fetch the offer and re-state its header, and a stepped mode over the page itself would rewire
// the screen that all the other work is done on. A dialog leaves the offer underneath, intact, one
// Escape away — which matters because the wizard is a walk a collector steps *out of* the moment
// something needs fixing somewhere else.
//
// **Nothing here is a gate.** The first step names what its items are still missing and lets the
// collector go on anyway (chosen deliberately when the wizard was designed): every one of those gaps
// is already reported by the offer's own ready blockers (#418) and refused by **List via Assistant**
// itself, and a second, stricter rule enforced only inside this dialog would be a rule no other
// surface knows about. What the wizard adds is the *order*, and one summary per step — not a new
// authority over what may be posted.
//
// It is offered wherever the Assistant can list at all (`hasListingModule`), not on Colnect alone:
// the item list is drawn on every platform since #669, price and photos are nobody's speciality, and
// the third step is the same handoff everywhere. Nothing in the three steps is Colnect's.
//
// The dialog drives the **screen's** Assistant handoff rather than starting one of its own. The
// hidden element the extension answers on belongs to the detail panel, and a second hook here would
// be a second element racing the first for the same reply.

const STEPS = [
  { key: "items", title: "Items" },
  { key: "price", title: "Price" },
  { key: "publish", title: "Publish" },
] as const;

type WizardStep = (typeof STEPS)[number]["key"];

const SECTION_TITLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
};

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  lineHeight: 1.6,
  color: "var(--color-text-muted)",
};

const WARNING_LINE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  color: "var(--color-warning)",
};

const OK_LINE: React.CSSProperties = {
  ...WARNING_LINE,
  color: "var(--color-accent)",
};

const INPUT_STYLE: React.CSSProperties = {
  width: "9rem",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  fontVariantNumeric: "tabular-nums",
};

/** The small "take this figure" button, the same one the detail screen puts beside its suggestion. */
const USE_BTN: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-accent)",
  color: "var(--color-accent)",
  background: "var(--color-accent-soft)",
  cursor: "pointer",
};

const LINK_CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px dashed var(--color-border-strong)",
  background: "var(--color-bg-page)",
  color: "var(--color-text-secondary)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

/** The Assistant button, given the footer's own weight here: on this step it *is* the action. */
const LIST_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.375rem",
  minHeight: "2.25rem",
  padding: "0.375rem 1rem",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: 600,
  border: "1px solid var(--color-accent)",
  color: "var(--color-accent)",
  background: "var(--color-accent-soft)",
  cursor: "pointer",
};

export interface OfferListingWizardDialogProps {
  collectionId: string;
  collectionSlug: string;
  offer: OfferDetail;
  /** The offer's copies, as the item card below reads them. */
  copies: ItemListItem[];
  areas: CollectionAreaData[];
  /** The filtered list this offer was opened from (#429), when it was opened from one — what the
   *  walk to the next offer follows. */
  listContext: OfferListContext | null;
  /** The screen's own Assistant state, passed in rather than re-derived: one handoff per screen. */
  assistantPresent: string | null;
  handoff: AssistantHandoff | null;
  handoffRunning: boolean;
  /** Why the last step's action is not offered at all, or null when it is — the same condition the
   *  header's button is drawn under (Ready, or a Preparing offer that passes the ready gate, #554).
   *  A **sentence**, computed by the screen, because what is missing at that point is a set or a
   *  price rather than a listing precondition: those come through `blockers` and are named there. */
  cannotListReason: string | null;
  /** What would make the Assistant refuse, counted exactly as the header's button counts it. */
  listingBlockerCount: number;
  /** What is left to fix before this offer can be posted, minus the photo half the run fixes itself
   *  (#727) — rendered in full here, where there is room for the whole sentence. */
  blockers: ReadyBlocker[];
  /** The click marks the offer Ready on its way out (#554). */
  marksReady: boolean;
  /** The click generates the listing photos first (#727). */
  generatesPhotos: boolean;
  isPending: boolean;
  onList: () => void;
  onDismissHandoff: () => void;
  onPatchPrice: (field: "price" | "startingPrice", value: string) => void;
  onClose: () => void;
}

export function OfferListingWizardDialog({
  collectionId,
  collectionSlug,
  offer,
  copies,
  areas,
  listContext,
  assistantPresent,
  handoff,
  handoffRunning,
  cannotListReason,
  listingBlockerCount,
  blockers,
  marksReady,
  generatesPhotos,
  isPending,
  onList,
  onDismissHandoff,
  onPatchPrice,
  onClose,
}: OfferListingWizardDialogProps) {
  const [step, setStep] = useState<WizardStep>("items");
  const index = STEPS.findIndex((s) => s.key === step);

  const gaps = useMemo(
    () => listingItemGaps(offer.platformItems, copies),
    [offer.platformItems, copies]
  );

  // ── The price the step edits ───────────────────────────────────────────────
  // An auction's is its **starting** price (#449): that is the figure the seller states and the one
  // the ready gate asks for, while the price beside it is wherever the bidding has got to. A quick
  // buy has only the one.
  const auction = isAuctionListing(offer.listingType);
  const priceField = auction ? "startingPrice" : "price";
  const stored = auction
    ? (offer.startingPrice ?? "")
    : offer.price === "0.00"
      ? ""
      : offer.price;
  const [draft, setDraft] = useState(stored);
  // Re-seed from the record whenever it changes under us — taking a suggestion writes the field
  // through the screen's own patch, and the answer comes back as a new `offer`.
  const seeded = useRef(stored);
  useEffect(() => {
    if (seeded.current !== stored) {
      seeded.current = stored;
      setDraft(stored);
    }
  }, [stored]);

  const commitPrice = () => {
    const value = draft.trim();
    if (value === stored) return;
    seeded.current = value;
    onPatchPrice(priceField, value);
  };
  const takeSuggestion = (value: string) => {
    seeded.current = value;
    setDraft(value);
    onPatchPrice(priceField, value);
  };

  // The platform's own opening figure (#362/#553). Offered back only on an auction that still has no
  // starting price: it is a *creation-time* seed, so on an offer that already carries one, showing
  // it again would be inviting the collector to undo a decision they have already made.
  const platformDefault =
    auction && !offer.startingPrice ? offer.platformDefaultStartingPrice : null;

  // ── Where the walk goes next ───────────────────────────────────────────────
  // The list the collector came from, when they came from one — otherwise the batch this wizard is
  // for: the offers still being prepared on this platform. Either way it is #429's own machinery, so
  // the offer landed on carries the same walk and the same next/previous strip.
  const walkContext: OfferListContext = useMemo(
    () => listContext ?? { platformId: offer.platformId, states: ["preparing"] },
    [listContext, offer.platformId]
  );
  const { data: neighbours } = useOfferNeighbours(collectionId, offer.id, walkContext);
  // Read once and never again, which is what makes the link survive the listing: posting this offer
  // takes it out of a `preparing` filter, and a re-asked question would answer "you are not in this
  // list" at the very moment the collector wants the next one. The neighbours query holds its answer
  // for the life of the screen — `staleTime: Infinity`, and its key is not under the offers key the
  // detail writes invalidate — so this is the same position the strip at the top of the page shows.
  const nextId = neighbours?.nextId ?? null;
  const nextHref = nextId
    ? `/c/${collectionSlug}/offers/${nextId}${offerListContextQuery(walkContext)}&wizard=1`
    : null;

  // What the third step reports as done. The handoff's own `listed`/`activated` is the live answer
  // during a run; the offer's state is what says so on a screen reopened afterwards.
  const mine = handoff && handoff.offerId === offer.id ? handoff : null;
  const live = isListedState(offer.state);

  const next = () => {
    if (step === "price") commitPrice();
    const to = STEPS[Math.min(index + 1, STEPS.length - 1)];
    setStep(to.key);
  };
  const back = () => {
    if (step === "price") commitPrice();
    setStep(STEPS[Math.max(index - 1, 0)].key);
  };

  return (
    // No fixed `height`: the panel is as tall as the step in it, and the shell's own viewport cap
    // takes over only once a step is longer than the screen — a long item list scrolls inside the
    // body, everything else sits at its natural size. The three steps are genuinely different
    // heights, and a panel held at the viewport's height left the short ones as a field or two
    // stranded at the top of an empty box.
    <DialogShell
      title={`Listing wizard — ${offer.name ?? offer.label}`}
      onClose={onClose}
      maxWidth="60rem"
    >
      {/* The rail. Every step is reachable from every other one, in both directions: the steps are an
          order to work in, not a sequence of locks, and a collector who has just priced an offer and
          spotted an unmatched stamp should not have to walk backwards through Next to reach it. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.75rem 1.5rem",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        {STEPS.map((s, i) => {
          const current = s.key === step;
          const flagged = s.key === "items" && hasItemGaps(gaps);
          const done = s.key === "publish" && (live || mine?.state === "activated");
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                if (step === "price") commitPrice();
                setStep(s.key);
              }}
              aria-current={current ? "step" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                padding: "0.25rem 0.75rem",
                borderRadius: "0.375rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
                border: `1px solid ${current ? "var(--color-accent)" : "var(--color-border)"}`,
                color: current ? "var(--color-accent)" : "var(--color-text-secondary)",
                background: current ? "var(--color-accent-soft)" : "var(--color-bg-page)",
              }}
            >
              <span aria-hidden style={{ fontVariantNumeric: "tabular-nums" }}>
                {i + 1}
              </span>
              {s.title}
              {flagged && (
                <span aria-hidden style={{ color: "var(--color-warning)", display: "inline-flex" }}>
                  <Icon name="warning" size="sm" />
                </span>
              )}
              {done && (
                <span aria-hidden style={{ color: "var(--color-accent)", display: "inline-flex" }}>
                  <Icon name="check" size="sm" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <DialogBody>
        {step === "items" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <p style={{ ...MUTED, margin: 0 }}>
              What this listing is made of, and what each stamp is known as in {offer.platformName}
              &rsquo;s catalogue. Link what is unmatched and give each grade a catalog value — the
              price step reads those figures.
            </p>
            {/* The summary, off the same rule the card's own chips are counted by, so the two cannot
                disagree. It is a **report**, not a gate: what is missing here stops the listing at
                the third step, said by the Assistant's own refusal, and saying it twice in two
                different voices would be one voice too many. */}
            {offer.platformItems.length === 0 ? (
              <p style={{ ...MUTED, margin: 0 }}>This offer holds no copies yet.</p>
            ) : hasItemGaps(gaps) ? (
              <p style={{ ...WARNING_LINE, margin: 0 }}>
                <Icon name="warning" size="sm" />
                {itemGapSummary(gaps)} — of {gaps.total} item{gaps.total === 1 ? "" : "s"}. You can
                go on and come back to these.
              </p>
            ) : (
              <p style={{ ...OK_LINE, margin: 0 }}>
                <Icon name="check" size="sm" />
                {gaps.total === 1
                  ? "The one item here is matched and priced."
                  : `All ${gaps.total} items are matched and priced.`}
              </p>
            )}
            <OfferPlatformItemsCard
              items={offer.platformItems}
              offerId={offer.id}
              platformModule={offer.platformModule}
              offerState={offer.state}
              collectionId={collectionId}
              copies={copies}
              areas={areas}
              embedded
            />
          </div>
        )}

        {step === "price" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <h3 style={SECTION_TITLE}>
                {auction ? "Starting price" : "Asking price"}
              </h3>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <NumericInput
                  value={draft}
                  onChange={(e) => setDraft(e.currentTarget.value)}
                  onBlur={commitPrice}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitPrice();
                    }
                  }}
                  disabled={isPending}
                  aria-label={auction ? "Starting price" : "Asking price"}
                  placeholder="0.00"
                  style={INPUT_STYLE}
                />
                <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
                  {offer.currency}
                </span>
                {offer.priceBase && !auction && (
                  <span style={{ ...MUTED, fontVariantNumeric: "tabular-nums" }}>
                    ≈ {offer.priceBase} {offer.baseCurrency}
                  </span>
                )}
              </div>
              {/* The suggestions, in the order they answer the question: what the goods are worth
                  first, the platform's flat opening figure only where nothing else can answer. */}
              {offer.suggestedPrice && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <Tooltip content="Average catalog value per set, in this offer's currency" align="start">
                    <span style={MUTED}>
                      <Icon name="suggestion" size="sm" /> catalog value {offer.suggestedPrice}{" "}
                      {offer.currency}
                      {offer.suggestedUnpricedSets > 0 &&
                        ` · ${offer.suggestedUnpricedSets} set${offer.suggestedUnpricedSets === 1 ? "" : "s"} unpriced`}
                    </span>
                  </Tooltip>
                  {draft !== offer.suggestedPrice && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => takeSuggestion(offer.suggestedPrice!)}
                      style={USE_BTN}
                    >
                      Use
                    </button>
                  )}
                </div>
              )}
              {platformDefault && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <Tooltip
                    content={`What ${offer.platformName} opens an auction at by default`}
                    align="start"
                  >
                    <span style={MUTED}>
                      <Icon name="suggestion" size="sm" /> platform default {platformDefault}{" "}
                      {offer.currency}
                    </span>
                  </Tooltip>
                  {draft !== platformDefault && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => takeSuggestion(platformDefault)}
                      style={USE_BTN}
                    >
                      Use
                    </button>
                  )}
                </div>
              )}
              {/* The platform's floor (#731), last because it is the weakest claim of the three: the
                  catalog value says what the goods are worth and the opening figure what this house
                  does, while this says only what the platform's own fees make worth posting. Offered
                  whether or not the figures above it already clear it — dropping deliberately to the
                  floor on a cheap common is the case it was written for — and never as the default,
                  which is what its own wording and its place at the bottom say. */}
              {offer.platformMinimumPrice && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <Tooltip
                    content={`The lowest ${offer.platformName} is worth listing on, set on the platform`}
                    align="start"
                  >
                    <span style={MUTED}>
                      <Icon name="suggestion" size="sm" /> minimum {offer.platformMinimumPrice}{" "}
                      {offer.currency}
                    </span>
                  </Tooltip>
                  {draft !== offer.platformMinimumPrice && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => takeSuggestion(offer.platformMinimumPrice!)}
                      style={USE_BTN}
                    >
                      Use minimum
                    </button>
                  )}
                </div>
              )}
              {!offer.suggestedPrice && !platformDefault && !offer.platformMinimumPrice && (
                <p style={{ ...MUTED, margin: 0 }}>
                  Nothing here carries a catalog value, so there is no figure to suggest. The items
                  step is where those are entered.
                </p>
              )}
            </div>

            {/* The other half of pricing: what these same stamps are being asked for on the platform
                right now (#423). The links are per `stamp × condition`, which is the grade the
                listing goes up at, so the comparison is like for like. */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <h3 style={SECTION_TITLE}>What they are being asked for</h3>
              {offer.platformItems.length === 0 ? (
                <p style={{ ...MUTED, margin: 0 }}>No items to look up.</p>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "grid",
                    gridTemplateColumns: "minmax(0, max-content) max-content max-content",
                    justifyContent: "start",
                    alignItems: "center",
                    columnGap: "0.75rem",
                    rowGap: "0.25rem",
                  }}
                >
                  {offer.platformItems.map((item) => (
                    <li
                      key={`${item.stampId}|${item.conditionId}`}
                      style={{ display: "contents" }}
                    >
                      <span style={{ fontSize: "0.8125rem", color: "var(--color-text-primary)" }}>
                        {item.catalogNumbers[0] ?? item.label}
                        {item.catalogItemVariant && (
                          <span style={{ ...MUTED, fontStyle: "italic" }}>
                            {" "}
                            ~ {item.catalogItemVariant}
                          </span>
                        )}
                      </span>
                      <span style={MUTED}>{item.conditionName}</span>
                      {item.marketUrl ? (
                        <a
                          href={item.marketUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={LINK_CHIP}
                        >
                          <Icon name="externalLink" size="sm" /> Market
                        </a>
                      ) : (
                        <span style={MUTED}>
                          {item.catalogUrl ? "grade not mapped" : "not matched"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {step === "publish" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {/* What is about to be posted, in one line each — the three facts the collector checks
                before pressing anything. Everything else about the listing is on the screen behind
                this dialog, and re-drawing it here would be a second offer screen to keep in step. */}
            <dl
              style={{
                margin: 0,
                display: "grid",
                gridTemplateColumns: "max-content minmax(0, 1fr)",
                columnGap: "1rem",
                rowGap: "0.375rem",
                fontSize: "0.875rem",
              }}
            >
              <dt style={MUTED}>Title</dt>
              <dd style={{ margin: 0 }}>{offer.name ?? offer.label}</dd>
              <dt style={MUTED}>{auction ? "Starting price" : "Price"}</dt>
              <dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>
                {(auction ? offer.startingPrice : offer.price === "0.00" ? null : offer.price) ? (
                  `${auction ? offer.startingPrice : offer.price} ${offer.currency}`
                ) : (
                  <span style={{ color: "var(--color-warning)" }}>not set</span>
                )}
              </dd>
              <dt style={MUTED}>Items</dt>
              <dd style={{ margin: 0 }}>
                {gaps.total} in {offer.sets.length} set{offer.sets.length === 1 ? "" : "s"}
                {hasItemGaps(gaps) && (
                  <span style={{ color: "var(--color-warning)" }}> · {itemGapSummary(gaps)}</span>
                )}
              </dd>
            </dl>

            {live ? (
              // Reopened after the listing went up — or opened on an offer that was already live.
              // There is nothing left to post, so the step reports and links instead.
              <p style={{ ...OK_LINE, margin: 0 }}>
                <Icon name="check" size="sm" />
                This offer is live on {offer.platformName}.
                {offer.url && (
                  <a
                    href={offer.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...LINK_CHIP, marginLeft: "0.25rem" }}
                  >
                    <Icon name="externalLink" size="sm" /> Listing
                  </a>
                )}
              </p>
            ) : (
              <>
                {/* Every reason the Assistant would refuse, spelled out: the header's own hint has
                    room for a short title apiece, and this step has room for the sentence. */}
                {blockers.length > 0 && (
                  <ul
                    style={{
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                    }}
                  >
                    {blockers.map((b) => (
                      <li key={b.code} style={{ ...WARNING_LINE, alignItems: "flex-start" }}>
                        <span style={{ marginTop: "0.125rem" }}>
                          <Icon name="warning" size="sm" />
                        </span>
                        <span>
                          <strong style={{ fontWeight: 600 }}>{b.title}</strong> — {b.message}
                          {b.subjects.length > 0 && (
                            <span style={{ color: "var(--color-text-muted)" }}>
                              {" "}
                              {b.subjects.join(", ")}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {cannotListReason === null ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <ListViaAssistantButton
                      platformModule={offer.platformModule}
                      present={assistantPresent}
                      blockerCount={listingBlockerCount}
                      busy={false}
                      running={handoffRunning}
                      disabled={isPending}
                      marksReady={marksReady}
                      generatesPhotos={generatesPhotos}
                      style={LIST_BTN}
                      onStart={onList}
                    />
                    <span style={MUTED}>
                      The form opens in a new tab, filled in. Nothing is posted until you submit it
                      there.
                    </span>
                  </div>
                ) : (
                  <p style={{ ...WARNING_LINE, margin: 0 }}>
                    <Icon name="warning" size="sm" />
                    {cannotListReason}
                  </p>
                )}

                {/* The run's own report, in the step that started it. The same strip the screen
                    behind shows, which is deliberate: it is the record of what happened, and the
                    collector reads it wherever they pressed the button. */}
                {mine && (
                  <div
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: "0.5rem",
                      overflow: "clip",
                    }}
                  >
                    <AssistantOutcome handoff={mine} onDismiss={onDismissHandoff} />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        {/* The walk on to the next offer, on the left with the other ways out. Offered on the last
            step whether or not this one was posted: an offer put aside is exactly the one a collector
            wants to step past, and a link that appeared only on success would be missing at the one
            moment it is most wanted. It carries the wizard on with it (`wizard=1`), so a batch is a
            single unbroken walk. */}
        {step === "publish" && nextHref && (
          <div style={{ marginRight: "auto" }}>
            {/* Deliberately **not** closing on the way out: the flag in the URL opens the wizard on
                the offer landed on, and so does this screen's own state where the router reuses the
                panel rather than remounting it. Closing here would fight both. */}
            <Link
              href={nextHref}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                minHeight: "2.25rem",
                padding: "0.375rem 1rem",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                border: "1px solid var(--color-border-strong)",
                color: "var(--color-text-secondary)",
                background: "var(--color-bg-elevated)",
                textDecoration: "none",
              }}
            >
              Next offer <Icon name="next" size="sm" />
            </Link>
          </div>
        )}
        {index > 0 && (
          <DialogSecondaryButton onClick={back}>
            <Icon name="previous" size="sm" /> Back
          </DialogSecondaryButton>
        )}
        {index < STEPS.length - 1 ? (
          <DialogPrimaryButton type="button" onClick={next}>
            Next <Icon name="next" size="sm" />
          </DialogPrimaryButton>
        ) : (
          <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
        )}
      </DialogFooter>
    </DialogShell>
  );
}
