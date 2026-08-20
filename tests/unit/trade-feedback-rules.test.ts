import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canLeaveTradeFeedback,
  parseTradeFeedback,
  tradeFeedbackActionLabels,
  tradeFeedbackRejectLabel,
  TRADE_FEEDBACK_NOTE_MAX,
} from "../../src/lib/trade-feedback-rules";

// Partner feedback's pure rules (#641): when a link still takes something, what a submission has to
// contain to be worth a row, and what striking a line out is called on each side of the table.

describe("when a link still takes feedback", () => {
  it("takes it at every live status, `agreed` included — there it is a request to reopen", () => {
    for (const status of ["preparing", "shared", "agreed"] as const) {
      assert.equal(canLeaveTradeFeedback(status), true, `${status} should take feedback`);
    }
  });

  it("refuses a closed exchange: annotating that is writing on a receipt", () => {
    assert.equal(canLeaveTradeFeedback("closed"), false);
  });

  it("refuses a cancelled one, which the link refuses before this is ever asked", () => {
    assert.equal(canLeaveTradeFeedback("cancelled"), false);
  });
});

describe("reading one submission", () => {
  it("keeps a trimmed note", () => {
    assert.deepEqual(parseTradeFeedback({ note: "  already have this  " }, { allowReject: true }), {
      ok: true,
      value: { note: "already have this", rejected: false },
    });
  });

  it("keeps a mark with no words — striking a line out says enough on its own", () => {
    assert.deepEqual(parseTradeFeedback({ rejected: true }, { allowReject: true }), {
      ok: true,
      value: { note: null, rejected: true },
    });
  });

  it("reads an empty submission as nothing said, which is what deletes the row", () => {
    assert.deepEqual(parseTradeFeedback({ note: "   " }, { allowReject: true }), {
      ok: true,
      value: null,
    });
    assert.deepEqual(parseTradeFeedback({}, { allowReject: true }), { ok: true, value: null });
  });

  it("refuses a note past the cap rather than truncating one", () => {
    const result = parseTradeFeedback(
      { note: "x".repeat(TRADE_FEEDBACK_NOTE_MAX + 1) },
      { allowReject: true }
    );
    assert.equal(result.ok, false);
  });

  it("accepts a note exactly at the cap", () => {
    const result = parseTradeFeedback(
      { note: "x".repeat(TRADE_FEEDBACK_NOTE_MAX) },
      { allowReject: true }
    );
    assert.equal(result.ok, true);
  });

  it("refuses a rejection where none is allowed — a note box rejects nothing", () => {
    const result = parseTradeFeedback({ rejected: true }, { allowReject: false });
    assert.equal(result.ok, false);
  });
});

describe("what the two sides call it", () => {
  it("inverts across the table, as every other word on the partner's page does", () => {
    assert.equal(tradeFeedbackRejectLabel("give"), "Not wanted");
    assert.equal(tradeFeedbackRejectLabel("receive"), "Cannot send");
  });

  it("names a rejection's accept after what it does, and a note's after reading it", () => {
    assert.equal(tradeFeedbackActionLabels(true).accept, "Remove the line");
    assert.equal(tradeFeedbackActionLabels(false).accept, "Done");
  });
});
