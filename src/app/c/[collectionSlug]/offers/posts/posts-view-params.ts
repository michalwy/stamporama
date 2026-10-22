// **How the list of Facebook posts is being looked at** (#2108) — the vocabulary, the precedence and
// the narrowing rule, kept pure and out of the panel so a test can read them.
//
// `purchases/intake-view-params.ts` is the same shape on the Intake documents list, and the two are
// deliberately alike: every filter is kept in the address and remembered per collection, so the list
// comes back as the collector left it however it is reached — the sidebar, Quick jump, a post's
// screen — and a reload, the Back button and a copied link all agree with what is on screen (#844).
// The params keep the names they had before #2108 (`group`, `stage`, `untitled`), so an address
// bookmarked before it still means what it meant.
//
// *Not in a post yet*'s fold is not here: it is not a filter, and keeps its own per-collection flag
// (#1991).

import { isFacebookPostStage, type FacebookPostStage } from "@/lib/facebook-post-rules";

/** Everything the toolbar over the list of posts decides. */
export interface PostsView {
  /** Group ids; empty is every group. */
  groups: string[];
  /** One stage, or every stage. */
  stage?: FacebookPostStage;
  /** Only the posts with no title (#1862). */
  untitled: boolean;
}

/** What the list shows with nothing said. A default is never written, to the address or the memory. */
export const POSTS_VIEW_DEFAULTS: PostsView = { groups: [], stage: undefined, untitled: false };

/**
 * The search param each setting travels as — typed over every key of {@link PostsView}, so a control
 * added to the toolbar fails to compile until somebody has said what it is called in the address.
 */
const VIEW_PARAM: { [K in keyof Required<PostsView>]-?: string } = {
  groups: "group",
  stage: "stage",
  untitled: "untitled",
};

/** The params this screen tracks, for `usePersistedFilterParams` and for the address mirror. */
export const POSTS_VIEW_PARAMS: readonly string[] = Object.values(VIEW_PARAM);

/** The param that carries group ids, which a remembered set can hold stale ones of. */
export const POSTS_GROUP_PARAM = VIEW_PARAM.groups;

const VIEW_KEYS = Object.keys(VIEW_PARAM) as (keyof PostsView)[];

/** A group set as the address carries it — comma-separated, each once. */
function parseGroupIds(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
}

/**
 * The view in force, from whatever answers for a param — the URL where it names one, the remembered
 * set otherwise (`usePersistedFilterParams`' reader decides that precedence; this only validates). An
 * unrecognised stage falls back to every stage rather than narrowing to nothing.
 */
export function resolvePostsView(readParam: (key: string) => string | null): PostsView {
  const stageRaw = readParam(VIEW_PARAM.stage) ?? "";
  return {
    groups: parseGroupIds(readParam(VIEW_PARAM.groups)),
    stage: isFacebookPostStage(stageRaw) ? stageRaw : undefined,
    untitled: readParam(VIEW_PARAM.untitled) === "1",
  };
}

/**
 * A remembered group list with the groups that no longer hold a post taken out — `null` where nothing
 * is left. Applied to the **stored** value only, the Intake documents list's rule for its parties
 * (#1392): a group whose posts have all been deleted is no longer in the menu, and would otherwise
 * narrow the list on every visit from a choice the collector cannot see. A link that names one is left
 * alone — it says what it said when it was copied, and the band says what it is narrowing by.
 */
export function pruneStoredGroups(stored: string | null, known: ReadonlySet<string>): string | null {
  const kept = parseGroupIds(stored).filter((id) => known.has(id));
  return kept.length > 0 ? kept.join(",") : null;
}

/** One setting as the address carries it, or `""` where it is at its default and is not written. */
function serialize(key: keyof PostsView, view: Partial<PostsView>): string {
  switch (key) {
    case "groups":
      return (view.groups ?? []).join(",");
    case "stage":
      return view.stage ?? "";
    case "untitled":
      return view.untitled ? "1" : "";
  }
}

/** The param updates one change to the toolbar amounts to, where `""` deletes. Only the keys named
 *  are written, so a press says what it changed and nothing else. */
export function postsViewUpdatesFor(patch: Partial<PostsView>): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const key of VIEW_KEYS) {
    if (key in patch) updates[VIEW_PARAM[key]] = serialize(key, patch);
  }
  return updates;
}

/** One setting narrowing the list, as the band under the toolbar reports it. */
export type PostsNarrowing =
  | { key: "groups"; value: string[] }
  | { key: "stage"; value: FacebookPostStage }
  | { key: "untitled" };

/** Every setting currently narrowing the list, in the order the toolbar reads. */
export function postsViewNarrowings(view: PostsView): PostsNarrowing[] {
  const out: PostsNarrowing[] = [];
  if (view.groups.length > 0) out.push({ key: "groups", value: view.groups });
  if (view.stage) out.push({ key: "stage", value: view.stage });
  if (view.untitled) out.push({ key: "untitled" });
  return out;
}

/** Back to every post in one press. Kept beside {@link postsViewNarrowings} so the band and its button
 *  cannot disagree. */
export function postsViewClearUpdates(): Record<string, string> {
  return Object.fromEntries(VIEW_KEYS.map((key) => [VIEW_PARAM[key], ""]));
}

/**
 * The view in force, written back into the address (#844): only a value that differs from both the
 * default and the address is written, so it returns `null` where the address already says what the
 * list shows, and a list nobody has narrowed keeps a clean address.
 */
export function postsViewUrlUpdates(
  view: PostsView,
  urlValue: (key: string) => string | null
): Record<string, string> | null {
  const updates: Record<string, string> = {};
  for (const key of VIEW_KEYS) {
    const param = VIEW_PARAM[key];
    const value = serialize(key, view);
    if (value && (urlValue(param) ?? "") !== value) updates[param] = value;
  }
  return Object.keys(updates).length > 0 ? updates : null;
}
