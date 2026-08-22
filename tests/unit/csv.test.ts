import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCsvRows } from "../../src/lib/csv";

// The one delimited-text reader the app has (#611, shared since #645). Two marketplace exports are
// read through it, so what it does with a quote, a separator and a blank line is asserted here once
// rather than in each reader.

describe("CSV reading", () => {
  it("keeps separators, quotes and line breaks that sit inside a quoted field", () => {
    const rows = parseCsvRows('a,"b,c","d""e","f\ng"\r\nh,i,j,k');
    assert.deepEqual(rows, [
      ["a", "b,c", 'd"e', "f\ng"],
      ["h", "i", "j", "k"],
    ]);
  });

  it("does not invent a row from a trailing newline", () => {
    assert.equal(parseCsvRows("a,b\r\nc,d\r\n").length, 2);
  });

  it("drops a blank line rather than reading it as a record", () => {
    assert.deepEqual(parseCsvRows("a,b\n\n\nc,d"), [
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("strips a byte-order mark so the first column keeps its name", () => {
    assert.deepEqual(parseCsvRows("﻿Name,Country\nX,Y"), [
      ["Name", "Country"],
      ["X", "Y"],
    ]);
  });
});
