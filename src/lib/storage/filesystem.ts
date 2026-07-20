import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import type {
  Storage,
  StorageInput,
  StorageObject,
  ResolveResult,
} from "./types";

/** Root of the filesystem storage, a mounted Docker volume in production. Configured via
 * `STAMPORAMA_DATA_DIR` (default `/data`), falling back to `./.data` for local dev where
 * `/data` is typically not writable. Documented in docker-compose.prod.yml + the installer. */
export function dataDir(): string {
  const configured = process.env.STAMPORAMA_DATA_DIR?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production"
    ? "/data"
    : path.join(process.cwd(), ".data");
}

/** All photo bytes live under `<dataDir>/photos/…`, keeping the volume namespaced in case
 * other on-disk data lands here later. */
function photosRoot(): string {
  return path.join(dataDir(), "photos");
}

/** Resolve a storage key to an absolute path, guarding against traversal: the resolved path
 * must stay within the photos root. Keys are app-generated (never user input), so this is a
 * belt-and-braces check rather than the primary defense. */
function keyToPath(key: string): string {
  const root = photosRoot();
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Storage key escapes root: ${key}`);
  }
  return resolved;
}

/** Filesystem storage binding (#112, ADR-0011). Async + streaming throughout; `resolveUrl`
 * always returns `{ kind: "stream" }` so the collection-scoped route pipes bytes itself. */
export class FilesystemStorage implements Storage {
  readonly backend = "filesystem" as const;

  // `mime` is part of the Storage contract (a GCS binding sets Content-Type on write) but the
  // filesystem binding doesn't need it, so it's omitted here — structural typing still matches.
  async put(key: string, input: StorageInput): Promise<void> {
    const filePath = keyToPath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    if (Buffer.isBuffer(input)) {
      await writeFile(filePath, input);
    } else {
      // Stream to disk without buffering the whole object in memory.
      const { createWriteStream } = await import("node:fs");
      const { pipeline } = await import("node:stream/promises");
      await pipeline(input, createWriteStream(filePath));
    }
  }

  async get(key: string, mime: string): Promise<StorageObject> {
    const filePath = keyToPath(key);
    const info = await stat(filePath);
    return {
      stream: createReadStream(filePath),
      sizeBytes: info.size,
      mime,
    };
  }

  async delete(key: string): Promise<void> {
    // Best-effort: absent bytes are a no-op. `rm` with `force` swallows ENOENT.
    await rm(keyToPath(key), { force: true });
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const from = keyToPath(fromKey);
    const to = keyToPath(toKey);
    await mkdir(path.dirname(to), { recursive: true });
    try {
      await rename(from, to);
    } catch (err) {
      // rename fails across devices/mounts (EXDEV); fall back to copy + delete.
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        const { copyFile } = await import("node:fs/promises");
        await copyFile(from, to);
        await rm(from, { force: true });
        return;
      }
      throw err;
    }
  }

  async resolveUrl(key: string, mime: string): Promise<ResolveResult> {
    return { kind: "stream", object: await this.get(key, mime) };
  }

  describe(): string {
    return `filesystem (dataDir=${dataDir()})`;
  }

  async healthCheck(): Promise<void> {
    // Prove the photos root is creatable and writable — the actual failure operators hit is a
    // volume that isn't mounted or is read-only. Write and delete a tiny probe file.
    const root = photosRoot();
    await mkdir(root, { recursive: true });
    const probe = path.join(root, ".health-probe");
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
  }
}

/** Bridge a Node `Readable` to a web `ReadableStream` for a Next route `Response` body. */
export function toWebStream(nodeStream: Readable): ReadableStream {
  return Readable.toWeb(nodeStream) as ReadableStream;
}
