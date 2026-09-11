import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, disposeItem } from "../../src/lib/items";
import type { ItemCreateInput } from "../../src/lib/items";
import { OPERATIONS, matchPath, pickMethod } from "../../src/lib/agent-api/registry";
import { buildOpenApiDocument } from "../../src/lib/agent-api/openapi";
import { buildToolList } from "../../src/lib/agent-api/mcp";
import { parseParameters } from "../../src/lib/agent-api/params";
import { LIST_PARAMETERS } from "../../src/lib/agent-api/list";
import { isApiError } from "../../src/lib/agent-api/errors";
import type { Operation, OperationContext } from "../../src/lib/agent-api/types";
import type {
  AgentCopyDetail,
  AgentIssueDetail,
  AgentStampDetail,
  AgentSearchResult,
  AgentValuationSummary,
} from "../../src/lib/agent-api/collection-reads";
import type { AgentHoldingsResponse } from "../../src/lib/agent-api/operations/holdings";

// **The half of #710 a pure test cannot make a claim about** (`agent-api.md`).
//
// `tests/unit/agent-api-collection-reads.test.ts` holds every projection, because each is a function
// of a row. What it cannot hold is that the rows on the other side *are* those shapes, that the
// scopes reach the right copies, that a name resolves to an id against a real dictionary, that the
// collection pinning actually excludes the collector's **other** collection, and — the one #710
// names as its own criterion — that an agent can answer *what do I hold from this issue, in what
// condition, and where is it* in one or two calls. That last one is a claim about **composition**,
// checkable only by making the calls and reading what comes back, so this file makes them.
//
// Every operation is reached the way the dispatcher reaches it — `matchPath` → `pickMethod` →
// `parseParameters` → `handler` — rather than by calling the reader behind it, so the registry's
// bindings are exercised rather than assumed.

const ts = Date.now();

/** Drive one operation exactly as `src/app/api/v1/[...path]/route.ts` does. */
async function call<T>(
  context: OperationContext,
  method: "GET",
  path: string,
  query: Record<string, string> = {}
): Promise<T> {
  const [pathname, search] = path.split("?");
  const match = matchPath(pathname.split("/").filter(Boolean));
  assert.ok(match.candidates.length > 0, `nothing is bound to /api/v1/${pathname}`);
  const picked = pickMethod(match, method);
  assert.ok(picked, `/api/v1/${pathname} does not accept ${method}`);
  const { operation, pathValues } = picked;
  const specs =
    operation.result.kind === "list"
      ? [...operation.parameters, ...LIST_PARAMETERS]
      : operation.parameters;
  const params = parseParameters(specs, {
    path: pathValues,
    query: new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(search ?? "")), ...query }),
  });
  return (await operation.handler(context, params)) as T;
}

/** The `ApiError` a call was refused with, or a failure saying it was not refused at all. */
async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    assert.ok(isApiError(error), `expected an ApiError, got ${String(error)}`);
    return error;
  }
  return assert.fail("expected a refusal");
}

describe("the collection reads (#710)", () => {
  let userId: string;
  let collectionId: string;
  /** A second collection of the **same owner**: the collection is the token's, not the user's. */
  let otherCollectionId: string;
  let context: OperationContext;

  let areaId: string, childAreaId: string, otherAreaId: string;
  let mnhId: string, usedId: string;
  let issueId: string, otherIssueId: string;
  let baseStampId: string, variantStampId: string, secondStampId: string, foreignStampId: string;
  let drawerId: string, shelfId: string;
  let mnhCopyId: string, usedCopyId: string, transitCopyId: string, disposedCopyId: string;
  let soldCopyId: string, foreignCopyId: string;

  before(async () => {
    userId = `test-user-reads-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User reads-${ts}`,
        email: `test-reads-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-reads-${ts}`, name: "Reads", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-reads-other-${ts}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    context = { ownerId: userId, collectionId };

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalog = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Polen", currency: "EUR" },
    });
    // `Poland` states the prefix and `Galicia` nests under it, so the area scope has a subtree to
    // walk and the catalog labels have a prefix to carry (#66/#377).
    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          catalogPrefix: "PL",
          primaryCatalogVendorId: vendor.id,
          primaryCatalogNameId: catalog.id,
          collectionAreaCatalogs: { create: [{ catalogNameId: catalog.id }] },
        },
      })
    ).id;
    childAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Galicia", parentId: areaId, primaryCatalogVendorId: vendor.id },
      })
    ).id;
    otherAreaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Austria" } })
    ).id;

    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;
    const variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: {
          collectionId,
          name: "Variant",
          actsAsVariant: true,
          isDefault: true,
          sortOrder: 0,
        },
      })
    ).id;

    drawerId = (
      await prisma.location.create({ data: { collectionId, name: "Szafa 1", assignable: false } })
    ).id;
    shelfId = (
      await prisma.location.create({
        data: { collectionId, name: "Klaser A", parentId: drawerId, assignable: true },
      })
    ).id;

    issueId = (
      await prisma.issue.create({
        // Past the collection's counter: these rows bypass `allocateEntityNumber` (#432).
        data: {
          collectionId,
          issueNo: 9710,
          collectionAreaId: areaId,
          name: "Kościuszko",
          year: 1919,
          catalogNumbers: {
            create: [{ catalogVendorId: vendor.id, firstNumber: "100", lastNumber: "104" }],
          },
        },
      })
    ).id;
    otherIssueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 9711, collectionAreaId: otherAreaId, name: "Elsewhere", year: 1920 },
      })
    ).id;

    const stamp = async (
      number: string,
      opts: { parentId?: string; area?: string; year?: number; collection?: string } = {}
    ): Promise<string> =>
      (
        await prisma.stamp.create({
          data: {
            collectionId: opts.collection ?? collectionId,
            name: number,
            issuedYear: opts.year ?? 1919,
            parentId: opts.parentId,
            subtypeId: opts.parentId ? variantSubtypeId : undefined,
            denomination: opts.parentId ? undefined : "10 gr",
            widthMm: opts.parentId ? undefined : 21.5,
            catalogNumbers:
              opts.collection === undefined
                ? { create: [{ catalogVendorId: vendor.id, number }] }
                : undefined,
            stampAreaLinks:
              opts.collection === undefined
                ? { create: [{ collectionAreaId: opts.area ?? areaId, isPrimary: true }] }
                : undefined,
          },
        })
      ).id;

    baseStampId = await stamp("100");
    variantStampId = await stamp("100a", { parentId: baseStampId });
    secondStampId = await stamp("101", { area: childAreaId, year: 1920 });
    foreignStampId = await stamp("999", { collection: otherCollectionId });

    await prisma.issueMember.createMany({
      data: [baseStampId, secondStampId].map((stampId, i) => ({ issueId, stampId, sortOrder: i })),
    });
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId,
        name: "Basic",
        sortOrder: 0,
        stamps: { create: [{ stampId: baseStampId }, { stampId: secondStampId }] },
      },
    });

    const copy = async (
      stampId: string,
      conditionId: string,
      extra: Omit<ItemCreateInput, "stampId" | "conditionId"> = {}
    ) => (await createItem(userId, collectionId, { stampId, conditionId, ...extra })).id;

    mnhCopyId = await copy(baseStampId, mnhId, {
      inCollection: true,
      locationId: shelfId,
      locationRef: "A234",
    });
    usedCopyId = await copy(baseStampId, usedId, { inCollection: true, locationId: shelfId });
    transitCopyId = await copy(secondStampId, mnhId, {
      inCollection: true,
      deliveryState: "in_transit",
    });
    disposedCopyId = await copy(variantStampId, usedId, { inCollection: true });
    await disposeItem(userId, disposedCopyId, { reason: "lost" });
    // The other collection has its own dictionary — a condition is per collection, so this copy
    // cannot be filed against the first collection's grade even by the same owner.
    const foreignConditionId = (
      await prisma.stampCondition.create({
        data: { collectionId: otherCollectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    // A **sold** copy, which is the other way a copy leaves (#166/#394) and the one `excludeGone`
    // answers. Written straight to the tables, so it bypasses the entity counters (#432) — numbers
    // well past the collection's own keep them from colliding with an allocated one.
    soldCopyId = await copy(baseStampId, mnhId, { forSale: true });
    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Colnect", platform: true } })
    ).id;
    const offer = await prisma.offer.create({
      data: {
        collectionId,
        offerNo: 9710,
        platformId,
        currency: "EUR",
        price: "5.00",
        state: "sold",
      },
    });
    const offerSet = await prisma.offerSet.create({ data: { offerId: offer.id } });
    await prisma.offerSetItem.create({ data: { offerSetId: offerSet.id, itemId: soldCopyId } });
    const sale = await prisma.sale.create({
      data: { collectionId, saleNo: 9710, platformId, soldAt: new Date(), currency: "EUR" },
    });
    const saleLine = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId: offer.id, offerSetId: offerSet.id, price: "5.00" },
    });
    await prisma.saleLineItem.create({ data: { saleLineId: saleLine.id, itemId: soldCopyId } });

    // **Two copies sharing one `createdAt`**, so the offset-paging walk below runs over a real tie
    // rather than over three distinct timestamps. `createMany` gives a bulk intake exactly this, and
    // without a total order an offset page boundary landing inside a tie can repeat one row and skip
    // another (the `id` tiebreak in `listItemsPaginated`).
    await prisma.item.updateMany({
      where: { id: { in: [mnhCopyId, usedCopyId] } },
      data: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
    });

    foreignCopyId = (
      await createItem(userId, otherCollectionId, {
        stampId: foreignStampId,
        conditionId: foreignConditionId,
      })
    ).id;
  });

  after(async () => {
    await prisma.saleLineItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.saleLine.deleteMany({ where: { sale: { collectionId } } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offerSetItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.contact.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId: otherCollectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId: otherCollectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId: otherCollectionId } });
    await prisma.collection.delete({ where: { id: otherCollectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  // ── The registry criterion ────────────────────────────────────────────────

  describe("what adding them to the registry published", () => {
    const added = [
      "search_collection",
      "get_stamp",
      "get_issue",
      "get_copy",
      "list_holdings",
      "summarize_valuation",
    ];

    it("puts every one of them in the OpenAPI document, from the one array", () => {
      const document = buildOpenApiDocument(OPERATIONS, { appVersion: "test" }) as {
        paths: Record<string, Record<string, { operationId: string }>>;
      };
      const published = Object.values(document.paths).flatMap((byMethod) =>
        Object.values(byMethod).map((entry) => entry.operationId)
      );
      for (const name of added) assert.ok(published.includes(name), `${name} is not in the document`);
    });

    it("makes every one of them an MCP tool with no MCP-side edit", () => {
      // #710's own *Done when*, and the property #709 built: `buildToolList` is a pure function of
      // the operation array and there is no hand-written list anywhere for these to be added to.
      const tools = buildToolList(OPERATIONS);
      for (const name of added) {
        const tool = tools.find((entry) => entry.name === name);
        assert.ok(tool, `${name} is not an MCP tool`);
        // The registry's own description leads, because a model decides whether to call a tool
        // from it (#709).
        const operation = OPERATIONS.find((entry) => entry.name === name) as Operation;
        assert.ok(tool.description.startsWith(operation.description));
      }
    });

    it("declares every one of them read-only", () => {
      // #710 is read scope throughout: an operation here never needs `read_write` (#707).
      for (const name of added) {
        const operation = OPERATIONS.find((entry) => entry.name === name) as Operation;
        assert.equal(operation.writes, false, `${name} declares writes`);
      }
    });
  });

  // ── The composition criterion ─────────────────────────────────────────────

  describe("what do I hold from this issue, in what condition, and where is it", () => {
    it("is answered in one call, and the answer is read out here rather than asserted", async () => {
      // #710's *Done when* is a claim about composition, so it is **demonstrated**: one call, and
      // everything the question asks for is in what came back.
      const held = await call<AgentHoldingsResponse>(context, "GET", "/holdings", {
        issue_id: issueId,
      });

      // *What do I hold* — three copies of this series are still held: two of `100` and the one of
      // `101` still in the post. The written-off copy of the variant is not among them.
      assert.equal(held.total, 3);
      assert.equal(held.items.length, 3);
      assert.deepEqual(
        held.items.map((row) => row.copyId).sort(),
        [mnhCopyId, usedCopyId, transitCopyId].sort()
      );

      // *In what condition* — off the rows, and off `byCondition` for the whole match.
      assert.deepEqual(
        held.byCondition,
        [
          { condition: "Mint Never Hinged", copies: 2 },
          { condition: "Used", copies: 1 },
        ]
      );

      // *Where is it* — the filing path and the mark on the shelf, on the row itself.
      const mnh = held.items.find((row) => row.copyId === mnhCopyId);
      assert.ok(mnh);
      assert.equal(mnh.location, "Szafa 1 › Klaser A");
      assert.equal(mnh.locationRef, "A234");
      assert.equal(mnh.condition, "Mint Never Hinged");
      assert.deepEqual(mnh.catalogNumbers, ["Mi·PL 100"]);

      // And the one still on its way says so rather than reading as in hand.
      const coming = held.items.find((row) => row.copyId === transitCopyId);
      assert.ok(coming);
      assert.equal(coming.deliveryState, "in_transit");
      assert.equal("location" in coming, false);
    });

    it("takes two calls when the agent started from a name rather than an id", async () => {
      // The other half of *one or two calls*: text in, ids out, then the holdings read. Nothing
      // between them, which is what `search_collection` exists for.
      const found = await call<AgentSearchResult>(context, "GET", "/search", {
        query: "Kościuszko",
      });
      const issue = found.issues.find((row) => row.name === "Kościuszko");
      assert.ok(issue, "the series was not found by name");

      const held = await call<AgentHoldingsResponse>(context, "GET", "/holdings", {
        issue_id: issue.issueId,
      });
      assert.equal(held.total, 3);
    });
  });

  // ── search_collection ─────────────────────────────────────────────────────

  describe("search_collection", () => {
    it("tags what it found and states the two copy counts apart", async () => {
      const found = await call<AgentSearchResult>(context, "GET", "/search", { query: "100" });
      const base = found.stamps.find((row) => row.stampId === baseStampId);
      assert.ok(base);
      assert.deepEqual(base.catalogNumbers, ["Mi·PL 100"]);
      // Two copies filed on `100` itself; the variant's one copy is written off, so neither figure
      // counts it (#348/#528, and #396 for the disposal).
      assert.equal(base.copies, 2);
      assert.equal(base.variantCopies, 0);
      assert.ok(base.path.startsWith(`/c/col-reads-${ts}/stamps/`));
    });

    it("says a group may be trimmed only when it came back full", async () => {
      const found = await call<AgentSearchResult>(context, "GET", "/search", { query: "100" });
      assert.equal(found.stampsMayBeTrimmed, false);
      assert.equal(found.copiesMayBeTrimmed, false);
    });

    it("answers an empty query with an empty answer rather than a refusal", async () => {
      // `searchCollection`'s own rule: a selection that turns out to be whitespace is nothing to
      // report a failure about. What is still refused is the parameter being absent.
      const found = await call<AgentSearchResult>(context, "GET", "/search", { query: "   x" });
      assert.equal(typeof found.query, "string");
      const error = await refusal(() => call(context, "GET", "/search", {}));
      assert.equal(error.code, "invalid_request");
    });

    it("never reaches the collector's other collection", async () => {
      const found = await call<AgentSearchResult>(context, "GET", "/search", { query: "999" });
      assert.equal(found.stamps.length, 0);
      assert.equal(found.copies.length, 0);
    });
  });

  // ── One thing in full ─────────────────────────────────────────────────────

  describe("get_stamp", () => {
    it("states the record, its series and its checklists", async () => {
      const stamp = await call<AgentStampDetail>(context, "GET", `/stamps/${baseStampId}`);
      assert.equal(stamp.stampId, baseStampId);
      assert.deepEqual(stamp.catalogNumbers, ["Mi·PL 100"]);
      assert.equal(stamp.area, "Poland");
      assert.equal(stamp.denomination, "10 gr");
      assert.equal(stamp.widthMm, 21.5);
      assert.equal(stamp.copies.total, 2);
      assert.deepEqual(stamp.issues[0].checklists, ["Basic"]);
    });

    it("refuses a stamp in the collector's other collection, naming where to get a good id", async () => {
      // `getStampListItem` is **owner**-scoped, so this is the check that is not already made for
      // us: the collection comes from the token and from nothing else (#706).
      const error = await refusal(() => call(context, "GET", `/stamps/${foreignStampId}`));
      assert.equal(error.code, "not_found");
      assert.match(error.message, /search_collection/);
    });
  });

  describe("get_issue", () => {
    it("states the declared range, the members and the checklists apart", async () => {
      const issue = await call<AgentIssueDetail>(context, "GET", `/issues/${issueId}`);
      assert.equal(issue.name, "Kościuszko");
      assert.equal(issue.area, "Poland");
      // The span goes through the app's own range formatter, prefix included (#400/#675) — which
      // shortens the numeric end, so `100–104` reads `100–04` exactly as `1298–302` does on screen.
      // An agent therefore reads a range the way the collector's own chip renders it, which is the
      // reason the formatter was moved into `src/lib` rather than spelled a second time here.
      assert.deepEqual(issue.catalogRanges, ["Mi·PL 100–04"]);
      assert.equal(issue.memberCount, 2);
      assert.equal(issue.requiredCount, 2);
      assert.equal(issue.checklists[0].name, "Basic");
      assert.equal(issue.checklists[0].stampCount, 2);
    });

    it("refuses an issue outside the token's collection", async () => {
      const error = await refusal(() => call(context, "GET", `/issues/${issueId}xx`));
      assert.equal(error.code, "not_found");
    });
  });

  describe("get_copy", () => {
    it("states where the copy is and what it is for", async () => {
      const copy = await call<AgentCopyDetail>(context, "GET", `/copies/${mnhCopyId}`);
      assert.equal(copy.itemNo > 0, true);
      assert.equal(copy.condition, "Mint Never Hinged");
      assert.equal(copy.location, "Szafa 1 › Klaser A");
      assert.equal(copy.locationRef, "A234");
      assert.equal(copy.inCollection, true);
      assert.equal(copy.forSale, false);
      // A null certificate and a null format are absent rather than invented (ADR-0006 §2,
      // ADR-0020) — the same rule the unit test pins, seen through a real row.
      assert.equal("certificate" in copy, false);
      assert.equal("format" in copy, false);
      assert.ok(copy.path.includes("/inventory/"));
    });

    it("still describes a copy that has been written off", async () => {
      // `list_holdings` drops it — it is not held — but *tell me about this copy* would be an odd
      // kind of read that refused to describe one the collector lost.
      const copy = await call<AgentCopyDetail>(context, "GET", `/copies/${disposedCopyId}`);
      assert.equal(copy.disposalReason, "lost");
      assert.ok(copy.disposedAt);
    });

    it("refuses a copy in the collector's other collection", async () => {
      const error = await refusal(() => call(context, "GET", `/copies/${foreignCopyId}`));
      assert.equal(error.code, "not_found");
    });
  });

  // ── list_holdings ─────────────────────────────────────────────────────────

  describe("list_holdings", () => {
    it("takes a condition by the abbreviation an agent would have in hand", async () => {
      // #708's whole point, exercised against a real dictionary: `MNH` is as good as its cuid.
      const held = await call<AgentHoldingsResponse>(context, "GET", "/holdings", {
        condition: "MNH",
      });
      assert.equal(held.total, 2);
      for (const row of held.items) assert.equal(row.condition, "Mint Never Hinged");
    });

    it("hands back the accepted names when a condition is not one of this collection's", async () => {
      const error = await refusal(() =>
        call(context, "GET", "/holdings", { condition: "Superb" })
      );
      assert.equal(error.code, "invalid_request");
      assert.ok(error.accepted?.some((value) => value.includes("Mint Never Hinged")));
    });

    it("scopes an area to its subtree, so a child area's copies are inside the parent's", async () => {
      const poland = await call<AgentHoldingsResponse>(context, "GET", "/holdings", {
        area: "Poland",
      });
      const galicia = await call<AgentHoldingsResponse>(context, "GET", "/holdings", {
        area: "Galicia",
      });
      // `101` sits in Galicia, `100` in Poland: the parent holds all three, the child only its own.
      assert.equal(poland.total, 3);
      assert.equal(galicia.total, 1);
      assert.equal(galicia.items[0].copyId, transitCopyId);
    });

    it("scopes a location to its subtree", async () => {
      // `Szafa 1` is not assignable and holds nothing directly; both filed copies are on the shelf
      // under it, and asking for the drawer finds them (#56).
      const drawer = await call<AgentHoldingsResponse>(context, "GET", "/holdings", {
        location: "Szafa 1",
      });
      assert.equal(drawer.total, 2);
    });

    it("answers nothing for a real series nothing is held from", async () => {
      // The negative half of the `issue_id` scope: a series that exists and holds no copies is an
      // **empty answer**, where a series id naming nothing at all is a refusal. Those are different
      // states and the agent has to be able to tell them apart.
      const empty = await call<AgentHoldingsResponse>(context, "GET", "/holdings", {
        issue_id: otherIssueId,
      });
      assert.equal(empty.total, 0);
      assert.deepEqual(empty.items, []);
      assert.deepEqual(empty.byCondition, []);
      assert.equal(empty.nextCursor, null);
    });

    it("takes a year, a stamp and a scope in combination", async () => {
      assert.equal(
        (await call<AgentHoldingsResponse>(context, "GET", "/holdings", { year: "1920" })).total,
        1
      );
      assert.equal(
        (await call<AgentHoldingsResponse>(context, "GET", "/holdings", { stamp_id: baseStampId }))
          .total,
        2
      );
      // Combined with AND: `100` is a 1919 stamp, so this is empty rather than two.
      assert.equal(
        (
          await call<AgentHoldingsResponse>(context, "GET", "/holdings", {
            stamp_id: baseStampId,
            year: "1920",
          })
        ).total,
        0
      );
    });

    it("refuses a scope id that names nothing, rather than answering with an empty list", async () => {
      // An agent handed `[]` cannot tell *you hold none of these* from *that id was wrong*, and only
      // the second is a mistake it can fix.
      const error = await refusal(() =>
        call(context, "GET", "/holdings", { issue_id: `${issueId}xx` })
      );
      assert.equal(error.code, "not_found");
      assert.match(error.message, /search_collection/);
    });

    it("states the full total and the breakdown over the whole match, not over the page", async () => {
      // The convention the whole surface turns on (#706), and the half `total` alone does not reach:
      // one row back, three in the match, and the condition breakdown still describes all three.
      const page = await call<AgentHoldingsResponse>(context, "GET", "/holdings", {
        issue_id: issueId,
        limit: "1",
      });
      assert.equal(page.items.length, 1);
      assert.equal(page.total, 3);
      assert.equal(page.nextCursor, "1");
      assert.deepEqual(page.byCondition, [
        { condition: "Mint Never Hinged", copies: 2 },
        { condition: "Used", copies: 1 },
      ]);
    });

    it("walks the whole set through the cursor without repeating or skipping a row", async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const page: AgentHoldingsResponse = await call<AgentHoldingsResponse>(
          context,
          "GET",
          "/holdings",
          { issue_id: issueId, limit: "1", ...(cursor ? { cursor } : {}) }
        );
        seen.push(...page.items.map((row) => row.copyId));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      // Two of these three share one `createdAt` (see the fixture), so the walk crosses a tie.
      assert.equal(seen.length, 3);
      assert.equal(new Set(seen).size, 3);
      assert.deepEqual(seen.slice().sort(), [mnhCopyId, usedCopyId, transitCopyId].sort());
    });

    it("leaves out what has left the collection, both ways it can leave", async () => {
      // Two mechanisms and one question (#394/#644): written off after delivery, and sold on a sale
      // line. `list_holdings` answers *what do I have*, so neither is in it — and the two are
      // asserted apart, because the disposal is dropped by the read's default while the sale is
      // dropped by `excludeGone`, and one assertion covering both would pass on either alone.
      const all = await call<AgentHoldingsResponse>(context, "GET", "/holdings");
      assert.equal(
        all.items.some((row) => row.copyId === disposedCopyId),
        false,
        "a written-off copy is not held"
      );
      assert.equal(
        all.items.some((row) => row.copyId === soldCopyId),
        false,
        "a sold copy is not held"
      );
      assert.equal(all.total, 3);
    });
  });

  // ── summarize_valuation ───────────────────────────────────────────────────

  describe("summarize_valuation", () => {
    it("states four totals in the base currency, each with the counts behind it", async () => {
      const summary = await call<AgentValuationSummary>(context, "GET", "/holdings/valuation");
      assert.equal(summary.baseCurrency, "PLN");
      // Nothing in this collection is priced, and that is the case worth pinning: the figure is
      // 0.00 **and says so** through `unpricedCount`, rather than reading as a collection worth
      // nothing (`valuation.md`).
      assert.equal(summary.catalogue.total, "0.00");
      assert.equal(summary.catalogue.pricedCount, 0);
      assert.equal(summary.catalogue.unpricedCount, 3);
      assert.equal(summary.market.valuedCount, 0);
      assert.equal(summary.market.noEvidenceCount, 3);
      assert.equal(summary.cost.noneCount, 3);
    });

    it("reads over a wider set than the holdings list, and the write-off is why", async () => {
      // #396: the underlying read lifts the disposal exclusion on purpose so it can state what the
      // copies that are gone had cost. So the two operations are not meant to agree, and a later
      // reader finding that should not "fix" it.
      const summary = await call<AgentValuationSummary>(context, "GET", "/holdings/valuation");
      const held = await call<AgentHoldingsResponse>(context, "GET", "/holdings");
      assert.equal(held.total, 3);
      assert.equal(summary.writeOff.copies, 1);
    });

    it("takes the same scope as the holdings list", async () => {
      const summary = await call<AgentValuationSummary>(context, "GET", "/holdings/valuation", {
        condition: "MNH",
      });
      assert.equal(summary.catalogue.unpricedCount, 2);
      assert.equal(summary.writeOff.copies, 0);
    });

    it("refuses a bad scope exactly as the holdings list does", async () => {
      const error = await refusal(() =>
        call(context, "GET", "/holdings/valuation", { area: "Atlantis" })
      );
      assert.equal(error.code, "invalid_request");
      assert.ok(error.accepted?.includes("Poland"));
    });
  });

  // ── The dispatcher's own rules ────────────────────────────────────────────

  describe("the dispatcher, over these operations", () => {
    it("refuses an undeclared query parameter with the accepted names beside it", async () => {
      // #706's rule one level up: an agent that guessed `filter=` and was silently ignored gets a
      // plausible answer to a question it did not ask.
      const error = await refusal(() =>
        call(context, "GET", "/holdings", { filter: "mint" })
      );
      assert.equal(error.code, "invalid_request");
      assert.ok(error.accepted?.includes("condition"));
      assert.ok(error.accepted?.includes("cursor"));
    });

    it("binds `/holdings/valuation` ahead of nothing — the two paths are distinct templates", () => {
      const list = pickMethod(matchPath(["holdings"]), "GET");
      const valuation = pickMethod(matchPath(["holdings", "valuation"]), "GET");
      assert.equal(list?.operation.name, "list_holdings");
      assert.equal(valuation?.operation.name, "summarize_valuation");
    });
  });
});
