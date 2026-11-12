/**
 * The **whole view of a list** as one value, for filter presets (#2487): every filter — the area
 * tree, the years and the search with its fields included — plus the sort and the grouping, captured
 * from wherever the list keeps each of them and laid back down in one go.
 *
 * Pure: no React, no `localStorage`, no Prisma. The browser half (`use-list-view.ts`) hands it the
 * address and a storage reader; the server half (`list-presets.ts`) uses {@link cleanListView} to
 * drop what names a record deleted since.
 *
 * **Where a list keeps its view.** Three places, and a list uses any mix of them:
 *
 * 1. **The address.** Every filter the URL carries is captured **wholesale** — the list's spec does
 *    not enumerate them, so a filter added to a list later is in its presets without anyone
 *    remembering to add it. A spec names only the parameters that are *not* view state
 *    (`ignoreParams`: a dialog's target, a one-off hand-off), which are left as they are on apply.
 * 2. **The address, falling back to a remembered value** (`remembered`) — the filters the lists
 *    remember per collection (#693, #325): the URL wins when it names one, the stored value fills in
 *    otherwise. The view holds the value *in force*, whichever side answered, and applying writes it
 *    to **both**: the URL so the list shows it now, the store so the next visit opens on it too and a
 *    cleared value does not come back from memory.
 * 3. **Storage alone** (`stored`) — the preferences that never travel in the URL: the grouping and
 *    its axes, a search box's ticked fields, the sub-area switch.
 * 4. **The screen's own state** (`local`) — a list whose filters are component state by design (the
 *    Wants list, #844) hands its control the values and a way to set them; nothing here reads them.
 *
 * Applying **replaces** the view: every captured parameter the preset does not hold is cleared, every
 * remembered one it does not hold is forgotten, every stored one is reset to its default. Nothing of
 * the view before is kept or merged.
 */

/** The lists that carry presets. Stored in `list_preset.list`, so a key is never renamed. */
export const LIST_KEYS = [
  "copies",
  "stamps",
  "issues",
  "wants",
  "offers",
  "proposals",
  "posts",
  "sales",
  "purchases",
  "trades",
  "contacts",
  "auction-lots",
  "auction-sales",
  "supplies",
] as const;

export type ListKey = (typeof LIST_KEYS)[number];

export function isListKey(value: unknown): value is ListKey {
  return typeof value === "string" && (LIST_KEYS as readonly string[]).includes(value);
}

/** The kinds of collection record a view parameter can name — what a preset can find gone. */
export const LIST_VIEW_REF_KINDS = [
  "area",
  "tag",
  "platform",
  "offerPlatform",
  "condition",
  "format",
  "subtype",
  "issueFormat",
  "color",
  "watermark",
  "paper",
  "printing",
  "certificateStatus",
  "fault",
  "location",
  "contact",
  "issue",
  "stamp",
  "facebookGroup",
  "supply",
] as const;

export type ListViewRefKind = (typeof LIST_VIEW_REF_KINDS)[number];

export function isListViewRefKind(value: unknown): value is ListViewRefKind {
  return typeof value === "string" && (LIST_VIEW_REF_KINDS as readonly string[]).includes(value);
}

/** What a record of each kind is called in the note saying it was dropped. */
export const REF_KIND_NOUN: Record<ListViewRefKind, string> = {
  area: "area",
  tag: "tag",
  platform: "platform",
  offerPlatform: "platform",
  condition: "condition",
  format: "format",
  subtype: "subtype",
  issueFormat: "issue format",
  color: "colour",
  watermark: "watermark",
  paper: "paper",
  printing: "printing",
  certificateStatus: "certificate status",
  fault: "fault",
  location: "location",
  contact: "contact",
  issue: "issue",
  stamp: "stamp",
  facebookGroup: "Facebook group",
  supply: "supply",
};

/**
 * Values a reference parameter carries that are **not** records — *no area*, *single*, *none*, the
 * *all* sentinel, the ordinary stamp among issue formats. Never looked up, so never dropped.
 */
export const REF_SENTINELS: ReadonlySet<string> = new Set(["all", "none", "single", "any", "stamp"]);

/** Where a remembered value is kept: `{c}` in the key is the collection id. */
export type ListViewStore =
  /** The value itself under the key (`usePersistedCollectionValue`, `usePersistedFlag`). */
  | { key: string; format: "raw" }
  /** One parameter of a query string under the key (`usePersistedFilterParams`). */
  | { key: string; format: "qs"; field: string }
  /** One field of a JSON object under the key (the sort, the shared area and year). */
  | { key: string; format: "json"; field: string };

export interface RememberedParam {
  /** The view's name for it, and the URL parameter unless {@link urlParams} says otherwise. */
  name: string;
  store: ListViewStore;
  /** A URL value meaning *nothing chosen* (`areaId=all`), read as empty. */
  sentinel?: string;
  /** A switch: `"1"`/`"true"` is on and anything else off, so `0`, `false` and absent agree. */
  bool?: boolean;
  /**
   * A value spread over more than one URL parameter, or spelled differently there (the offers
   * list's status, #1229's `needsAction`). `read` returns null when the address names none of them.
   */
  url?: {
    params: readonly string[];
    read: (url: UrlReader) => string | null;
    write: (value: string, url: URLSearchParams) => void;
  };
}

export interface StoredValue {
  /** The view's name for it. */
  name: string;
  /** The storage key — `{c}` is the collection id. */
  key: string;
  /** What the preference reads with nothing stored, so a stored default and none compare equal. */
  defaultValue?: string;
}

export interface ListViewSpec {
  list: ListKey;
  /** URL parameters that are not view state, left as they are on apply. */
  ignoreParams?: readonly string[];
  remembered?: readonly RememberedParam[];
  stored?: readonly StoredValue[];
  /** Which view parameters name collection records, and of what kind. Comma-separated values are
   *  looked up one by one. */
  refs?: Readonly<Record<string, ListViewRefKind>>;
}

/** A list's view: its parameters as the URL would carry them, its stored preferences, and the
 *  screen state a list keeps of its own. Empty values are absent from all three. */
export interface ListView {
  params: Record<string, string>;
  stored: Record<string, string>;
  local: Record<string, string>;
}

export interface UrlReader {
  has(key: string): boolean;
  get(key: string): string | null;
  keys(): Iterable<string>;
}

export type StorageReader = (key: string) => string | null;

export function storageKey(template: string, collectionId: string): string {
  return template.replace("{c}", collectionId);
}

function readStore(store: ListViewStore, collectionId: string, storage: StorageReader): string {
  const raw = storage(storageKey(store.key, collectionId));
  if (store.format === "raw") return raw ?? "";
  if (!raw) return "";
  if (store.format === "qs") return new URLSearchParams(raw).get(store.field) ?? "";
  try {
    const parsed: unknown = JSON.parse(raw);
    const value =
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>)[store.field] : null;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function normalize(param: RememberedParam, value: string): string {
  if (param.bool) return value === "1" || value === "true" ? "1" : "";
  if (param.sentinel && value === param.sentinel) return "";
  return value;
}

function ownedParams(spec: ListViewSpec): Set<string> {
  const owned = new Set<string>(spec.ignoreParams ?? []);
  for (const p of spec.remembered ?? []) {
    owned.add(p.name);
    for (const key of p.url?.params ?? []) owned.add(key);
  }
  return owned;
}

/** The view in force — the address, the remembered values it falls back to, and the stored
 *  preferences. */
export function readListView(
  spec: ListViewSpec,
  url: UrlReader,
  storage: StorageReader,
  collectionId: string
): ListView {
  const params: Record<string, string> = {};
  const owned = ownedParams(spec);
  for (const key of url.keys()) {
    if (owned.has(key)) continue;
    const value = url.get(key);
    if (value) params[key] = value;
  }
  for (const p of spec.remembered ?? []) {
    const fromUrl = p.url ? p.url.read(url) : url.has(p.name) ? (url.get(p.name) ?? "") : null;
    const value = normalize(p, fromUrl ?? readStore(p.store, collectionId, storage));
    if (value) params[p.name] = value;
  }
  const stored: Record<string, string> = {};
  for (const s of spec.stored ?? []) {
    const value = storage(storageKey(s.key, collectionId)) ?? s.defaultValue ?? "";
    if (value) stored[s.name] = value;
  }
  return { params, stored, local: {} };
}

/** What applying a view writes: the whole address, and each storage key's new value (null removes
 *  it). */
export interface ListViewWrite {
  url: URLSearchParams;
  storage: Map<string, string | null>;
}

/**
 * The writes that lay `view` down — replacing the view, never merging into it. `current` is the
 * address now, whose ignored parameters are kept; `storage` reads what is stored now, for the keys
 * that hold more than one value.
 */
export function writeListView(
  spec: ListViewSpec,
  view: ListView,
  current: UrlReader,
  storage: StorageReader,
  collectionId: string
): ListViewWrite {
  const url = new URLSearchParams();
  for (const key of spec.ignoreParams ?? []) {
    const value = current.get(key);
    if (value !== null) url.set(key, value);
  }
  const owned = ownedParams(spec);
  for (const [key, value] of Object.entries(view.params)) {
    if (!owned.has(key) && value) url.set(key, value);
  }

  const writes = new Map<string, string | null>();
  const read = (key: string) => (writes.has(key) ? (writes.get(key) ?? null) : storage(key));
  for (const p of spec.remembered ?? []) {
    const value = view.params[p.name] ?? "";
    if (value) {
      if (p.url) p.url.write(value, url);
      else url.set(p.name, value);
    }
    const key = storageKey(p.store.key, collectionId);
    if (p.store.format === "raw") {
      writes.set(key, value || null);
    } else if (p.store.format === "qs") {
      const qs = new URLSearchParams(read(key) ?? "");
      if (value) qs.set(p.store.field, value);
      else qs.delete(p.store.field);
      writes.set(key, qs.toString() || null);
    } else {
      let obj: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(read(key) ?? "{}");
        if (parsed && typeof parsed === "object") obj = { ...(parsed as Record<string, unknown>) };
      } catch {
        /* a broken value is replaced */
      }
      obj[p.store.field] = value || null;
      const empty = Object.values(obj).every((v) => v === null || v === "");
      writes.set(key, empty ? null : JSON.stringify(obj));
    }
  }
  for (const s of spec.stored ?? []) {
    writes.set(storageKey(s.key, collectionId), view.stored[s.name] ?? null);
  }
  return { url, storage: writes };
}

function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] === a[k]);
}

export function sameListView(a: ListView, b: ListView): boolean {
  return (
    sameRecord(a.params, b.params) && sameRecord(a.stored, b.stored) && sameRecord(a.local, b.local)
  );
}

/** Reads a stored view back, keeping only string values — a hand-edited or old row cannot hand the
 *  list anything else. */
export function parseListView(value: unknown): ListView {
  const pick = (v: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === "string" && x) out[k] = x;
      }
    }
    return out;
  };
  const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { params: pick(obj.params), stored: pick(obj.stored), local: pick(obj.local) };
}

export function parseRefs(value: unknown): Record<string, ListViewRefKind> {
  const out: Record<string, ListViewRefKind> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isListViewRefKind(v)) out[k] = v;
    }
  }
  return out;
}

/** The record ids a view names, by kind — what the server looks up. */
export function referencedIds(
  view: ListView,
  refs: Readonly<Record<string, ListViewRefKind>>
): Map<ListViewRefKind, Set<string>> {
  const out = new Map<ListViewRefKind, Set<string>>();
  for (const [param, kind] of Object.entries(refs)) {
    for (const value of [view.params[param], view.local[param]]) {
      if (!value) continue;
      for (const id of value.split(",")) {
        if (!id || REF_SENTINELS.has(id)) continue;
        let set = out.get(kind);
        if (!set) out.set(kind, (set = new Set()));
        set.add(id);
      }
    }
  }
  return out;
}

/** `kind:id` → the record's name when the preset was saved. */
export type RefLabels = Record<string, string>;

export function refLabelKey(kind: ListViewRefKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * The view without the records that no longer exist, and a line per record dropped — named as it
 * was when the preset was saved. A comma-separated parameter loses only its missing values; one left
 * with none is cleared.
 */
export function cleanListView(
  view: ListView,
  refs: Readonly<Record<string, ListViewRefKind>>,
  exists: (kind: ListViewRefKind, id: string) => boolean,
  labels: RefLabels
): { view: ListView; dropped: string[] } {
  const params = { ...view.params };
  const local = { ...view.local };
  const dropped: string[] = [];
  for (const [param, kind] of Object.entries(refs)) {
    for (const record of [params, local]) {
      const value = record[param];
      if (!value) continue;
      const kept: string[] = [];
      for (const id of value.split(",")) {
        if (!id) continue;
        if (REF_SENTINELS.has(id) || exists(kind, id)) {
          kept.push(id);
          continue;
        }
        const label = labels[refLabelKey(kind, id)];
        dropped.push(label ? `${REF_KIND_NOUN[kind]} “${label}”` : `a ${REF_KIND_NOUN[kind]}`);
      }
      if (kept.length > 0) record[param] = kept.join(",");
      else delete record[param];
    }
  }
  return { view: { params, stored: { ...view.stored }, local }, dropped };
}

/** The note applying a preset shows when something it named is gone. */
export function droppedNote(dropped: readonly string[]): string | null {
  if (dropped.length === 0) return null;
  const list =
    dropped.length === 1
      ? dropped[0]
      : `${dropped.slice(0, -1).join(", ")} and ${dropped[dropped.length - 1]}`;
  return `Applied without ${list} — no longer in the collection.`;
}

export const PRESET_NAME_MAX = 80;

/** A preset's name as it is stored, or the reason it cannot be. */
export function checkPresetName(raw: string): { name: string } | { error: string } {
  const name = raw.trim();
  if (!name) return { error: "Name is required." };
  if (name.length > PRESET_NAME_MAX) {
    return { error: `A name is at most ${PRESET_NAME_MAX} characters.` };
  }
  return { name };
}

/** Presets are listed by name (#2487), the way a collector reads them, not by when they were made. */
export function comparePresetNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}
