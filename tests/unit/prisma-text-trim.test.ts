import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trimWriteArgs, WRITING_OPERATIONS } from "@/lib/prisma-text-trim";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(HERE, "../../prisma/schema.prisma");

describe("trimWriteArgs", () => {
  it("trims a create's columns", () => {
    assert.deepEqual(trimWriteArgs({ data: { name: "  Poland  ", note: "x " } }), {
      data: { name: "Poland", note: "x" },
    });
  });

  it("trims each row of a createMany", () => {
    assert.deepEqual(trimWriteArgs({ data: [{ name: " a " }, { name: "b" }] }), {
      data: [{ name: "a" }, { name: "b" }],
    });
  });

  it("trims an upsert's create and update alike", () => {
    assert.deepEqual(
      trimWriteArgs({ where: { id: " keep " }, create: { name: " a " }, update: { name: " b " } }),
      { where: { id: " keep " }, create: { name: "a" }, update: { name: "b" } }
    );
  });

  it("leaves every read-side argument alone", () => {
    const args = {
      where: { name: "  spaced  " },
      select: { name: true },
      orderBy: { name: "asc" },
      cursor: { id: " x " },
      data: { name: " y " },
    };
    const out = trimWriteArgs(args) as typeof args;
    assert.deepEqual(out.where, { name: "  spaced  " });
    assert.deepEqual(out.cursor, { id: " x " });
    assert.deepEqual(out.data, { name: "y" });
  });

  it("walks into a nested create, and into a list of them", () => {
    assert.deepEqual(
      trimWriteArgs({
        data: {
          name: " parent ",
          translations: { create: [{ value: " one " }, { value: " two " }] },
          profile: { create: { bio: " b " } },
        },
      }),
      {
        data: {
          name: "parent",
          translations: { create: [{ value: "one" }, { value: "two" }] },
          profile: { create: { bio: "b" } },
        },
      }
    );
  });

  it("walks into a to-many update's data, and into connectOrCreate's create", () => {
    assert.deepEqual(
      trimWriteArgs({
        data: {
          lines: { update: { where: { id: " x " }, data: { note: " n " } } },
          tag: { connectOrCreate: { where: { name: " t " }, create: { name: " t " } } },
        },
      }),
      {
        data: {
          lines: { update: { where: { id: " x " }, data: { note: "n" } } },
          tag: { connectOrCreate: { where: { name: " t " }, create: { name: "t" } } },
        },
      }
    );
  });

  it("trims the long form of writing a scalar", () => {
    assert.deepEqual(trimWriteArgs({ data: { name: { set: " a " } } }), {
      data: { name: { set: "a" } },
    });
  });

  it("does not reach inside a Json column's value", () => {
    // `AlbumPrintedPage.snapshot` is compared against a freshly computed one by
    // `album-divergence.ts`; a string trimmed here would report the card as diverged forever.
    const snapshot = { boxes: [{ text: "  wrapped line  " }], preset: { name: " p " } };
    const out = trimWriteArgs({ data: { snapshot, printedAt: new Date(0) } }) as {
      data: { snapshot: unknown };
    };
    assert.deepEqual(out.data.snapshot, snapshot);
  });

  it("leaves a Decimal, a Date and a Buffer by reference", () => {
    const date = new Date(0);
    const bytes = Buffer.from("x");
    const out = trimWriteArgs({ data: { at: date, bytes, name: " n " } }) as {
      data: { at: Date; bytes: Buffer };
    };
    assert.equal(out.data.at, date);
    assert.equal(out.data.bytes, bytes);
  });

  it("gives back the very object it was handed when nothing needed trimming", () => {
    const args = { data: { name: "Poland" } };
    assert.equal(trimWriteArgs(args), args);
  });

  it("turns a value of nothing but whitespace into the empty string, and no further", () => {
    // `''` is a statement of its own for `CollectionAreaVendor.areaPrefix` (`area-prefix.ts`);
    // the rule stops at making *typed spaces* and *empty* the same thing.
    assert.deepEqual(trimWriteArgs({ data: { areaPrefix: "   " } }), {
      data: { areaPrefix: "" },
    });
  });

  it("names every operation that writes", () => {
    for (const op of ["create", "createMany", "update", "updateMany", "upsert"]) {
      assert.ok(WRITING_OPERATIONS.has(op), `${op} writes`);
    }
    for (const op of ["findMany", "findUnique", "count", "aggregate", "delete", "deleteMany"]) {
      assert.ok(!WRITING_OPERATIONS.has(op), `${op} carries nothing typed`);
    }
  });
});

describe("the schema this rule was reasoned about", () => {
  const schema = readFileSync(SCHEMA, "utf8");

  it("still holds exactly the Json columns the rule steps around", () => {
    // Each of these holds an object of the app's own making rather than typed prose, which is why
    // `trimWriteArgs` descends only through Prisma's own write operators. A new one means reading
    // `prisma-text-trim.ts` again and deciding whether that is still true of it.
    const found = [...schema.matchAll(/^\s+(\w+)\s+Json\??/gm)].map((m) => m[1]).sort();
    assert.deepEqual(found, ["allegroCategoryParameters", "rates", "snapshot", "value"]);
  });

  it("has no column named like a Prisma write operator", () => {
    // The operator test is what tells an instruction from a `Json` value. A column called `data` or
    // `where` would make a single-column write look like an instruction and be walked as one.
    const operators =
      "create|createMany|connectOrCreate|connect|disconnect|delete|deleteMany|update|" +
      "updateMany|upsert|set|push|increment|decrement|multiply|divide|where|data|skipDuplicates";
    const clashes = [...schema.matchAll(new RegExp(`^\\s+(${operators})\\s+\\S`, "gm"))].map(
      (m) => m[1]
    );
    assert.deepEqual(clashes, []);
  });

  it("holds no String[] column that could carry prose", () => {
    // An array under a column's name is left alone, because it is either a `Json` array or one of
    // these. All of them hold ids, which have no whitespace to remove.
    const found = [...schema.matchAll(/^\s+(\w+)\s+String\[\]/gm)].map((m) => m[1]).sort();
    assert.deepEqual(found, [
      "conditionIds",
      "formatIds",
      "itemIds",
      "photoPlanOrder",
      "photoPlanUnpublished",
      "setIds",
    ]);
  });
});
