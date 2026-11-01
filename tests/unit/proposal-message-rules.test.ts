import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PROPOSAL_MESSAGE_PLACEHOLDERS,
  renderProposalMessage,
  unknownProposalMessagePlaceholders,
  type ProposalMessageInput,
} from "../../src/lib/proposal-message-rules";

// The message a proposal's buyer is sent (#2288), from the Direct platform's template.

const input: ProposalMessageInput = {
  proposalNo: 4,
  buyerName: "Jan Kowalski",
  currency: "PLN",
  lots: [
    { lotNo: 1, title: "Austria 1850 Mercury", price: "25.00" },
    { lotNo: 3, title: "Poland 1924 Copernicus", price: null },
    { lotNo: 4, title: "", price: "7.50" },
  ],
  total: "32.50",
};

describe("a proposal's message (#2288)", () => {
  it("lists the lots with the numbers the screen gives them, their prices and the total", () => {
    assert.equal(
      renderProposalMessage("Hi {buyer},\n{lots}\nTogether: {total} (#{proposal})", input),
      "Hi Jan Kowalski,\n1. Austria 1850 Mercury — 25 zł\n3. Poland 1924 Copernicus\n4. — 7.50 zł\nTogether: 32.50 zł (#4)"
    );
  });

  it("writes the currency as asked, in the list and the total alike", () => {
    assert.equal(renderProposalMessage("{lots:code}|{total:none}", { ...input, lots: [input.lots[0]] }), "1. Austria 1850 Mercury — 25 PLN|32.50");
  });

  it("pads the proposal's number when asked", () => {
    assert.equal(renderProposalMessage("{proposal:3}", input), "004");
  });

  it("generates nothing without a template — a blank one included (#1692)", () => {
    assert.equal(renderProposalMessage(null, input), null);
    assert.equal(renderProposalMessage("", input), null);
    assert.equal(renderProposalMessage("  \n ", input), null);
  });

  it("keeps a token that is not a placeholder as typed, and names it", () => {
    assert.equal(renderProposalMessage("{lot} {total:cod}", input), "{lot} {total:cod}");
    assert.deepEqual(unknownProposalMessagePlaceholders("{lot} {total:cod} {total:code} {buyer}"), ["{lot}", "{total:cod}"]);
  });

  it("lists every placeholder the renderer fills", () => {
    const template = PROPOSAL_MESSAGE_PLACEHOLDERS.map((p) => p.token).join(" ");
    assert.deepEqual(unknownProposalMessagePlaceholders(template), []);
    assert.doesNotMatch(renderProposalMessage(template, input) ?? "", /\{/);
  });
});
