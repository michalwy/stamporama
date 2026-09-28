import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chooseKind,
  effectiveKinds,
  levelsToReorder,
  parseVariantTreeText,
  resolveVariantTree,
  shiftLines,
  variantPathKey,
  variantTreeToText,
  VARIANT_TREE_MAX_STAMPS,
  type ExistingVariant,
  type VariantTreeNode,
} from "../../src/lib/variant-tree";

// A stamp's variant tree typed as indented text (#1447).

/** The collector's own example: one watermark with three perforations and colours under two of
 *  them, the other watermark with none. */
const IRREGULAR = ["X", "  A", "    a", "    b", "  B", "  C", "    a", "Y"].join("\n");

/** The tree as `number status` lines, indented by depth — what the preview draws. */
function draw(nodes: readonly VariantTreeNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${"  ".repeat(depth)}${n.number} ${n.status}`,
    ...draw(n.children, depth + 1),
  ]);
}

function stored(stampId: string, number: string | null, children: ExistingVariant[] = [], subtypeId: string | null = null): ExistingVariant {
  return { stampId, number, subtypeId, children };
}

describe("parseVariantTreeText (#1447)", () => {
  it("reads each line's level from its indentation", () => {
    const { lines, problems } = parseVariantTreeText(IRREGULAR);
    assert.deepEqual(problems, []);
    assert.deepEqual(
      lines.map((l) => [l.level, l.suffix]),
      [[0, "X"], [1, "A"], [2, "a"], [2, "b"], [1, "B"], [1, "C"], [2, "a"], [0, "Y"]]
    );
  });

  it("reads tabs and four-space indentation the same as two spaces", () => {
    const levels = (t: string) => parseVariantTreeText(t).lines.map((l) => l.level);
    assert.deepEqual(levels("X\n\tA\n\t\ta\nY"), [0, 1, 2, 0]);
    assert.deepEqual(levels("X\n    A\n        a\nY"), [0, 1, 2, 0]);
  });

  it("ignores blank lines and the whitespace around a suffix", () => {
    const { lines } = parseVariantTreeText("X  \n\n   \n  A\r\n");
    assert.deepEqual(
      lines.map((l) => [l.line, l.level, l.suffix]),
      [[1, 0, "X"], [4, 1, "A"]]
    );
  });

  it("reports a line indented more than one level below the line above", () => {
    const { lines, problems } = parseVariantTreeText("X\n    a\n  A");
    // Two spaces is the level here (the first indentation is four, so `  A` does not line up).
    assert.deepEqual(problems.map((p) => p.line), [3]);

    const skip = parseVariantTreeText("X\n  A\n      a");
    assert.deepEqual(skip.problems, [
      { line: 3, message: "It is indented more than one level below the line above." },
    ]);
    // Still drawn, one level down, so the preview has something to show.
    assert.equal(skip.lines[2].level, 2);
    assert.equal(lines.length, 3);
  });

  it("reports a first line that is indented", () => {
    assert.deepEqual(parseVariantTreeText("  X").problems.map((p) => p.line), [1]);
  });

  it("reports an indentation that lines up with no level", () => {
    const { problems } = parseVariantTreeText("X\n  A\n   a");
    assert.deepEqual(problems, [
      { line: 3, message: "Its indentation does not line up with a level." },
    ]);
  });
});

describe("resolveVariantTree (#1447)", () => {
  it("numbers every variant as its parent's number with its suffix appended", () => {
    const tree = resolveVariantTree(IRREGULAR, [], "123");
    assert.deepEqual(draw(tree.roots), [
      "123X new",
      "  123XA new",
      "    123XAa new",
      "    123XAb new",
      "  123XB new",
      "  123XC new",
      "    123XCa new",
      "123Y new",
    ]);
    assert.deepEqual(tree.problems, []);
    // Each after its parent, so a write can hang every line off an id it already has.
    assert.deepEqual(
      tree.created.map((n) => n.number),
      ["123X", "123XA", "123XAa", "123XAb", "123XB", "123XC", "123XCa", "123Y"]
    );
  });

  it("reports a suffix repeated among siblings, and only there", () => {
    const tree = resolveVariantTree("A\n  a\nB\n  a\nA", [], "9");
    assert.deepEqual(tree.problems, [{ line: 5, message: "The suffix A is already used at this level." }]);
  });

  it("matches lines to the stored variants and creates only the rest", () => {
    const existing = [stored("x", "123X", [stored("xa", "123XA", [], "perf")], "wmk")];
    const tree = resolveVariantTree(IRREGULAR, existing, "123");
    assert.deepEqual(draw(tree.roots), [
      "123X existing",
      "  123XA existing",
      "    123XAa new",
      "    123XAb new",
      "  123XB new",
      "  123XC new",
      "    123XCa new",
      "123Y new",
    ]);
    assert.equal(tree.created.length, 6);
    assert.equal(tree.roots[0].stampId, "x");
    assert.equal(tree.roots[0].subtypeId, "wmk");
  });

  it("keeps a stored variant no line names, where it stood, with everything under it", () => {
    const existing = [
      stored("a", "1a"),
      stored("b", "1b", [stored("b1", "1bI")]),
      stored("c", "1c"),
    ];
    const tree = resolveVariantTree("a\nc\nd", existing, "1");
    assert.deepEqual(draw(tree.roots), [
      "1a existing",
      "1b kept",
      "  1bI kept",
      "1c existing",
      "1d new",
    ]);
  });

  it("keeps a stored variant whose number does not follow its parent's", () => {
    const existing = [stored("odd", "124"), stored("none", null)];
    const tree = resolveVariantTree("a", existing, "123");
    assert.deepEqual(draw(tree.roots), ["124 kept", "null kept", "123a new"]);
  });

  it("refuses every suffix under a stamp with no number in the catalogue", () => {
    const tree = resolveVariantTree("a\nb", [stored("x", "9x")], "");
    assert.equal(tree.problems.length, 1);
    assert.deepEqual(draw(tree.roots), ["9x kept"]);
  });

  it("refuses more new variants than one write takes", () => {
    const text = Array.from({ length: VARIANT_TREE_MAX_STAMPS + 1 }, (_, i) => `v${i}`).join("\n");
    const tree = resolveVariantTree(text, [], "1");
    assert.equal(tree.problems.length, 1);
    assert.equal(tree.problems[0].line, VARIANT_TREE_MAX_STAMPS + 1);
  });
});

describe("variantTreeToText (#1447)", () => {
  it("writes the stored tree as the suffixes, indented, and reads back to the same tree", () => {
    const existing = [
      stored("x", "123X", [stored("xa", "123XA", [stored("xaa", "123XAa")]), stored("xb", "123XB")]),
      stored("y", "123Y"),
    ];
    const text = variantTreeToText(existing, "123");
    assert.equal(text, "X\n  A\n    a\n  B\nY");
    const tree = resolveVariantTree(text, existing, "123");
    assert.equal(tree.created.length, 0);
    assert.ok(draw(tree.roots).every((line) => line.endsWith(" existing")));
  });

  it("leaves out a variant with no suffix to write, and everything under it", () => {
    const existing = [stored("odd", "124", [stored("odda", "124a")]), stored("a", "123a")];
    assert.equal(variantTreeToText(existing, "123"), "a");
  });
});

describe("kinds chosen in the preview (#1447)", () => {
  const tree = () => resolveVariantTree(IRREGULAR, [], "123").roots;
  const key = (...s: string[]) => variantPathKey(s);

  it("fills the siblings that have no kind yet, and nothing else", () => {
    const roots = tree();
    const choices = chooseKind(roots, {}, key("X", "A"), "perf");
    const kinds = effectiveKinds(roots, choices);
    assert.equal(kinds.get(key("X", "A")), "perf");
    assert.equal(kinds.get(key("X", "B")), "perf");
    assert.equal(kinds.get(key("X", "C")), "perf");
    assert.equal(kinds.get(key("X")), null);
    assert.equal(kinds.get(key("X", "A", "a")), null);
  });

  it("lets each sibling be changed on its own afterwards", () => {
    const roots = tree();
    let choices = chooseKind(roots, {}, key("X", "A"), "perf");
    choices = chooseKind(roots, choices, key("X", "B"), "colour");
    const kinds = effectiveKinds(roots, choices);
    assert.equal(kinds.get(key("X", "A")), "perf");
    assert.equal(kinds.get(key("X", "B")), "colour");
    assert.equal(kinds.get(key("X", "C")), "perf");
  });

  it("keeps the kinds while the lines keep their place, and gives a new line its siblings' kind", () => {
    const choices = chooseKind(tree(), {}, key("X", "A"), "perf");
    // A line inserted above them all, and one added to the perforations' level.
    const edited = resolveVariantTree(`W\n${IRREGULAR.replace("  B", "  B\n  D")}`, [], "123");
    const kinds = effectiveKinds(edited.roots, choices);
    assert.equal(kinds.get(key("X", "A")), "perf");
    assert.equal(kinds.get(key("X", "D")), "perf");
    assert.equal(kinds.get(key("W")), null);
  });

  it("takes a stored sibling's kind for a line added beside it", () => {
    const existing = [stored("a", "1a", [], "colour")];
    const roots = resolveVariantTree("a\nb", existing, "1").roots;
    assert.equal(effectiveKinds(roots, {}).get(key("b")), "colour");
  });

  it("keeps the default when it is chosen on purpose", () => {
    const roots = tree();
    let choices = chooseKind(roots, {}, key("X", "A"), "perf");
    choices = chooseKind(roots, choices, key("X", "B"), "");
    assert.equal(effectiveKinds(roots, choices).get(key("X", "B")), null);
  });
});

describe("levelsToReorder (#1447, #549)", () => {
  const existing = [stored("a", "1a"), stored("c", "1c", [stored("c1", "1cI"), stored("c2", "1cII")])];
  const order = new Map<string, string[]>([
    ["root", ["a", "c"]],
    ["a", []],
    ["c", ["c1", "c2"]],
    ["c1", []],
    ["c2", []],
  ]);
  const levels = (text: string) =>
    levelsToReorder(resolveVariantTree(text, existing, "1").roots, "root", order).map((l) => [
      l.parent?.number ?? "root",
      l.children.map((c) => c.number),
    ]);

  it("answers nothing for the text it opened on", () => {
    assert.deepEqual(levels("a\nc\n  I\n  II"), []);
  });

  it("answers nothing when a line is only removed", () => {
    assert.deepEqual(levels("c\n  II"), []);
  });

  it("answers a level that gains a variant, in the lines' order", () => {
    assert.deepEqual(levels("a\nb\nc\n  I\n  II"), [["root", ["1a", "1b", "1c"]]]);
  });

  it("answers a level the text reorders, and a new level under a new variant", () => {
    assert.deepEqual(levels("c\n  II\n  I\na\n  x"), [
      ["root", ["1c", "1a"]],
      ["1c", ["1cII", "1cI"]],
      ["1a", ["1ax"]],
    ]);
  });
});

describe("shiftLines — Tab and Shift+Tab (#1447)", () => {
  it("indents the current line and moves the caret with it", () => {
    assert.deepEqual(shiftLines("X\nA\nY", 3, 3, "indent"), {
      text: "X\n  A\nY",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it("outdents the current line", () => {
    assert.deepEqual(shiftLines("X\n  A\nY", 5, 5, "outdent"), {
      text: "X\nA\nY",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("indents by the text's own unit", () => {
    assert.equal(shiftLines("X\n\tA\nB", 6, 6, "indent").text, "X\n\tA\n\tB");
    assert.equal(shiftLines("X\n    A\nB", 9, 9, "indent").text, "X\n    A\n    B");
  });

  it("shifts every line a selection touches", () => {
    assert.deepEqual(shiftLines("X\nA\nB\nY", 2, 5, "indent"), {
      text: "X\n  A\n  B\nY",
      selectionStart: 4,
      selectionEnd: 9,
    });
  });

  it("leaves a line with no indentation as it is on outdent", () => {
    assert.equal(shiftLines("X\nA", 3, 3, "outdent").text, "X\nA");
  });
});
