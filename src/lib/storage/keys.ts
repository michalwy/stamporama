import type { PhotoVariant, SheetVariant } from "./types";

// How stored bytes are addressed: mime → extension, and the prefixes and variant keys built on it.
// Pure string arithmetic — no backend, no Prisma.
//
// Split out of `index.ts` so a unit test can hold it (`platform.md`, the #569 idiom). The barrel
// constructs the bindings and re-exports the local cache, which reaches Prisma for its bookkeeping,
// so importing these helpers from there pulled the generated client into `pnpm test:unit` — which
// AGENTS.md says is pure logic only (#861). `index.ts` re-exports everything here, so callers that
// import from `@/lib/storage` are unaffected.

/** File extension for a stored variant, derived from its mime. Accepted upload formats only. */
export function extForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      throw new Error(`Unsupported mime for storage key: ${mime}`);
  }
}

// A photo/upload persists a `storageKey` *prefix*; the two variant files hang under it as
// `<prefix>/{full,thumb}.<ext>` (#112 variant addressing). Storing the prefix keeps the two
// derivatives addressable from the single column and lets a whole photo's bytes be moved or
// deleted as a unit.

/** Permanent prefix for a committed photo: `<collectionId>/<photoId>`. */
export function permanentPrefix(collectionId: string, photoId: string): string {
  return `${collectionId}/${photoId}`;
}

/** Staging prefix for an eager pre-Save upload: `staging/<uploadId>`. Namespaced apart from
 * permanent keys so the GC sweep and tooling can target staging alone. */
export function stagingPrefix(uploadId: string): string {
  return `staging/${uploadId}`;
}

/** The concrete key of one variant under a stored prefix: `<prefix>/{full,thumb}.<ext>`. */
export function variantKey(
  prefix: string,
  variant: PhotoVariant,
  mime: string
): string {
  return `${prefix}/${variant}.${extForMime(mime)}`;
}

/** Permanent prefix for a retained scan sheet (#566): `<collectionId>/sheets/<sheetId>`. Under the
 * collection like every other permanent key, in a segment of its own so the retained originals —
 * far the largest objects the app stores — can be found, measured and swept as a group without
 * pattern-matching photo ids. */
export function sheetPrefix(collectionId: string, sheetId: string): string {
  return `${collectionId}/sheets/${sheetId}`;
}

/** The concrete key of one sheet variant: `<prefix>/{original,view}.<ext>`. */
export function sheetVariantKey(
  prefix: string,
  variant: SheetVariant,
  mime: string
): string {
  return `${prefix}/${variant}.${extForMime(mime)}`;
}
