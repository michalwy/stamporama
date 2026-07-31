import { test } from "node:test";
import assert from "node:assert/strict";
import { registerPlatformModule, findListingModule, moduleReports } from "./registry";
import {
  attachListingPhotos,
  fillListing,
  resolveListedUrl,
  resolveListingTarget,
  selectListingPhotos,
} from "./listing-run";
import type { PlatformModule } from "./module";
import type { ListingPhotoFile, ListingTask, ListingTaskPhoto } from "./listing";

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
    isFormDocument: () => true,
    fill: (_doc, task) => ({
      filled: [{ field: "Price", value: `${task.price} ${task.currency}` }],
      skipped: [{ field: "Title", reason: "FakeMarket has no title field." }],
    }),
    listedUrl: (url) => (url.startsWith("https://fake.test/listing/") ? url : null),
    attachPhotos: (_doc, photos) => ({
      filled: [{ field: "Pictures", value: photos.map((p) => p.file.name).join(", ") }],
      skipped: [],
    }),
  },
};

/** A marketplace whose sale form takes no pictures — a complete module, and the case the shell must
 *  answer with silence rather than with a gap (#411). */
const noPicturesModule: PlatformModule = {
  id: "no-pictures-market",
  name: "NoPicturesMarket",
  matches: (url) => url.startsWith("https://no-pictures.test/"),
  extract: () => [],
  listing: {
    formUrl: () => "https://no-pictures.test/sell",
    isFormUrl: (url) => url.startsWith("https://no-pictures.test/sell"),
    isFormDocument: () => true,
    fill: () => ({ filled: [], skipped: [] }),
    listedUrl: () => null,
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
registerPlatformModule(noPicturesModule);

/** One image of a plan, at a size the caller can reason about. */
function image(fileName: string, sizeBytes: number): ListingTaskPhoto {
  return {
    photoId: fileName,
    url: `/api/collections/c1/photos/${fileName}/full`,
    fileName,
    mime: "image/jpeg",
    width: 800,
    height: 600,
    sizeBytes,
  };
}

/** A fetched image, as the page hands it to a module. `File` is enough of one for the fakes here. */
function photoFile(name: string): ListingPhotoFile {
  return { photoId: name, file: { name, type: "image/jpeg" } as File };
}

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

test("the sale form's address without the sale form on it is a wait, not a refusal", () => {
  // The anti-bot interstitial (#419): the URL is the form's own and the document is not, so the
  // answer says "not yet" rather than filling nothing and calling it filled.
  registerPlatformModule({
    id: "guarded-market",
    name: "GuardedMarket",
    matches: () => false,
    extract: () => [],
    listing: {
      formUrl: () => "https://guarded.test/sell",
      isFormUrl: () => true,
      isFormDocument: () => false,
      fill: () => {
        throw new Error("The fill must never be reached on a page that is not the form.");
      },
      listedUrl: () => null,
    },
  });
  const result = fillListing(task("guarded-market"), noDoc, "https://guarded.test/sell");
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.retry, true);
  assert.match(result.ok ? "" : result.error, /has not served the listing form/);
});

test("a page that is not the sale form at all is refused outright, never retried", () => {
  const result = fillListing(task("fake-market"), noDoc, "https://fake.test/account/login");
  assert.equal(result.ok ? undefined : result.retry, undefined);
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
      isFormDocument: () => true,
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

// ── Pictures (#411) ──────────────────────────────────────────────────────────

test("a ready plan hands its images over in upload order", () => {
  const selection = selectListingPhotos(
    task("fake-market", {
      photos: {
        status: "ready",
        outOfDate: false,
        images: [image("o-01.jpg", 1000), image("o-02.jpg", 1000)],
      },
    })
  );
  assert.deepEqual(
    selection.images.map((i) => i.fileName),
    ["o-01.jpg", "o-02.jpg"]
  );
  assert.deepEqual(selection.skipped, []);
});

test("a platform whose form takes no pictures is silence, not a gap", () => {
  const selection = selectListingPhotos(
    task("no-pictures-market", {
      photos: { status: "ready", outOfDate: false, images: [image("o-01.jpg", 1000)] },
    })
  );
  assert.deepEqual(selection, { images: [], skipped: [] });
});

test("a plan still rendering is reported, and costs no fetch", () => {
  for (const status of ["queued", "running"] as const) {
    const selection = selectListingPhotos(
      task("fake-market", { photos: { status, outOfDate: false, images: [] } })
    );
    assert.deepEqual(selection.images, []);
    assert.match(selection.skipped[0]?.reason ?? "", /still rendering/);
  }
});

test("an offer with no pictures at all is not a gap either", () => {
  const selection = selectListingPhotos(
    task("fake-market", { photos: { status: "ready", outOfDate: false, images: [] } })
  );
  assert.deepEqual(selection, { images: [], skipped: [] });
});

test("an out-of-date render is attached, not withheld", () => {
  const selection = selectListingPhotos(
    task("fake-market", {
      photos: { status: "ready", outOfDate: true, images: [image("o-01.jpg", 1000)] },
    })
  );
  assert.deepEqual(
    selection.images.map((i) => i.fileName),
    ["o-01.jpg"]
  );
  assert.deepEqual(selection.skipped, []);
});

test("a set past the run's budget fills from the front and names the rest", () => {
  const selection = selectListingPhotos(
    task("fake-market", {
      photos: {
        status: "ready",
        outOfDate: false,
        images: [image("o-01.jpg", 600), image("o-02.jpg", 600), image("o-03.jpg", 600)],
      },
    }),
    1000
  );
  // The plan's order is the priority order (#313), so the budget protects nothing at the back.
  assert.deepEqual(
    selection.images.map((i) => i.fileName),
    ["o-01.jpg"]
  );
  assert.equal(selection.skipped.length, 1);
  assert.match(selection.skipped[0].field, /o-02\.jpg, o-03\.jpg/);
});

test("one image larger than the whole budget still goes, rather than nothing going", () => {
  const selection = selectListingPhotos(
    task("fake-market", {
      photos: { status: "ready", outOfDate: false, images: [image("o-01.jpg", 5000)] },
    }),
    1000
  );
  assert.deepEqual(
    selection.images.map((i) => i.fileName),
    ["o-01.jpg"]
  );
});

test("pictures are attached through the module that filled the form", () => {
  const result = attachListingPhotos("fake-market", noDoc, "https://fake.test/sell?offer=o1", [
    photoFile("o-01.jpg"),
    photoFile("o-02.jpg"),
  ]);
  assert.deepEqual(result, {
    ok: true,
    outcome: { filled: [{ field: "Pictures", value: "o-01.jpg, o-02.jpg" }], skipped: [] },
  });
});

test("pictures never go to a page that is not the sale form", () => {
  const result = attachListingPhotos("fake-market", noDoc, "https://fake.test/account/login", [
    photoFile("o-01.jpg"),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /not FakeMarket's listing form/);
});

test("a module with no uploader answers with an empty report, not a refusal", () => {
  const result = attachListingPhotos("no-pictures-market", noDoc, "https://no-pictures.test/sell", [
    photoFile("o-01.jpg"),
  ]);
  assert.deepEqual(result, { ok: true, outcome: { filled: [], skipped: [] } });
});

test("a module throwing while attaching leaves the filled form standing", () => {
  registerPlatformModule({
    id: "broken-pictures-market",
    name: "BrokenPicturesMarket",
    matches: () => false,
    extract: () => [],
    listing: {
      formUrl: () => "https://broken-pictures.test/sell",
      isFormUrl: () => true,
      isFormDocument: () => true,
      fill: () => ({ filled: [], skipped: [] }),
      listedUrl: () => null,
      attachPhotos: () => {
        throw new Error("The uploader is not on this page.");
      },
    },
  });
  const result = attachListingPhotos(
    "broken-pictures-market",
    noDoc,
    "https://broken-pictures.test/sell",
    [photoFile("o-01.jpg")]
  );
  assert.deepEqual(result, {
    ok: true,
    outcome: {
      filled: [],
      skipped: [{ field: "Pictures", reason: "The uploader is not on this page." }],
    },
  });
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
