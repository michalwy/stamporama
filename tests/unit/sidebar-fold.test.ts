import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSidebarFoldShortcut,
  isSidebarFolded,
  parseSidebarFold,
  serializeSidebarFold,
} from "../../src/app/c/[collectionSlug]/sidebar-fold";
import { SECTION_ICONS, SECTION_LABELS } from "../../src/app/c/[collectionSlug]/nav-sections";
import { SECTION_ORDER } from "../../src/app/c/[collectionSlug]/nav-entries";

// The sidebar folded to its icon rail (#2505): whether it is folded, and the shortcut that folds it.

describe("sidebar fold state (#2505)", () => {
  it("reads back only a choice it wrote, anything else being no choice", () => {
    assert.equal(parseSidebarFold(serializeSidebarFold(true)), true);
    assert.equal(parseSidebarFold(serializeSidebarFold(false)), false);
    assert.equal(parseSidebarFold(null), null);
    assert.equal(parseSidebarFold("true"), null);
    assert.equal(parseSidebarFold(""), null);
  });

  it("folds by itself in a narrow window while nothing is chosen", () => {
    assert.equal(isSidebarFolded(null, true), true);
    assert.equal(isSidebarFolded(null, false), false);
  });

  it("keeps an explicit choice at every width", () => {
    assert.equal(isSidebarFolded(false, true), false);
    assert.equal(isSidebarFolded(true, false), true);
  });
});

describe("sidebar fold shortcut (#2505)", () => {
  const key = { key: "\\", code: "Backslash", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it("is ⌘\\ or Ctrl+\\", () => {
    assert.ok(isSidebarFoldShortcut({ ...key, metaKey: true }));
    assert.ok(isSidebarFoldShortcut({ ...key, ctrlKey: true }));
  });

  it("goes by the key's position where a layout types something else on it", () => {
    assert.ok(isSidebarFoldShortcut({ ...key, key: "ś", metaKey: true }));
  });

  it("is not the bare key, nor a chord with Shift or Alt", () => {
    assert.ok(!isSidebarFoldShortcut(key));
    assert.ok(!isSidebarFoldShortcut({ ...key, metaKey: true, shiftKey: true }));
    assert.ok(!isSidebarFoldShortcut({ ...key, ctrlKey: true, altKey: true }));
    assert.ok(!isSidebarFoldShortcut({ ...key, key: "k", code: "KeyK", metaKey: true }));
  });
});

describe("sidebar rail sections (#2505)", () => {
  it("gives every section an icon of its own", () => {
    const icons = SECTION_ORDER.map((k) => SECTION_ICONS[k]);
    assert.equal(new Set(icons).size, SECTION_ORDER.length);
    assert.deepEqual(Object.keys(SECTION_ICONS).sort(), Object.keys(SECTION_LABELS).sort());
  });
});
