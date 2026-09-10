import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { readCollectionVocabulary } from "../../src/lib/agent-api/operations/vocabulary";
import { getCollectionVocabularyOperation } from "../../src/lib/agent-api/operations/vocabulary";
import { OPERATIONS, matchPath, pickMethod } from "../../src/lib/agent-api/registry";
import { buildOpenApiDocument } from "../../src/lib/agent-api/openapi";
import { resolveVocabularyValue } from "../../src/lib/agent-api/vocabulary";
import { isApiError } from "../../src/lib/agent-api/errors";

// **The half of #708 a pure test cannot make a claim about** (`agent-api.md`).
//
// `tests/unit/agent-api-vocabulary.test.ts` holds the resolver's whole decision, because that is a
// function of a value and a list. What it cannot hold is the **lookup**: that eight `select`s name
// the right columns, that the translation filter picks the collection's own language, that the
// label falls back to an area's `titleName`, and that what comes out is the shape the operation
// declares. Every one of those is a claim about a real collection in a real database, which is why
// this file exists — the same reason `agent-api-auth.test.ts` is an integration test.
//
// It also exercises the operation the way the dispatcher does, since #708 is the first entry in the
// registry and *appears in the OpenAPI document with no second place to edit* is #706's criterion
// that nothing had yet demonstrated against a real operation.

const ts = Date.now();

describe("the collection vocabulary operation", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let context: { ownerId: string; collectionId: string };

  before(async () => {
    // Unique per run, like every other file here: the suite isolates by id, and a fixed one
    // survives a run whose `before` threw.
    const user = await prisma.user.create({
      data: {
        id: `test-user-vocab-${ts}`,
        name: "Vocabulary User",
        email: `test-vocab-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    userId = user.id;

    // `defaultLanguage: "pl"` on purpose. The `name` columns hold what the collector configured and
    // a translation row for the collection's own language is what `label` is meant to surface, so a
    // collection whose default language is English could not tell a working fallback from a dead one.
    collectionId = (
      await prisma.collection.create({
        data: {
          name: "Vocabulary",
          slug: `vocab-${ts}`,
          baseCurrency: "PLN",
          defaultLanguage: "pl",
          ownerId: userId,
        },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          name: "Other",
          slug: `vocab-other-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    context = { ownerId: userId, collectionId };

    const mnh = await prisma.stampCondition.create({
      data: {
        collectionId,
        name: "Mint Never Hinged",
        abbreviation: "MNH",
        sortOrder: 0,
      },
    });
    await prisma.stampConditionTranslation.create({
      data: { stampConditionId: mnh.id, language: "pl", name: "Czysty bez podlepki" },
    });
    // A translation in a language that is *not* the collection's default must not leak into `label`.
    await prisma.stampConditionTranslation.create({
      data: { stampConditionId: mnh.id, language: "de", name: "Postfrisch" },
    });
    await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
    });
    // **The discriminating row**, and it exists because the obvious test did not discriminate.
    // A condition translated into a language that is *not* this collection's, and into no other:
    // with the filter its `label` is absent, and without the filter its `label` becomes
    // "Gefalzt". Asserting on `MNH` instead could not see the difference — it carries a `pl` row
    // as well, which Prisma happened to return first, so dropping the filter left the answer
    // unchanged and the test green. Only a row with exactly one, wrong-language translation
    // separates *the filter works* from *the ordering was lucky*.
    const mh = await prisma.stampCondition.create({
      data: { collectionId, name: "Mint Hinged", abbreviation: "MH", sortOrder: 2 },
    });
    await prisma.stampConditionTranslation.create({
      data: { stampConditionId: mh.id, language: "de", name: "Gefalzt" },
    });
    // The other collection's rows must not appear anywhere in the answer.
    await prisma.stampCondition.create({
      data: {
        collectionId: otherCollectionId,
        name: "Should Not Appear",
        abbreviation: "SNA",
        sortOrder: 0,
      },
    });

    await prisma.stampFormat.create({
      data: { collectionId, name: "Block of 4", abbreviation: "Blk4", sortOrder: 0 },
    });
    await prisma.certificateStatus.create({
      data: { collectionId, name: "Certificate", abbreviation: "Cert", sortOrder: 0 },
    });
    await prisma.stampSubtype.create({
      data: { collectionId, name: "Basic", actsAsVariant: false, isDefault: true, sortOrder: 0 },
    });
    await prisma.stampSubtype.create({
      data: { collectionId, name: "Perforation", actsAsVariant: true, isDefault: false, sortOrder: 1 },
    });

    const poland = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Second Republic",
        titleName: "Poland",
        assignable: false,
        sortOrder: 0,
      },
    });
    await prisma.collectionArea.create({
      data: { collectionId, name: "1918-1939", parentId: poland.id, assignable: true, sortOrder: 1 },
    });

    const cabinet = await prisma.location.create({
      data: { collectionId, name: "Cabinet", assignable: false },
    });
    await prisma.location.create({
      data: { collectionId, name: "Stockbook A", parentId: cabinet.id, assignable: true },
    });

    const michel = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    await prisma.catalogName.create({
      data: { vendorId: michel.id, name: "Europa Band 1", currency: "EUR" },
    });
    const otherVendor = await prisma.catalogVendor.create({
      data: { collectionId: otherCollectionId, name: "Elsewhere", abbreviation: "El" },
    });
    await prisma.catalogName.create({
      data: { vendorId: otherVendor.id, name: "Not Ours", currency: "USD" },
    });

    await prisma.contact.create({
      data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
    });
    // A platform whose currency the collector has not set yet: nullable in the schema and
    // domain-enforced before the first offer, so an agent should be able to see it is unset.
    await prisma.contact.create({
      data: { collectionId, name: "Allegro", platform: true },
    });
    // **The row that must never appear.** `Contact` is one table for buyers, sellers, exchange
    // partners and platforms, and it carries personal details. A `platform` filter that was
    // forgotten would hand an agent this person's email to hold for a whole session.
    await prisma.contact.create({
      data: {
        collectionId,
        name: "Jan Kowalski",
        buyer: true,
        email: "jan@example.com",
        phone: "+48 000 000 000",
        notes: "Pays late.",
      },
    });
    // And one that is both, since the flags are independent and combinable — it *is* a platform, so
    // it appears, and its personal columns still must not.
    await prisma.contact.create({
      data: {
        collectionId,
        name: "Marketplace Ltd",
        platform: true,
        seller: true,
        platformCurrency: "GBP",
        email: "billing@example.com",
      },
    });
  });

  after(async () => {
    const ids = [collectionId, otherCollectionId];
    await prisma.contact.deleteMany({ where: { collectionId: { in: ids } } });
    await prisma.catalogName.deleteMany({ where: { vendor: { collectionId: { in: ids } } } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId: { in: ids } } });
    await prisma.location.deleteMany({ where: { collectionId: { in: ids }, parentId: { not: null } } });
    await prisma.location.deleteMany({ where: { collectionId: { in: ids } } });
    await prisma.collectionArea.deleteMany({
      where: { collectionId: { in: ids }, parentId: { not: null } },
    });
    await prisma.collectionArea.deleteMany({ where: { collectionId: { in: ids } } });
    await prisma.stampSubtype.deleteMany({ where: { collectionId: { in: ids } } });
    await prisma.certificateStatus.deleteMany({ where: { collectionId: { in: ids } } });
    await prisma.stampFormat.deleteMany({ where: { collectionId: { in: ids } } });
    await prisma.stampCondition.deleteMany({ where: { collectionId: { in: ids } } });
    await prisma.collection.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("returns every vocabulary in one call", async () => {
    const vocabulary = await readCollectionVocabulary(context);
    assert.equal(vocabulary.conditions.length, 3);
    assert.equal(vocabulary.formats.length, 1);
    assert.equal(vocabulary.certificateStatuses.length, 1);
    assert.equal(vocabulary.subtypes.length, 2);
    assert.equal(vocabulary.areas.length, 2);
    assert.equal(vocabulary.locations.length, 2);
    assert.equal(vocabulary.catalogVendors.length, 1);
    assert.equal(vocabulary.catalogs.length, 1);
    assert.equal(vocabulary.platforms.length, 3);
  });

  it("scopes everything to the token's own collection", async () => {
    // The whole surface derives its collection from the token (#706) and carries no id in any path,
    // so a leak here would be invisible to the agent and unattributable to anything it sent.
    const vocabulary = await readCollectionVocabulary(context);
    const everyName = [
      ...vocabulary.conditions,
      ...vocabulary.catalogVendors,
      ...vocabulary.catalogs,
      ...vocabulary.platforms,
    ].map((row) => row.name);
    assert.ok(!everyName.includes("Should Not Appear"));
    assert.ok(!everyName.includes("Elsewhere"));
    assert.ok(!everyName.includes("Not Ours"));
  });

  it("states the base currency instead of a currency vocabulary", async () => {
    // #708 names currencies among its nine; they are an app-wide constant rather than per-collection
    // cuids, and no operation takes one as input, so what the agent is given is the denomination its
    // figures are in. `"currencies"` deliberately does not exist on this response.
    const vocabulary = await readCollectionVocabulary(context);
    assert.equal(vocabulary.baseCurrency, "PLN");
    assert.ok(!("currencies" in vocabulary));
  });

  it("carries the canonical name and the collection's own label beside it", async () => {
    const mnh = (await readCollectionVocabulary(context)).conditions.find(
      (row) => row.abbreviation === "MNH"
    );
    assert.ok(mnh);
    assert.equal(mnh.name, "Mint Never Hinged");
    assert.equal(mnh.label, "Czysty bez podlepki");
  });

  it("reads the label from the collection's default language and no other", async () => {
    // **This is the control that had to be rewritten to be one.** The first version asserted that
    // `MNH` — which carries both a `pl` and a `de` translation — does not come back as "Postfrisch",
    // and it passed with the language filter deliberately removed: Prisma returned the `pl` row
    // first and the answer was unchanged. A check that cannot see the failure is not a check.
    //
    // `MH` is translated into German and nothing else, so with the filter there is no label at all
    // and without it the label is "Gefalzt". No row ordering can rescue that.
    const conditions = (await readCollectionVocabulary(context)).conditions;
    const mh = conditions.find((row) => row.abbreviation === "MH");
    assert.ok(mh);
    assert.ok(
      !("label" in mh),
      "a translation in a language this collection does not use must not become its label"
    );
    // And the positive half beside it, so a filter that matched *nothing* would not pass either.
    assert.equal(conditions.find((row) => row.abbreviation === "MNH")?.label, "Czysty bez podlepki");
  });

  it("omits the label entirely where there is nothing to say", async () => {
    const used = (await readCollectionVocabulary(context)).conditions.find(
      (row) => row.name === "Used"
    );
    assert.ok(used);
    assert.ok(!("label" in used), "a label echoing the name would double every vocabulary for nothing");
  });

  it("falls back to an area's public titleName, which is a genuinely different string", async () => {
    // Internal grouping name against the name used in listing titles (#210).
    const area = (await readCollectionVocabulary(context)).areas.find(
      (row) => row.name === "Second Republic"
    );
    assert.ok(area);
    assert.equal(area.label, "Poland");
  });

  it("returns the trees flat, carrying parentId and assignable", async () => {
    const vocabulary = await readCollectionVocabulary(context);
    const root = vocabulary.areas.find((row) => row.name === "Second Republic");
    const child = vocabulary.areas.find((row) => row.name === "1918-1939");
    assert.ok(root && child);
    assert.equal(root.parentId, null);
    assert.equal(child.parentId, root.id);
    // A grouping-only node cannot hold material; an agent filing a copy under one has made a
    // mistake nothing else on this surface would catch.
    assert.equal(root.assignable, false);
    assert.equal(child.assignable, true);

    const cabinet = vocabulary.locations.find((row) => row.name === "Cabinet");
    const stockbook = vocabulary.locations.find((row) => row.name === "Stockbook A");
    assert.ok(cabinet && stockbook);
    assert.equal(stockbook.parentId, cabinet.id);
    assert.equal(cabinet.assignable, false);
  });

  it("carries the subtype flags an agent reasoning about a variant tree needs", async () => {
    const subtypes = (await readCollectionVocabulary(context)).subtypes;
    const basic = subtypes.find((row) => row.name === "Basic");
    const perforation = subtypes.find((row) => row.name === "Perforation");
    assert.ok(basic && perforation);
    assert.equal(basic.isDefault, true);
    assert.equal(perforation.actsAsVariant, true);
  });

  describe("platforms", () => {
    // **Derived from #711's body, not from #708's list of nine.** #708's *Done when* is *every
    // vocabulary an operation in #710, #711 or #712 can take as input*, and #711's *draft an offer*
    // cannot be called without naming one — an offer's currency is inherited and locked from the
    // platform (#196), so the platform is structurally required. Whoever implements #711 can
    // contradict this.

    it("returns the platforms with the currency an offer there is locked to", async () => {
      const platforms = (await readCollectionVocabulary(context)).platforms;
      assert.equal(platforms.find((row) => row.name === "Delcampe")?.currency, "EUR");
      assert.equal(platforms.find((row) => row.name === "Marketplace Ltd")?.currency, "GBP");
    });

    it("says a platform's currency is unset rather than omitting it", async () => {
      // Domain-enforced before the first offer rather than a database constraint, so an agent
      // should learn it is unset *before* drafting rather than by being refused afterwards.
      const allegro = (await readCollectionVocabulary(context)).platforms.find(
        (row) => row.name === "Allegro"
      );
      assert.ok(allegro);
      assert.equal(allegro.currency, null);
    });

    it("returns only contacts flagged as platforms", async () => {
      const platforms = (await readCollectionVocabulary(context)).platforms;
      assert.ok(!platforms.some((row) => row.name === "Jan Kowalski"));
    });

    it("includes a contact that is a platform and something else too", async () => {
      // The role flags are independent and combinable (ADR-0007 §4), so `platform: true` is the
      // whole test and a second role must not exclude it.
      const platforms = (await readCollectionVocabulary(context)).platforms;
      assert.ok(platforms.some((row) => row.name === "Marketplace Ltd"));
    });

    it("carries no personal detail from the contact row at all", async () => {
      // The filter and the `select` are two independent guards and neither is relied on alone. This
      // asserts the projection: an agent holds this for a whole session, and a trading partner's
      // email has no business in it.
      const platforms = (await readCollectionVocabulary(context)).platforms;
      const serialised = JSON.stringify(platforms);
      for (const leak of ["jan@example.com", "billing@example.com", "+48 000 000 000", "Pays late."]) {
        assert.ok(!serialised.includes(leak), `${leak} must not reach the agent`);
      }
      for (const row of platforms) {
        assert.deepEqual(Object.keys(row).sort(), ["currency", "id", "name"]);
      }
    });
  });

  it("hangs a catalog off its vendor by id rather than nesting it", async () => {
    const vocabulary = await readCollectionVocabulary(context);
    const michel = vocabulary.catalogVendors[0];
    const book = vocabulary.catalogs[0];
    assert.equal(michel.abbreviation, "Mi");
    assert.equal(book.vendorId, michel.id);
    assert.equal(book.currency, "EUR");
  });

  it("resolves a real name against what it just returned — the round trip #708 exists for", async () => {
    // The point of the endpoint: an agent fetches this once, then sends names. Both halves are
    // exercised together here, which neither the unit suite nor a fixture could do.
    const vocabulary = await readCollectionVocabulary(context);
    const resolved = resolveVocabularyValue("MNH", vocabulary.conditions, {
      vocabulary: "condition",
      parameter: "condition",
    });
    assert.equal(resolved, vocabulary.conditions.find((row) => row.abbreviation === "MNH")?.id);

    // And the collector's own Polish label resolves, since that is what a person would say.
    assert.equal(
      resolveVocabularyValue("czysty bez podlepki", vocabulary.conditions, {
        vocabulary: "condition",
        parameter: "condition",
      }),
      resolved
    );
  });

  it("answers #708's *Done when* against real rows: a wrong name returns this collection's names", async () => {
    const vocabulary = await readCollectionVocabulary(context);
    try {
      resolveVocabularyValue("Superb", vocabulary.conditions, {
        vocabulary: "condition",
        parameter: "condition",
      });
      assert.fail("a name matching nothing must be refused");
    } catch (error) {
      assert.ok(isApiError(error));
      const accepted = error.accepted ?? [];
      assert.ok(accepted.some((value) => value.includes("Mint Never Hinged")));
      assert.ok(accepted.some((value) => value.includes("Used")));
      assert.ok(!accepted.some((value) => value.includes("Should Not Appear")));
    }
  });

  it("refuses a token whose collection has gone, rather than failing as a 500", async () => {
    try {
      await readCollectionVocabulary({ ownerId: userId, collectionId: `missing-${ts}` });
      assert.fail("a missing collection must be refused");
    } catch (error) {
      assert.ok(isApiError(error));
      assert.equal(error.code, "not_found");
      assert.equal(error.status, 404);
    }
  });

  it("refuses a caller who does not own the collection", async () => {
    try {
      await readCollectionVocabulary({ ownerId: `someone-else-${ts}`, collectionId });
      assert.fail("ownership is checked server-side and never in the caller");
    } catch (error) {
      assert.ok(isApiError(error));
      assert.equal(error.code, "not_found");
    }
  });
});

describe("the operation in the registry", () => {
  it("is bound where the dispatcher will find it", () => {
    const match = matchPath(["vocabulary"]);
    const picked = pickMethod(match, "GET");
    assert.ok(picked);
    assert.equal(picked.operation.name, "get_collection_vocabulary");
  });

  it("reads a `read` token, so it declares no writes", () => {
    // The vocabulary is read-only by decision: an agent works within the collector's configured
    // terms, and changing them is a settings act that stays in the UI (#708).
    assert.equal(getCollectionVocabularyOperation.writes, false);
  });

  it("takes no parameters, because the collection comes from the token", () => {
    assert.deepEqual(getCollectionVocabularyOperation.parameters, []);
  });

  it("is an object result rather than a list, so nothing paginates a vocabulary", () => {
    // A half-fetched vocabulary is a resolver that fails on values the collection really has.
    assert.equal(getCollectionVocabularyOperation.result.kind, "object");
  });

  it("appears in the OpenAPI document with no second place to edit", () => {
    // #706's own *Done when*, demonstrated against a real operation for the first time — until
    // #708 the registry was empty and only a fixture could stand in for this.
    const doc = buildOpenApiDocument(OPERATIONS, { appVersion: "test" });
    const paths = doc.paths as Record<string, Record<string, { operationId?: string }>>;
    assert.ok(paths["/api/v1/vocabulary"], "the operation's path is in the document");
    assert.equal(paths["/api/v1/vocabulary"].get?.operationId, "get_collection_vocabulary");
  });
});
