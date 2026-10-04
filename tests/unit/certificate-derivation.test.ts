import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveCertifiedValue } from "../../src/lib/auction-lot";
import { bidLine } from "../../src/lib/agent-api/bid-reads";

// A certified line with no price of its own, derived from the plain price × the status's
// percentage (#1636) — the rule, and what an agent is told about it.
//
// The rule is the collector's (2026-10-04): a recorded figure always wins, the derivation runs one
// way only, and a status with no percentage derives nothing and says so.

const UNPRICED = { unpriced: true, mark: null };
const PLAIN = { unitValue: 100, unpriced: false, unconvertible: false };

describe("deriveCertifiedValue (#1636)", () => {
  it("derives the plain figure × the status's percentage when the certificate has no price", () => {
    const derived = deriveCertifiedValue(UNPRICED, PLAIN, 120);
    assert.deepEqual(derived, { percent: 120, plainUnitValue: 100, unitValue: 120, unconvertible: false });
  });

  it("derives nothing over a recorded price at the certificate", () => {
    assert.equal(deriveCertifiedValue({ unpriced: false, mark: null }, PLAIN, 120), null);
  });

  it("derives nothing over a cell the catalogue marks as giving no price (#1615)", () => {
    assert.equal(deriveCertifiedValue({ unpriced: true, mark: "nonexistent" }, PLAIN, 120), null);
  });

  it("derives nothing, and says nothing, when there is no plain price either", () => {
    const plain = { unitValue: null, unpriced: true, unconvertible: false };
    assert.equal(deriveCertifiedValue(UNPRICED, plain, 120), null);
  });

  it("keeps a status with no percentage on the line, with no figure, so the answer can say why", () => {
    const derived = deriveCertifiedValue(UNPRICED, PLAIN, null);
    assert.deepEqual(derived, { percent: null, plainUnitValue: 100, unitValue: null, unconvertible: false });
  });

  it("reports a plain figure with no rate as unconvertible, never as unpriced", () => {
    const plain = { unitValue: null, unpriced: false, unconvertible: true };
    const derived = deriveCertifiedValue(UNPRICED, plain, 120);
    assert.deepEqual(derived, { percent: 120, plainUnitValue: null, unitValue: null, unconvertible: true });
  });
});

describe("bidLine — a derived catalogue figure is stated (#1636)", () => {
  const anchor = {
    stampId: "s1",
    stampName: "Kościuszko",
    catalogLabel: "Mi·PL 12",
    quantity: 1,
    anchor: 60,
    source: "catalogue" as const,
    unconvertible: false,
    market: null,
    ratio: { ratio: 0.5, bucketLabel: "Poland, MNH, 1948–1952" },
    owned: 0,
  };
  const naming = { condition: "Mint Never Hinged", certificate: "Guarantee", format: null };

  it("names the plain figure, the percentage and the sentence to quote", () => {
    const line = bidLine(
      { ...anchor, derivation: { certificate: "Gu", percent: 120, plainUnitValue: "100.00" } },
      naming
    );
    assert.deepEqual(line.derivation, {
      certificate: "Gu",
      percent: 120,
      plainValue: "100.00",
      statement: "Derived from None × 120% — no Gu price is recorded.",
    });
    assert.equal(line.unitValue, "60.00");
  });

  it("says a status without a percentage is why the line is unanchored", () => {
    const line = bidLine(
      {
        ...anchor,
        anchor: null,
        source: null,
        ratio: null,
        derivation: { certificate: "Gu", percent: null, plainUnitValue: "100.00" },
      },
      naming
    );
    assert.equal(line.anchoredOn, undefined);
    assert.equal(line.derivation?.percent, undefined);
    assert.equal(line.derivation?.statement, "No Gu price, and Gu has no percentage to derive one from None.");
  });

  it("carries no derivation on a line priced at its own certificate", () => {
    const line = bidLine({ ...anchor, derivation: null }, naming);
    assert.equal("derivation" in line, false);
  });
});
