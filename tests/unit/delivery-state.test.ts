import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DELIVERY_STATES,
  DELIVERY_STATE_META,
  deliveryStateLabel,
  deliveryStateToken,
  isDelivered,
  isDeliveryState,
} from "../../src/lib/delivery-state";

describe("isDeliveryState", () => {
  it("accepts every state in the vocabulary", () => {
    for (const state of DELIVERY_STATES) assert.equal(isDeliveryState(state), true);
  });

  it("rejects anything else, including empty and absent values", () => {
    assert.equal(isDeliveryState("shipped"), false);
    assert.equal(isDeliveryState(""), false);
    assert.equal(isDeliveryState(null), false);
    assert.equal(isDeliveryState(undefined), false);
  });
});

describe("delivery state display", () => {
  it("labels and tints every state in the vocabulary", () => {
    for (const state of DELIVERY_STATES) {
      assert.equal(deliveryStateLabel(state), DELIVERY_STATE_META[state].label);
      assert.notEqual(deliveryStateToken(state), "muted");
    }
  });

  it("falls back to the raw value and no tint for an unknown state", () => {
    assert.equal(deliveryStateLabel("shipped"), "shipped");
    assert.equal(deliveryStateToken("shipped"), "muted");
  });
});

describe("isDelivered", () => {
  it("is true only for the in-hand state — the precondition for listing a copy", () => {
    for (const state of DELIVERY_STATES) {
      assert.equal(isDelivered(state), state === "delivered");
    }
  });
});
