import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseEcbXml,
  convertViaEur,
} from "../../src/lib/exchange-rates";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"
  xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-07-17'>
      <Cube currency='USD' rate='1.0891'/>
      <Cube currency='GBP' rate='0.84528'/>
      <Cube currency='PLN' rate='4.2635'/>
      <Cube currency='CHF' rate='0.9401'/>
      <Cube currency='CZK' rate='25.064'/>
      <Cube currency='DKK' rate='7.4614'/>
      <Cube currency='SEK' rate='11.0355'/>
      <Cube currency='NOK' rate='11.4325'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe("parseEcbXml", () => {
  it("parses all currencies from sample XML", () => {
    const rates = parseEcbXml(SAMPLE_XML);
    assert.equal(rates.get("EUR"), 1);
    assert.equal(rates.get("USD"), 1.0891);
    assert.equal(rates.get("GBP"), 0.84528);
    assert.equal(rates.get("PLN"), 4.2635);
    assert.equal(rates.size, 9);
  });

  it("returns only EUR for empty XML", () => {
    const rates = parseEcbXml("<Cube></Cube>");
    assert.equal(rates.size, 1);
    assert.equal(rates.get("EUR"), 1);
  });
});

describe("convertViaEur", () => {
  const rates = parseEcbXml(SAMPLE_XML);

  it("returns 1 for same currency", () => {
    assert.equal(convertViaEur(rates, "USD", "USD"), 1);
  });

  it("converts EUR to another currency directly", () => {
    const result = convertViaEur(rates, "EUR", "USD");
    assert.equal(result, 1.0891);
  });

  it("converts another currency to EUR", () => {
    const result = convertViaEur(rates, "USD", "EUR");
    assertApprox(result, 1 / 1.0891);
  });

  it("converts between two non-EUR currencies via pivot", () => {
    const result = convertViaEur(rates, "USD", "GBP");
    assertApprox(result, 0.84528 / 1.0891);
  });

  it("round-trips a value through another currency without loss", () => {
    // Both directions come from one table, so they are exact reciprocals — the property the cache
    // is snapshot-shaped to preserve (#20). Pair-wise caching broke it: a 1500 EUR catalogue value
    // pivoted through the base currency came back as 1498.44.
    const there = convertViaEur(rates, "EUR", "PLN");
    const back = convertViaEur(rates, "PLN", "EUR");
    assertApprox(1500 * there * back, 1500, 1e-9);
  });

  it("throws for unsupported currency", () => {
    assert.throws(
      () => convertViaEur(rates, "USD", "JPY"),
      /Unsupported currency pair/
    );
  });
});

function assertApprox(actual: number, expected: number, epsilon = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `Expected ${actual} to be approximately ${expected}`
  );
}
