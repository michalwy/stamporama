import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PAGE_SCROLL_LOCK_ATTRIBUTE,
  createPageScrollLock,
  type ScrollLockRoot,
} from "../../src/app/page-scroll-lock";

// **While a dialog is open, the page behind it never scrolls** (#1577). The lock is counted because
// dialogs nest, and it lives in the shared shell so that no dialog can forget it — both are checked
// here, together with the stylesheet rules that turn the attribute into a locked page.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../src");

function fakeRoot() {
  const attrs = new Map<string, string>();
  const root: ScrollLockRoot = {
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
  };
  return { root, locked: () => attrs.has(PAGE_SCROLL_LOCK_ATTRIBUTE) };
}

describe("createPageScrollLock", () => {
  it("locks the page while one surface holds it and unlocks it when that surface lets go", () => {
    const { root, locked } = fakeRoot();
    const lock = createPageScrollLock(() => root);
    assert.equal(locked(), false);
    const release = lock.acquire();
    assert.equal(locked(), true);
    release();
    assert.equal(locked(), false);
  });

  it("keeps the page locked under an outer dialog when the dialog opened from it closes", () => {
    const { root, locked } = fakeRoot();
    const lock = createPageScrollLock(() => root);
    const outer = lock.acquire();
    const inner = lock.acquire();
    inner();
    assert.equal(locked(), true);
    outer();
    assert.equal(locked(), false);
  });

  it("ignores a second release, so it cannot unlock a page another surface still holds", () => {
    const { root, locked } = fakeRoot();
    const lock = createPageScrollLock(() => root);
    const first = lock.acquire();
    const second = lock.acquire();
    first();
    first();
    assert.equal(locked(), true);
    assert.equal(lock.holders, 1);
    second();
    assert.equal(locked(), false);
  });
});

describe("where the lock is held", () => {
  it("DialogShell holds it, so every dialog does", () => {
    const shell = readFileSync(path.join(SRC, "app/dialog-shell.tsx"), "utf8");
    const body = shell.slice(shell.indexOf("export function DialogShell("));
    assert.match(body.slice(0, body.indexOf("return (")), /usePageScrollLock\(\)/);
  });

  it("the photo lightbox, which covers the page without the shell, holds it too", () => {
    const viewer = readFileSync(path.join(SRC, "app/photo-viewer.tsx"), "utf8");
    assert.match(viewer, /usePageScrollLock\(/);
  });

  it("the stylesheet locks the page on the attribute, keeps its width, and contains overlay scroll", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(css, new RegExp(`html\\[${PAGE_SCROLL_LOCK_ATTRIBUTE}\\]\\s*\\{\\s*overflow:\\s*hidden;`));
    assert.match(css, /html\s*\{\s*scrollbar-gutter:\s*stable;/);
    const contain = css.match(/([^{}]+)\{\s*overscroll-behavior:\s*contain;/);
    assert.ok(contain, "no overscroll-behavior: contain rule");
    for (const selector of ['[role="dialog"] *', '[role="listbox"]', '[role="menu"]']) {
      assert.ok(contain[1].includes(selector), `${selector} is not contained`);
    }
  });
});
