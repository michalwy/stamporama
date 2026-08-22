import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Symmetric encryption for secrets this app has to **replay** rather than verify (#476; ADR-0023).
//
// The precedent in this repo is `api-tokens.ts`, and it deliberately does not transfer: an
// Assistant token is only ever checked against a stored SHA-256, so a hash is enough. An Allegro
// refresh token is sent back to Allegro, so it has to come out of the database in the clear — and a
// database dump is a routine, freely-copied artefact in a self-hosted install.
//
// AES-256-GCM, because the ciphertext must be **tamper-evident**: a flipped byte in a refresh token
// has to fail here, as a decryption error naming the key, rather than downstream as an opaque
// Allegro rejection that reads like an expired grant.
//
// Pure and dependency-free on purpose (no Prisma, no `server-only`) so it is unit-testable: it is
// the one piece of #476 whose failure modes are worth asserting rather than reasoning about.
//
// A second caller since: the partner share link on a trade (#681, `trade-share-address.ts`), which
// is replayed to the *collector* rather than to a third party. It seals only when a key is
// configured — that link must keep working on an install that never connected Allegro — so nothing
// here became required that was not before.

/** The env var holding the master key. Required only once a secret is actually stored. */
export const SECRET_KEY_ENV = "STAMPORAMA_SECRET_KEY";

/** Prefix of every sealed value — the format is self-describing so it can change without a
 *  migration having to guess what a column holds. */
const FORMAT = "v1";
const IV_BYTES = 12; // GCM's own nonce size; anything else costs interoperability for nothing.
const TAG_BYTES = 16;

/** Raised when the key is absent or unusable. Named so callers can tell a *configuration* problem
 *  (fixable in `.env`) from a corrupt value (fixable only by reconnecting). */
export class SecretKeyMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretKeyMissingError";
  }
}

/** Raised when a stored value cannot be opened — wrong key, wrong format, or tampered ciphertext. */
export class SecretDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretDecryptError";
  }
}

/**
 * Derive the 32-byte AES key from the configured passphrase.
 *
 * SHA-256 of the passphrase rather than a KDF with a salt: the input is a machine-generated
 * high-entropy value the setup docs tell the collector to produce with `openssl rand -base64 32`,
 * and a per-value salt would have to be stored beside the ciphertext to be usable — buying nothing
 * against an attacker who by then already holds the database. What it does buy is that any
 * passphrase length yields a valid key, so a collector who typed something shorter still gets a
 * working install rather than a startup crash.
 */
function deriveKey(passphrase: string): Buffer {
  return createHash("sha256").update(passphrase, "utf8").digest();
}

/** The configured key, or null when none is set. */
export function secretKeyConfigured(): boolean {
  return Boolean(process.env[SECRET_KEY_ENV]?.trim());
}

function requireKey(): Buffer {
  const raw = process.env[SECRET_KEY_ENV]?.trim();
  if (!raw) {
    throw new SecretKeyMissingError(
      `${SECRET_KEY_ENV} is not set. It is required to store Allegro credentials; generate one with \`openssl rand -base64 32\` and restart.`
    );
  }
  return deriveKey(raw);
}

/**
 * Seal a plaintext secret for storage. Returns `v1.<iv>.<ciphertext>.<tag>`, all base64url.
 *
 * A fresh random IV per call, so sealing the same token twice never produces the same string —
 * which matters because these columns sit in a table the collector can read.
 */
export function sealSecret(plaintext: string): string {
  const key = requireKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT, iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(
    "."
  );
}

/**
 * Open a value produced by {@link sealSecret}.
 *
 * Every failure — an unknown format, a truncated string, a wrong key, a modified ciphertext —
 * arrives as {@link SecretDecryptError}, because to the caller they are one situation: this stored
 * secret cannot be used, and the connection has to be made again.
 */
export function openSecret(sealed: string): string {
  const key = requireKey();
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT) {
    throw new SecretDecryptError("Stored secret is not in a recognised format.");
  }
  const [, ivPart, ctPart, tagPart] = parts;
  const iv = Buffer.from(ivPart, "base64url");
  const ct = Buffer.from(ctPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretDecryptError("Stored secret is malformed.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretDecryptError(
      `Stored secret could not be decrypted. This usually means ${SECRET_KEY_ENV} changed since it was saved.`
    );
  }
}

/**
 * Open a value, returning null instead of throwing when it cannot be read.
 *
 * For the status read, which has to be able to say "this connection needs reconnecting" on a screen
 * rather than fail the page: a connection whose secrets are unreadable is exactly as unusable as one
 * whose refresh was rejected, and the collector's next step is the same either way.
 */
export function tryOpenSecret(sealed: string): string | null {
  try {
    return openSecret(sealed);
  } catch {
    return null;
  }
}
