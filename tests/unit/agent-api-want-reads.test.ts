import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ANY_VALUE,
  NO_CERTIFICATE,
  SINGLE_FORMAT,
  acceptanceNames,
  checklistGap,
  want,
  wantMatch,
} from "../../src/lib/agent-api/want-reads";
import type {
  AcceptanceNames,
  ChecklistGapRow,
  WantContext,
  WantRow,
} from "../../src/lib/agent-api/want-reads";

// The want and checklist projections (#712) — what an agent is actually told about what a collection
// is looking for.
//
// **Pure and structurally typed, so this file holds the whole of the decision** (`agent-api.md`,
// *The module layout is the Prisma-free split*). What it cannot hold is that `WantListItem` and
// `IssueWantGapChecklist` satisfy these shapes — `tsc` answers that where the handlers call these
// functions, and `tests/integration/agent-api-trades.test.ts` answers it against a real database —
// one file for the whole of #712, because wants, checklist gaps and trades are one workflow and one
// fixture.
//
// The rules worth pinning are the two a later reader would otherwise "tidy" away: an **empty
// acceptance set means *any*** and comes back saying so rather than empty, and the **null members
// are spelled rather than dropped** — which is the opposite of what a copy's null format does, for
// a reason that only holds because a set is not a single value.

const NAMES: AcceptanceNames = {
  conditions: new Map([
    ["c-mnh", "Mint Never Hinged"],
    ["c-used", "Used"],
  ]),
  certificateStatuses: new Map([["cert-pzf", "PZF"]]),
  formats: new Map([["f-pair", "Pair"]]),
};

const ROW: WantRow = {
  id: "want-1",
  stampId: "stamp-1",
  stampName: "Kościuszko",
  unknownVariant: false,
  subtype: null,
  issueName: "Insurgents",
  issueYear: 1938,
  priority: "high",
  conditionIds: ["c-mnh"],
  certificateStatusIds: [],
  formatIds: [],
  notes: null,
  closedAt: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  copies: { held: 2, toSort: 0, ordered: 1, inTransit: 0 },
  matchingCopies: { held: 0, toSort: 0, ordered: 0, inTransit: 0 },
  catalogRange: null,
};

const CONTEXT: WantContext = {
  catalogNumbers: [{ label: "Mi·PL 200", isPrimary: true }],
  names: NAMES,
  path: "/c/mine/stamps/stamp-1",
};

describe("acceptanceNames (#712)", () => {
  it("reports an empty set as *any* rather than as empty", () => {
    // **The single most misreadable thing about a want.** Zero rows means *any* (ADR-0032 §1), and
    // an agent handed `[]` will read it as *accepts nothing* about half the time — and then tell
    // the collector a want they can plainly satisfy cannot be.
    assert.deepEqual(acceptanceNames([], NAMES.conditions, null), [ANY_VALUE]);
  });

  it("spells the null member rather than dropping it", () => {
    // Dropping it would change the set's meaning outright: `{null, PZF}` means *uncertificated, or
    // with a PZF certificate*, and dropped it reads as *PZF only*, which is a different want. This
    // is deliberately the opposite of what #710 does with a copy's null certificate, where the null
    // is the whole answer and its absence says exactly what spelling it would.
    assert.deepEqual(
      acceptanceNames([null, "cert-pzf"], NAMES.certificateStatuses, NO_CERTIFICATE),
      [NO_CERTIFICATE, "PZF"]
    );
    assert.deepEqual(acceptanceNames([null], NAMES.formats, SINGLE_FORMAT), [SINGLE_FORMAT]);
  });

  it("falls back to the id when the dictionary has no name, rather than dropping the member", () => {
    // A row the vocabulary read did not carry is a smaller failure than a set silently one member
    // short, which would be a lie about what the collector will accept.
    assert.deepEqual(acceptanceNames(["c-gone"], NAMES.conditions, null), ["c-gone"]);
  });

  it("uses spellings no dictionary row can collide with", () => {
    // Nothing stops a collector naming a certificate status `No certificate`, and a bare word would
    // then be indistinguishable from that row's own name. A parenthesised phrase is not a name any
    // of these dictionaries can hold.
    for (const token of [ANY_VALUE, NO_CERTIFICATE, SINGLE_FORMAT]) {
      assert.ok(token.startsWith("(") && token.endsWith(")"), token);
    }
  });
});

describe("want (#712)", () => {
  it("states both copy tallies and never merges them", () => {
    const projected = want(ROW, CONTEXT);
    // A mint-only want against a used copy in hand: two held of the stamp, none that answer *this*
    // want. Both are true, and only the second may be read as *one is on its way* (#532).
    assert.deepEqual(projected.copiesOfStamp, { held: 2, toSort: 0, ordered: 1, inTransit: 0 });
    assert.deepEqual(projected.copiesMatching, { held: 0, toSort: 0, ordered: 0, inTransit: 0 });
  });

  it("says *any* on every axis the collector did not narrow", () => {
    const projected = want(ROW, CONTEXT);
    assert.deepEqual(projected.conditions, ["Mint Never Hinged"]);
    assert.deepEqual(projected.certificates, [ANY_VALUE]);
    assert.deepEqual(projected.formats, [ANY_VALUE]);
  });

  it("drops what carries nothing and keeps a zero", () => {
    const projected = want(ROW, CONTEXT) as unknown as Record<string, unknown>;
    assert.ok(!("notes" in projected), "an empty note is absent");
    assert.ok(!("closedAt" in projected), "an open want carries no closing date");
    assert.ok(!("unknownVariant" in projected), "false is absent, as `compact` has it");
    assert.ok(!("catalogRange" in projected), "an unpriced want states no range at all");
    // …and the zeroes inside a tally survive, because `copies: 0` is the answer *not held* (#348).
    assert.equal((projected.copiesMatching as { held: number }).held, 0);
  });

  it("carries a closed want's date and a range's coverage", () => {
    const projected = want(
      {
        ...ROW,
        closedAt: "2026-09-05T09:00:00.000Z",
        catalogRange: {
          minBase: "12.00",
          maxBase: "50.00",
          baseCurrency: "EUR",
          pricedCombinations: 1,
          totalCombinations: 24,
          estimated: true,
        },
      },
      CONTEXT
    );
    assert.equal(projected.closedAt, "2026-09-05T09:00:00.000Z");
    // **The figure never travels without the counts saying what it rests on** (`valuation.md`): a
    // range built from one combination in twenty-four is real and is not the whole story.
    assert.deepEqual(projected.catalogRange, {
      min: "12.00",
      max: "50.00",
      currency: "EUR",
      pricedCombinations: 1,
      acceptedCombinations: 24,
      estimated: true,
    });
  });
});

describe("wantMatch (#712)", () => {
  it("keeps an empty `wants` rather than dropping the row", () => {
    // *No* is the answer the caller asked for. A row missing from the result would read as *not
    // wanted* and as *I did not look at that one* at the same time.
    const projected = wantMatch(
      {
        stampId: "stamp-9",
        stampName: null,
        issueName: null,
        issueYear: null,
        wants: [],
        copies: { held: 0, toSort: 0, ordered: 0, inTransit: 0 },
      },
      {
        catalogNumbers: [{ label: "Mi 9", isPrimary: true }],
        condition: "Used",
        certificate: NO_CERTIFICATE,
        format: SINGLE_FORMAT,
      }
    );
    assert.deepEqual(projected.wants, []);
    assert.equal(projected.condition, "Used");
  });

  it("echoes the key the question was asked at", () => {
    // An answer about a key is unreadable without the key, and the caller sent one grade for a whole
    // batch of stamps — so the row states which.
    const projected = wantMatch(
      {
        stampId: "stamp-1",
        stampName: "Kościuszko",
        issueName: "Insurgents",
        issueYear: 1938,
        wants: [{ id: "want-1", priority: "high", notes: "upgrade" }],
        copies: { held: 3, toSort: 0, ordered: 0, inTransit: 0 },
      },
      {
        catalogNumbers: [{ label: "Mi·PL 200", isPrimary: true }],
        condition: "Mint Never Hinged",
        certificate: "PZF",
        format: SINGLE_FORMAT,
      }
    );
    assert.deepEqual(projected.wants, [{ wantId: "want-1", priority: "high", notes: "upgrade" }]);
    assert.equal(projected.certificate, "PZF");
    assert.equal(projected.format, SINGLE_FORMAT);
    // The other half of the decision: wanted **and** already held three times over is a different
    // proposition from wanted and missing.
    assert.equal(projected.copiesOfStamp.held, 3);
  });
});

describe("checklistGap (#712)", () => {
  const ROWS: ChecklistGapRow = {
    checklistId: "cl-1",
    name: "Basic set",
    required: 12,
    missing: [
      {
        stampId: "s-3",
        stampName: "Overprint",
        catalogNumbers: [{ label: "Mi·PL 202", isPrimary: true }],
        alreadyWanted: false,
      },
      {
        stampId: "s-4",
        stampName: null,
        catalogNumbers: [{ label: "Mi·PL 203", isPrimary: true }],
        alreadyWanted: true,
      },
    ],
  };

  it("derives `held` from the gap rather than counting a second time", () => {
    // One subtraction rather than a second query, so the two figures cannot come to disagree —
    // `countItems`' own argument about a count that disagrees with its rows.
    const projected = checklistGap(ROWS);
    assert.equal(projected.required, 12);
    assert.equal(projected.held, 10);
    assert.equal(projected.missing.length, 2);
  });

  it("marks only what is already wanted, and says nothing on the rest", () => {
    const projected = checklistGap(ROWS);
    assert.ok(!("alreadyWanted" in projected.missing[0]), "an unwanted gap carries no flag");
    assert.equal(projected.missing[1].alreadyWanted, true);
    // A missing name prints nothing rather than a placeholder (#535): `Stamp.name` is usually blank
    // here and the catalogue number is what a collector reads a row by.
    assert.ok(!("stamp" in projected.missing[1]));
    assert.deepEqual(projected.missing[1].catalogNumbers, ["Mi·PL 203"]);
  });

  it("reports an empty checklist as complete-of-nothing rather than as complete", () => {
    const projected = checklistGap({ checklistId: "cl-2", name: "Empty", required: 0, missing: [] });
    assert.equal(projected.required, 0);
    assert.equal(projected.held, 0);
  });
});
