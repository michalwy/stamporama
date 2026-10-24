import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agentConversationEntry,
  decodeAttachmentData,
  parseAttachmentFileSpec,
  parseConversationEntrySpec,
  parseConversationInstant,
  parseSaleRef,
  summarizeAttachmentBatch,
  summarizeConversationBatch,
} from "../../src/lib/agent-api/conversation-log-reads";
import {
  MAX_ATTACHMENT_NAME_LENGTH,
  attachmentKind,
  cleanAttachmentName,
  sniffAttachment,
} from "../../src/lib/conversation-attachment-rules";
import { checkConversationText, MAX_SUMMARY_LENGTH } from "../../src/lib/conversation-log-rules";

// The conversation log's pure rules (#2149): an entry's text, an entry as the agent spells it, a sale
// as it is named, and what an entry reads back as — and its files (#2150): what a file is, the name it
// is kept under, and a file as the agent sends it.

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
      attachments: [],
    };
    assert.deepEqual(agentConversationEntry({ ...base, saleId: "s1", saleNo: 12 }, "col1"), {
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
      attachments: [],
    });
    assert.equal(agentConversationEntry({ ...base, saleId: null, saleNo: null }, "col1").sale, null);
  });

  it("names each file by a link the same token opens, never by its bytes (#2150)", () => {
    const entry = agentConversationEntry(
      {
        id: "e1",
        contactId: "c1",
        contactName: "Anna",
        saleId: null,
        saleNo: null,
        occurredAt: "2026-10-20T12:05:00.000Z",
        channel: "messenger",
        direction: "from_buyer",
        summary: "Paid",
        quote: null,
        url: null,
        author: "collector",
        attachments: [
          { id: "a1", fileName: "blik.png", contentType: "image/png", sizeBytes: 2048 },
          { id: "a2", fileName: "certificate.pdf", contentType: "application/pdf", sizeBytes: 90000 },
        ],
      },
      "col 1"
    );
    assert.deepEqual(entry.attachments, [
      { id: "a1", name: "blik.png", type: "image", bytes: 2048, url: "/api/collections/col%201/conversation-attachments/a1" },
      {
        id: "a2",
        name: "certificate.pdf",
        type: "pdf",
        bytes: 90000,
        url: "/api/collections/col%201/conversation-attachments/a2",
      },
    ]);
  });

  it("counts a batch's answers", () => {
    const batch = summarizeConversationBatch([
      { index: 0, status: "refused", reason: "no" },
      { index: 1, status: "refused", reason: "no" },
    ]);
    assert.equal(batch.recorded, 0);
    assert.equal(batch.refused, 2);
    assert.equal("files" in batch, false, "no files sent, no files answered");
    const withFiles = summarizeConversationBatch([], [{ index: 0, entry: 0, status: "refused", reason: "no" }]);
    assert.equal(withFiles.files?.length, 1);
  });
});

// ── Files (#2150) ─────────────────────────────────────────────────────────────────────────────────

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const PDF = Buffer.from("%PDF-1.7\n%\xe2\xe3\n");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

describe("sniffAttachment", () => {
  it("reads what a file is from its bytes", () => {
    assert.equal(sniffAttachment(PNG), "image/png");
    assert.equal(sniffAttachment(JPEG), "image/jpeg");
    assert.equal(sniffAttachment(PDF), "application/pdf");
    assert.equal(sniffAttachment(WEBP), "image/webp");
  });

  it("keeps nothing else, whatever it is called", () => {
    assert.equal(sniffAttachment(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
    assert.equal(sniffAttachment(Buffer.from("GIF89a")), null);
    assert.equal(sniffAttachment(Buffer.from("PK\x03\x04")), null);
    assert.equal(sniffAttachment(Buffer.alloc(0)), null);
    assert.equal(attachmentKind("application/pdf"), "pdf");
    assert.equal(attachmentKind("image/webp"), "image");
  });
});

describe("cleanAttachmentName", () => {
  it("keeps the last path segment without control characters or quotes", () => {
    assert.equal(cleanAttachmentName("C:\\Users\\anna\\potwierdzenie.pdf", "application/pdf"), "potwierdzenie.pdf");
    assert.equal(cleanAttachmentName('../../"evil"\u0000.png', "image/png"), "evil.png");
  });

  it("gives a name with no extension the one its bytes say, and an empty one a name", () => {
    assert.equal(cleanAttachmentName("potwierdzenie", "application/pdf"), "potwierdzenie.pdf");
    assert.equal(cleanAttachmentName("   ", "image/jpeg"), "attachment.jpg");
    assert.equal(cleanAttachmentName("zrzut ekranu 2026-10-20.png", "image/png"), "zrzut ekranu 2026-10-20.png");
  });

  it("shortens a long name and keeps its extension", () => {
    const name = cleanAttachmentName(`${"a".repeat(400)}.pdf`, "application/pdf");
    assert.equal(name.length, MAX_ATTACHMENT_NAME_LENGTH);
    assert.ok(name.endsWith(".pdf"));
  });
});

describe("decodeAttachmentData", () => {
  const base64 = PNG.toString("base64");

  it("reads base64 plain, wrapped, unpadded, URL-safe, or after a data URL prefix", () => {
    assert.deepEqual(decodeAttachmentData(base64), PNG);
    assert.deepEqual(decodeAttachmentData(`${base64.slice(0, 6)}\n${base64.slice(6)}`), PNG);
    assert.deepEqual(decodeAttachmentData(base64.replace(/=+$/, "")), PNG);
    assert.deepEqual(decodeAttachmentData(`data:image/png;base64,${base64}`), PNG);
    const urlSafe = Buffer.from([0xfb, 0xff, 0xfe]);
    assert.deepEqual(decodeAttachmentData(urlSafe.toString("base64url")), urlSafe);
  });

  it("refuses what is not base64 rather than storing a damaged file", () => {
    assert.equal(decodeAttachmentData("not base64!"), null);
    assert.equal(decodeAttachmentData(""), null);
    assert.equal(decodeAttachmentData("abcde"), null);
  });
});

describe("parseAttachmentFileSpec", () => {
  const data = PDF.toString("base64");

  it("reads a name and the bytes, the base64 wrapping over lines", () => {
    const parsed = parseAttachmentFileSpec(`name=certificate.pdf\ndata=${data.slice(0, 8)}\n${data.slice(8)}`, {
      withEntry: false,
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.spec.name, "certificate.pdf");
    assert.deepEqual(parsed.spec.bytes, PDF);
    assert.equal(parsed.spec.entry, null);
  });

  it("takes a file with no name", () => {
    const parsed = parseAttachmentFileSpec(`data=${data}`, { withEntry: false });
    assert.ok(parsed.ok);
    assert.equal(parsed.spec.name, "");
  });

  it("asks a file sent with entries which entry it goes with, and refuses one past them", () => {
    const sent = parseAttachmentFileSpec(`entry=1\nname=a.pdf\ndata=${data}`, { withEntry: true, entries: 2 });
    assert.ok(sent.ok);
    assert.equal(sent.spec.entry, 1);
    const none = parseAttachmentFileSpec(`data=${data}`, { withEntry: true, entries: 2 });
    assert.ok(!none.ok && /entry=/.test(none.reason));
    const past = parseAttachmentFileSpec(`entry=2\ndata=${data}`, { withEntry: true, entries: 2 });
    assert.ok(!past.ok && /names no entry/.test(past.reason));
    const stray = parseAttachmentFileSpec(`entry=0\ndata=${data}`, { withEntry: false });
    assert.ok(!stray.ok && /names its entry itself/.test(stray.reason));
  });

  it("refuses a file with no data, data that is not base64, and a field named twice", () => {
    assert.ok(!parseAttachmentFileSpec("name=a.png", { withEntry: false }).ok);
    const garbled = parseAttachmentFileSpec("data=%%%", { withEntry: false });
    assert.ok(!garbled.ok && /not base64/.test(garbled.reason));
    const twice = parseAttachmentFileSpec(`name=a\nname=b\ndata=${data}`, { withEntry: false });
    assert.ok(!twice.ok && /twice/.test(twice.reason));
    const loose = parseAttachmentFileSpec(`${data}`, { withEntry: false });
    assert.ok(!loose.ok);
  });

  it("counts a call's answers", () => {
    const entry = agentConversationEntry(
      {
        id: "e1",
        contactId: "c1",
        contactName: "Anna",
        saleId: null,
        saleNo: null,
        occurredAt: "2026-10-20T12:05:00.000Z",
        channel: "messenger",
        direction: "from_buyer",
        summary: "Paid",
        quote: null,
        url: null,
        author: "assistant",
        attachments: [],
      },
      "col1"
    );
    const batch = summarizeAttachmentBatch([{ index: 0, status: "refused", reason: "no" }], entry);
    assert.equal(batch.attached, 0);
    assert.equal(batch.refused, 1);
    assert.equal(batch.entry.id, "e1");
  });
});
