import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// **A screen uses the window's width** (#1851).
//
// Every page of a collection is drawn in `Screen` (`src/app/screen.tsx`), which is full width unless
// it is handed one of `SCREEN_CAPS`. The rule exists because a screen used to write its frame inline
// and a new one copied the nearest, inheriting its column; checked here rather than remembered, the
// way `text-field-coverage.test.ts` checks the text fields.
//
// Two things are pinned: that a page is in a `Screen` at all, and that every cap is named in
// `docs/agents/ui-shell.md`'s list of the caps kept — a cap with no reason written down is the thing
// #1851 removed.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const COLLECTION_APP = path.join(ROOT, "src/app/c/[collectionSlug]");

/** Pages that hand their whole frame to a client screen of their own, which draws the `Screen`. */
const DELEGATED: Record<string, string> = {
  "albums/[albumId]/page.tsx": "albums/[albumId]/album-screen.tsx",
  "albums/[albumId]/pages/page.tsx": "albums/[albumId]/pages/page-editor.tsx",
};

/** Pages that render nothing: they redirect. */
const REDIRECTS = new Set(["catalog/page.tsx"]);

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pages(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

describe("every collection screen is drawn in Screen", () => {
  const found = pages(COLLECTION_APP).map((file) => path.relative(COLLECTION_APP, file));

  it("finds the pages", () => {
    assert.ok(found.length > 30, `only ${found.length} pages found under ${COLLECTION_APP}`);
  });

  for (const page of found) {
    it(page, () => {
      if (REDIRECTS.has(page)) {
        const source = readFileSync(path.join(COLLECTION_APP, page), "utf8");
        assert.match(source, /\bredirect\(/, `${page} is listed as a redirect but does not redirect`);
        return;
      }
      const drawn = DELEGATED[page] ?? page;
      const source = readFileSync(path.join(COLLECTION_APP, drawn), "utf8");
      assert.match(
        source,
        /<Screen[\s>]/,
        `${drawn} does not draw its frame with Screen (src/app/screen.tsx) — a screen is full width ` +
          `unless it states a reason in SCREEN_CAPS (#1851)`
      );
    });
  }
});

describe("every screen cap is documented", () => {
  const screen = readFileSync(path.join(ROOT, "src/app/screen.tsx"), "utf8");
  const block = screen.match(/export const SCREEN_CAPS = \{([\s\S]*?)\n\} as const;/);
  const keys = [...(block?.[1] ?? "").matchAll(/^ {2}(\w+): "/gm)].map((m) => m[1]);
  const guide = readFileSync(path.join(ROOT, "docs/agents/ui-shell.md"), "utf8");

  it("reads the caps", () => {
    assert.ok(keys.length > 0, "no keys read from SCREEN_CAPS");
  });

  for (const key of keys) {
    it(key, () => {
      assert.ok(
        guide.includes(`- \`${key}\` (`),
        `SCREEN_CAPS.${key} is not in ui-shell.md's list of the caps kept, with its reason`
      );
    });
  }
});
