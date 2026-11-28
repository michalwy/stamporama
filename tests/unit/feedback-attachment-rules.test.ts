import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_ATTACHMENT_ACCEPT,
  MAX_FEEDBACK_ATTACHMENTS,
  MAX_FEEDBACK_ATTACHMENT_BYTES,
  MAX_FEEDBACK_REQUEST_BYTES,
  checkFeedbackFiles,
  looksLikeFeedbackPicture,
  sniffFeedbackAttachment,
} from "@/lib/feedback-attachment-rules";

// Pictures sent with a feedback report (#2727): the owner's limits (2026-11-28) — images only (PNG,
// JPEG, WebP), at most five per report, 10 MB each — and what a file is read from its bytes.

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const PDF = new TextEncoder().encode("%PDF-1.7\n");
const GIF = new TextEncoder().encode("GIF89a......");

describe("feedback attachment rules", () => {
  it("holds the owner's limits", () => {
    assert.equal(MAX_FEEDBACK_ATTACHMENTS, 5);
    assert.equal(MAX_FEEDBACK_ATTACHMENT_BYTES, 10 * 1024 * 1024);
    assert.ok(MAX_FEEDBACK_REQUEST_BYTES > MAX_FEEDBACK_ATTACHMENTS * MAX_FEEDBACK_ATTACHMENT_BYTES);
    assert.equal(FEEDBACK_ATTACHMENT_ACCEPT, "image/png,image/jpeg,image/webp");
  });

  it("reads PNG, JPEG and WebP from their bytes, and refuses a PDF or anything else", () => {
    assert.equal(sniffFeedbackAttachment(PNG), "image/png");
    assert.equal(sniffFeedbackAttachment(JPEG), "image/jpeg");
    assert.equal(sniffFeedbackAttachment(WEBP), "image/webp");
    assert.equal(sniffFeedbackAttachment(PDF), null);
    assert.equal(sniffFeedbackAttachment(GIF), null);
    assert.equal(sniffFeedbackAttachment(new Uint8Array()), null);
  });

  it("checks the count and each size", () => {
    const ok = { size: 1000 };
    assert.deepEqual(checkFeedbackFiles([]), { ok: true });
    assert.deepEqual(checkFeedbackFiles(Array(5).fill(ok)), { ok: true });
    assert.deepEqual(checkFeedbackFiles([{ size: MAX_FEEDBACK_ATTACHMENT_BYTES }]), { ok: true });
    assert.deepEqual(checkFeedbackFiles(Array(6).fill(ok)), { ok: false, problem: "too_many", index: 5 });
    assert.deepEqual(checkFeedbackFiles([ok, { size: MAX_FEEDBACK_ATTACHMENT_BYTES + 1 }]), {
      ok: false,
      problem: "too_large",
      index: 1,
    });
    assert.deepEqual(checkFeedbackFiles([{ size: 0 }]), { ok: false, problem: "empty", index: 0 });
  });

  it("tells the dialog which declared types are pictures it may send", () => {
    assert.ok(looksLikeFeedbackPicture("image/png"));
    assert.ok(looksLikeFeedbackPicture("IMAGE/JPEG"));
    assert.ok(looksLikeFeedbackPicture("image/webp"));
    assert.ok(!looksLikeFeedbackPicture("application/pdf"));
    assert.ok(!looksLikeFeedbackPicture("image/gif"));
    assert.ok(looksLikeFeedbackPicture(""), "no declared type: the server reads the bytes");
  });
});
