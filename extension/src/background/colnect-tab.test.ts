import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { colnectTab } from "./colnect-tab";

// #1292: a Colnect tab open from before the Assistant was loaded has no content script, and a message
// to it has nobody to answer. What is asserted is that no tab is handed back without the script having
// been put into it — through a `chrome` double holding only the calls `colnectTab` makes.

interface FakeTab {
  id?: number;
  status?: string;
  discarded?: boolean;
}

function installChrome(open: FakeTab[], refuse: number[] = []) {
  const seen = { injected: [] as number[], created: 0 };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      query: async () => open,
      create: async () => {
        seen.created += 1;
        return { id: 99, status: "loading" };
      },
      get: async (id: number) => ({ id, status: "complete" }),
      onUpdated: { addListener() {}, removeListener() {} },
    },
    scripting: {
      executeScript: async ({ target }: { target: { tabId: number } }) => {
        if (refuse.includes(target.tabId)) throw new Error("Cannot access contents of the page.");
        seen.injected.push(target.tabId);
        return [];
      },
    },
  };
  return seen;
}

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe("colnectTab (#1292)", () => {
  it("puts the content script into a Colnect tab that was already open", async () => {
    const seen = installChrome([{ id: 5, status: "complete" }]);
    assert.equal(await colnectTab(), 5);
    assert.deepEqual(seen.injected, [5]);
    assert.equal(seen.created, 0);
  });

  it("passes over a discarded tab, which has no document to run in", async () => {
    const seen = installChrome([
      { id: 5, status: "unloaded", discarded: true },
      { id: 6, status: "complete" },
    ]);
    assert.equal(await colnectTab(), 6);
    assert.deepEqual(seen.injected, [6]);
  });

  it("opens a new tab when no open one will take the script", async () => {
    const seen = installChrome([{ id: 5, status: "complete" }], [5]);
    assert.equal(await colnectTab(), 99);
    assert.deepEqual(seen.injected, [99]);
    assert.equal(seen.created, 1);
  });

  it("hands back no tab at all rather than one nothing is listening in", async () => {
    installChrome([], [99]);
    assert.equal(await colnectTab(), null);
  });
});
