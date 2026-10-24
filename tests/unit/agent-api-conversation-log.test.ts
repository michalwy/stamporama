import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agentConversationEntry,
  parseConversationEntrySpec,
  parseConversationInstant,
  parseSaleRef,
  summarizeConversationBatch,
} from "../../src/lib/agent-api/conversation-log-reads";
import { checkConversationText, MAX_SUMMARY_LENGTH } from "../../src/lib/conversation-log-rules";

// The conversation log's pure rules (#2149): an entry's text, an entry as the agent spells it, a sale
// as it is named, and what an entry reads back as.

describe("checkConversationText", () => {
  it("requires a summary and reads a blank quote or link as none", () => {
    assert.deepEqual(checkConversationText({ summary: "  Paid by BLIK ", quote: " ", url: "" }), {
      ok: true,
      summary: "Paid by BLIK",
      quote: null,
      url: null,
    });
    const blank = checkConversationText({ summary: "  ", quote: null, url: null });
    assert.equal(blank.ok, false);
    assert.equal(!blank.ok && blank.field, "summary");
  });

  it("refuses a summary over the cap, and a link that is not a web address", () => {
    const long = checkConversationText({ summary: "x".repeat(MAX_SUMMARY_LENGTH + 1), quote: null, url: null });
    assert.equal(!long.ok && long.field, "summary");
    const link = checkConversationText({ summary: "ok", quote: null, url: "messenger thread" });
    assert.equal(!link.ok && link.field, "url");
    assert.equal(checkConversationText({ summary: "ok", quote: null, url: "https://m.me/t/123" }).ok, true);
  });
});

describe("parseConversationInstant", () => {
  it("takes an instant with its zone and refuses one without", () => {
    const at = parseConversationInstant("2026-10-20T14:05:00+02:00");
    assert.ok(at instanceof Date);
    assert.equal(at.toISOString(), "2026-10-20T12:05:00.000Z");
    assert.equal(typeof parseConversationInstant("2026-10-20T14:05"), "string");
    assert.equal(typeof parseConversationInstant("2026-10-20"), "string");
  });
});

describe("parseSaleRef", () => {
  it("reads a number as the collector writes one, an id otherwise, and none", () => {
    assert.deepEqual(parseSaleRef("12"), { kind: "number", saleNo: 12 });
    assert.deepEqual(parseSaleRef("s12"), { kind: "number", saleNo: 12 });
    assert.deepEqual(parseSaleRef("#7"), { kind: "number", saleNo: 7 });
    assert.deepEqual(parseSaleRef("NONE"), { kind: "none" });
    assert.deepEqual(parseSaleRef("cm1abc"), { kind: "id", id: "cm1abc" });
  });
});

describe("parseConversationEntrySpec", () => {
  const entry = [
    "at=2026-10-20T14:05:00+02:00",
    "channel=messenger",
    "direction=from_buyer",
    "summary=Takes both sets for 40 PLN; pays by BLIK tonight.",
    "quote=ok biorę oba",
    "za 40 zł z wysyłką",
    "link=https://www.messenger.com/t/123",
  ].join("\n");

  it("reads a field per line, a `;` inside a value, and a line continuing the field before it", () => {
    const parsed = parseConversationEntrySpec(entry);
    assert.ok(parsed.ok);
    assert.equal(parsed.spec.at.toISOString(), "2026-10-20T12:05:00.000Z");
    assert.equal(parsed.spec.channel, "messenger");
    assert.equal(parsed.spec.direction, "from_buyer");
    assert.equal(parsed.spec.summary, "Takes both sets for 40 PLN; pays by BLIK tonight.");
    assert.equal(parsed.spec.quote, "ok biorę oba\nza 40 zł z wysyłką");
    assert.equal(parsed.spec.link, "https://www.messenger.com/t/123");
    assert.equal(parsed.spec.sale, null);
  });

  it("takes the entry's own sale, none included", () => {
    const own = parseConversationEntrySpec(`${entry}\nsale=s4`);
    assert.ok(own.ok);
    assert.deepEqual(own.spec.sale, { kind: "number", saleNo: 4 });
    const none = parseConversationEntrySpec(`${entry}\nsale=none`);
    assert.ok(none.ok);
    assert.deepEqual(none.spec.sale, { kind: "none" });
  });

  it("refuses a missing field, an unknown channel or direction, a field named twice and text before any field", () => {
    const refusal = (text: string) => {
      const parsed = parseConversationEntrySpec(text);
      assert.equal(parsed.ok, false, text);
      return parsed.ok ? "" : parsed.reason;
    };
    assert.match(refusal("at=2026-10-20T14:05:00Z\nchannel=email\ndirection=note"), /no summary/);
    assert.match(refusal(entry.replace("channel=messenger", "channel=whatsapp")), /not a channel/);
    assert.match(refusal(entry.replace("direction=from_buyer", "direction=in")), /not a direction/);
    assert.match(refusal(`${entry}\nchannel=email`), /twice/);
    assert.match(refusal(`hello\n${entry}`), /does not start with a field/);
    assert.match(refusal(entry.replace("+02:00", "")), /not an instant/);
  });
});

describe("agentConversationEntry", () => {
  it("names the buyer and the sale, and says who wrote it", () => {
    const base = {
      id: "e1",
      contactId: "c1",
      contactName: "Anna",
      occurredAt: "2026-10-20T12:05:00.000Z",
      channel: "email",
      direction: "to_buyer",
      summary: "Sent the tracking number",
      quote: null,
      url: null,
      author: "assistant",
    };
    assert.deepEqual(agentConversationEntry({ ...base, saleId: "s1", saleNo: 12 }), {
      id: "e1",
      buyer: { id: "c1", name: "Anna" },
      sale: { id: "s1", saleNo: 12 },
      at: "2026-10-20T12:05:00.000Z",
      channel: "email",
      direction: "to_buyer",
      summary: "Sent the tracking number",
      quote: null,
      link: null,
      writtenBy: "assistant",
    });
    assert.equal(agentConversationEntry({ ...base, saleId: null, saleNo: null }).sale, null);
  });

  it("counts a batch's answers", () => {
    const batch = summarizeConversationBatch([
      { index: 0, status: "refused", reason: "no" },
      { index: 1, status: "refused", reason: "no" },
    ]);
    assert.equal(batch.recorded, 0);
    assert.equal(batch.refused, 2);
  });
});
