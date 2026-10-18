import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_SALE_UI_STATE,
  parseSaleUiState,
  serializeSaleUiState,
} from "../../src/lib/sale-ui-state";

describe("parseSaleUiState", () => {
  it("reads a sale never opened as every set collapsed", () => {
    assert.deepEqual(parseSaleUiState(null), EMPTY_SALE_UI_STATE);
  });

  it("reads the expanded sets back", () => {
    assert.deepEqual(parseSaleUiState('{"lines":["a","b"]}'), { lines: ["a", "b"] });
  });

  it("degrades a malformed entry to the default rather than throwing", () => {
    assert.deepEqual(parseSaleUiState("{not json"), EMPTY_SALE_UI_STATE);
    assert.deepEqual(parseSaleUiState("[1,2]"), EMPTY_SALE_UI_STATE);
    assert.deepEqual(parseSaleUiState('{"lines":"a"}'), EMPTY_SALE_UI_STATE);
  });

  it("drops entries that are not ids", () => {
    assert.deepEqual(parseSaleUiState('{"lines":["a",1,null,"b"]}'), { lines: ["a", "b"] });
  });
});

describe("serializeSaleUiState", () => {
  it("stores nothing for a sale with every set collapsed, so it takes no slot", () => {
    assert.equal(serializeSaleUiState({ lines: [] }), null);
  });

  it("round-trips through the parser", () => {
    const raw = serializeSaleUiState({ lines: ["x", "y"] });
    assert.deepEqual(parseSaleUiState(raw), { lines: ["x", "y"] });
  });
});
