import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDelcampeCategoryTree,
  diffDelcampeCategories,
  decodeEntities,
  delcampeCategoryAncestorIds,
  delcampeCategoryRow,
  expandableDelcampeCategoryIds,
  filterDelcampeCategoryTree,
  parseDelcampeCategoryPage,
} from "../../src/lib/delcampe-category-catalog-rules";

// Reading Delcampe's published category list (#609; ADR-0035 §4).
//
// The markup below is trimmed from the real pages — `…/category-id/stamps/europe/` and
// `…/category-id/stamps/poland/` — and keeps the three shapes that decide everything: a leaf with an
// id, a link with no children rendered, and a link whose children *are* rendered underneath it.
//
// That third shape is why this file exists. Delcampe's country pages inline their whole subtree, so
// following those links returns rows the page already gave; a walk that follows them anyway is four
// times the requests against somebody else's site for no new data.

const li = (inner: string) => `<li>\n  <span class="flex space-sm v-center">${inner}</span>`;
const leaf = (name: string, id: string) =>
  li(`<span>${name}</span><div><span class="label-blue-light font-xs">#${id}</span></div>`) + "</li>";
const link = (href: string, name: string) => li(`<a href="${href}" title="${name}">${name}</a>`) + "</li>";
const expanded = (href: string, name: string, children: string) =>
  li(`<a href="${href}" title="${name}">${name}</a>`) +
  `<ul class="nls category-bloc">${children}</ul></li>`;

const page = (children: string) =>
  `<header>…<span>Not the list</span>…</header>` +
  `<ul class="nls category-bloc">${children}</ul>` +
  `<footer>…</footer>`;

describe("parseDelcampeCategoryPage", () => {
  it("reads a category from a node that carries an id", () => {
    const { entries } = parseDelcampeCategoryPage(page(leaf("Aland", "1245")));
    assert.deepEqual(entries, [{ id: "1245", name: "Aland", trail: [] }]);
  });

  it("ignores everything outside the list, so page chrome cannot become a category", () => {
    const { entries } = parseDelcampeCategoryPage(page(leaf("Aland", "1245")));
    assert.equal(entries.length, 1);
  });

  it("reports a link whose children were not rendered — that page still has to be read", () => {
    const { entries, links } = parseDelcampeCategoryPage(
      page(link("/en_GB/collectables/category-id/stamps/poland/", "Poland"))
    );
    assert.deepEqual(entries, []);
    assert.deepEqual(links, [
      { href: "/en_GB/collectables/category-id/stamps/poland/", name: "Poland", trail: [] },
    ]);
  });

  it("does NOT report a link whose children are right there — fetching it would re-read this page", () => {
    const { entries, links } = parseDelcampeCategoryPage(
      page(
        expanded(
          "/en_GB/collectables/category-id/stamps/poland/1919-1939/",
          "1919-1939 Republic",
          leaf("Used stamps", "7945") + leaf("Unused stamps", "7936")
        )
      )
    );
    assert.deepEqual(links, []);
    assert.deepEqual(entries, [
      { id: "7945", name: "Used stamps", trail: ["1919-1939 Republic"] },
      { id: "7936", name: "Unused stamps", trail: ["1919-1939 Republic"] },
    ]);
  });

  it("keeps the nesting, which is the only thing telling two `Used stamps` apart", () => {
    const { entries } = parseDelcampeCategoryPage(
      page(
        expanded(
          "/a/",
          "1919-1939 Republic",
          leaf("Used stamps", "7945")
        ) +
          expanded(
            "/b/",
            "1944-.... Republic",
            expanded("/b/1/", "1944-60", leaf("Used stamps", "7946"))
          )
      )
    );
    assert.deepEqual(
      entries.map((entry) => delcampeCategoryRow(entry, ["Stamps", "Europe", "Poland"])),
      [
        {
          id: "7945",
          name: "Used stamps",
          path: "Stamps > Europe > Poland > 1919-1939 Republic > Used stamps",
        },
        {
          id: "7946",
          name: "Used stamps",
          path: "Stamps > Europe > Poland > 1944-.... Republic > 1944-60 > Used stamps",
        },
      ]
    );
  });

  it("decodes the entities Delcampe's own names carry", () => {
    const { entries } = parseDelcampeCategoryPage(page(leaf("Covers &amp; Documents", "7953")));
    assert.equal(entries[0].name, "Covers & Documents");
    assert.equal(decodeEntities("Blocks &amp; sheetlets"), "Blocks & sheetlets");
  });

  it("says nothing rather than throwing on a page that is not the list", () => {
    // A sign-in wall, an error page, a redirect that landed elsewhere. The refresh has to carry on
    // past one of these — and must never read it as "the tree is now empty".
    assert.deepEqual(parseDelcampeCategoryPage("<html><body>Not found</body></html>"), {
      entries: [],
      links: [],
    });
  });
});

describe("buildDelcampeCategoryTree", () => {
  const rows = [
    { id: "7945", name: "Used stamps", path: "Stamps > Europe > Poland > 1919-1939 Republic > Used stamps" },
    { id: "7946", name: "Used stamps", path: "Stamps > Europe > Poland > 1944-.... Republic > 1944-60 > Used stamps" },
    { id: "7938", name: "Unused stamps", path: "Stamps > Europe > Poland > 1961-70 > Unused stamps" },
    { id: "7923", name: "Occupations", path: "Stamps > Europe > Poland > Occupations" },
    { id: "7925", name: "General Government", path: "Stamps > Europe > Poland > Occupations > General Government" },
    { id: "24678", name: "Unused stamps", path: "Stamps > Europe > Saar > Unused stamps" },
  ];
  const tree = buildDelcampeCategoryTree(rows);
  const poland = tree[0].children[0].children[0];

  it("puts the headings the path passes through above the categories", () => {
    assert.equal(tree.length, 1);
    assert.equal(tree[0].name, "Stamps");
    // A heading is not a category: nothing can be uploaded into `Stamps > Europe`, and the picker
    // must not offer it.
    assert.equal(tree[0].categoryId, null);
    assert.equal(poland.name, "Poland");
    assert.equal(poland.categoryId, null);
    assert.deepEqual(
      poland.children.map((node) => node.name),
      ["1919-1939 Republic", "1944-.... Republic", "1961-70", "Occupations"]
    );
  });

  it("lets a node be listable *and* a parent — which Delcampe's own tree does", () => {
    const occupations = poland.children.find((node) => node.name === "Occupations");
    assert.equal(occupations?.categoryId, "7923");
    assert.deepEqual(
      occupations?.children.map((node) => node.categoryId),
      ["7925"]
    );
  });

  it("identifies a node by its path, the only thing unique about it", () => {
    // `Used stamps` names hundreds of nodes and a heading has no id at all.
    assert.equal(
      poland.children[0].children[0].id,
      "Stamps > Europe > Poland > 1919-1939 Republic > Used stamps"
    );
  });
});

describe("filterDelcampeCategoryTree", () => {
  const rows = [
    { id: "7945", name: "Used stamps", path: "Stamps > Europe > Poland > 1919-1939 Republic > Used stamps" },
    { id: "7936", name: "Unused stamps", path: "Stamps > Europe > Poland > 1919-1939 Republic > Unused stamps" },
    { id: "24678", name: "Unused stamps", path: "Stamps > Europe > Saar > Unused stamps" },
  ];
  const tree = buildDelcampeCategoryTree(rows);

  /** Every category id the filtered tree still reaches, so a test can state an outcome without
   *  walking four levels of nesting by hand. */
  function ids(nodes: ReturnType<typeof buildDelcampeCategoryTree>): string[] {
    return nodes.flatMap((node) => [...(node.categoryId ? [node.categoryId] : []), ...ids(node.children)]);
  }

  it("keeps the ancestors of a match, so the result still reads as a tree", () => {
    const filtered = filterDelcampeCategoryTree(tree, "saar");
    assert.deepEqual(filtered.map((node) => node.name), ["Stamps"]);
    assert.deepEqual(ids(filtered), ["24678"]);
  });

  it("keeps a matched node's whole subtree — a country query means the country", () => {
    // Alphabetical within a level, so `Unused stamps` leads `Used stamps`.
    assert.deepEqual(ids(filterDelcampeCategoryTree(tree, "poland")), ["7936", "7945"]);
  });

  it("does not answer `used` with the unused ones — the split this tree is built on", () => {
    // `Unused stamps` contains `used`. A substring search would return every unused category of
    // every country for the one query a stamp seller types most.
    assert.deepEqual(ids(filterDelcampeCategoryTree(tree, "used")), ["7945"]);
  });

  it("matches on word starts, so half a country's name is enough", () => {
    assert.deepEqual(ids(filterDelcampeCategoryTree(tree, "pol unused")), ["7936"]);
  });

  it("matches a bare category id outright", () => {
    assert.deepEqual(ids(filterDelcampeCategoryTree(tree, "24678")), ["24678"]);
  });

  it("is the whole tree for an empty term", () => {
    assert.deepEqual(ids(filterDelcampeCategoryTree(tree, "  ")), ids(tree));
  });
});

describe("expanding the tree", () => {
  const tree = buildDelcampeCategoryTree([
    { id: "7945", name: "Used stamps", path: "Stamps > Europe > Poland > 1919-1939 Republic > Used stamps" },
  ]);

  it("expands every node that has children, so a search never hides its own matches", () => {
    assert.deepEqual([...expandableDelcampeCategoryIds(tree)], [
      "Stamps",
      "Stamps > Europe",
      "Stamps > Europe > Poland",
      "Stamps > Europe > Poland > 1919-1939 Republic",
    ]);
  });

  it("opens on a chosen category in place, not at the top of a collapsed tree", () => {
    assert.deepEqual(
      [...delcampeCategoryAncestorIds("Stamps > Europe > Poland > 1919-1939 Republic > Used stamps")],
      [
        "Stamps",
        "Stamps > Europe",
        "Stamps > Europe > Poland",
        "Stamps > Europe > Poland > 1919-1939 Republic",
      ]
    );
  });
});

describe("diffDelcampeCategories", () => {
  const before = [
    { id: "7945", name: "Used stamps", path: "Stamps > Europe > Poland > 1919-1939 > Used stamps" },
    { id: "7936", name: "Unused stamps", path: "Stamps > Europe > Poland > 1919-1939 > Unused stamps" },
    { id: "9999", name: "Gone", path: "Stamps > Europe > Nowhere > Gone" },
  ];

  it("counts what arrived, what went, and what moved", () => {
    const after = [
      // unchanged
      before[0],
      // renamed in place — the same category, said differently
      { ...before[1], name: "Mint stamps" },
      // new
      { id: "7911", name: "Blocks", path: "Stamps > Europe > Poland > Blocks" },
    ];
    assert.deepEqual(diffDelcampeCategories(before, after, true), {
      added: 1,
      removed: 1,
      changed: 1,
      unchanged: 1,
    });
  });

  it("counts a category moved elsewhere in the tree as changed, not as added and removed", () => {
    const after = [
      { ...before[0], path: "Stamps > Europe > Poland > Second Republic > Used stamps" },
      before[1],
      before[2],
    ];
    const changes = diffDelcampeCategories(before, after, true);
    assert.equal(changes.changed, 1);
    assert.equal(changes.added, 0);
    assert.equal(changes.removed, 0);
  });

  it("never reports a removal from an incomplete pass", () => {
    // A walk cut short saw a subset, so every category it did not reach would look retired — which
    // is also exactly why nothing is deleted on one. The count and the write agree.
    assert.deepEqual(diffDelcampeCategories(before, [before[0]], false), {
      added: 0,
      removed: 0,
      changed: 0,
      unchanged: 1,
    });
  });
});
