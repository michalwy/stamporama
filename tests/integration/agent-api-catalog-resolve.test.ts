import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { OPERATIONS, matchPath, pickMethod } from "../../src/lib/agent-api/registry";
import { buildOpenApiDocument } from "../../src/lib/agent-api/openapi";
import { buildToolList } from "../../src/lib/agent-api/mcp";
import { parseParameters } from "../../src/lib/agent-api/params";
import { LIST_PARAMETERS } from "../../src/lib/agent-api/list";
import { isApiError } from "../../src/lib/agent-api/errors";
import type { ListResponse } from "../../src/lib/agent-api/list";
import type { AgentCatalogResolution } from "../../src/lib/agent-api/catalog-resolve";
import type { OperationContext } from "../../src/lib/agent-api/types";

// **The half of #1037 a pure test cannot make a claim about** (`agent-api.md`).
//
// `tests/unit/agent-api-catalog-resolve.test.ts` holds every decision, because each is a function of
// strings. What it cannot hold is that the prefixes come off a **real** area tree and a real issue
// override, that the recall net actually reaches the row the exact comparison then keeps, that the
// stated vendor resolves through #708's resolver against a real dictionary, that the collection
// pinning excludes the collector's *other* collection, and — the criterion #1037 states — that
// **one call** answers a batch with a verdict apiece. Those are claims about composition, checkable
// only by making the call and reading what comes back.
//
// Every operation is reached the way the dispatcher reaches it — `matchPath` → `pickMethod` →
// `parseParameters` → `handler` — so the registry's binding is exercised rather than assumed.

const ts = Date.now();

type Resolutions = ListResponse<AgentCatalogResolution>;

/** Drive one operation exactly as `src/app/api/v1/[...path]/route.ts` does. */
async function call<T>(
  context: OperationContext,
  path: string,
  query: URLSearchParams
): Promise<T> {
  const match = matchPath(path.split("/").filter(Boolean));
  assert.ok(match.candidates.length > 0, `nothing is bound to /api/v1/${path}`);
  const picked = pickMethod(match, "GET");
  assert.ok(picked, `/api/v1/${path} does not accept GET`);
  const { operation, pathValues } = picked;
  const specs =
    operation.result.kind === "list"
      ? [...operation.parameters, ...LIST_PARAMETERS]
      : operation.parameters;
  const params = parseParameters(specs, { path: pathValues, query });
  return (await operation.handler(context, params)) as T;
}

/** The query a batch call is made with: one `numbers` per string, plus anything else. */
function batch(numbers: readonly string[], extra: Record<string, string> = {}): URLSearchParams {
  const query = new URLSearchParams();
  for (const number of numbers) query.append("numbers", number);
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return query;
}

async function resolve(
  context: OperationContext,
  numbers: readonly string[],
  extra: Record<string, string> = {}
): Promise<Resolutions> {
  return call<Resolutions>(context, "catalog/resolve", batch(numbers, extra));
}

/** The one row for a string, found by the input it was asked with. */
function row(answer: Resolutions, input: string): AgentCatalogResolution {
  const found = answer.items.find((item) => item.input === input);
  assert.ok(found, `no row came back for "${input}"`);
  return found;
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

describe("resolving foreign catalog numbers (#1037)", () => {
  let userId: string;
  let collectionId: string;
  /** A second collection of the **same owner**: the collection is the token's, not the user's. */
  let otherCollectionId: string;
  let context: OperationContext;

  let michelId: string, scottId: string;
  let miPl123a: string, sc123a: string, miPl200: string, miSp1: string, miPl1: string;
  let foreignStampId: string;

  before(async () => {
    userId = `test-user-catres-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User catres-${ts}`,
        email: `test-catres-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-catres-${ts}`, name: "Catres", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-catres-other-${ts}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    context = { ownerId: userId, collectionId };

    michelId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    scottId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Scott", abbreviation: "Sc" },
      })
    ).id;

    // `Poland` states `PL` for every vendor; `Austria` states nothing, so a number under it carries
    // no prefix at all and the bare-number key is the only one it answers to.
    const polandId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          catalogPrefix: "PL",
          primaryCatalogVendorId: michelId,
        },
      })
    ).id;
    const austriaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Austria", primaryCatalogVendorId: scottId },
      })
    ).id;

    // The prefix that makes `Mi·SP 1` a different stamp from `Mi·PL 1` comes off an **issue
    // override** (#377) rather than a second area, because the override is the level a resolver is
    // most likely to be built without and the one that decides the whole catalog identity.
    const specialIssueId = (
      await prisma.issue.create({
        data: {
          collectionId,
          issueNo: 91037,
          collectionAreaId: polandId,
          name: "Specjalne",
          year: 1919,
          catalogPrefixes: { create: [{ catalogVendorId: michelId, areaPrefix: "SP" }] },
        },
      })
    ).id;

    const stamp = async (
      name: string,
      vendorId: string,
      number: string,
      areaId: string
    ): Promise<string> =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name,
            issuedYear: 1919,
            catalogNumbers: { create: [{ catalogVendorId: vendorId, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;

    miPl123a = await stamp("Kościuszko", michelId, "123a", polandId);
    sc123a = await stamp("Franz Josef", scottId, "123a", austriaId);
    miPl200 = await stamp("Orzeł", michelId, "200", polandId);
    miSp1 = await stamp("Specjalny", michelId, "1", polandId);
    miPl1 = await stamp("Pierwszy", michelId, "1", polandId);
    await prisma.issueMember.create({
      data: { issueId: specialIssueId, stampId: miSp1, sortOrder: 0 },
    });

    // The same number in a collection this token is not pinned to.
    const otherVendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId: otherCollectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    foreignStampId = (
      await prisma.stamp.create({
        data: {
          collectionId: otherCollectionId,
          name: "Elsewhere",
          catalogNumbers: { create: [{ catalogVendorId: otherVendorId, number: "123a" }] },
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it("is in the registry, reads only, and reaches both wrappers", () => {
    const operation = OPERATIONS.find((op) => op.name === "resolve_catalog_numbers");
    assert.ok(operation, "resolve_catalog_numbers is not in OPERATIONS");
    assert.equal(operation.writes, false);
    const document = buildOpenApiDocument(OPERATIONS, { appVersion: "test" }) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const published = Object.values(document.paths).flatMap((byMethod) =>
      Object.values(byMethod).map((entry) => entry.operationId)
    );
    assert.ok(
      published.includes("resolve_catalog_numbers"),
      "the operation is missing from the OpenAPI document"
    );
    assert.ok(
      buildToolList(OPERATIONS).some((tool) => tool.name === "resolve_catalog_numbers"),
      "the operation is missing from the MCP tool list"
    );
  });

  it("answers a whole batch in one call, with a verdict apiece", async () => {
    // #1037's first criterion, asked the way its use case asks it: a morning's listings, mixed.
    const answer = await resolve(context, [
      "Mi 123a",
      "Michel 123a",
      "mi123a",
      "Mi·PL 123a",
      "123a",
      "Fi 456",
      "Mi 999999",
    ]);

    assert.equal(answer.total, 7, "`total` counts the strings sent");
    assert.equal(answer.items.length, 7);
    assert.equal(answer.nextCursor, null);

    for (const input of ["Mi 123a", "Michel 123a", "mi123a", "Mi·PL 123a"]) {
      const resolved = row(answer, input);
      assert.equal(resolved.verdict, "resolved", input);
      assert.equal(resolved.stamps.length, 1, input);
      assert.equal(resolved.stamps[0].stampId, miPl123a, input);
      assert.equal(resolved.stamps[0].matchedNumber, "Mi·PL 123a", input);
      assert.equal(resolved.vendor, "Michel", input);
      assert.equal(resolved.number, "123a", input);
    }

    const bare = row(answer, "123a");
    assert.equal(bare.verdict, "ambiguous");
    assert.deepEqual(
      bare.stamps.map((stamp) => stamp.stampId).sort(),
      [miPl123a, sc123a].sort(),
      "a bare number naming no catalogue reaches both, and picks neither"
    );

    const unknown = row(answer, "Fi 456");
    assert.equal(unknown.verdict, "unknown_vendor");
    assert.equal(unknown.vendorToken, "Fi");
    assert.deepEqual(unknown.acceptedVendors, ["Michel (Mi)", "Scott (Sc)"]);
    assert.deepEqual(unknown.stamps, []);

    const missing = row(answer, "Mi 999999");
    assert.equal(missing.verdict, "no_match");
    assert.equal(missing.vendorToken, undefined);
    assert.deepEqual(missing.stamps, []);
  });

  it("an ambiguous row carries enough to tell the candidates apart", async () => {
    const answer = await resolve(context, ["123a"]);
    const [first, second] = row(answer, "123a").stamps;
    assert.ok(first && second);
    assert.notEqual(first.matchedNumber, second.matchedNumber);
    assert.deepEqual(
      [first, second].map((stamp) => stamp.matchedNumber).sort(),
      ["Mi·PL 123a", "Sc 123a"]
    );
    for (const stamp of [first, second]) {
      assert.ok(stamp.name, "a candidate states its name");
      assert.ok(stamp.area, "a candidate states its area");
      assert.ok(stamp.path.startsWith(`/c/col-catres-${ts}/stamps/`));
      assert.ok(stamp.catalogNumbers.length > 0);
    }
  });

  it("a stated catalogue turns the same ambiguous string into a resolution", async () => {
    for (const vendor of ["Michel", "Mi", michelId]) {
      const answer = await resolve(context, ["123a"], { vendor });
      const resolved = row(answer, "123a");
      assert.equal(resolved.verdict, "resolved", vendor);
      assert.equal(resolved.stamps[0].stampId, miPl123a, vendor);
    }
    const scott = row(await resolve(context, ["123a"], { vendor: "Sc" }), "123a");
    assert.equal(scott.verdict, "resolved");
    assert.equal(scott.stamps[0].stampId, sc123a);
  });

  it("a catalogue named in the string outranks the one the caller stated", async () => {
    const answer = await resolve(context, ["Sc 123a"], { vendor: "Michel" });
    const resolved = row(answer, "Sc 123a");
    assert.equal(resolved.verdict, "resolved");
    assert.equal(resolved.stamps[0].stampId, sc123a);
    assert.equal(resolved.vendor, "Scott");
  });

  it("an issue's prefix override is part of the identity", async () => {
    // `Mi·SP 1` and `Mi·PL 1` are two stamps (#377), and a bare `Mi 1` names neither.
    const answer = await resolve(context, ["Mi·SP 1", "Mi·PL 1", "Mi 1"]);
    assert.deepEqual(
      row(answer, "Mi·SP 1").stamps.map((stamp) => stamp.stampId),
      [miSp1]
    );
    assert.deepEqual(
      row(answer, "Mi·PL 1").stamps.map((stamp) => stamp.stampId),
      [miPl1]
    );
    assert.equal(row(answer, "Mi 1").verdict, "ambiguous");
  });

  it("an area prefix on the front of a number is not read as a catalogue", async () => {
    const answer = await resolve(context, ["PL 200", "200"]);
    assert.equal(row(answer, "PL 200").verdict, "resolved");
    assert.deepEqual(
      row(answer, "PL 200").stamps.map((stamp) => stamp.stampId),
      [miPl200]
    );
    assert.equal(row(answer, "200").verdict, "resolved");
  });

  it("does not reach the collector's other collection", async () => {
    // The token is pinned to one collection (#706). `Mi 123a` exists in both and answers once.
    const answer = await resolve(context, ["Mi 123a"]);
    const ids = row(answer, "Mi 123a").stamps.map((stamp) => stamp.stampId);
    assert.deepEqual(ids, [miPl123a]);
    assert.ok(!ids.includes(foreignStampId));
  });

  it("pages over the strings, and the cursor walks the caller's own list", async () => {
    const first = await resolve(context, ["Mi 123a", "Mi 200", "Mi 999999"], { limit: "2" });
    assert.equal(first.total, 3);
    assert.equal(first.items.length, 2);
    assert.equal(first.nextCursor, "2");
    assert.deepEqual(
      first.items.map((item) => item.input),
      ["Mi 123a", "Mi 200"]
    );

    const second = await resolve(context, ["Mi 123a", "Mi 200", "Mi 999999"], {
      limit: "2",
      cursor: first.nextCursor!,
    });
    assert.equal(second.total, 3);
    assert.deepEqual(
      second.items.map((item) => item.input),
      ["Mi 999999"]
    );
    assert.equal(second.nextCursor, null);
  });

  it("refuses a catalogue this collection does not keep, naming the ones it does", async () => {
    // #708's resolver on the wire: a name the agent was told to send being refused is the failure
    // that would be, so the accepted list is what `get_collection_vocabulary` hands over.
    const error = await refusal(() => resolve(context, ["123a"], { vendor: "Fischer" }));
    assert.equal(error.code, "invalid_request");
    assert.deepEqual(error.accepted, ["Michel (Mi)", "Scott (Sc)"]);
  });

  it("refuses a call with nothing to resolve", async () => {
    const error = await refusal(() => call(context, "catalog/resolve", new URLSearchParams()));
    assert.equal(error.code, "invalid_request");
    assert.match(error.message, /numbers/);
  });

  it("refuses an undeclared query parameter rather than ignoring it", async () => {
    const error = await refusal(() => resolve(context, ["123a"], { catalogue: "Michel" }));
    assert.equal(error.code, "invalid_request");
    assert.ok(error.accepted?.includes("vendor"));
  });
});
