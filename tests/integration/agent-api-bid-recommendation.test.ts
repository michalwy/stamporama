import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { OPERATIONS, matchPath, pickMethod } from "../../src/lib/agent-api/registry";
import { parseParameters } from "../../src/lib/agent-api/params";
import { isApiError } from "../../src/lib/agent-api/errors";
import { assertOperationScope } from "../../src/lib/agent-api/scope";
import { recommendBidForLines, resolveLotRecommendations } from "../../src/lib/bid-recommendations";
import { valuateAuctionLotLines } from "../../src/lib/auction-lines";
import type { OperationContext } from "../../src/lib/agent-api/types";
import type { AgentBidRecommendation } from "../../src/lib/agent-api/bid-reads";

// **`recommend_bid` (#1168), and the one control that matters here.**
//
// `tests/unit/agent-api-bid-reads.test.ts` holds every projection, because each is a function of a
// plain object, and `tests/unit/bid-recommendation.test.ts` holds the arithmetic. What neither can
// make a claim about is the thing this issue is actually about: **that the figure an agent is given
// for a described lot is the figure the lots screen states for the same lot.** That is a claim about
// two code paths agreeing, it is checkable only against a real database, and it is the defect class
// `agent-api.md` names as the one no test can see — so this file makes it the first test and builds
// the fixture around it.
//
// **The control is real rather than decorative, and it was measured rather than asserted.** Forking
// the band on the agent path, and forking the anchor on it, were each applied on purpose and each
// turned the first test red.
//
// Its comparison half has a limit worth naming: **two paths through one broken function still
// agree**, so a break in `anchorLine` itself is invisible to *comparing* them. That is why the same
// test also asserts the arithmetic's own answer — `100.00`, from figures the fixture states — and
// with both halves in it a shared break turns it red too, which was checked by doubling the
// catalogue anchor inside `resolveLine` and reading the result. **Keep both halves.** An agreement
// test on its own would pass while every figure in the app was wrong together, which is the most
// expensive way for a control to be green.
//
// Everything is reached the way the dispatcher reaches it — `matchPath` → `pickMethod` →
// `parseParameters` → `handler` — so the registry's binding of `/bid-recommendation` is exercised
// rather than assumed.

const ts = Date.now();

/** Drive one operation exactly as `src/app/api/v1/[...path]/route.ts` does. */
async function call<T>(
  context: OperationContext,
  path: string,
  query: Record<string, string> = {}
): Promise<T> {
  const match = matchPath(path.split("/").filter(Boolean));
  assert.ok(match.candidates.length > 0, `nothing is bound to /api/v1/${path}`);
  const picked = pickMethod(match, "GET");
  assert.ok(picked, `/api/v1/${path} does not accept GET`);
  const params = parseParameters(picked.operation.parameters, {
    path: picked.pathValues,
    query: new URLSearchParams(query),
  });
  return (await picked.operation.handler(context, params)) as T;
}

/** The refusal an operation threw, as the dispatcher would render it. */
async function refusal(
  context: OperationContext,
  path: string,
  query: Record<string, string>
): Promise<{ code: string; message: string; accepted?: readonly string[] }> {
  try {
    await call(context, path, query);
  } catch (error) {
    assert.ok(isApiError(error), `expected an ApiError, got ${String(error)}`);
    return { code: error.code, message: error.message, accepted: error.accepted };
  }
  assert.fail("expected a refusal");
}

describe("recommend_bid (#1168)", () => {
  let userId: string;
  let collectionId: string;
  let context: OperationContext;
  let sellerId: string;
  let platformId: string;
  let conditionId: string;
  let editionId: string;
  let areaId: string;
  let issueId: string;

  /** Priced 50.00 MNH — the stamp with recorded results of its own. */
  let recordedStampId: string;
  /** Priced 40.00 MNH, never sold — the one the learned ratio has to price. */
  let plainStampId: string;
  /** No catalogue price and no result: unanchored either way. */
  let unknownStampId: string;
  /** Priced 100.00 MNH each, and what the ratio evidence is built from. */
  const evidenceStampIds: string[] = [];

  let seq = 0;

  async function price(stampId: string, amount: string) {
    await prisma.stampCatalogPrice.create({
      data: {
        stampId,
        catalogEditionId: editionId,
        conditionId,
        certificateStatusId: null,
        formatId: null,
        price: amount,
        currency: "EUR",
      },
    });
  }

  async function stamp(name: string, issuedYear: number | null = 1950): Promise<string> {
    const s = await prisma.stamp.create({ data: { collectionId, name, issuedYear } });
    await prisma.stampCollectionArea.create({
      data: { stampId: s.id, collectionAreaId: areaId, isPrimary: true },
    });
    await prisma.issueMember.create({ data: { issueId, stampId: s.id } });
    return s.id;
  }

  async function sale(currency = "EUR"): Promise<string> {
    const row = await prisma.auctionSale.create({
      data: { collectionId, sellerId, platformId, name: `Sale ${++seq}`, currency },
    });
    return row.id;
  }

  interface LotSpec {
    saleId: string;
    finalPrice?: string | null;
    status?: string;
    lines: { stampId: string; quantity?: number }[];
  }

  async function lot(spec: LotSpec): Promise<string> {
    const row = await prisma.auctionLot.create({
      data: {
        auctionSaleId: spec.saleId,
        auctionLotNo: 9700 + ++seq,
        lotNo: String(seq),
        endsAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        status: spec.status ?? "closed",
        finalPrice: spec.finalPrice ?? null,
        lines: {
          create: spec.lines.map((l) => ({
            stampId: l.stampId,
            conditionId,
            certificateStatusId: null,
            formatId: null,
            quantity: l.quantity ?? 1,
          })),
        },
      },
    });
    return row.id;
  }

  /** Three single-line results at half catalogue — enough to carry a bucket (`MIN_RATIO_SAMPLE`). */
  async function recordHalfCatalogueEvidence(saleId: string) {
    for (const stampId of evidenceStampIds) {
      await lot({ saleId, finalPrice: "50.00", lines: [{ stampId }] });
    }
  }

  // Every test starts from no evidence, so a ladder level is never inherited from the test before.
  beforeEach(async () => {
    await prisma.auctionLot.deleteMany({ where: { auctionSale: { collectionId } } });
  });

  before(async () => {
    userId = `test-user-recbid-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User recbid-${ts}`,
        email: `test-recbid-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-recbid-${ts}`,
        name: `Collection recbid-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    context = { ownerId: userId, collectionId };

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        data: {
          collectionId,
          issueNo: 9401,
          collectionAreaId: areaId,
          name: "Definitives",
          year: 1950,
        },
      })
    ).id;

    recordedStampId = await stamp("Recorded");
    await price(recordedStampId, "50.00");
    plainStampId = await stamp("Plain");
    await price(plainStampId, "40.00");
    unknownStampId = await stamp("Unknown");

    for (const n of [1, 2, 3]) {
      const id = await stamp(`Evidence ${n}`);
      await price(id, "100.00");
      evidenceStampIds.push(id);
    }

    sellerId = (await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } }))
      .id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
  });

  after(async () => {
    // Sales first: `AuctionLotLine.stampId` is `Restrict`, so dropping the collection would race its
    // own cascades — the stamps go one way and the lines the other.
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  // ── The control this issue exists for ──────────────────────────────────────

  it("gives the agent the figure the lots screen states for the same lot", async () => {
    const saleId = await sale();
    await recordHalfCatalogueEvidence(saleId);
    await lot({ saleId, finalPrice: "30.00", lines: [{ stampId: recordedStampId }] });

    // A real lot on a real sale, described exactly as the agent will describe it.
    const lotId = await lot({
      saleId,
      status: "open",
      lines: [
        { stampId: recordedStampId, quantity: 2 },
        { stampId: plainStampId, quantity: 2 },
        { stampId: unknownStampId, quantity: 2 },
      ],
    });

    // What the lots screen would put on the row, through its own path.
    const valued = await valuateAuctionLotLines(collectionId, [lotId]);
    const screen = (
      await resolveLotRecommendations(collectionId, [lotId], valued, () => ({
        premiumPercent: "20",
        premiumFixed: "1.50",
      }))
    ).get(lotId)!;

    // What the agent is told, for the same specification, through the whole dispatcher.
    const agent = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: [recordedStampId, plainStampId, unknownStampId].join(","),
      condition: "MNH",
      quantity: "2",
      currency: "EUR",
      premium_percent: "20",
      premium_fixed: "1.50",
    });

    // **The whole point.** Three figures, both readings of each, and the four counts.
    assert.equal(agent.fair?.allIn, screen.fair?.allIn);
    assert.equal(agent.fair?.bid, screen.fair?.bid);
    assert.equal(agent.floor?.allIn, screen.floor?.allIn);
    assert.equal(agent.floor?.bid, screen.floor?.bid);
    assert.equal(agent.walkAway?.allIn, screen.walkAway?.allIn);
    assert.equal(agent.walkAway?.bid, screen.walkAway?.bid);
    assert.equal(agent.marketLines, screen.marketLines);
    assert.equal(agent.catalogueLines, screen.catalogueLines);
    assert.equal(agent.unanchoredLines, screen.unanchoredLines);
    assert.equal(agent.unconvertibleLines, screen.unconvertibleLines);

    // And the figure is the one the arithmetic says, so an agreement between two broken paths
    // cannot pass for an agreement: 2 × 30 (market) + 2 × 40 × 0.5 (catalogue × the learned 50%),
    // with the third line unanchored.
    assert.equal(agent.fair?.allIn, "100.00");
    assert.equal(agent.marketLines, 1);
    assert.equal(agent.catalogueLines, 1);
    assert.equal(agent.unanchoredLines, 1);
  });

  // ── The three unanswerable cases ───────────────────────────────────────────

  it("counts a line nothing prices rather than valuing it at zero", async () => {
    const agent = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: [plainStampId, unknownStampId].join(","),
      condition: "MNH",
    });
    assert.equal(agent.unanchoredLines, 1);
    assert.equal(agent.unconvertibleLines, 0);
    // The anchored line still sums — the count is what says the total is partial.
    assert.equal(agent.fair?.allIn, "40.00");
    const unanchored = agent.lines.find((line) => line.stampId === unknownStampId)!;
    assert.equal(unanchored.anchoredOn, undefined);
    assert.equal(unanchored.unitValue, undefined);
    assert.equal(unanchored.unconvertible, undefined);
  });

  it("reports a line it cannot convert as unconvertible and never as unpriced", async () => {
    // **Asked of the domain rather than through the dispatcher, and the reason is the test below**:
    // `currency` carries a closed `values` list, so a code no feed quotes cannot be sent at all.
    // What makes this state reachable in the real app is the *feed* being unreachable for a
    // perfectly ordinary currency — `baseToSaleRates` catches per currency and answers null — and
    // "XTS" is how that is reproduced deterministically here, exactly as
    // `auction-lot-anchors.test.ts` reproduces it for a sale.
    const result = await recommendBidForLines(
      collectionId,
      "XTS",
      [{ stampId: plainStampId, conditionId, certificateStatusId: null, formatId: null, quantity: 1 }],
      {}
    );
    assert.equal(result.currency, "XTS");
    assert.equal(result.recommendation.unconvertibleLines, 1);
    // **Not** unanchored: it has a value that cannot be summed, which is a different fact.
    assert.equal(result.recommendation.unanchoredLines, 0);
    assert.equal(result.lines[0].unconvertible, true);
    assert.equal(result.lines[0].anchor, null);
    // Nothing could be counted, so there is no figure at all — and it is absent, not `0.00`.
    assert.equal(result.recommendation.fair, null);
    assert.equal(result.recommendation.floor, null);
    assert.equal(result.recommendation.walkAway, null);
  });

  it("refuses a currency outside the accepted set rather than answering nothing convertible", async () => {
    // The other half of the test above, and the reason it goes through the domain. A typo would
    // otherwise come back as a perfectly formed answer in which every line is unconvertible — an
    // agent cannot tell that from *this collection prices none of it*, and `values` is #706's own
    // mechanism for a small closed set.
    const error = await refusal(context, "bid-recommendation", {
      stamp_ids: plainStampId,
      condition: "MNH",
      currency: "EURO",
    });
    assert.equal(error.code, "invalid_request");
    assert.ok(error.accepted?.includes("EUR"));
  });

  it("states a level the fees alone consume, with no bid rather than a bid of zero", async () => {
    const agent = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: plainStampId,
      condition: "MNH",
      // A lot fee larger than the whole valuation: the figure stands and no hammer price fits.
      premium_fixed: "60.00",
    });
    assert.equal(agent.fair?.allIn, "40.00");
    assert.equal(agent.fair?.bid, undefined);
    assert.equal(agent.floor?.allIn, "30.00");
    assert.equal(agent.floor?.bid, undefined);
    // Still an answered lot: the levels are there, it is the *bid* that has nowhere to go.
    assert.equal(agent.unanchoredLines, 0);
    assert.equal(agent.premiumFixed, "60.00");
  });

  it("keeps a lot nothing could price unanswered rather than worthless", async () => {
    const agent = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: unknownStampId,
      condition: "MNH",
    });
    assert.equal(agent.fair, undefined);
    assert.equal(agent.floor, undefined);
    assert.equal(agent.walkAway, undefined);
    assert.equal(agent.unanchoredLines, 1);
  });

  // ── Currency, fees, naming, several lines ──────────────────────────────────

  it("answers in the collection's base currency when the caller names none", async () => {
    const agent = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: plainStampId,
      condition: "MNH",
    });
    assert.equal(agent.currency, "EUR");
    assert.equal(agent.unconvertibleLines, 0);
  });

  it("echoes the fees it used, so an omitted premium is visible rather than silent", async () => {
    const withFees = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: plainStampId,
      condition: "MNH",
      premium_percent: "20",
    });
    assert.equal(withFees.premiumPercent, 20);
    assert.equal(withFees.fair?.allIn, "40.00");
    // 40 / 1.20, rounded down to the cent.
    assert.equal(withFees.fair?.bid, "33.33");

    const without = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: plainStampId,
      condition: "MNH",
    });
    assert.equal(without.premiumPercent, undefined);
    assert.equal(without.premiumFixed, undefined);
    // The overstatement itself: with no premium the bid *is* the all-in figure. The absent echo is
    // the only thing that says so, which is why it is asserted rather than assumed.
    assert.equal(without.fair?.bid, without.fair?.allIn);
  });

  it("refuses a fee that is not an amount rather than reading it as nothing", async () => {
    const error = await refusal(context, "bid-recommendation", {
      stamp_ids: plainStampId,
      condition: "MNH",
      premium_percent: "twenty",
    });
    assert.equal(error.code, "invalid_request");
    assert.match(error.message, /two decimal places/);
  });

  it("takes the grade by name through #708's resolver, and refuses one it does not know", async () => {
    const byName = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: plainStampId,
      condition: "MNH",
    });
    const byId = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: plainStampId,
      condition: conditionId,
    });
    assert.equal(byName.fair?.allIn, byId.fair?.allIn);
    assert.equal(byName.lines[0].condition, "Mint Never Hinged");

    const error = await refusal(context, "bid-recommendation", {
      stamp_ids: plainStampId,
      condition: "Superb",
    });
    // #708's refusal is an `invalid_request` carrying the accepted **names** — there is no code of
    // its own, and the names are the whole point: an agent told only "unknown condition" guesses
    // again and fails the same way.
    assert.equal(error.code, "invalid_request");
    assert.deepEqual(error.accepted, ["Mint Never Hinged (MNH)"]);
  });

  it("refuses a stamp that is not in this collection rather than answering about a smaller lot", async () => {
    const other = await prisma.collection.create({
      data: {
        slug: `col-recbid-other-${ts}`,
        name: `Other recbid-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    const foreign = await prisma.stamp.create({
      data: { collectionId: other.id, name: "Somebody else's" },
    });

    const error = await refusal(context, "bid-recommendation", {
      stamp_ids: [plainStampId, foreign.id].join(","),
      condition: "MNH",
    });
    assert.equal(error.code, "not_found");
    assert.match(error.message, /search_collection/);
    assert.match(error.message, /smaller lot/);

    await prisma.collection.delete({ where: { id: other.id } });
  });

  it("sums a run and multiplies by quantity, never decomposing a multiple", async () => {
    const run = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: [plainStampId, ...evidenceStampIds].join(","),
      condition: "MNH",
    });
    // 40 + 3 × 100, at the cold-start ratio of 100%.
    assert.equal(run.fair?.allIn, "340.00");
    assert.equal(run.lines.length, 4);

    const three = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: plainStampId,
      condition: "MNH",
      quantity: "3",
    });
    assert.equal(three.fair?.allIn, "120.00");
    assert.equal(three.lines[0].quantity, 3);
  });

  it("collapses a stamp sent twice into one line rather than counting it twice", async () => {
    const agent = await call<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: [plainStampId, plainStampId].join(","),
      condition: "MNH",
    });
    assert.equal(agent.lines.length, 1);
    assert.equal(agent.fair?.allIn, "40.00");
  });

  it("refuses a quantity below one", async () => {
    const error = await refusal(context, "bid-recommendation", {
      stamp_ids: plainStampId,
      condition: "MNH",
      quantity: "0",
    });
    assert.equal(error.code, "invalid_request");
  });

  it("refuses an empty stamp list rather than answering about nothing", async () => {
    const error = await refusal(context, "bid-recommendation", {
      stamp_ids: "",
      condition: "MNH",
    });
    assert.equal(error.code, "invalid_request");
    assert.match(error.message, /search_collection/);
  });

  // ── The registry entry ─────────────────────────────────────────────────────

  it("declares itself a read, so a read-only token reaches it", () => {
    const operation = OPERATIONS.find((entry) => entry.name === "recommend_bid");
    assert.ok(operation, "recommend_bid is not in the registry");
    assert.equal(operation.writes, false);
    // The scope decision is `writes` and nothing else (#707) — asserted here rather than inferred
    // from the flag, because the flag is only worth what the check makes of it.
    assert.doesNotThrow(() => assertOperationScope("read", operation));
  });

  it("says in its own description that the three unanswerable cases are three answers", () => {
    const operation = OPERATIONS.find((entry) => entry.name === "recommend_bid")!;
    const said = `${operation.description} ${operation.result.description}`;
    // The description is what the model actually reads, so the distinction has to survive into it —
    // this is the half a response-shape assertion cannot reach.
    assert.match(said, /unanchoredLines/);
    assert.match(said, /unconvertibleLines/);
    assert.match(said, /absent when the fees alone consume/i);
    assert.match(said, /not a zero/i);
    // And the limit of the shape is stated rather than left to be discovered.
    assert.match(said, /mixing grades/i);
  });
});
