import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findLinkTab,
  linkTabFinished,
  pruneLinkTabs,
  upsertLinkTab,
  withoutLinkTab,
  type LinkTab,
} from "./link-tabs";

// Only the list operations and the one decision are covered: the storage calls need a chrome.storage
// double, while these are what decides whether a tab the Assistant opened for a Link is closed (#1380).

const HOUR = 60 * 60 * 1000;

const link = (over: Partial<LinkTab> = {}): LinkTab => ({
  tabId: 41,
  instanceTabId: 12,
  stampId: "s_1",
  openedAt: 0,
  ...over,
});

describe("linkTabFinished", () => {
  it("finishes on a match written for the stamp the Link was pressed on", () => {
    assert.equal(linkTabFinished(link(), ["s_1"]), true);
    assert.equal(linkTabFinished(link(), ["s_9", "s_1"]), true);
  });

  it("keeps the tab open when Write only linked a neighbour on the same search page", () => {
    assert.equal(linkTabFinished(link(), ["s_9"]), false);
  });

  it("keeps the tab open when nothing was written at all", () => {
    assert.equal(linkTabFinished(link(), []), false);
    assert.equal(linkTabFinished(link({ stampId: null }), []), false);
  });

  it("takes the first match written where the page named no stamp", () => {
    assert.equal(linkTabFinished(link({ stampId: null }), ["s_9"]), true);
  });
});

describe("pruneLinkTabs", () => {
  it("keeps a search opened hours ago and drops one from another day", () => {
    const list = [link({ tabId: 1, openedAt: 0 }), link({ tabId: 2, openedAt: -30 * HOUR })];
    assert.deepEqual(
      pruneLinkTabs(list, 2 * HOUR).map((t) => t.tabId),
      [1]
    );
  });
});

describe("the record list", () => {
  it("holds one Link per tab, the latest replacing the earlier", () => {
    const list = upsertLinkTab([link({ stampId: "s_1" })], link({ stampId: "s_2" }));
    assert.equal(list.length, 1);
    assert.equal(findLinkTab(list, 41)?.stampId, "s_2");
  });

  it("finds nothing for a tab the Assistant never opened", () => {
    assert.equal(findLinkTab([link()], 7), null);
  });

  it("forgets one tab and leaves the others", () => {
    const list = [link({ tabId: 1 }), link({ tabId: 2 })];
    assert.deepEqual(
      withoutLinkTab(list, 1).map((t) => t.tabId),
      [2]
    );
  });
});
