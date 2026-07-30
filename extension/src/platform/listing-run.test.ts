import { test } from "node:test";
import assert from "node:assert/strict";
import { registerPlatformModule, findListingModule, moduleReports } from "./registry";
import { fillListing, resolveListedUrl, resolveListingTarget } from "./listing-run";
import type { PlatformModule } from "./module";
import type { ListingTask } from "./listing";

// The shell driving a listing task through a module it knows nothing about (#408). The fake modules
// below are the whole point: the driver is exercised against a marketplace that does not exist, so
// nothing Colnect-shaped can leak into it.

const listingModule: PlatformModule = {
  id: "fake-market",
  name: "FakeMarket",
  matches: (url) => url.startsWith("https://fake.test/"),
  extract: () => [],
  listing: {
    formUrl: (task) => `https://fake.test/sell?offer=${task.offerId}`,
    isFormUrl: (url) => url.startsWith("https://fake.test/sell"),
    fill: (_doc, task) => ({
      filled: [{ field: "Price", value: `${task.price} ${task.currency}` }],
      skipped: [{ field: "Title", reason: "FakeMarket has no title field." }],
    }),
    listedUrl: (url) => (url.startsWith("https://fake.test/listing/") ? url : null),
  },
};

const readOnlyModule: PlatformModule = {
  id: "read-only-market",
  name: "ReadOnlyMarket",
  matches: (url) => url.startsWith("https://read-only.test/"),
  extract: () => [],
};

registerPlatformModule(listingModule);
registerPlatformModule(readOnlyModule);

function task(module: string | null, overrides: Partial<ListingTask> = {}): ListingTask {
  return {
    offerId: "o1",
    collectionId: "c1",
    state: "ready",
    platform: { id: "p1", name: "A Marketplace", module },
    title: "Mi·PL 1-3",
    description: null,
    privateNote: null,
    descriptionFormat: "plain",
    price: "40.00",
    currency: "PLN",
    quantity: 1,
    items: [],
    photos: { status: "ready", outOfDate: false, images: [] },
    ...overrides,
  };
}

/** A `Document` the fake module never touches — this is the shell's test, not a DOM one. */
const noDoc = null as unknown as Document;

test("the registry reports which half each module carries", () => {
  const reports = moduleReports();
  assert.deepEqual(
    reports.find((r) => r.id === "fake-market")?.capabilities,
    ["extract", "listing"]
  );
  assert.deepEqual(
    reports.find((r) => r.id === "read-only-market")?.capabilities,
    ["extract"]
  );
  assert.equal(findListingModule("read-only-market"), null);
  assert.equal(findListingModule("no-such-module"), null);
});

test("a task resolves to its module's form URL", () => {
  const target = resolveListingTarget(task("fake-market"));
  assert.deepEqual(target, {
    ok: true,
    moduleId: "fake-market",
    moduleName: "FakeMarket",
    url: "https://fake.test/sell?offer=o1",
  });
});

test("a platform naming no module is refused rather than guessed at", () => {
  const target = resolveListingTarget(task(null));
  assert.equal(target.ok, false);
  assert.match(target.ok ? "" : target.error, /A Marketplace/);
});

test("an unknown module id and a module that cannot list are different answers", () => {
  const unknown = resolveListingTarget(task("delcampe"));
  assert.equal(unknown.ok, false);
  assert.match(unknown.ok ? "" : unknown.error, /"delcampe"/);

  const readOnly = resolveListingTarget(task("read-only-market"));
  assert.equal(readOnly.ok, false);
  assert.match(readOnly.ok ? "" : readOnly.error, /not listed from here/);
});

test("filling reports what went in and what did not", () => {
  const result = fillListing(task("fake-market"), noDoc, "https://fake.test/sell?offer=o1&step=2");
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.outcome.filled : null, [
    { field: "Price", value: "40.00 PLN" },
  ]);
  assert.deepEqual(result.ok ? result.outcome.skipped : null, [
    { field: "Title", reason: "FakeMarket has no title field." },
  ]);
});

test("a page that is not the sale form is refused, never filled", () => {
  const result = fillListing(task("fake-market"), noDoc, "https://fake.test/account/login");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /not FakeMarket's listing form/);
});

test("a module throwing on unexpected DOM comes back as a refusal", () => {
  registerPlatformModule({
    id: "broken-market",
    name: "BrokenMarket",
    matches: () => false,
    extract: () => [],
    listing: {
      formUrl: () => "https://broken.test/sell",
      isFormUrl: () => true,
      fill: () => {
        throw new Error("Price field not found.");
      },
      listedUrl: () => {
        throw new Error("BrokenMarket cannot read a URL.");
      },
    },
  });
  const result = fillListing(task("broken-market"), noDoc, "https://broken.test/sell");
  assert.deepEqual(result, { ok: false, error: "Price field not found." });
});

// ── Reading the listing back (#412) ──────────────────────────────────────────

test("a listed entry's URL is read through the module that filled the form", () => {
  assert.equal(
    resolveListedUrl("fake-market", "https://fake.test/listing/abc"),
    "https://fake.test/listing/abc"
  );
  // The form itself is not its own outcome, and neither is any other page the collector wanders to.
  assert.equal(resolveListedUrl("fake-market", "https://fake.test/sell?offer=o1"), null);
});

test("a module that cannot list, or does not exist, reads no listing", () => {
  assert.equal(resolveListedUrl("read-only-market", "https://read-only.test/listing/1"), null);
  assert.equal(resolveListedUrl("no-such-module", "https://fake.test/listing/abc"), null);
});

test("a module throwing while reading a URL is silence, not a report", () => {
  // The collector is simply on a page; nothing has been claimed about a listing either way.
  assert.equal(resolveListedUrl("broken-market", "https://broken.test/whatever"), null);
});
