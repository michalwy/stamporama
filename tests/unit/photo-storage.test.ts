import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  extForMime,
  permanentPrefix,
  stagingPrefix,
  variantKey,
} from "../../src/lib/storage";
import { FilesystemStorage } from "../../src/lib/storage/filesystem";

describe("storage key helpers", () => {
  it("maps accepted mimes to extensions", () => {
    assert.equal(extForMime("image/jpeg"), "jpg");
    assert.equal(extForMime("image/png"), "png");
    assert.equal(extForMime("image/webp"), "webp");
  });

  it("rejects unsupported mimes", () => {
    assert.throws(() => extForMime("image/gif"));
  });

  it("builds permanent and staging prefixes", () => {
    assert.equal(permanentPrefix("col1", "ph1"), "col1/ph1");
    assert.equal(stagingPrefix("up1"), "staging/up1");
  });

  it("addresses variants under a prefix", () => {
    assert.equal(variantKey("col1/ph1", "full", "image/jpeg"), "col1/ph1/full.jpg");
    assert.equal(variantKey("staging/up1", "thumb", "image/png"), "staging/up1/thumb.png");
  });
});

describe("FilesystemStorage round-trip", () => {
  let dir: string;
  const storage = new FilesystemStorage();

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "stamporama-storage-"));
    process.env.STAMPORAMA_DATA_DIR = dir;
  });

  after(async () => {
    delete process.env.STAMPORAMA_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  async function readAll(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  it("puts then gets the same bytes", async () => {
    const key = "col1/ph1/full.jpg";
    await storage.put(key, Buffer.from("hello-photo"));
    const obj = await storage.get(key, "image/jpeg");
    assert.equal(obj.mime, "image/jpeg");
    assert.equal(obj.sizeBytes, Buffer.byteLength("hello-photo"));
    assert.equal((await readAll(obj.stream)).toString(), "hello-photo");
  });

  it("moves bytes from one key to another", async () => {
    const from = "staging/up2/full.png";
    const to = "col1/ph2/full.png";
    await storage.put(from, Buffer.from("movable"));
    await storage.move(from, to);
    const obj = await storage.get(to, "image/png");
    assert.equal((await readAll(obj.stream)).toString(), "movable");
    await assert.rejects(storage.get(from, "image/png"));
  });

  it("deletes bytes and treats a missing key as a no-op", async () => {
    const key = "col1/ph3/thumb.webp";
    await storage.put(key, Buffer.from("bye"));
    await storage.delete(key);
    await assert.rejects(storage.get(key, "image/webp"));
    await storage.delete(key); // second delete must not throw
  });

  it("resolveUrl streams for the filesystem binding", async () => {
    const key = "col1/ph4/full.jpg";
    await storage.put(key, Buffer.from("streamed"));
    const resolved = await storage.resolveUrl(key, "image/jpeg");
    assert.equal(resolved.kind, "stream");
    if (resolved.kind === "stream") {
      assert.equal((await readAll(resolved.object.stream)).toString(), "streamed");
    }
  });

  it("rejects keys that escape the storage root", async () => {
    await assert.rejects(
      storage.put("../escape.jpg", Buffer.from("x"))
    );
  });
});
