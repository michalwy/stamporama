import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INTAKE_VIEW_DEFAULTS,
  INTAKE_VIEW_PARAMS,
  intakeViewClearUpdates,
  intakeViewNarrowings,
  intakeViewStatusesFor,
  intakeViewUpdatesFor,
  intakeViewUrlUpdates,
  pruneStoredParties,
  resolveIntakeView,
  type IntakeView,
} from "../../src/app/c/[collectionSlug]/purchases/intake-view-params";
import { INTAKE_PARTY_NONE, parseIntakePartyIds } from "../../src/lib/purchase-kind";

// The Intake documents list's toolbar as a value (#1392): what the address and the memory resolve
// to, what a press writes, what the band announces, and what the mirror puts back into the address.

/** A reader over one flat set of params — the shape `usePersistedFilterParams` hands the resolver. */
function reader(params: Record<string, string>): (key: string) => string | null {
  return (key) => (key in params ? params[key] : null);
}

function view(patch: Partial<IntakeView> = {}): IntakeView {
  return { ...INTAKE_VIEW_DEFAULTS, ...patch };
}

describe("parseIntakePartyIds", () => {
  it("reads a comma list, dropping blanks and repeats", () => {
    assert.deepEqual(parseIntakePartyIds("a, b,,a,none"), ["a", "b", "none"]);
  });

  it("reads nothing as no filter", () => {
    assert.deepEqual(parseIntakePartyIds(null), []);
    assert.deepEqual(parseIntakePartyIds(""), []);
  });
});

describe("resolveIntakeView", () => {
  it("is the defaults with nothing said", () => {
    assert.deepEqual(resolveIntakeView(reader({})), INTAKE_VIEW_DEFAULTS);
  });

  it("reads every setting under the names the address has always used", () => {
    const resolved = resolveIntakeView(
      reader({
        type: "purchase",
        status: "in_transit",
        platform: "p1,none",
        supplier: "s1",
        sortBy: "createdAt",
        sortDir: "asc",
      })
    );
    assert.deepEqual(resolved, {
      type: "purchase",
      status: "in_transit",
      platforms: ["p1", INTAKE_PARTY_NONE],
      suppliers: ["s1"],
      sortBy: "createdAt",
      sortDir: "asc",
    });
  });

  it("reads Completed as a status of its own (#1449)", () => {
    assert.equal(resolveIntakeView(reader({ status: "completed" })).status, "completed");
  });

  it("never has a delivery status in force while only opening balances are listed", () => {
    for (const status of ["preparing", "in_transit", "arrived"]) {
      const resolved = resolveIntakeView(reader({ type: "opening_balance", status }));
      assert.equal(resolved.type, "opening_balance");
      assert.equal(resolved.status, undefined);
    }
  });

  it("keeps Completed while only opening balances are listed (#1461)", () => {
    const resolved = resolveIntakeView(reader({ type: "opening_balance", status: "completed" }));
    assert.equal(resolved.status, "completed");
  });

  it("falls back to the default for a value that no longer exists", () => {
    const resolved = resolveIntakeView(
      reader({ type: "gift", status: "lost", sortBy: "price", sortDir: "sideways" })
    );
    assert.deepEqual(resolved, INTAKE_VIEW_DEFAULTS);
  });
});

describe("intakeViewUpdatesFor", () => {
  it("writes only what was pressed, and deletes a setting returned to its default", () => {
    assert.deepEqual(intakeViewUpdatesFor({ status: "arrived" }), { status: "arrived" });
    assert.deepEqual(intakeViewUpdatesFor({ sortDir: "desc" }), { sortDir: "" });
    assert.deepEqual(intakeViewUpdatesFor({ suppliers: ["s1", "s2"] }), { supplier: "s1,s2" });
    assert.deepEqual(intakeViewUpdatesFor({ platforms: [] }), { platform: "" });
  });

  it("clears the status when Opening balances is picked, in the same write", () => {
    assert.deepEqual(intakeViewUpdatesFor({ type: "opening_balance" }), {
      type: "opening_balance",
      status: "",
    });
  });

  it("keeps Completed when Opening balances is picked, since it applies there too (#1461)", () => {
    const current = view({ status: "completed" });
    assert.deepEqual(intakeViewUpdatesFor({ type: "opening_balance" }, current), {
      type: "opening_balance",
    });
  });

  it("clears a delivery status in force when Opening balances is picked", () => {
    const current = view({ status: "arrived" });
    assert.deepEqual(intakeViewUpdatesFor({ type: "opening_balance" }, current), {
      type: "opening_balance",
      status: "",
    });
  });

  it("leaves the status alone for any other type", () => {
    assert.deepEqual(intakeViewUpdatesFor({ type: "trade" }), { type: "trade" });
    assert.deepEqual(intakeViewUpdatesFor({ type: undefined }), { type: "" });
  });
});

describe("intakeViewStatusesFor", () => {
  it("offers every status over purchases, and only Completed over opening balances (#1461)", () => {
    assert.deepEqual(intakeViewStatusesFor(undefined), ["preparing", "in_transit", "arrived", "completed"]);
    assert.deepEqual(intakeViewStatusesFor("trade"), ["preparing", "in_transit", "arrived", "completed"]);
    assert.deepEqual(intakeViewStatusesFor("opening_balance"), ["completed"]);
  });
});

describe("the narrowed-list band", () => {
  it("announces nothing for a list nobody has narrowed, whatever its sort", () => {
    assert.deepEqual(intakeViewNarrowings(view({ sortBy: "createdAt", sortDir: "asc" })), []);
  });

  it("names every filter in force, in toolbar order", () => {
    const narrowings = intakeViewNarrowings(
      view({ type: "purchase", status: "arrived", platforms: ["p1"], suppliers: ["none"] })
    );
    assert.deepEqual(
      narrowings.map((n) => n.key),
      ["type", "status", "platforms", "suppliers"]
    );
  });

  it("clears exactly what it announces, and never the sort", () => {
    const cleared = intakeViewClearUpdates();
    assert.deepEqual(Object.keys(cleared).sort(), ["platform", "status", "supplier", "type"]);
    assert.ok(Object.values(cleared).every((v) => v === ""));
    // Every param the band's filters travel as is one this screen remembers, so clearing reaches the
    // memory too and the filter does not come back from it.
    for (const key of Object.keys(cleared)) assert.ok(INTAKE_VIEW_PARAMS.includes(key));
  });
});

describe("pruneStoredParties", () => {
  const known = new Set(["s1", "s2"]);

  it("keeps the ids still on a document, and none", () => {
    assert.equal(pruneStoredParties("s1,gone,none", known), "s1,none");
  });

  it("leaves nothing where nothing is left", () => {
    assert.equal(pruneStoredParties("gone", known), null);
    assert.equal(pruneStoredParties(null, known), null);
  });
});

describe("intakeViewUrlUpdates — the restore written back into the address (#844)", () => {
  it("writes nothing for a list at its defaults", () => {
    assert.equal(intakeViewUrlUpdates(INTAKE_VIEW_DEFAULTS, reader({})), null);
  });

  it("writes a restored setting the address does not carry", () => {
    const restored = view({ type: "purchase", suppliers: ["s1", "none"], sortDir: "asc" });
    assert.deepEqual(intakeViewUrlUpdates(restored, reader({})), {
      type: "purchase",
      supplier: "s1,none",
      sortDir: "asc",
    });
  });

  it("writes once: nothing where the address already says what is on screen", () => {
    const restored = view({ type: "purchase", suppliers: ["s1"] });
    assert.equal(intakeViewUrlUpdates(restored, reader({ type: "purchase", supplier: "s1" })), null);
  });

  it("leaves Completed in the address while only opening balances are listed (#1461)", () => {
    const shown = resolveIntakeView(reader({ type: "opening_balance", status: "completed" }));
    assert.equal(
      intakeViewUrlUpdates(shown, reader({ type: "opening_balance", status: "completed" })),
      null
    );
  });

  it("takes out a status the address names while only opening balances are listed", () => {
    const shown = resolveIntakeView(reader({ type: "opening_balance", status: "arrived" }));
    assert.deepEqual(
      intakeViewUrlUpdates(shown, reader({ type: "opening_balance", status: "arrived" })),
      { status: "" }
    );
  });
});
