/**
 * Reading Delcampe's **published category list** (#609; ADR-0035 §4), kept pure.
 *
 * Delcampe's Easy Uploader file wants a numeric `category_id` and nothing else, and there is no API
 * to ask what `7945` is called — the REST one sits behind the paid API Pass (ADR-0034). What there
 * *is* is a public page per node of the tree, `delcampe.net/en_GB/collectables/category-id/stamps/…`,
 * which Delcampe's own help centre points sellers at for exactly this. So the names come from there,
 * and this module is the half that turns one such page into rows.
 *
 * It is pure so that the parse can be tested against a saved page rather than against the live site:
 * a marketplace's markup changes without warning, and the failure that matters — "the list stopped
 * being readable" — must be catchable in a unit test rather than only in a silently empty picker.
 *
 * The shape of one page, as observed:
 *
 * ```html
 * <ul class="nls category-bloc">
 *   <li><span class="flex …"><span>Aland</span><div><span class="label-blue-light …">#1245</span></div></span></li>
 *   <li><span class="flex …"><a href="…/stamps/andorra/" …>Andorra</a></span></li>
 *   <li><span class="flex …"><a href="…/poland/1919-…/" …>….-1919 …</a></span>
 *       <ul class="nls category-bloc"><li>…<span>Used stamps</span>…#7944…</li>…</ul></li>
 * </ul>
 * ```
 *
 * Two things follow, and both matter:
 *
 * - A node carrying an **id** is a category the file may name. A node carrying only a **link** is a
 *   heading whose children live on their own page.
 * - A link whose `<li>` already contains a nested list has **already been expanded here**, and
 *   fetching its page returns exactly the rows this page just gave. Following it anyway is what turns
 *   a ~260-page walk into a ~1000-page one, so {@link parseDelcampeCategoryPage} reports only the
 *   links that were *not* expanded.
 *
 * The path is deliberately **not** taken from the page's own breadcrumb: a country page's breadcrumb
 * says `Stamps > Poland` and omits the continent, so half the tree would be filed one level shallower
 * than the other half. The crawler knows the trail it followed and prefixes it, which is the only
 * account of the path that is the same for every row.
 */

/** One category the upload file may name: Delcampe's id, its own name, and the trail of headings it
 *  sat under **within this page** (empty at the page's top level). */
export interface DelcampeCategoryEntry {
  id: string;
  name: string;
  trail: string[];
}

/** A heading whose children were not expanded on this page, and so has a page of its own. */
export interface DelcampeCategoryLink {
  href: string;
  name: string;
  trail: string[];
}

export interface DelcampeCategoryPage {
  entries: DelcampeCategoryEntry[];
  links: DelcampeCategoryLink[];
}

/** The list's own container. Everything before it is the site's chrome, which happens to contain
 *  markup close enough to the list's to confuse a looser scan. */
const LIST_OPEN = '<ul class="nls category-bloc">';

const TOKEN =
  /<ul class="nls category-bloc">|<\/ul>|<li>|<a href="([^"]+)"[^>]*>([^<]*)<\/a>|<span>([^<]*)<\/span>|label-blue-light[^"]*">#(\d+)</g;

/** The handful of entities Delcampe's category names actually carry (`Covers &amp; Documents`). A
 *  full entity decoder would be a dependency for five characters. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * The categories one page states, and the headings it left for their own pages.
 *
 * Returns empty lists rather than throwing on a page that holds no list at all — a sign-in wall, an
 * error page, a redirect that landed somewhere else. The caller is a background refresh, and "this
 * page said nothing" is a thing it must be able to carry on past; what it must never do is treat a
 * page that said nothing as a page that said *the tree is now empty*, which is why the refresh
 * deletes only what a **complete** pass did not see.
 */
export function parseDelcampeCategoryPage(html: string): DelcampeCategoryPage {
  const start = html.indexOf(LIST_OPEN);
  if (start < 0) return { entries: [], links: [] };

  const entries: DelcampeCategoryEntry[] = [];
  const links: DelcampeCategoryLink[] = [];
  /** The headings currently open, one per nested list. A `null` is a list opened under something
   *  with no name of its own, which contributes nothing to a path. */
  const stack: (string | null)[] = [];
  let depth = 0;
  let current: string | null = null;
  /** The link this `<li>` opened with, if any, so a nested list can mark it as expanded. */
  let pendingLink: DelcampeCategoryLink | null = null;

  TOKEN.lastIndex = 0;
  const body = html.slice(start);
  for (let match = TOKEN.exec(body); match; match = TOKEN.exec(body)) {
    const token = match[0];

    if (token === LIST_OPEN) {
      // A list opening inside an `<li>` means that `<li>`'s children are right here — so its link,
      // if it had one, is a page there is no reason to fetch. It is blanked rather than removed
      // because it has already been recorded; the blanks are filtered out at the end.
      if (pendingLink) pendingLink.href = "";
      stack.push(current);
      depth += 1;
      current = null;
      pendingLink = null;
      continue;
    }

    if (token === "</ul>") {
      stack.pop();
      depth -= 1;
      current = null;
      pendingLink = null;
      if (depth <= 0) break;
      continue;
    }

    if (token === "<li>") {
      current = null;
      pendingLink = null;
      continue;
    }

    const trail = stack.filter((name): name is string => Boolean(name));

    if (match[1] !== undefined) {
      current = decodeEntities(match[2]);
      pendingLink = { href: match[1], name: current, trail };
      links.push(pendingLink);
      continue;
    }

    if (match[3] !== undefined) {
      current = decodeEntities(match[3]);
      continue;
    }

    if (match[4] !== undefined && current) {
      entries.push({ id: match[4], name: current, trail });
    }
  }

  // A link that was expanded in place had its href blanked above; it is dropped here rather than at
  // the point of expansion, the nested list arriving after the link has already been recorded.
  return { entries, links: links.filter((link) => link.href) };
}

/** A stored row of the catalogue, as the picker and the crawl both see it. */
export interface DelcampeCategoryRow {
  id: string;
  name: string;
  path: string;
}

/** A crawled entry as one row: the trail the crawler followed, plus the trail within the page, plus
 *  the entry's own name. Stated once so the crawler and the seed generator cannot disagree about
 *  what a path is. */
export function delcampeCategoryRow(
  entry: DelcampeCategoryEntry,
  crawlTrail: readonly string[]
): DelcampeCategoryRow {
  return {
    id: entry.id,
    name: entry.name,
    path: [...crawlTrail, ...entry.trail, entry.name].join(" > "),
  };
}

// ---------------------------------------------------------------------------
// The tree, and searching it
// ---------------------------------------------------------------------------

/**
 * One node of the catalogue as the picker walks it.
 *
 * `id` is the node's **full path**, which is the only thing unique about it: a heading has no
 * category id at all, and `Used stamps` names hundreds of nodes. It doubles as the value stored on a
 * chosen category, so nothing has to be recomputed to say where a pick sits.
 *
 * `categoryId` is null on a **heading** — `Stamps > Europe > Poland` is a place in Delcampe's tree
 * and not a category anything can be uploaded into. Those are shown and expandable but cannot be
 * chosen, which is the rule `LocationTreeSelect` already applies to grouping-only storage.
 */
export interface DelcampeCategoryTreeNode {
  id: string;
  name: string;
  categoryId: string | null;
  children: DelcampeCategoryTreeNode[];
}

/**
 * The flat catalogue as a tree.
 *
 * Built from the paths rather than from stored parent links, because the path *is* the parent link:
 * Delcampe's list states a breadcrumb per category and nothing else, and inventing an id for every
 * heading in the database would be storing something Delcampe never said.
 *
 * A node can carry **both** a category id and children — `Occupations` is listable *and* has
 * `General Government` under it — so a heading is not "a node with children" but "a node with no id
 * of its own".
 */
export function buildDelcampeCategoryTree(
  rows: readonly DelcampeCategoryRow[]
): DelcampeCategoryTreeNode[] {
  const roots: DelcampeCategoryTreeNode[] = [];
  const byPath = new Map<string, DelcampeCategoryTreeNode>();

  for (const row of rows) {
    const segments = row.path.split(" > ").filter(Boolean);
    let siblings = roots;
    let path = "";
    for (const [index, name] of segments.entries()) {
      path = path ? `${path} > ${name}` : name;
      let node = byPath.get(path);
      if (!node) {
        node = { id: path, name, categoryId: null, children: [] };
        byPath.set(path, node);
        siblings.push(node);
      }
      // The last segment is the row itself; everything before it is a heading this row happens to
      // pass through, and may well be a category in its own right on some other row.
      if (index === segments.length - 1) node.categoryId = row.id;
      siblings = node.children;
    }
  }

  sortDelcampeCategoryTree(roots);
  return roots;
}

/** Alphabetical within each level, which is how Delcampe's own pages read. Period headings sort
 *  usefully by accident — `1919-1939` before `1944-….` — and nothing here should invent an order
 *  Delcampe did not state. */
function sortDelcampeCategoryTree(nodes: DelcampeCategoryTreeNode[]): void {
  nodes.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  for (const node of nodes) sortDelcampeCategoryTree(node.children);
}

/**
 * A search term as the words it is matched by.
 *
 * Delcampe's own names are full of punctuation (`...-1860 Prephilately`, `1944-60`,
 * `Blocks & sheetlets`), so splitting on anything that is not a letter or a digit is what makes
 * `1944` and `1944-60` both find the same row.
 */
export function delcampeCategoryQueryWords(term: string): string[] {
  return tokenize(term);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Whether one node answers a query.
 *
 * Matched over the **whole path**, not the node's name: a leaf is called `Used stamps` some hundreds
 * of times on this tree and only the path says which country's and which period's, so `poland used`
 * has to be a query that works.
 *
 * On **word starts** rather than substrings, which is not fussiness: `Unused stamps` contains `used`,
 * so a substring search answers a query for used stamps with the unused ones of every country, on a
 * tree whose primary split is exactly that. A prefix still lets `pol` find Poland.
 *
 * A bare category id matches outright — the collector reading a number off Delcampe's own selling
 * form is the one case where the id is the thing they know.
 */
export function matchesDelcampeCategoryQuery(
  node: { id: string; categoryId: string | null },
  words: readonly string[],
  rawTerm: string
): boolean {
  if (node.categoryId !== null && node.categoryId === rawTerm) return true;
  const tokens = tokenize(node.id);
  return words.every((word) => tokens.some((token) => token.startsWith(word)));
}

/**
 * The tree narrowed to what a query reaches, ancestors kept.
 *
 * A node survives when it matches or when anything below it does — `filterLocationTree`'s rule, which
 * is what makes the result still readable as a tree rather than as a flat list of leaves that could
 * be anywhere. An empty query is the whole tree, collapsed by the caller.
 */
export function filterDelcampeCategoryTree(
  nodes: readonly DelcampeCategoryTreeNode[],
  term: string
): DelcampeCategoryTreeNode[] {
  const rawTerm = term.trim();
  const words = delcampeCategoryQueryWords(rawTerm);
  if (words.length === 0) return [...nodes];
  return narrow(nodes, words, rawTerm);
}

function narrow(
  nodes: readonly DelcampeCategoryTreeNode[],
  words: readonly string[],
  rawTerm: string
): DelcampeCategoryTreeNode[] {
  const kept: DelcampeCategoryTreeNode[] = [];
  for (const node of nodes) {
    const children = narrow(node.children, words, rawTerm);
    // A node whose *path* matches keeps its whole subtree: everything under `Poland` matches
    // `poland` by construction, and pruning it would answer a query for a country with a country
    // that has nothing in it.
    if (matchesDelcampeCategoryQuery(node, words, rawTerm)) {
      kept.push(node);
    } else if (children.length > 0) {
      kept.push({ ...node, children });
    }
  }
  return kept;
}

/** Every node in a tree that has children, which is what a search expands: the matches are the
 *  leaves of the narrowed tree, and a search that left them folded away would have found nothing as
 *  far as the collector can see. */
export function expandableDelcampeCategoryIds(
  nodes: readonly DelcampeCategoryTreeNode[]
): Set<string> {
  const ids = new Set<string>();
  const walk = (list: readonly DelcampeCategoryTreeNode[]) => {
    for (const node of list) {
      if (node.children.length === 0) continue;
      ids.add(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

/** The ancestors of one path, so opening the picker on a category already chosen shows it in place
 *  rather than at the top of a collapsed tree. */
export function delcampeCategoryAncestorIds(path: string): Set<string> {
  const segments = path.split(" > ").filter(Boolean);
  const ids = new Set<string>();
  let current = "";
  for (const segment of segments.slice(0, -1)) {
    current = current ? `${current} > ${segment}` : segment;
    ids.add(current);
  }
  return ids;
}
