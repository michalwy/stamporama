import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  crawlDelcampeCategories,
  refreshDelcampeCategories,
} from "../src/lib/delcampe-category-catalog";

// Read Delcampe's published category list and store it (#609; ADR-0035 §4).
//
//   pnpm delcampe:categories            # read the list and store it in this instance's database
//   pnpm delcampe:categories --seed     # read it and rewrite the snapshot checked into the repo
//
// The same pass the app runs once a day on its own, offered as a command for the two cases the timer
// does not cover: an instance being set up, where the picker would otherwise be empty until the first
// scheduled pass, and one whose last pass was refused. Settings → Delcampe has the same button.
//
// It walks Delcampe's own public list — there is no API for this; the REST one is behind the paid API
// Pass (ADR-0034) — sequentially and spaced, and treats a rate-limit refusal as an instruction to
// stop rather than as an error to retry through. A pass that stops early keeps what it read and
// leaves the previous snapshot standing, so this is safe to run again at any time.

/** Where the checked-in snapshot lives, and the one thing that must agree with
 *  `src/lib/delcampe-category-seed.ts`: `[id, path]` pairs, the name being the path's last segment. */
const SEED_FILE = join(__dirname, "..", "src", "lib", "delcampe-category-seed.json");

/** Rewrite the snapshot rather than the database. **Only a complete pass may be written** — a
 *  half-read snapshot committed to the repo would ship a picker missing whole continents, and unlike
 *  a half-read *refresh* nothing would ever correct it. */
async function writeSeed(): Promise<boolean> {
  const result = await crawlDelcampeCategories();
  console.log(
    `[delcampe-categories] ${result.rows.length} categories from ${result.pagesRead} page(s)`
  );
  if (!result.complete) {
    console.error(
      `[delcampe-categories] the walk did not finish, so the snapshot was left alone: ${result.message ?? "unknown reason"}`
    );
    return false;
  }
  const rows = [...result.rows].sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(
    SEED_FILE,
    JSON.stringify({
      // The date a person reads to judge whether the file is stale. Nothing in the app branches on it.
      readAt: new Date().toISOString().slice(0, 10),
      categories: rows.map((row) => [row.id, row.path]),
    }) + "\n"
  );
  console.log(`[delcampe-categories] wrote ${SEED_FILE}`);
  return true;
}

async function main(): Promise<void> {
  const started = Date.now();
  const seed = process.argv.slice(2).includes("--seed");
  const ok = seed ? await writeSeed() : await storeRefresh();
  console.log(`[delcampe-categories] done in ${Math.round((Date.now() - started) / 1000)}s`);
  // An incomplete pass is not a failure — nothing was lost and the next one carries on — but it is
  // worth an exit code, so a cron wrapper can tell "read the whole list" from "read some of it".
  process.exitCode = ok ? 0 : 1;
}

async function storeRefresh(): Promise<boolean> {
  const result = await refreshDelcampeCategories();
  console.log(
    `[delcampe-categories] ${result.read} categories from ${result.pagesRead} page(s)` +
      (result.complete ? "" : " — incomplete")
  );
  if (result.message) console.log(`[delcampe-categories] ${result.message}`);
  return result.complete;
}

void main();
