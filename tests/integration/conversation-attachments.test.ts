import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { deleteContact } from "../../src/lib/contacts";
import {
  createConversationEntries,
  deleteConversationEntry,
  readConversationLog,
} from "../../src/lib/conversation-log";
import {
  ConversationAttachmentError,
  addConversationAttachments,
  removeConversationAttachment,
} from "../../src/lib/conversation-attachments";
import { MAX_ATTACHMENTS_PER_ENTRY } from "../../src/lib/conversation-attachment-rules";
import { getCollectionPhotoStorageBytes } from "../../src/lib/photos";
import { getStorage } from "../../src/lib/storage";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, GET, POST } from "../../src/app/api/v1/[...path]/route";
import { GET as serveAttachment } from "../../src/app/api/collections/[collectionId]/conversation-attachments/[attachmentId]/route";
import type {
  AgentAttachmentBatch,
  AgentConversationBatch,
  AgentConversationEntry,
} from "../../src/lib/agent-api/conversation-log-reads";
import type { ListResponse } from "../../src/lib/agent-api/list";

// The filesystem backend under a throwaway directory, as the photo tests do.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-conversation-attachments-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// **Files on conversation log entries (#2150)**, in the domain and through the agent API.
//
// `tests/unit/agent-api-conversation-log.test.ts` holds what a file is, its name and the grammar the
// agent sends it in. This file holds the rest: that an entry keeps pictures and PDFs as they came,
// refuses anything else and past its limit, that removing one — or deleting its entry, or the contact
// — deletes the bytes, that they count in the collection's storage, and that the agent attaches,
// lists, fetches and removes them through the real routes, a read only token listing and fetching
// only.

const ts = Date.now();

type Method = "GET" | "POST" | "DELETE";
const HANDLERS = { GET, POST, DELETE };

async function call(token: string, method: Method, pathname: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const [route, search] = pathname.split("?");
  const request = new NextRequest(`http://localhost/api/v1${route}${search ? `?${search}` : ""}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: route.split("/").filter(Boolean) }),
  });
  return { status: response.status, body: await response.json() };
}

async function ok<T>(token: string, method: Method, pathname: string, body?: unknown): Promise<T> {
  const answer = await call(token, method, pathname, body);
  assert.equal(answer.status, 200, `${method} ${pathname} → ${JSON.stringify(answer.body)}`);
  return answer.body as T;
}

/** Fetch a file the way an agent does: the entry's `url`, with its own token. */
async function fetchFile(token: string, url: string): Promise<Response> {
  const [, , , collectionId, , attachmentId] = url.split("/");
  return serveAttachment(new NextRequest(`http://localhost${url}`, { headers: { authorization: `Bearer ${token}` } }), {
    params: Promise.resolve({ collectionId: decodeURIComponent(collectionId), attachmentId: decodeURIComponent(attachmentId) }),
  });
}

async function picture(red: number): Promise<Buffer> {
  return sharp({ create: { width: 160, height: 120, channels: 3, background: { r: red, g: 120, b: 60 } } })
    .png()
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

describe("files on conversation log entries (#2150)", () => {
  let userId: string;
  let collectionId: string;
  let annaId: string;
  let token: string;
  let readOnlyToken: string;

  const entry = (summary: string) => ({
    occurredAt: new Date("2026-10-20T12:00:00Z"),
    channel: "messenger" as const,
    direction: "from_buyer" as const,
    summary,
    quote: null,
    url: null,
    saleId: null,
  });

  before(async () => {
    userId = `test-user-conversation-files-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: userId,
        email: `test-conversation-files-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-conversation-files-${ts}`, name: "Conversation files", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    annaId = (await prisma.contact.create({ data: { collectionId, name: "Anna Zielińska", buyer: true } })).id;
    token = (await createAssistantToken(userId, collectionId, { label: "files agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "files agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe("in the domain", () => {
    it("keeps a picture with its thumbnail and a PDF as it came, shown on the entry", async () => {
      const [entryId] = await createConversationEntries(userId, annaId, [entry("Paid by BLIK")], "collector");
      const png = await picture(200);
      const [image, pdf] = await addConversationAttachments(userId, entryId, [
        { name: "blik.png", bytes: png },
        { name: "C:\\scans\\certificate", bytes: PDF },
      ]);
      assert.equal(image.kind, "image");
      assert.equal(image.hasThumb, true);
      assert.deepEqual([image.widthPx, image.heightPx], [160, 120]);
      assert.equal(pdf.kind, "pdf");
      assert.equal(pdf.fileName, "certificate.pdf", "the last path segment, with the extension its bytes say");
      assert.equal(pdf.hasThumb, false);

      const rows = await prisma.conversationAttachment.findMany({ where: { entryId }, orderBy: { createdAt: "asc" } });
      const stored = await getStorage(rows[1].storageBackend).get(rows[1].storageKey, rows[1].contentType, "delivery");
      const chunks: Buffer[] = [];
      for await (const chunk of stored.stream) chunks.push(Buffer.from(chunk));
      assert.deepEqual(Buffer.concat(chunks), PDF, "the PDF's bytes are kept exactly");
      assert.ok(await exists(rows[0].storageBackend, rows[0].thumbKey!, "image/webp"));

      const view = await readConversationLog(userId, collectionId, annaId, null);
      const shown = view?.entries.find((e) => e.id === entryId);
      assert.deepEqual(shown?.attachments.map((a) => a.fileName), ["blik.png", "certificate.pdf"]);

      const storage = await getCollectionPhotoStorageBytes(userId, collectionId);
      assert.equal(storage, png.length + PDF.length, "attachments count in the collection's storage");
    });

    it("refuses a file that is neither a picture nor a PDF, whatever its name, and stores nothing", async () => {
      const [entryId] = await createConversationEntries(userId, annaId, [entry("Sent a zip")], "collector");
      await assert.rejects(
        addConversationAttachments(userId, entryId, [
          { name: "ok.pdf", bytes: PDF },
          { name: "scan.pdf", bytes: Buffer.from("PK\u0003\u0004 not a pdf") },
        ]),
        (err: unknown) => err instanceof ConversationAttachmentError && /neither/.test(err.message)
      );
      assert.equal(await prisma.conversationAttachment.count({ where: { entryId } }), 0, "all or none");
      await assert.rejects(
        addConversationAttachments(userId, entryId, [{ name: "broken.png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]) }]),
        (err: unknown) => err instanceof ConversationAttachmentError && /could not be read as a picture/.test(err.message)
      );
    });

    it("keeps at most the files an entry holds", async () => {
      const [entryId] = await createConversationEntries(userId, annaId, [entry("Many scans")], "collector");
      await addConversationAttachments(
        userId,
        entryId,
        Array.from({ length: MAX_ATTACHMENTS_PER_ENTRY }, (_, i) => ({ name: `scan-${i}.pdf`, bytes: PDF }))
      );
      await assert.rejects(
        addConversationAttachments(userId, entryId, [{ name: "one-more.pdf", bytes: PDF }]),
        (err: unknown) => err instanceof ConversationAttachmentError && /Remove some first/.test(err.message)
      );
    });

    it("deletes the bytes when a file is removed, when its entry is deleted, and when the contact is", async () => {
      const [first, second] = await createConversationEntries(userId, annaId, [entry("One"), entry("Two")], "collector");
      const [removed] = await addConversationAttachments(userId, first, [{ name: "a.png", bytes: await picture(10) }]);
      const removedRow = await prisma.conversationAttachment.findUniqueOrThrow({ where: { id: removed.id } });
      await removeConversationAttachment(userId, removed.id);
      assert.equal(await exists(removedRow.storageBackend, removedRow.storageKey, removedRow.contentType), false);
      assert.equal(await exists(removedRow.storageBackend, removedRow.thumbKey!, "image/webp"), false);

      await addConversationAttachments(userId, first, [{ name: "b.pdf", bytes: PDF }]);
      const withEntry = await prisma.conversationAttachment.findFirstOrThrow({ where: { entryId: first } });
      await deleteConversationEntry(userId, first);
      assert.equal(await prisma.conversationAttachment.count({ where: { entryId: first } }), 0);
      assert.equal(await exists(withEntry.storageBackend, withEntry.storageKey, withEntry.contentType), false);

      const piotrId = (await prisma.contact.create({ data: { collectionId, name: "Piotr", buyer: true } })).id;
      const [piotrEntry] = await createConversationEntries(userId, piotrId, [entry("Hello")], "collector");
      await addConversationAttachments(userId, piotrEntry, [{ name: "c.pdf", bytes: PDF }]);
      const withContact = await prisma.conversationAttachment.findFirstOrThrow({ where: { entryId: piotrEntry } });
      await deleteContact(userId, piotrId);
      assert.equal(await prisma.conversationAttachment.count({ where: { entryId: piotrEntry } }), 0);
      assert.equal(await exists(withContact.storageBackend, withContact.storageKey, withContact.contentType), false);

      assert.ok(second);
    });

    it("refuses another owner's entry and attachment", async () => {
      const [entryId] = await createConversationEntries(userId, annaId, [entry("Mine")], "collector");
      const [attachment] = await addConversationAttachments(userId, entryId, [{ name: "a.pdf", bytes: PDF }]);
      await assert.rejects(addConversationAttachments("someone-else", entryId, [{ name: "b.pdf", bytes: PDF }]), ConversationAttachmentError);
      await assert.rejects(removeConversationAttachment("someone-else", attachment.id), ConversationAttachmentError);
    });
  });

  describe("through the agent API", () => {
    it("registers the two operations, writing", () => {
      for (const name of ["attach_conversation_files", "remove_conversation_attachment"]) {
        assert.equal(OPERATIONS.find((op) => op.name === name)?.writes, true, name);
      }
    });

    it("records entries with their files, answering each file and refusing one for a refused entry", async () => {
      const png = await picture(90);
      const batch = await ok<AgentConversationBatch>(token, "POST", "/conversation-entries", {
        buyer: annaId,
        entries: [
          "at=2026-10-21T09:00:00+02:00\nchannel=messenger\ndirection=from_buyer\nsummary=Sent the BLIK confirmation",
          "at=yesterday\nchannel=messenger\ndirection=from_buyer\nsummary=Misread",
        ],
        files: [
          `entry=0\nname=blik.png\ndata=data:image/png;base64,${png.toString("base64")}`,
          `entry=0\nname=notes.txt\ndata=${Buffer.from("plain text").toString("base64")}`,
          `entry=1\nname=other.pdf\ndata=${PDF.toString("base64")}`,
        ],
      });
      assert.equal(batch.recorded, 1);
      assert.deepEqual(
        batch.files?.map((file) => [file.index, file.entry, file.status]),
        [
          [0, 0, "attached"],
          [1, 0, "refused"],
          [2, 1, "refused"],
        ]
      );
      const recorded = batch.entries[0];
      assert.ok(recorded.status === "recorded");
      assert.deepEqual(
        recorded.entry.attachments.map((a) => [a.name, a.type, a.bytes]),
        [["blik.png", "image", png.length]]
      );
    });

    it("attaches files afterwards, lists and fetches them with a read only token, and removes one", async () => {
      const batch = await ok<AgentConversationBatch>(token, "POST", "/conversation-entries", {
        buyer: annaId,
        entries: ["at=2026-10-22T10:00:00Z\nchannel=email\ndirection=from_buyer\nsummary=Sent the certificate scan"],
      });
      const recorded = batch.entries[0];
      assert.ok(recorded.status === "recorded");
      const entryId = recorded.entry.id;

      const attached = await ok<AgentAttachmentBatch>(token, "POST", `/conversation-entries/${entryId}/attachments`, {
        files: [`name=certificate.pdf\ndata=${PDF.toString("base64")}`, "name=empty\ndata=???"],
      });
      assert.equal(attached.attached, 1);
      assert.equal(attached.refused, 1);
      assert.equal(attached.entry.attachments.length, 1);

      // A read only token cannot attach or remove …
      const refusedAttach = await call(readOnlyToken, "POST", `/conversation-entries/${entryId}/attachments`, {
        files: [`data=${PDF.toString("base64")}`],
      });
      assert.equal(refusedAttach.status, 403);

      // … and lists and fetches.
      const listed = await ok<ListResponse<AgentConversationEntry>>(readOnlyToken, "GET", "/conversation-entries?text=certificate");
      const file = listed.items.find((item) => item.id === entryId)?.attachments[0];
      assert.ok(file);
      assert.equal(file.type, "pdf");
      const fetched = await fetchFile(readOnlyToken, file.url);
      assert.equal(fetched.status, 200);
      assert.equal(fetched.headers.get("content-type"), "application/pdf");
      assert.match(fetched.headers.get("content-disposition") ?? "", /inline; filename="certificate\.pdf"/);
      assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), PDF);

      const refusedRemove = await call(readOnlyToken, "DELETE", `/conversation-attachments/${file.id}`);
      assert.equal(refusedRemove.status, 403);

      const removed = await ok<{ removed: string; entry: AgentConversationEntry }>(token, "DELETE", `/conversation-attachments/${file.id}`);
      assert.equal(removed.removed, file.id);
      assert.equal(removed.entry.attachments.length, 0);
      assert.equal((await fetchFile(token, file.url)).status, 404);
      assert.equal((await call(token, "DELETE", `/conversation-attachments/${file.id}`)).status, 404);
    });

    it("does not serve a file to a token of another collection", async () => {
      const otherCollection = await prisma.collection.create({
        data: { slug: `col-conversation-files-other-${ts}`, name: "Other", baseCurrency: "PLN", ownerId: userId },
      });
      const otherToken = (await createAssistantToken(userId, otherCollection.id, { label: "other", scope: "read", kind: "agent" })).token;
      const [entryId] = await createConversationEntries(userId, annaId, [entry("Scoped")], "collector");
      const [attachment] = await addConversationAttachments(userId, entryId, [{ name: "a.pdf", bytes: PDF }]);
      const url = `/api/collections/${collectionId}/conversation-attachments/${attachment.id}`;
      assert.equal((await fetchFile(otherToken, url)).status, 401);
      assert.equal((await fetchFile(token, url)).status, 200);
      await prisma.assistantToken.deleteMany({ where: { collectionId: otherCollection.id } });
    });
  });
});
