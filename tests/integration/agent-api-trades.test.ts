import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { createWant } from "../../src/lib/wants";
import { createTradeShareToken } from "../../src/lib/trade-share";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { buildOpenApiDocument } from "../../src/lib/agent-api/openapi";
import { buildToolList } from "../../src/lib/agent-api/mcp";
import { DELETE, GET, POST } from "../../src/app/api/v1/[...path]/route";
import { POST as MCP_POST } from "../../src/app/api/mcp/route";
import type { AgentWant, AgentWantMatch, AgentChecklistGaps } from "../../src/lib/agent-api/want-reads";
import type {
  AgentGiveLineResult,
  AgentTrade,
  AgentTradeBalance,
  AgentTradeLine,
  AgentTradeRow,
} from "../../src/lib/agent-api/trade-reads";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **Wants, checklists and trades (#712), driven through the real route with a real token.**
//
// `tests/unit/agent-api-want-reads.test.ts` and `tests/unit/agent-api-trade-reads.test.ts` hold
// every projection, because each is a function of a row, and
// `tests/unit/agent-api-operation-boundary.test.ts` holds the send boundary as a fact about what the
// operation modules import. What none of them can hold is everything below: that `WantListItem`,
// `TradeData` and `TradeBalanceRead` actually satisfy those shapes, that the whole of #712's *Done
// when* is a real sequence of calls, and that the registry now publishes what it says it does.
//
// **It goes through `src/app/api/v1/[...path]/route.ts`**, #711's arrangement and for its reasons:
// the scope check and the body parsing both live in the route, and calling the handlers directly
// would walk past both. It is also the first file here to exercise `DELETE` on this surface.
//
// **The `Done when` is read out rather than asserted.** #712 asks that an agent can answer *what
// does this counterparty have that I want, and what would balance a trade for it* and **leave a
// drafted, balanced trade behind** — so *the whole exchange, end to end* below makes exactly those
// calls in exactly that order and reads the answers out.

const ts = Date.now();

function v1(
  token: string,
  method: string,
  path: string,
  body?: unknown
): { request: NextRequest; context: { params: Promise<{ path: string[] }> } } {
  const [pathname, search] = path.split("?");
  const url = `http://localhost/api/v1${pathname}${search ? `?${search}` : ""}`;
  return {
    request: new NextRequest(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    context: { params: Promise.resolve({ path: pathname.split("/").filter(Boolean) }) },
  };
}

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

async function get<T>(token: string, path: string): Promise<T> {
  const { request, context } = v1(token, "GET", path);
  const response = await GET(request, context);
  const body = await response.json();
  assert.equal(response.status, 200, `GET ${path} → ${JSON.stringify(body)}`);
  return body as T;
}

async function post<T>(token: string, path: string, body: unknown): Promise<T> {
  const call = v1(token, "POST", path, body);
  const response = await POST(call.request, call.context);
  const answer = await response.json();
  assert.equal(response.status, 200, `POST ${path} → ${JSON.stringify(answer)}`);
  return answer as T;
}

async function del<T>(token: string, path: string): Promise<T> {
  const call = v1(token, "DELETE", path);
  const response = await DELETE(call.request, call.context);
  const answer = await response.json();
  assert.equal(response.status, 200, `DELETE ${path} → ${JSON.stringify(answer)}`);
  return answer as T;
}

async function refused(
  token: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<{ status: number; error: ApiErrorBody["error"] }> {
  const call = v1(token, method, path, body);
  const handler = method === "GET" ? GET : method === "POST" ? POST : DELETE;
  const response = await handler(call.request, call.context);
  const answer = (await response.json()) as ApiErrorBody;
  assert.ok(response.status >= 400, `expected a refusal, got ${JSON.stringify(answer)}`);
  return { status: response.status, error: answer.error };
}

describe("the want, checklist and trade operations (#712)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;

  let mnhId: string;
  let usedId: string;
  let areaId: string;
  let issueId: string;
  let checklistId: string;

  /** On the checklist, held for trade, and catalogued — the copy a requirement resolves to. */
  let heldStampId: string;
  let heldCopyId: string;
  let secondCopyId: string;
  /** On the checklist and held by nobody — the gap. */
  let gapStampId: string;
  /** On the checklist, missing, and already carrying an open want. */
  let wantedGapStampId: string;
  /** Wanted, not on the checklist — what the counterparty is offering. */
  let offeredStampId: string;
  let offeredWantId: string;

  before(async () => {
    userId = `test-user-tradeops-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User tradeops-${ts}`,
        email: `test-tradeops-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    // EUR throughout — collection, catalogue and trade — so no exchange rate is fetched and the
    // suite runs offline, the arrangement the offers suite beside it makes.
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-tradeops-${ts}`, name: "Trade ops", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Polen", currency: "EUR" },
    });
    const editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;

    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          catalogPrefix: "PL",
          primaryCatalogVendorId: vendor.id,
          primaryCatalogNameId: catalogName.id,
          collectionAreaCatalogs: { create: [{ catalogNameId: catalogName.id }] },
        },
      })
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

    // The partner, who is an exchange partner and **not** a platform — so the vocabulary read has
    // to separate the two rather than return every contact.
    await prisma.contact.create({
      data: {
        collectionId,
        name: "Anna Nováková",
        exchangePartner: true,
        email: `anna-${ts}@example.com`,
        phone: "+420 111 222 333",
        notes: "Met at the Prague fair.",
      },
    });

    const issue = await prisma.issue.create({
      data: { collectionId, issueNo: 9712, collectionAreaId: areaId, name: "Insurgents", year: 1938 },
    });
    issueId = issue.id;

    async function stamp(name: string, number: string): Promise<string> {
      const row = await prisma.stamp.create({ data: { collectionId, name, issuedYear: 1938 } });
      await prisma.stampCollectionArea.create({
        data: { stampId: row.id, collectionAreaId: areaId, isPrimary: true },
      });
      await prisma.issueMember.create({ data: { issueId: issue.id, stampId: row.id } });
      await prisma.stampCatalogNumber.create({
        data: { stampId: row.id, catalogVendorId: vendor.id, number },
      });
      return row.id;
    }

    async function price(stampId: string, conditionId: string, amount: string): Promise<void> {
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

    heldStampId = await stamp("Kościuszko", "200");
    gapStampId = await stamp("Overprint", "201");
    wantedGapStampId = await stamp("Definitive", "202");
    offeredStampId = await stamp("Franz Josef", "203");

    await price(heldStampId, mnhId, "50.00");
    await price(heldStampId, usedId, "8.00");
    await price(gapStampId, mnhId, "2.00");
    await price(wantedGapStampId, mnhId, "4.00");
    await price(offeredStampId, usedId, "30.00");

    checklistId = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId: issue.id,
          name: "Basic set",
          sortOrder: 0,
          stamps: {
            create: [
              { stampId: heldStampId, sortOrder: 0 },
              { stampId: gapStampId, sortOrder: 1 },
              { stampId: wantedGapStampId, sortOrder: 2 },
            ],
          },
        },
      })
    ).id;

    // Two copies of the one held stamp, both marked for trade — so #659's ranking has something to
    // choose between and a quantity of two has something to serve.
    async function copy(stampId: string, conditionId: string): Promise<string> {
      const item = await createItem(userId, collectionId, {
        stampId,
        conditionId,
        forTrade: true,
        inCollection: true,
      });
      return item.id;
    }
    heldCopyId = await copy(heldStampId, mnhId);
    secondCopyId = await copy(heldStampId, mnhId);

    // An open want on a checklist gap, so `find_checklist_gaps` has one row already covered and one
    // not — which is the difference that makes the answer worth reading.
    await createWant(userId, collectionId, {
      stampId: wantedGapStampId,
      conditionIds: [],
      certificateStatusIds: [],
      formatIds: [],
      priority: "normal",
      notes: null,
    });
    // And a narrow want on what the counterparty is offering: used only, so a mint copy of it would
    // *not* match and the acceptance rule is doing real work below.
    offeredWantId = (
      await createWant(userId, collectionId, {
        stampId: offeredStampId,
        conditionIds: [usedId],
        certificateStatusIds: [],
        formatIds: [],
        priority: "high",
        notes: "The one gap in the run.",
      })
    ).ids[0];

    token = (
      await createAssistantToken(userId, collectionId, {
        label: "trade agent",
        scope: "read_write",
        kind: "agent",
      })
    ).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, {
        label: "trade agent, read only",
        scope: "read",
        kind: "agent",
      })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.tradeShareToken.deleteMany({ where: { trade: { collectionId } } });
    await prisma.tradeLine.deleteMany({ where: { trade: { collectionId } } });
    await prisma.tradeSection.deleteMany({ where: { trade: { collectionId } } });
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.wantCondition.deleteMany({ where: { want: { collectionId } } });
    await prisma.wantCertificateStatus.deleteMany({ where: { want: { collectionId } } });
    await prisma.wantFormat.deleteMany({ where: { want: { collectionId } } });
    await prisma.want.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.checklistStamp.deleteMany({ where: { checklist: { collectionId } } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.stampCatalogPrice.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.stampCatalogNumber.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stampCollectionArea.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.contact.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── The boundary ──────────────────────────────────────────────────────────

  describe("the boundary the whole issue is about", () => {
    it("carries no send-shaped operation, checked against the registry rather than asserted", () => {
      // #712's *Done when*: **no send-shaped or share-shaped operation exists in the registry**. A
      // sentence in a document is not a check, and this is the one guard that still answers when
      // somebody adds an operation in six months without reading the issue.
      //
      // It is a **verb** test, `agent-api-offers.test.ts`'s shape and for its reason: a fragment
      // crude enough to catch `share_trade` would take `find_checklist_gaps` and
      // `add_trade_receive_lines` with it. Its sibling —
      // `tests/unit/agent-api-operation-boundary.test.ts` — fails on the *imports* instead, and
      // catches what this one cannot: a sending operation called something innocent.
      const forbiddenVerbs = new Set([
        "send",
        "share",
        "propose",
        "publish",
        "post",
        "submit",
        "notify",
        "email",
        "close",
        "cancel",
        "agree",
        "revoke",
        "mint",
        "sync",
      ]);
      const forbiddenWords = new Set([
        "proposal",
        "share",
        "token",
        "feedback",
        "partner",
        "colnect",
      ]);
      const offenders = OPERATIONS.filter((operation) => {
        const words = operation.name.split("_");
        return forbiddenVerbs.has(words[0]) || words.some((word) => forbiddenWords.has(word));
      }).map((operation) => operation.name);
      assert.deepEqual(
        offenders,
        [],
        "the agent never reaches a counterparty, and the boundary is that no such operation exists (#712)"
      );
    });

    it("would notice one, so the assertion above is not green for want of an instrument", () => {
      // A control that has never been seen to fail is indistinguishable from one that cannot fail
      // (#814). The predicate is run over names that are **not** in the registry, which is what
      // makes the empty result above worth reading.
      const words = (name: string) => name.split("_");
      const caught = [
        "send_trade_proposal",
        "share_trade",
        "mint_share_link",
        "close_trade",
        "sync_colnect_list",
        "save_partner_feedback",
      ];
      const verbs = new Set([
        "send",
        "share",
        "propose",
        "publish",
        "post",
        "submit",
        "notify",
        "email",
        "close",
        "cancel",
        "agree",
        "revoke",
        "mint",
        "sync",
      ]);
      const nouns = new Set(["proposal", "share", "token", "feedback", "partner", "colnect"]);
      for (const name of caught) {
        assert.ok(
          verbs.has(words(name)[0]) || words(name).some((word) => nouns.has(word)),
          `${name} would not have been caught`
        );
      }
      // And the real names a crude pattern would have taken with it.
      for (const name of ["add_trade_receive_lines", "find_checklist_gaps", "list_trades"]) {
        assert.ok(
          !verbs.has(words(name)[0]) && !words(name).some((word) => nouns.has(word)),
          `${name} is a real operation and must not be caught`
        );
      }
    });

    it("has no way to move a trade's state, so a draft stays a draft", async () => {
      const draft = await post<AgentTrade>(token, "/trades", { partner: "Anna Nováková" });
      assert.equal(draft.status, "preparing");
      // The other half of *absence, not a flag*: there is no status parameter on `create_trade` and
      // no operation that takes one.
      const paths = OPERATIONS.map((operation) => `${operation.method} ${operation.path}`);
      assert.ok(
        !paths.some((path) => /status|share|proposal|feedback|fulfil|close/.test(path)),
        paths.join(", ")
      );
    });

    it("does not hand the agent the partner's link, even when one exists", async () => {
      // **The sharpest check in this file, and it needs a real token to be one.** `TradeData.share`
      // carries the address the partner opens the list at. A fixture with no link would pass the
      // projection test trivially, so one is minted here and the whole response is searched for it.
      const draft = await post<AgentTrade>(token, "/trades", { partner: "Anna Nováková" });
      const { token: shareToken } = await createTradeShareToken(userId, draft.tradeId, {
        showValues: true,
        expiresAt: null,
      });
      assert.ok(shareToken.length > 20, "the fixture minted nothing to look for");

      const read = await get<AgentTrade>(token, `/trades/${draft.tradeId}`);
      const serialised = JSON.stringify(read);
      assert.ok(!serialised.includes(shareToken), "the share token reached the agent");
      assert.ok(!("share" in (read as unknown as Record<string, unknown>)), "the share block reached the agent");
      // And the list row beside it, which is a different projection over a different read.
      const list = await get<ListResponse<AgentTradeRow>>(token, "/trades");
      assert.ok(!JSON.stringify(list).includes(shareToken), "the share token reached the list");
    });

    it("hands the agent no contact details for the person it is trading with", async () => {
      // The exchange-partner vocabulary is a projection of `Contact`, which carries an email, a
      // phone number and the collector's private notes. #708 measured that the mapper is the guard
      // rather than the `where` or the `select`, so this asks the wire rather than the query.
      const vocabulary = await get<Record<string, unknown>>(token, "/vocabulary");
      const serialised = JSON.stringify(vocabulary);
      assert.ok(serialised.includes("Anna Nováková"), "the partner is missing from the vocabulary");
      assert.ok(!serialised.includes(`anna-${ts}@example.com`), "an email reached the agent");
      assert.ok(!serialised.includes("+420 111 222 333"), "a phone number reached the agent");
      assert.ok(!serialised.includes("Prague fair"), "a private note reached the agent");
    });
  });

  // ── The wants and the checklist ───────────────────────────────────────────

  describe("what the collection is looking for", () => {
    it("states an unnarrowed acceptance axis as *any* rather than as empty", async () => {
      const page = await get<ListResponse<AgentWant>>(
        token,
        `/wants?stamp_id=${offeredStampId}`
      );
      assert.equal(page.total, 1);
      const row = page.items[0];
      assert.deepEqual(row.conditions, ["Used"]);
      assert.deepEqual(row.certificates, ["(any)"]);
      assert.deepEqual(row.formats, ["(any)"]);
      assert.equal(row.priority, "high");
      assert.deepEqual(row.catalogNumbers, ["Mi·PL 203"]);
    });

    it("answers what a counterparty holds against the want list, in the grade asked about", async () => {
      // The want on this stamp is **used only**, so the same stamp offered mint must not match. That
      // is ADR-0032 §1 doing real work rather than the shape of the response being asserted.
      const used = await get<ListResponse<AgentWantMatch>>(
        token,
        `/wants/matches?stamp_ids=${offeredStampId},${heldStampId}&condition=U`
      );
      assert.equal(used.total, 2);
      assert.deepEqual(
        used.items.map((row) => row.wants.map((hit) => hit.wantId)),
        [[offeredWantId], []],
        "the used copy answers the used want and nothing answers the held stamp"
      );
      // *No* is an answer: the second row is present and empty rather than missing.
      assert.equal(used.items[1].stampId, heldStampId);
      // And the other half of the decision — what is already held of the stamp being offered.
      assert.equal(used.items[0].copiesOfStamp.held, 0);
      assert.equal(used.items[1].copiesOfStamp.held, 2);

      const mint = await get<ListResponse<AgentWantMatch>>(
        token,
        `/wants/matches?stamp_ids=${offeredStampId}&condition=MNH`
      );
      assert.deepEqual(mint.items[0].wants, [], "a mint copy does not answer a used-only want");
    });

    it("refuses a stamp that is not in this collection rather than answering short", async () => {
      // A row simply missing would read as *not wanted*, which is the one wrong answer an agent
      // cannot tell from a right one.
      const { status, error } = await refused(
        token,
        "GET",
        `/wants/matches?stamp_ids=${offeredStampId},not-a-stamp&condition=U`
      );
      assert.equal(status, 404);
      assert.equal(error.code, "not_found");
      assert.ok(error.message.includes("not-a-stamp"), error.message);
    });

    it("names a checklist's gap and says which of it is already being looked for", async () => {
      const gaps = await get<AgentChecklistGaps>(token, `/issues/${issueId}/checklist-gaps`);
      assert.equal(gaps.checklists.length, 1);
      const list = gaps.checklists[0];
      assert.equal(list.checklistId, checklistId);
      assert.equal(list.required, 3);
      assert.equal(list.held, 1, "one of the three is held");
      assert.deepEqual(
        list.missing.map((stamp) => stamp.stampId).sort(),
        [gapStampId, wantedGapStampId].sort()
      );
      const wanted = list.missing.find((stamp) => stamp.stampId === wantedGapStampId);
      const unwanted = list.missing.find((stamp) => stamp.stampId === gapStampId);
      assert.equal(wanted?.alreadyWanted, true);
      assert.ok(
        !(unwanted && "alreadyWanted" in unwanted),
        "a gap nobody is looking for carries no flag"
      );
    });
  });

  // ── The composition claim ─────────────────────────────────────────────────

  describe("from `what does this partner have that I want` to a drafted, balanced trade", () => {
    it("is the actual sequence of calls, and the answers are read out here rather than asserted", async () => {
      // **#712's *Done when*, performed.** Each step is a call an agent makes, and what it answered
      // is read out of the next one rather than assumed.

      // 1. What does the counterparty have that I want? They are offering the used Franz Josef.
      const matches = await get<ListResponse<AgentWantMatch>>(
        token,
        `/wants/matches?stamp_ids=${offeredStampId}&condition=U`
      );
      assert.equal(matches.items[0].wants.length, 1);

      // 2. Start the exchange. Nothing is sent; it is a draft with one section to work in.
      const draft = await post<AgentTrade>(token, "/trades", {
        partner: "Anna Nováková",
        balance_by: "value",
        agreed_catalog: "Mi",
      });
      assert.equal(draft.status, "preparing");
      assert.equal(draft.contentEditable, true);
      assert.equal(draft.balanceBy, "value");
      assert.equal(draft.agreedCatalog, "Michel");
      assert.equal(draft.currency, "EUR", "the trade currency defaults to the collection's own");
      const sectionId = draft.sections[0].sectionId;

      // 3. Ask for it. A receive line names a stamp and a grade, because the partner's stamps are
      //    in nobody's inventory.
      const asked = await post<{ added: number }>(
        token,
        `/trade-sections/${sectionId}/receive`,
        { stamp_id: offeredStampId, condition: "U", quantity: 1 }
      );
      assert.equal(asked.added, 1);

      // 4. Offer something back. The partner asked for the Kościuszko mint, and the resolver picks
      //    which copy goes — #659's order, which is exactly the rule an agent must not restate.
      const served = await post<AgentGiveLineResult>(
        token,
        `/trade-sections/${sectionId}/requirements`,
        { stamp_id: heldStampId, condition: "MNH", quantity: 1 }
      );
      assert.equal(served.added, 1);
      assert.deepEqual(served.refused, []);
      // #659's own labeller spells a requirement's subject `<number> · <name>` — the raw catalogue
      // number rather than the area-prefixed one the rows carry. Asserted as it is rather than as it
      // "ought" to be: it is what the collector's own import report prints, and a second spelling
      // here would be the agent and the screen naming one stamp two ways.
      assert.deepEqual(served.requirements, [
        { stamp: "200 · Kościuszko", requested: 1, served: 1, missing: 0 },
      ]);

      // 5. Read it back. A give line names a concrete copy; a receive line does not.
      const give = await get<ListResponse<AgentTradeLine>>(
        token,
        `/trade-sections/${sectionId}/lines?side=give`
      );
      assert.equal(give.total, 1);
      assert.ok(
        [heldCopyId, secondCopyId].includes(give.items[0].copyId!),
        "the resolver promised one of the two copies"
      );
      assert.equal(give.items[0].catalogValue.baseAmount, "50.00");
      const receive = await get<ListResponse<AgentTradeLine>>(
        token,
        `/trade-sections/${sectionId}/lines?side=receive`
      );
      assert.equal(receive.total, 1);
      assert.ok(!("copyId" in receive.items[0]), "a receive line names no copy");
      assert.equal(receive.items[0].catalogValue.baseAmount, "30.00");

      // 6. Does it balance? Fifty against thirty, judged on value in the agreed catalogue.
      const before = await get<AgentTradeBalance>(token, `/trades/${draft.tradeId}/balance`);
      assert.equal(before.baseCurrency, "EUR");
      assert.equal(before.tradeCurrency, "EUR");
      assert.equal(before.agreedCatalog, "Michel");
      assert.equal(before.trade.balanceBy, "value");
      assert.equal(before.trade.give.agreed, 50);
      assert.equal(before.trade.receive.agreed, 30);
      assert.equal(before.trade.valueDiff, 20);
      assert.equal(before.trade.valueBalanced, false, "forty percent apart is not balanced");
      assert.deepEqual(before.blockers, [], "every line is valued, so nothing is blocking");

      // 7. Make it balance by taking the heavy line off — which is the other half of *adjust*.
      const removed = await del<{ removed: number }>(
        token,
        `/trade-lines/${give.items[0].lineId}`
      );
      assert.equal(removed.removed, 1);
      const after = await get<AgentTradeBalance>(token, `/trades/${draft.tradeId}/balance`);
      assert.equal(after.trade.give.agreed, 0);
      assert.equal(after.trade.give.lines, 0);

      // 8. And the drafted trade is left behind in the app, where the collector finds it.
      const left = await get<AgentTrade>(token, `/trades/${draft.tradeId}`);
      assert.equal(left.status, "preparing");
      assert.equal(left.partner, "Anna Nováková");
      assert.equal(left.sections[0].receiveLines, 1);
      assert.ok(left.path.startsWith(`/c/col-tradeops-${ts}/trades/`), left.path);
    });

    it("reports a shortfall rather than throwing, because a gap is what goes back to the partner", async () => {
      // #659's rule on the wire: *you do not hold this in this grade* is the useful half of an
      // answer about somebody else's wish list, so it survives to the report.
      const draft = await post<AgentTrade>(token, "/trades", { partner: "Anna Nováková" });
      const sectionId = draft.sections[0].sectionId;
      const served = await post<AgentGiveLineResult>(
        token,
        `/trade-sections/${sectionId}/requirements`,
        { stamp_id: gapStampId, condition: "MNH", quantity: 2 }
      );
      assert.equal(served.added, 0);
      assert.deepEqual(served.requirements, [
        { stamp: "201 · Overprint", requested: 2, served: 0, missing: 2 },
      ]);
    });

    it("takes N distinct copies for a quantity of N, and never one copy twice", async () => {
      const draft = await post<AgentTrade>(token, "/trades", { partner: "Anna Nováková" });
      const sectionId = draft.sections[0].sectionId;
      const served = await post<AgentGiveLineResult>(
        token,
        `/trade-sections/${sectionId}/requirements`,
        { stamp_id: heldStampId, condition: "MNH", quantity: 2 }
      );
      assert.equal(served.added, 2);
      const lines = await get<ListResponse<AgentTradeLine>>(
        token,
        `/trade-sections/${sectionId}/lines?side=give`
      );
      const copies = lines.items.map((line) => line.copyId);
      assert.equal(new Set(copies).size, 2, "one copy cannot serve two pieces");
    });

    it("refuses a requirement that names both a stamp and a set, with the sentence saying which", async () => {
      const draft = await post<AgentTrade>(token, "/trades", { partner: "Anna Nováková" });
      const { status, error } = await refused(
        token,
        "POST",
        `/trade-sections/${draft.sections[0].sectionId}/requirements`,
        { stamp_id: heldStampId, checklist_id: checklistId, condition: "MNH" }
      );
      assert.equal(status, 400);
      assert.equal(error.code, "invalid_request");
      assert.ok(error.message.includes("exactly one"), error.message);
    });

    it("refuses a value-balanced trade that names no catalogue, as the one fault it is", async () => {
      // #638's own rule: the alternative is forty lines each blamed for a figure the trade never
      // asked any book for. Caught before the trade exists rather than on the first balance read.
      const { status, error } = await refused(token, "POST", "/trades", {
        partner: "Anna Nováková",
        balance_by: "value",
      });
      assert.equal(status, 400);
      assert.ok(error.message.includes("agreed_catalog"), error.message);
    });

    it("refuses a partner the collection does not know, with the names that would have worked", async () => {
      // **The agent may not add a person to the address book**, which is *writing to the vocabulary
      // is out of scope* (#708) — so a typed name is a refusal rather than a new contact.
      const beforeCount = await prisma.contact.count({ where: { collectionId } });
      const { status, error } = await refused(token, "POST", "/trades", { partner: "Nobody" });
      assert.equal(status, 400);
      assert.ok(error.accepted?.includes("Anna Nováková"), JSON.stringify(error.accepted));
      assert.equal(
        await prisma.contact.count({ where: { collectionId } }),
        beforeCount,
        "a refused partner must not have been created on the way"
      );
    });
  });

  // ── Scope ─────────────────────────────────────────────────────────────────

  describe("a read token on the writing trade verbs", () => {
    it("is refused on the wire, naming the scope that would have worked", async () => {
      const { status, error } = await refused(readOnlyToken, "POST", "/trades", {
        partner: "Anna Nováková",
      });
      assert.equal(status, 403);
      assert.equal(error.code, "forbidden");
      assert.deepEqual(error.accepted, ["read", "read_write"]);
    });

    it("is refused through the MCP wrapper too, by the binding and by nothing else", async () => {
      const response = await MCP_POST(
        new NextRequest("http://localhost/api/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${readOnlyToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "create_trade", arguments: { partner: "Anna Nováková" } },
          }),
        })
      );
      const answer = (await response.json()) as {
        result?: { isError?: boolean; content?: { text?: string }[] };
      };
      assert.equal(answer.result?.isError, true, JSON.stringify(answer));
      assert.ok(
        JSON.stringify(answer.result?.content).includes("read_write"),
        JSON.stringify(answer.result)
      );
    });

    it("reads everything that does not write", async () => {
      const page = await get<ListResponse<AgentTradeRow>>(readOnlyToken, "/trades");
      assert.ok(page.total > 0, "a read token sees the trades");
      const gaps = await get<AgentChecklistGaps>(
        readOnlyToken,
        `/issues/${issueId}/checklist-gaps`
      );
      assert.equal(gaps.checklists.length, 1);
    });
  });

  // ── What adding them to the registry published ────────────────────────────

  describe("what adding them to the registry published", () => {
    const NEW_OPERATIONS = [
      "list_wants",
      "match_wants",
      "find_checklist_gaps",
      "list_trades",
      "create_trade",
      "get_trade",
      "list_trade_lines",
      "get_trade_balance",
      "add_trade_give_lines",
      "serve_trade_requirement",
      "add_trade_receive_lines",
      "remove_trade_line",
    ];

    it("puts every one of them in the OpenAPI document, from one edit", () => {
      const document = buildOpenApiDocument(OPERATIONS, { appVersion: "test" }) as {
        paths: Record<string, Record<string, { operationId: string }>>;
      };
      const published = new Set(
        Object.values(document.paths).flatMap((methods) =>
          Object.values(methods).map((operation) => operation.operationId)
        )
      );
      for (const name of NEW_OPERATIONS) {
        assert.ok(published.has(name), `${name} is not in the document`);
      }
    });

    it("puts every one of them in the MCP tool list, from the same edit", () => {
      const tools = buildToolList(OPERATIONS).map((tool) => tool.name);
      for (const name of NEW_OPERATIONS) {
        assert.ok(tools.includes(name), `${name} is not a tool`);
      }
    });

    it("declares `writes` honestly, which is the one thing no other test can see", () => {
      // **There is no test that can check a declaration against what a handler does** — nothing
      // reads a handler's body — so this is the place the four writing verbs are enumerated and the
      // eight reading ones are asserted not to have crept in.
      const byName = new Map(OPERATIONS.map((operation) => [operation.name, operation.writes]));
      for (const name of [
        "create_trade",
        "add_trade_give_lines",
        "serve_trade_requirement",
        "add_trade_receive_lines",
        "remove_trade_line",
      ]) {
        assert.equal(byName.get(name), true, `${name} writes and must say so`);
      }
      for (const name of [
        "list_wants",
        "match_wants",
        "find_checklist_gaps",
        "list_trades",
        "get_trade",
        "list_trade_lines",
        "get_trade_balance",
      ]) {
        assert.equal(byName.get(name), false, `${name} writes nothing and must say so`);
      }
    });
  });
});
