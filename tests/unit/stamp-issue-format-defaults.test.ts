import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ISSUE_FORMATS } from "../../src/lib/stamp-issue-format-defaults";
import { TAG_COLORS } from "../../src/lib/tag-colors";
import { parseStampAttributes, pickStampAttributeWrites } from "../../src/lib/stamp-attribute-kinds";

// The issue formats a collection starts with (#2439), and the stamp form's field for them.

describe("default issue formats (#2439)", () => {
  it("seeds the ten values the collector settled, with no row for an ordinary stamp", () => {
    assert.deepEqual(
      DEFAULT_ISSUE_FORMATS.map((f) => f.abbreviation),
      ["Bl", "exBl", "MS", "TB", "ST", "MH", "HBl", "exMH", "Coil", "PS"]
    );
    assert.ok(!DEFAULT_ISSUE_FORMATS.some((f) => /^(stamp|ordinary stamp|single)$/i.test(f.name)));
  });

  it("gives each a palette colour no other value has", () => {
    const colors = DEFAULT_ISSUE_FORMATS.map((f) => f.color);
    for (const c of colors) assert.ok((TAG_COLORS as readonly string[]).includes(c), c);
    assert.equal(new Set(colors).size, colors.length);
  });

  it("matches the backfill existing collections were given", () => {
    const dir = join(process.cwd(), "prisma", "migrations");
    const name = readdirSync(dir).find((d) => d.endsWith("_stamp_issue_format"));
    assert.ok(name, "the issue format migration exists");
    const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
    const rows = [...sql.matchAll(/\('([^']+)',\s*'([^']+)',\s*(\d+),\s*'([^']+)'\)/g)].map((m) => ({
      name: m[1],
      abbreviation: m[2],
      sortOrder: Number(m[3]),
      color: m[4],
    }));
    assert.deepEqual(
      rows,
      DEFAULT_ISSUE_FORMATS.map((f, i) => ({ ...f, sortOrder: i }))
    );
  });
});

describe("the stamp form's issue format field (#2439)", () => {
  it("sets, clears, and leaves untouched when the form did not render it", () => {
    const set = new FormData();
    set.set("issueFormatId", "isf1");
    assert.deepEqual(pickStampAttributeWrites(parseStampAttributes(set)), { issueFormatId: "isf1" });

    const cleared = new FormData();
    cleared.set("issueFormatId", "");
    assert.deepEqual(pickStampAttributeWrites(parseStampAttributes(cleared)), {
      issueFormatId: null,
    });

    assert.deepEqual(pickStampAttributeWrites(parseStampAttributes(new FormData())), {});
  });
});
