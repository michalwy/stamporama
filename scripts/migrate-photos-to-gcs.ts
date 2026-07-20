import "dotenv/config";
import { prisma } from "../src/lib/db";
import { getStorage, variantKey, type PhotoVariant } from "../src/lib/storage";

// Optional fs→GCS migration (#138, ADR-0011). Copies each filesystem photo's stored bytes to
// the GCS bucket under the *same* key, then flips its `storageBackend` column to `gcs`. Purely a
// convenience so the filesystem volume can eventually be retired — enabling GCS does NOT require
// it (write-one, read-many means new photos already write to GCS while old ones keep streaming
// from disk). Idempotent: only rows still on `filesystem` are selected, so re-running resumes.
//
//   pnpm photos:migrate:gcs              # copy bytes to GCS and flip the column, keep fs bytes
//   pnpm photos:migrate:gcs --delete-source   # also delete the filesystem bytes after each flip
//   pnpm photos:migrate:gcs --dry-run         # report what would move, change nothing
//
// Requires the GCS env (STAMPORAMA_GCS_BUCKET, GOOGLE_APPLICATION_CREDENTIALS, …) to be set.
// Committed `Photo` rows are migrated; transient `PhotoUpload` staging rows are left to age out
// via the orphan-GC sweep.

const VARIANTS: PhotoVariant[] = ["full", "thumb"];
const CONCURRENCY = 4;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const deleteSource = args.has("--delete-source");

async function migrateOne(photo: {
  id: string;
  storageKey: string;
  mime: string;
}): Promise<void> {
  const src = getStorage("filesystem");
  const dst = getStorage("gcs");

  // Copy both derivatives to GCS under the identical key.
  for (const variant of VARIANTS) {
    const key = variantKey(photo.storageKey, variant, photo.mime);
    const object = await src.get(key, photo.mime);
    await dst.put(key, object.stream, photo.mime);
  }

  // Flip the column only after both variants are safely on GCS.
  await prisma.photo.update({
    where: { id: photo.id },
    data: { storageBackend: "gcs" },
  });

  // Best-effort source cleanup once the row points at GCS.
  if (deleteSource) {
    for (const variant of VARIANTS) {
      await src
        .delete(variantKey(photo.storageKey, variant, photo.mime))
        .catch(() => {});
    }
  }
}

async function main(): Promise<void> {
  const pending = await prisma.photo.findMany({
    where: { storageBackend: "filesystem" },
    select: { id: true, storageKey: true, mime: true },
  });

  if (pending.length === 0) {
    console.log("[photos:migrate:gcs] nothing to migrate — no filesystem photos.");
    return;
  }

  console.log(
    `[photos:migrate:gcs] ${pending.length} photo(s) on filesystem` +
      (dryRun ? " (dry run — no changes)" : "") +
      (deleteSource ? " (will delete source bytes)" : "")
  );

  if (dryRun) {
    for (const p of pending) {
      console.log(`  would migrate ${p.id} (${p.storageKey})`);
    }
    return;
  }

  let done = 0;
  let failed = 0;
  // Simple fixed-size worker pool over the queue.
  const queue = [...pending];
  async function worker(): Promise<void> {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        await migrateOne(next);
        done += 1;
        console.log(`  migrated ${next.id} (${done}/${pending.length})`);
      } catch (err) {
        failed += 1;
        console.error(`  FAILED ${next.id}:`, err);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker)
  );

  console.log(
    `[photos:migrate:gcs] done — ${done} migrated, ${failed} failed.` +
      (failed > 0 ? " Re-run to retry the failures." : "")
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[photos:migrate:gcs] fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
