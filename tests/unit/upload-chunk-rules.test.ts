import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_UPLOAD_CHUNK_KB,
  MAX_UPLOAD_CHUNK_KB,
  MIN_UPLOAD_CHUNK_KB,
  chunkCount,
  chunkRange,
  resolveUploadChunkBytes,
} from "../../src/lib/upload-chunk-rules";

// How large a piece of a card scan may be (#590). The default matters more than it looks: it is the
// figure an operator who has configured nothing gets, and the whole feature is worth nothing if a
// proxy refuses it unasked.
describe("upload chunk rules (#590)", () => {
  it("defaults below the strictest common proxy default", () => {
    // nginx ships `client_max_body_size 1m`. A chunk sized *at* the limit leaves no room for the
    // request line and headers a proxy may count with the body, so the default sits under it.
    assert.ok(resolveUploadChunkBytes(undefined) < 1024 * 1024);
    assert.equal(resolveUploadChunkBytes(undefined), DEFAULT_UPLOAD_CHUNK_KB * 1024);
  });

  it("takes the operator's override", () => {
    assert.equal(resolveUploadChunkBytes("2048"), 2048 * 1024);
    assert.equal(resolveUploadChunkBytes(" 256 "), 256 * 1024);
  });

  it("clamps rather than refuses, so a typo cannot break the upload path", () => {
    assert.equal(resolveUploadChunkBytes("1"), MIN_UPLOAD_CHUNK_KB * 1024);
    assert.equal(resolveUploadChunkBytes("999999"), MAX_UPLOAD_CHUNK_KB * 1024);
    assert.equal(resolveUploadChunkBytes("nonsense"), DEFAULT_UPLOAD_CHUNK_KB * 1024);
    assert.equal(resolveUploadChunkBytes("-4"), DEFAULT_UPLOAD_CHUNK_KB * 1024);
    assert.equal(resolveUploadChunkBytes(""), DEFAULT_UPLOAD_CHUNK_KB * 1024);
  });

  it("counts the parts a file is sent in, the last one short", () => {
    assert.equal(chunkCount(1000, 400), 3);
    assert.equal(chunkCount(800, 400), 2);
    assert.equal(chunkCount(1, 400), 1);
    assert.equal(chunkCount(0, 400), 0);
  });

  it("ranges cover the file exactly once", () => {
    const total = 1000;
    const size = 400;
    const ranges = Array.from({ length: chunkCount(total, size) }, (_, i) =>
      chunkRange(i, total, size)
    );
    assert.deepEqual(ranges, [
      { start: 0, end: 400 },
      { start: 400, end: 800 },
      { start: 800, end: 1000 },
    ]);
    assert.equal(
      ranges.reduce((sum, r) => sum + (r.end - r.start), 0),
      total
    );
  });
});
