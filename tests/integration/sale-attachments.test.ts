import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { deleteSale, mergeSales } from "../../src/lib/sales";
import {
  SaleAttachmentError,
  addSaleAttachments,
  listAttachmentsOfSales,
  listSaleAttachments,
  removeSaleAttachment,
} from "../../src/lib/sale-attachments";
import { getCollectionPhotoStorageBytes } from "../../src/lib/photos";
import { getStorage } from "../../src/lib/storage";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { GET, POST } from "../../src/app/api/v1/[...path]/route";
import { GET as serveAttachment } from "../../src/app/api/collections/[collectionId]/sale-attachments/[attachmentId]/route";
import type { AgentSaleAttachmentBatch, AgentSaleAttachments } from "../../src/lib/agent-api/sale-attachment-reads";

// The filesystem backend under a throwaway directory, as the photo tests do.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-sale-attachments-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// **A sale's own files (#2198)** — shipment photos, posting receipts — in the domain and through the
// agent API: a sale keeps pictures and PDFs as they came and refuses anything else; removing one, or
// deleting the sale, deletes the bytes; merging moves them to the sale that remains; they count in
// the collection's storage; and the agent adds, lists and fetches them through the real routes, a
// read only token listing and fetching only.

const ts = Date.now();

type Method = "GET" | "POST";
const HANDLERS = { GET, POST };

async function call(token: string, method: Method, pathname: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const request = new NextRequest(`http://localhost/api/v1${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: pathname.split("/").filter(Boolean) }),
  });
  return { status: response.status, body: await response.json() };
}

async function ok<T>(token: string, method: Method, pathname: string, body?: unknown): Promise<T> {
  const answer = await call(token, method, pathname, body);
  assert.equal(answer.status, 200, `${method} ${pathname} → ${JSON.stringify(answer.body)}`);
  return answer.body as T;
}

/** Fetch a file the way an agent does: its `url`, with its own token. */
async function fetchFile(token: string, url: string): Promise<Response> {
  const [, , , collectionId, , attachmentId] = url.split("/");
  return serveAttachment(new NextRequest(`http://localhost${url}`, { headers: { authorization: `Bearer ${token}` } }), {
    params: Promise.resolve({ collectionId: decodeURIComponent(collectionId), attachmentId: decodeURIComponent(attachmentId) }),
  });
}

async function picture(red: number): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 100, channels: 3, background: { r: red, g: 90, b: 40 } } })
    .jpeg()
    .toBuffer();
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

async function exists(backend: string, key: string, mime: string): Promise<boolean> {
  try {
    await getStorage(backend).get(key, mime, "delivery");
    return true;
  } catch {
    return false;
  }
}

describe("a sale's own files (#2198)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let token: string;
  let readOnlyToken: string;
  let saleNo = 0;

  async function newSale(): Promise<string> {
    saleNo += 1;
    const sale = await prisma.sale.create({
      data: { collectionId, saleNo, platformId, soldAt: new Date("2026-10-20"), currency: "PLN" },
    });
    return sale.id;
  }

  before(async () => {
    userId = `test-user-sale-files-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: userId,
        email: `test-sale-files-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-sale-files-${ts}`, name: "Sale files", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Facebook" } })).id;
    token = (await createAssistantToken(userId, collectionId, { label: "sale files agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "sale files agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe("in the domain", () => {
    it("keeps a picture with its thumbnail and a PDF as it came, oldest first", async () => {
      const saleId = await newSale();
      const jpeg = await picture(200);
      const [photo, receipt] = await addSaleAttachments(userId, saleId, [
        { name: "parcel.jpg", bytes: jpeg },
        { name: "/sdcard/receipt", bytes: PDF },
      ]);
      assert.equal(photo.kind, "image");
      assert.equal(photo.hasThumb, true);
      assert.deepEqual([photo.widthPx, photo.heightPx], [200, 100]);
      assert.equal(receipt.kind, "pdf");
      assert.equal(receipt.fileName, "receipt.pdf");

      const listed = await listSaleAttachments(userId, collectionId, saleId);
      assert.deepEqual(listed?.map((file) => file.fileName), ["parcel.jpg", "receipt.pdf"]);
      const bySale = await listAttachmentsOfSales(userId, collectionId, [saleId]);
      assert.equal(bySale[saleId]?.length, 2);

      const row = await prisma.saleAttachment.findUniqueOrThrow({ where: { id: receipt.id } });
      assert.match(row.storageKey, new RegExp(`^${collectionId}/sale/[^/]+/original\\.pdf$`));
      const stored = await getStorage(row.storageBackend).get(row.storageKey, row.contentType, "delivery");
      const chunks: Buffer[] = [];
      for await (const chunk of stored.stream) chunks.push(Buffer.from(chunk));
      assert.deepEqual(Buffer.concat(chunks), PDF, "the PDF's bytes are kept exactly");

      const storage = await getCollectionPhotoStorageBytes(userId, collectionId);
      assert.equal(storage, jpeg.length + PDF.length, "a sale's files count in the collection's storage");
    });

    it("refuses a file that is neither a picture nor a PDF, all or none", async () => {
      const saleId = await newSale();
      await assert.rejects(
        addSaleAttachments(userId, saleId, [
          { name: "ok.pdf", bytes: PDF },
          { name: "notes.pdf", bytes: Buffer.from("plain text") },
        ]),
        (err: unknown) => err instanceof SaleAttachmentError && /neither/.test(err.message)
      );
      assert.equal(await prisma.saleAttachment.count({ where: { saleId } }), 0);
    });

    it("deletes the bytes when a file is removed and when the sale is deleted", async () => {
      const saleId = await newSale();
      const [removed, kept] = await addSaleAttachments(userId, saleId, [
        { name: "a.jpg", bytes: await picture(10) },
        { name: "b.pdf", bytes: PDF },
      ]);
      const removedRow = await prisma.saleAttachment.findUniqueOrThrow({ where: { id: removed.id } });
      assert.deepEqual(await removeSaleAttachment(userId, removed.id), { saleId });
      assert.equal(await exists(removedRow.storageBackend, removedRow.storageKey, removedRow.contentType), false);
      assert.equal(await exists(removedRow.storageBackend, removedRow.thumbKey!, "image/webp"), false);

      const keptRow = await prisma.saleAttachment.findUniqueOrThrow({ where: { id: kept.id } });
      await deleteSale(userId, saleId);
      assert.equal(await prisma.saleAttachment.count({ where: { saleId } }), 0);
      assert.equal(await exists(keptRow.storageBackend, keptRow.storageKey, keptRow.contentType), false);
    });

    it("moves the files of a merged sale to the one that remains", async () => {
      const remaining = await newSale();
      const other = await newSale();
      await addSaleAttachments(userId, remaining, [{ name: "mine.pdf", bytes: PDF }]);
      const [moved] = await addSaleAttachments(userId, other, [{ name: "theirs.pdf", bytes: PDF }]);
      await mergeSales(userId, {
        remainingSaleId: remaining,
        otherSaleId: other,
        choices: { buyer: "remaining", commission: "remaining", postage: "remaining" },
      });
      const listed = await listSaleAttachments(userId, collectionId, remaining);
      assert.deepEqual(listed?.map((file) => file.fileName), ["mine.pdf", "theirs.pdf"]);
      const row = await prisma.saleAttachment.findUniqueOrThrow({ where: { id: moved.id } });
      assert.ok(await exists(row.storageBackend, row.storageKey, row.contentType), "the bytes stay where they were");
    });

    it("refuses another owner's sale and file", async () => {
      const saleId = await newSale();
      const [file] = await addSaleAttachments(userId, saleId, [{ name: "a.pdf", bytes: PDF }]);
      await assert.rejects(addSaleAttachments("someone-else", saleId, [{ name: "b.pdf", bytes: PDF }]), SaleAttachmentError);
      await assert.rejects(removeSaleAttachment("someone-else", file.id), SaleAttachmentError);
      assert.equal(await listSaleAttachments("someone-else", collectionId, saleId), null);
    });
  });

  describe("through the agent API", () => {
    it("registers a read and a write, and no removal", () => {
      assert.equal(OPERATIONS.find((op) => op.name === "list_sale_attachments")?.writes, false);
      assert.equal(OPERATIONS.find((op) => op.name === "add_sale_attachments")?.writes, true);
      assert.equal(OPERATIONS.some((op) => /^(remove|delete)_sale_attachment/.test(op.name)), false);
    });

    it("adds files, answering each, lists and fetches them with a read only token", async () => {
      const saleId = await newSale();
      const jpeg = await picture(120);
      const added = await ok<AgentSaleAttachmentBatch>(token, "POST", `/sales/${saleId}/attachments`, {
        files: [
          `name=parcel.jpg\ndata=data:image/jpeg;base64,${jpeg.toString("base64")}`,
          `name=notes.txt\ndata=${Buffer.from("plain text").toString("base64")}`,
          `name=receipt.pdf\ndata=${PDF.toString("base64")}`,
        ],
      });
      assert.equal(added.attached, 2);
      assert.equal(added.refused, 1);
      assert.deepEqual(
        added.files.map((file) => [file.index, file.status]),
        [
          [0, "attached"],
          [1, "refused"],
          [2, "attached"],
        ]
      );
      assert.equal(added.sale.attachments.length, 2);
      const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, select: { apiReviewAt: true } });
      assert.equal(sale.apiReviewAt, null, "a file is a record, not an act: the sale is not put to review");

      // A read only token cannot add …
      const refused = await call(readOnlyToken, "POST", `/sales/${saleId}/attachments`, { files: [`data=${PDF.toString("base64")}`] });
      assert.equal(refused.status, 403);

      // … and lists and fetches.
      const listed = await ok<AgentSaleAttachments>(readOnlyToken, "GET", `/sales/${saleId}/attachments`);
      assert.deepEqual(
        listed.attachments.map((file) => [file.name, file.type, file.bytes]),
        [
          ["parcel.jpg", "image", jpeg.length],
          ["receipt.pdf", "pdf", PDF.length],
        ]
      );
      const fetched = await fetchFile(readOnlyToken, listed.attachments[1].url);
      assert.equal(fetched.status, 200);
      assert.equal(fetched.headers.get("content-type"), "application/pdf");
      assert.match(fetched.headers.get("content-disposition") ?? "", /inline; filename="receipt\.pdf"/);
      assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), PDF);
    });

    it("answers an unknown sale as not found, and serves no file to another collection's token", async () => {
      assert.equal((await call(token, "GET", "/sales/no-such-sale/attachments")).status, 404);
      const otherCollection = await prisma.collection.create({
        data: { slug: `col-sale-files-other-${ts}`, name: "Other", baseCurrency: "PLN", ownerId: userId },
      });
      const otherToken = (await createAssistantToken(userId, otherCollection.id, { label: "other", scope: "read", kind: "agent" })).token;
      const saleId = await newSale();
      const [file] = await addSaleAttachments(userId, saleId, [{ name: "a.pdf", bytes: PDF }]);
      const url = `/api/collections/${collectionId}/sale-attachments/${file.id}`;
      assert.equal((await fetchFile(otherToken, url)).status, 401);
      assert.equal((await fetchFile(token, url)).status, 200);
      assert.equal((await call(otherToken, "GET", `/sales/${saleId}/attachments`)).status, 404);
      await prisma.assistantToken.deleteMany({ where: { collectionId: otherCollection.id } });
    });
  });
});
