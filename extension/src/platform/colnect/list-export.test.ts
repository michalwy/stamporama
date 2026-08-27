import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLNECT_EXPORT_MODULE,
  colnectExportFileName,
  colnectLangFromPath,
  colnectListExportFields,
  colnectListExportPath,
  readColnectListExportAnswer,
} from "./list-export";

// The request behind Colnect's own *Export list* button (#690).
//
// Asserted here rather than in a browser for `list-write.test.ts`'s reason exactly: the shape was
// read off `m.115.js` on 2026-08-26 and Colnect owes nobody its stability, so a drift should surface
// as a failing assertion rather than as an empty snapshot quietly replacing a good one.

describe("colnectListExportPath (#690)", () => {
  it("asks in the collector's own language, same-origin", () => {
    assert.equal(colnectListExportPath("pl"), "/pl/collectors/request_list_export");
    assert.equal(colnectListExportPath("en"), "/en/collectors/request_list_export");
  });

  it("falls back to English rather than putting a misread prefix in the path", () => {
    assert.equal(colnectListExportPath("english"), "/en/collectors/request_list_export");
    assert.equal(colnectListExportPath(""), "/en/collectors/request_list_export");
  });
});

describe("colnectLangFromPath (#690)", () => {
  it("reads the prefix Colnect puts on every page", () => {
    assert.equal(colnectLangFromPath("/pl/znaczki/lista/kraj/123"), "pl");
    assert.equal(colnectLangFromPath("/en"), "en");
    assert.equal(colnectLangFromPath("/DE/stamps"), "de");
  });

  it("answers en where there is no prefix to read", () => {
    assert.equal(colnectLangFromPath("/"), "en");
    assert.equal(colnectLangFromPath("/stamps/list"), "en");
  });
});

describe("colnectListExportFields (#690)", () => {
  it("keys the category by module name, not by the number the write call wants", () => {
    const fields = new URLSearchParams(colnectListExportFields(3));
    assert.equal(fields.get("cat"), COLNECT_EXPORT_MODULE);
    assert.equal(fields.get("cat"), "stamps", "`20` is `/item/col`'s vocabulary, not this one's");
  });

  it("names the list by Colnect's own list id", () => {
    assert.equal(new URLSearchParams(colnectListExportFields(4)).get("list"), "4");
    assert.equal(new URLSearchParams(colnectListExportFields(16)).get("list"), "16");
  });

  it("never asks for variants — Colnect's own stamps button cannot", () => {
    assert.equal(new URLSearchParams(colnectListExportFields(2)).get("incl_var"), "false");
  });
});

describe("readColnectListExportAnswer (#690)", () => {
  it("takes the file's URL", () => {
    assert.deepEqual(readColnectListExportAnswer({ url: "https://colnect.com/tmp/swap.csv" }), {
      ok: true,
      url: "https://colnect.com/tmp/swap.csv",
    });
  });

  it("passes Colnect's own sentence on rather than inventing one", () => {
    assert.deepEqual(readColnectListExportAnswer({ response: "List is empty" }), {
      ok: false,
      message: "List is empty",
    });
    assert.deepEqual(readColnectListExportAnswer({ error: "Please log in" }), {
      ok: false,
      message: "Please log in",
    });
  });

  it("refuses anything that is not an export, rather than reading a good file out of it", () => {
    assert.equal(readColnectListExportAnswer(null).ok, false);
    assert.equal(readColnectListExportAnswer("<html>").ok, false);
    assert.equal(readColnectListExportAnswer({ url: "   " }).ok, false);
    assert.equal(readColnectListExportAnswer({}).ok, false);
  });
});

describe("colnectExportFileName (#690)", () => {
  it("keeps the name Colnect gave the file, so both routes into a snapshot describe it alike", () => {
    assert.equal(
      colnectExportFileName("https://colnect.com/tmp/colnect_swap_2026-08-26.csv", 3),
      "colnect_swap_2026-08-26.csv"
    );
    assert.equal(colnectExportFileName("/tmp/list%20swap.csv?t=99", 3), "list swap.csv");
  });

  it("names the list where the URL names nothing", () => {
    assert.equal(colnectExportFileName("https://colnect.com/tmp/", 4), "colnect-list-4.csv");
  });
});
