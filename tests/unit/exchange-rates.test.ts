import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEcbXml, convertViaEur, parseEcbHistoricCsv } from "../../src/lib/ecb-rates";

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

// The ECB data API's CSV for a window of days (#1633): a price observed on a given day is converted at
// the rate of that day, which the collection's own one-snapshot table cannot answer for a past day.
describe("parseEcbHistoricCsv", () => {
  const HEADER =
    "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,TITLE_COMPL";
  const row = (currency: string, day: string, value: string) =>
    `EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,SP00,A,${day},${value},A,"ECB reference exchange rate, ${currency}/Euro, 2.15 pm (C.E.T.)"`;
  const CSV = [
    HEADER,
    row("CHF", "2021-03-04", "1.1114"),
    row("CHF", "2021-03-05", "1.1066"),
    row("PLN", "2021-03-04", "4.5529"),
    row("PLN", "2021-03-05", "4.5748"),
    // After the day asked about — the window's end is the day, but a row past it must never win.
    row("PLN", "2021-03-08", "4.6000"),
  ].join("\n");

  it("takes each currency at the latest day on or before the one asked about", () => {
    // 2021-03-07 is a Sunday: the rate a bank would have used is Friday's.
    const rates = parseEcbHistoricCsv(CSV, "2021-03-07");
    assert.equal(rates.get("CHF"), 1.1066);
    assert.equal(rates.get("PLN"), 4.5748);
    assert.equal(rates.get("EUR"), 1);
  });

  it("ignores a row dated after the day, so a later rate never prices an earlier sale", () => {
    const rates = parseEcbHistoricCsv(CSV, "2021-03-04");
    assert.equal(rates.get("PLN"), 4.5529);
  });

  it("reads the columns by name, whatever order the API puts them in", () => {
    const reordered = [
      "OBS_VALUE,TIME_PERIOD,CURRENCY",
      "4.5748,2021-03-05,PLN",
    ].join("\n");
    assert.equal(parseEcbHistoricCsv(reordered, "2021-03-05").get("PLN"), 4.5748);
  });

  it("pivots through EUR exactly as today's table does", () => {
    const rates = parseEcbHistoricCsv(CSV, "2021-03-05");
    // CHF → PLN = PLN per EUR ÷ CHF per EUR.
    assert.ok(Math.abs(convertViaEur(rates, "CHF", "PLN") - 4.5748 / 1.1066) < 1e-12);
  });

  it("returns only EUR for an empty or unrecognised answer", () => {
    assert.deepEqual([...parseEcbHistoricCsv("", "2021-03-05").keys()], ["EUR"]);
    assert.deepEqual([...parseEcbHistoricCsv("A,B\n1,2", "2021-03-05").keys()], ["EUR"]);
  });
});
