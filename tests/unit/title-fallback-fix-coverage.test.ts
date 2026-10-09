import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// **A preview's missing-translation warning lets each name be translated where it is reported**
// (#1733), in every preview that shows it. The warning is `TitleFallbackNote`; it can only offer the
// links when its host hands it a `fix`, so a new preview that renders the note without one would
// quietly go back to naming tokens the collector has to leave to fix. And the popover the links open
// floats above dialogs that cannot be told to step aside, so it must be an Escape layer itself.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Every `<TitleFallbackNote …>` element in `text`, attributes included. */
function noteElements(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/<TitleFallbackNote\b/g)) {
    const end = text.indexOf("/>", m.index);
    out.push(text.slice(m.index, end + 2));
  }
  return out;
}

describe("the missing-translation warning (#1733)", () => {
  const uses = sourceFiles(SRC).flatMap((file) =>
    noteElements(readFileSync(file, "utf8")).map((element) => ({
      file: path.relative(SRC, file),
      element,
    }))
  );

  it("is rendered somewhere — the sweep is looking at the right thing", () => {
    assert.ok(uses.length >= 2, `expected the compose dialog and the template builder, found ${uses.length}`);
  });

  it("is always handed what it needs to translate a name in place", () => {
    const bare = uses.filter((u) => !/\bfix=/.test(u.element));
    assert.deepEqual(
      bare.map((u) => u.file),
      [],
      "a preview renders the warning without `fix`, so its names cannot be translated from it"
    );
  });

  it("opens a popover that is an Escape layer of its own", () => {
    const text = readFileSync(path.join(SRC, "app/c/[collectionSlug]/shared/translation-gaps.tsx"), "utf8");
    const popover = text.slice(text.indexOf("export function TranslationGapPopover"));
    assert.match(popover, /useEscapeLayer\(onClose\)/);
    // Its own capture listener would race the shared one and lose to the dialog beneath (#361).
    assert.doesNotMatch(popover, /addEventListener\("keydown"/);
  });
});
