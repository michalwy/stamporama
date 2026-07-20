import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Storage as GcsClient, type Bucket } from "@google-cloud/storage";
import type {
  Storage,
  StorageInput,
  StorageObject,
  ResolveResult,
} from "./types";

// GCS storage binding (#138, ADR-0011). The planned second binding, purely additive: the same
// backend-agnostic keys used on the filesystem become GCS object names (optionally under a
// configured prefix), and `resolveUrl` returns a short-lived signed URL so image bytes bypass
// the app. Credentials come from Application Default Credentials (ADC) — set
// `GOOGLE_APPLICATION_CREDENTIALS` to a mounted service-account key file; that key is also what
// signs the read URLs. Async + streaming throughout, matching seam 1 of the interface.

/** Default signed-URL lifetime. Short by design: collection-scoped auth runs when the URL is
 * minted (in the serving route), so the URL itself only needs to outlive one client fetch. */
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;

function requiredBucketName(): string {
  const name = process.env.STAMPORAMA_GCS_BUCKET?.trim();
  if (!name) {
    throw new Error(
      "GCS storage is selected but STAMPORAMA_GCS_BUCKET is not set."
    );
  }
  return name;
}

/** Object-key prefix inside the bucket, normalized without leading/trailing slashes. Lets a
 * single bucket be shared across deployments/environments. */
function keyPrefix(): string {
  return (process.env.STAMPORAMA_GCS_KEY_PREFIX?.trim() ?? "").replace(
    /^\/+|\/+$/g,
    ""
  );
}

function signedUrlTtlMs(): number {
  const raw = process.env.STAMPORAMA_GCS_SIGNED_URL_TTL_SECONDS?.trim();
  const seconds = raw ? Number(raw) : NaN;
  const ttl =
    Number.isFinite(seconds) && seconds > 0
      ? seconds
      : DEFAULT_SIGNED_URL_TTL_SECONDS;
  return ttl * 1000;
}

export class GcsStorage implements Storage {
  readonly backend = "gcs" as const;

  // The client and bucket handle are created on first use, so a filesystem-only deployment
  // never constructs a GCS client or requires bucket config just by importing this module.
  private bucketHandle: Bucket | null = null;

  private bucket(): Bucket {
    if (!this.bucketHandle) {
      const client = new GcsClient();
      this.bucketHandle = client.bucket(requiredBucketName());
    }
    return this.bucketHandle;
  }

  /** Map a backend-agnostic storage key to a bucket object name, applying the optional prefix. */
  private objectName(key: string): string {
    const prefix = keyPrefix();
    return prefix ? `${prefix}/${key}` : key;
  }

  private file(key: string) {
    return this.bucket().file(this.objectName(key));
  }

  async put(key: string, input: StorageInput, mime: string): Promise<void> {
    const file = this.file(key);
    if (Buffer.isBuffer(input)) {
      // `resumable: false` uses a single multipart upload — cheaper for the small derivatives
      // we store (full ≤2500px, thumb 320px) than a resumable session.
      await file.save(input, { contentType: mime, resumable: false });
      return;
    }
    await pipeline(
      input,
      file.createWriteStream({ contentType: mime, resumable: false })
    );
  }

  async get(key: string, mime: string): Promise<StorageObject> {
    const file = this.file(key);
    const [metadata] = await file.getMetadata();
    return {
      stream: file.createReadStream() as unknown as Readable,
      sizeBytes: Number(metadata.size ?? 0),
      mime,
    };
  }

  async delete(key: string): Promise<void> {
    // Best-effort: absent objects are a no-op, mirroring the filesystem binding.
    await this.file(key).delete({ ignoreNotFound: true });
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    // Server-side copy + delete inside the bucket — GCS has no atomic rename.
    await this.file(fromKey).move(this.objectName(toKey));
  }

  // `mime` is part of the contract but a signed URL doesn't need it (Content-Type was set on the
  // object at write time), so it's omitted here — structural typing still matches.
  async resolveUrl(key: string): Promise<ResolveResult> {
    const [url] = await this.file(key).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + signedUrlTtlMs(),
    });
    return { kind: "redirect", url };
  }

  describe(): string {
    const prefix = keyPrefix();
    const ttlSeconds = signedUrlTtlMs() / 1000;
    return (
      `gcs (bucket=${process.env.STAMPORAMA_GCS_BUCKET?.trim() ?? "<unset>"}` +
      (prefix ? `, prefix=${prefix}` : "") +
      `, signedUrlTtl=${ttlSeconds}s)`
    );
  }

  async healthCheck(): Promise<void> {
    // Cheap probe: confirm credentials resolve and the configured bucket is reachable. Also
    // warns early if the signing key is missing, since serving depends on signed URLs.
    const [exists] = await this.bucket().exists();
    if (!exists) {
      throw new Error(
        `bucket "${requiredBucketName()}" not found or not accessible with the provided credentials`
      );
    }
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
      throw new Error(
        "GOOGLE_APPLICATION_CREDENTIALS is not set — signed read URLs cannot be minted"
      );
    }
  }
}
