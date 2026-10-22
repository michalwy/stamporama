import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SWEEPABLE_SCAN_UPLOAD_STATUSES,
  asScanUploadStatus,
  canDiscardScanUpload,
  canRetryScanUpload,
  isScanUploadPending,
  scanUploadStatusText,
  isScanUploadShown,
  newlyPreparedSheets,
  queueAhead,
  scanCardTitle,
  scanProgressSummary,
} from "../../src/lib/scan-upload-status-rules";

describe("scan upload status rules (#1567)", () => {
  it("keeps the report of an interrupted upload until it is dismissed (#1568)", () => {
    assert.ok(!SWEEPABLE_SCAN_UPLOAD_STATUSES.includes("interrupted"));
    assert.equal(isScanUploadShown("interrupted"), true);
    assert.equal(isScanUploadPending("interrupted"), false);
    assert.equal(canDiscardScanUpload("interrupted"), true);
    assert.equal(canRetryScanUpload("interrupted"), false);
    assert.match(scanUploadStatusText("interrupted"), /not uploaded/i);
  });

  it("never lets the sweep take a scan whose bytes are all in and not yet a card", () => {
    assert.ok(!SWEEPABLE_SCAN_UPLOAD_STATUSES.includes("queued"));
    assert.ok(!SWEEPABLE_SCAN_UPLOAD_STATUSES.includes("preparing"));
    assert.ok(SWEEPABLE_SCAN_UPLOAD_STATUSES.includes("uploading"));
    assert.ok(SWEEPABLE_SCAN_UPLOAD_STATUSES.includes("failed"));
  });

  it("discards only what the worker is not holding and what is not a card yet", () => {
    assert.equal(canDiscardScanUpload("uploading"), true);
    assert.equal(canDiscardScanUpload("queued"), true);
    assert.equal(canDiscardScanUpload("failed"), true);
    assert.equal(canDiscardScanUpload("preparing"), false);
    assert.equal(canDiscardScanUpload("done"), false);
  });

  it("retries only a failure", () => {
    assert.deepEqual(
      (["uploading", "queued", "preparing", "done", "failed"] as const).filter(canRetryScanUpload),
      ["failed"]
    );
  });

  it("keeps asking while a scan waits or is prepared, and draws a card for those and failures", () => {
    assert.equal(isScanUploadPending("queued"), true);
    assert.equal(isScanUploadPending("preparing"), true);
    assert.equal(isScanUploadPending("failed"), false);
    assert.equal(isScanUploadShown("failed"), true);
    assert.equal(isScanUploadShown("done"), false);
    assert.equal(isScanUploadShown("uploading"), false);
  });

  it("reads an unknown stored status as still arriving", () => {
    assert.equal(asScanUploadStatus("preparing"), "preparing");
    assert.equal(asScanUploadStatus("something-new"), "uploading");
  });

  it("counts the scan being prepared and every earlier one as ahead", () => {
    const ahead = queueAhead([
      { id: "c", status: "queued", queuedAt: new Date("2026-10-03T10:02:00Z") },
      { id: "p", status: "preparing", queuedAt: new Date("2026-10-03T10:00:00Z") },
      { id: "a", status: "queued", queuedAt: "2026-10-03T10:01:00Z" },
    ]);
    assert.equal(ahead.get("a"), 1);
    assert.equal(ahead.get("c"), 2);
    assert.equal(ahead.has("p"), false);
    assert.equal(queueAhead([{ id: "x", status: "queued", queuedAt: null }]).get("x"), 0);
  });

  it("opens the editor only on scans the page watched being prepared", () => {
    const uploads = [
      { id: "watched", status: "done" as const, sheetId: "s1" },
      { id: "ready-before", status: "done" as const, sheetId: "s2" },
      { id: "still", status: "preparing" as const, sheetId: null },
      { id: "broke", status: "failed" as const, sheetId: null },
    ];
    assert.deepEqual(newlyPreparedSheets(new Set(["watched", "still", "broke"]), uploads), ["s1"]);
    assert.deepEqual(newlyPreparedSheets(new Set(), uploads), []);
  });
});

describe("the panel of scans being added (#2099)", () => {
  it("calls a scan by its card: a back by its batch, a front by its name", () => {
    assert.equal(scanCardTitle({ side: "back", batchNo: 4, label: "Klaser" }), "Back of batch 4");
    assert.equal(scanCardTitle({ side: "front", batchNo: 4, label: "Klaser" }), "New card · Klaser");
    assert.equal(scanCardTitle({ side: "front", batchNo: null, label: null }), "New card");
  });

  it("folds to one line, each part only when it counts", () => {
    assert.equal(
      scanProgressSummary({
        uploading: { position: 3, of: 12 },
        waiting: 9,
        notUploaded: 0,
        preparing: 1,
      }),
      "Uploading 3 of 12 · Preparing 1"
    );
    assert.equal(
      scanProgressSummary({ uploading: null, waiting: 0, notUploaded: 0, preparing: 2 }),
      "Preparing 2"
    );
    assert.equal(
      scanProgressSummary({ uploading: null, waiting: 2, notUploaded: 1, preparing: 0 }),
      "Waiting to upload 2 · 1 not uploaded"
    );
  });
});
