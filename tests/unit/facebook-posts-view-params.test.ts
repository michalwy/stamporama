import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  POSTS_VIEW_DEFAULTS,
  POSTS_VIEW_PARAMS,
  postsViewClearUpdates,
  postsViewNarrowings,
  postsViewUpdatesFor,
  postsViewUrlUpdates,
  pruneStoredGroups,
  resolvePostsView,
  type PostsView,
} from "../../src/app/c/[collectionSlug]/offers/posts/posts-view-params";

// The list of Facebook posts' toolbar as a value (#2108): what the address and the memory resolve to,
// what a press writes, what the band announces, and what the mirror puts back into the address.

function reader(params: Record<string, string>): (key: string) => string | null {
  return (key) => (key in params ? params[key] : null);
}

function view(patch: Partial<PostsView> = {}): PostsView {
  return { ...POSTS_VIEW_DEFAULTS, ...patch };
}

describe("POSTS_VIEW_PARAMS", () => {
  it("keeps the names the address used before #2108", () => {
    assert.deepEqual([...POSTS_VIEW_PARAMS].sort(), ["group", "stage", "untitled"]);
  });
});

describe("resolvePostsView", () => {
  it("reads nothing as every post", () => {
    assert.deepEqual(resolvePostsView(reader({})), POSTS_VIEW_DEFAULTS);
  });

  it("reads every filter", () => {
    assert.deepEqual(resolvePostsView(reader({ group: "g1, g2,,g1", stage: "up", untitled: "1" })), {
      groups: ["g1", "g2"],
      stage: "up",
      untitled: true,
    });
  });

  it("drops an unknown stage rather than narrowing to nothing", () => {
    assert.equal(resolvePostsView(reader({ stage: "bogus" })).stage, undefined);
    assert.equal(resolvePostsView(reader({ untitled: "yes" })).untitled, false);
  });
});

describe("pruneStoredGroups", () => {
  it("drops the groups that hold no post any more", () => {
    assert.equal(pruneStoredGroups("g1,gone", new Set(["g1"])), "g1");
  });

  it("answers null where nothing is left", () => {
    assert.equal(pruneStoredGroups("gone", new Set(["g1"])), null);
    assert.equal(pruneStoredGroups(null, new Set(["g1"])), null);
  });
});

describe("postsViewUpdatesFor", () => {
  it("writes only the keys named", () => {
    assert.deepEqual(postsViewUpdatesFor({ stage: "ready" }), { stage: "ready" });
    assert.deepEqual(postsViewUpdatesFor({ groups: ["a", "b"] }), { group: "a,b" });
    assert.deepEqual(postsViewUpdatesFor({ untitled: true }), { untitled: "1" });
  });

  it("clears with an empty value, so the memory is cleared with the address", () => {
    assert.deepEqual(postsViewUpdatesFor({ stage: undefined, untitled: false, groups: [] }), {
      group: "",
      stage: "",
      untitled: "",
    });
  });
});

describe("postsViewNarrowings and postsViewClearUpdates", () => {
  it("names nothing on the default view", () => {
    assert.deepEqual(postsViewNarrowings(view()), []);
  });

  it("names every filter in force, in toolbar order", () => {
    assert.deepEqual(postsViewNarrowings(view({ groups: ["g"], stage: "over", untitled: true })), [
      { key: "groups", value: ["g"] },
      { key: "stage", value: "over" },
      { key: "untitled" },
    ]);
  });

  it("clears every param the band can announce", () => {
    assert.deepEqual(postsViewClearUpdates(), { group: "", stage: "", untitled: "" });
  });
});

describe("postsViewUrlUpdates", () => {
  it("writes nothing for a list nobody has narrowed", () => {
    assert.equal(postsViewUrlUpdates(view(), reader({})), null);
  });

  it("writes nothing where the address already says it", () => {
    assert.equal(postsViewUrlUpdates(view({ stage: "up" }), reader({ stage: "up" })), null);
  });

  it("writes back a restored filter the address lacks", () => {
    assert.deepEqual(postsViewUrlUpdates(view({ groups: ["g1"], untitled: true }), reader({})), {
      group: "g1",
      untitled: "1",
    });
  });
});
