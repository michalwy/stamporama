import type { ListViewSpec, RememberedParam, StoredValue } from "@/lib/list-views";
import { REMEMBERED_FILTER_KEYS } from "../inventory/copies-list-filters";
import { INTAKE_VIEW_PARAMS } from "../purchases/intake-view-params";
import { POSTS_VIEW_PARAMS } from "../offers/posts/posts-view-params";
import { SUPPLIES_VIEW_PARAMS } from "../supplies/supplies-view-params";

// Where each list keeps its view (#2487) — the one place a list says, for its filter presets, which
// of its settings live outside the address and where. Everything the address carries is captured
// without being named here (`list-views.ts`), so a filter added to a list later is in its presets
// with no change to this file; what **must** be added here is a filter that is remembered, or a
// preference kept in storage alone. The storage keys are the hooks' own spelling:
// `usePersistedCollectionValue(ns)` is `stamporama:<ns>:{c}`, `usePersistedSort(list)` is
// `stamporama:sort:<list>`, `useCollectionFilterStore` is `stamporama:list-filters:{c}`.

/** A value `usePersistedCollectionValue` keeps, the URL winning when it names one. */
function rememberedRaw(name: string, namespace: string, opts: { bool?: boolean } = {}): RememberedParam {
  return { name, store: { key: `stamporama:${namespace}:{c}`, format: "raw" }, ...opts };
}

/** The parameters `usePersistedFilterParams(namespace, …)` keeps together in one query string. */
function rememberedSet(keys: readonly string[], namespace: string): RememberedParam[] {
  return keys.map((name) => ({
    name,
    store: { key: `stamporama:${namespace}:{c}`, format: "qs", field: name },
  }));
}

/** The area and the year every list rail shares (#143) — `useListAreaYearFilter`. */
const AREA_YEAR: RememberedParam[] = [
  {
    name: "areaId",
    store: { key: "stamporama:list-filters:{c}", format: "json", field: "areaId" },
    sentinel: "all",
  },
  {
    name: "year",
    store: { key: "stamporama:list-filters:{c}", format: "json", field: "year" },
    sentinel: "all",
  },
];

/** `usePersistedSort(list, …)` — global per list rather than per collection, as the hook keeps it. */
function sort(list: string): RememberedParam[] {
  return ["sortBy", "sortDir"].map((field) => ({
    name: field,
    store: { key: `stamporama:sort:${list}`, format: "json", field },
  }));
}

/** Whether a picked area brings its sub-areas (#385) — part of what the area selection means. */
const SUB_AREAS: StoredValue = {
  name: "subAreas",
  key: "stamporama:filter-include-descendants:area",
  defaultValue: "1",
};

/** A search box's ticked fields (#2238). */
function searchFields(namespace: string): StoredValue {
  return { name: "searchFields", key: `stamporama:${namespace}:{c}` };
}

/** A `usePersistedFlag` switch that is off until set. */
function flag(name: string, key: string): StoredValue {
  return { name, key, defaultValue: "0" };
}

const CATALOGUE_REFS = {
  areaId: "area",
  issueId: "issue",
  tagIds: "tag",
  issueFormatIds: "issueFormat",
  colorIds: "color",
  watermarkIds: "watermark",
  paperIds: "paper",
  printingIds: "printing",
} as const;

export const COPIES_VIEW: ListViewSpec = {
  list: "copies",
  remembered: [
    ...AREA_YEAR,
    ...sort("inventory"),
    ...rememberedSet(REMEMBERED_FILTER_KEYS, "inventory-filters"),
    rememberedRaw("notOfferedPlatform", "inventory-not-offered-platform"),
  ],
  stored: [
    { name: "groupMode", key: "stamporama:inventory:groupMode:{c}", defaultValue: "none" },
    flag("groupByCondition", "stamporama:inventory:groupByCondition:{c}"),
    flag("groupByFormat", "stamporama:inventory:groupByFormat:{c}"),
    flag("groupByCertificate", "stamporama:inventory:groupByCertificate:{c}"),
    SUB_AREAS,
    { name: "subLocations", key: "stamporama:filter-include-descendants:location", defaultValue: "1" },
    searchFields("inventory-search-fields"),
  ],
  refs: {
    areaId: "area",
    issueId: "issue",
    tagIds: "tag",
    faultIds: "fault",
    conditionIds: "condition",
    formatIds: "format",
    subtypeIds: "subtype",
    issueFormatIds: "issueFormat",
    certificateStatusIds: "certificateStatus",
    locationId: "location",
    notOfferedPlatform: "offerPlatform",
    excludedPlatform: "offerPlatform",
  },
};

export const STAMPS_VIEW: ListViewSpec = {
  list: "stamps",
  remembered: [
    ...AREA_YEAR,
    ...sort("stamps"),
    rememberedRaw("catalogVendorId", "list-catalog-vendor"),
  ],
  stored: [SUB_AREAS, searchFields("stamps-search-fields")],
  refs: CATALOGUE_REFS,
};

export const ISSUES_VIEW: ListViewSpec = {
  list: "issues",
  remembered: [
    ...AREA_YEAR,
    ...sort("issues"),
    rememberedRaw("catalogVendorId", "list-catalog-vendor"),
  ],
  stored: [SUB_AREAS, searchFields("issues-search-fields")],
  refs: CATALOGUE_REFS,
};

/** The Wants list keeps its filters as screen state (#844) and reads the area and the year from the
 *  shared memory alone, never the address — so the memory is captured whole, as a stored value. Its
 *  status, priorities, conditions, issue formats and search are the control's `local` view. */
export const WANTS_VIEW: ListViewSpec = {
  list: "wants",
  stored: [
    {
      name: "areaYear",
      key: "stamporama:list-filters:{c}",
      defaultValue: JSON.stringify({ areaId: null, year: null }),
    },
    flag("groupByIssue", "stamporama:wants:groupByIssue:{c}"),
    SUB_AREAS,
    searchFields("wants-search-fields"),
  ],
  refs: { stampId: "stamp", conditionIds: "condition", issueFormatIds: "issueFormat" },
};

/** The offers list's status (#1229): one value, spelled `needsAction=1` or `state=…` in the URL. */
const NEEDS_ACTION = "needsAction";
const OFFER_STATUS: RememberedParam = {
  name: "status",
  store: { key: "stamporama:offers-status:{c}", format: "raw" },
  url: {
    params: ["state", "needsAction"],
    read: (url) =>
      url.has("state") || url.has("needsAction")
        ? url.get("needsAction") === "1"
          ? NEEDS_ACTION
          : (url.get("state") ?? "")
        : null,
    write: (value, url) => {
      if (value === NEEDS_ACTION) url.set("needsAction", "1");
      else url.set("state", value);
    },
  },
};

export const OFFERS_VIEW: ListViewSpec = {
  list: "offers",
  remembered: [
    OFFER_STATUS,
    rememberedRaw("platform", "offers-platform"),
    rememberedRaw("search", "offers-search"),
  ],
  stored: [
    flag("includeClosed", "stamporama:offers:includeClosed:{c}"),
    searchFields("offers-search-fields"),
  ],
  refs: { platform: "platform" },
};

export const PROPOSALS_VIEW: ListViewSpec = { list: "proposals" };

export const POSTS_VIEW: ListViewSpec = {
  list: "posts",
  remembered: rememberedSet(POSTS_VIEW_PARAMS, "facebook-posts-view"),
  refs: { group: "facebookGroup" },
};

export const SALES_VIEW: ListViewSpec = {
  list: "sales",
  remembered: [rememberedRaw("status", "sales-status"), rememberedRaw("search", "sales-search")],
  stored: [searchFields("sales-search-fields")],
  refs: { platform: "platform", buyer: "contact" },
};

export const PURCHASES_VIEW: ListViewSpec = {
  list: "purchases",
  remembered: rememberedSet(INTAKE_VIEW_PARAMS, "intake-documents-view"),
  refs: { platform: "platform", supplier: "contact" },
};

export const TRADES_VIEW: ListViewSpec = {
  list: "trades",
  refs: { partner: "contact" },
};

export const CONTACTS_VIEW: ListViewSpec = { list: "contacts" };

export const AUCTION_LOTS_VIEW: ListViewSpec = {
  list: "auction-lots",
  remembered: [
    rememberedRaw("outcome", "auction-outcome"),
    rememberedRaw("seller", "auction-seller"),
    rememberedRaw("platform", "auction-platform"),
    rememberedRaw("search", "auction-search"),
    rememberedRaw("closing", "auction-closing"),
    rememberedRaw("signal", "auction-signal"),
    rememberedRaw("undescribed", "auction-undescribed", { bool: true }),
    rememberedRaw("duplicate", "auction-duplicate", { bool: true }),
    rememberedRaw("toReview", "auction-to-review", { bool: true }),
    rememberedRaw("tagIds", "auction-tags"),
    rememberedRaw("tagMode", "auction-tag-mode"),
    rememberedRaw("conditionToSettle", "auction-condition-to-settle", { bool: true }),
    rememberedRaw("notPurchased", "auction-not-purchased", { bool: true }),
    {
      name: "includeClosed",
      store: { key: "stamporama:auctions:includeClosed:{c}", format: "raw" },
      bool: true,
    },
  ],
  stored: [
    flag("groupBySale", "stamporama:auctions:groupBySale:{c}"),
    searchFields("auction-search-fields"),
  ],
  refs: { seller: "contact", platform: "platform", tagIds: "tag" },
};

export const AUCTION_SALES_VIEW: ListViewSpec = {
  list: "auction-sales",
  remembered: [
    rememberedRaw("status", "auction-sale-status"),
    rememberedRaw("search", "auction-sale-search"),
  ],
  stored: [searchFields("auction-sale-search-fields")],
};

export const SUPPLIES_VIEW: ListViewSpec = {
  list: "supplies",
  // Which tab is open is where the collector is on the screen, not a narrowing of it.
  ignoreParams: ["tab"],
  remembered: rememberedSet(SUPPLIES_VIEW_PARAMS, "packing-supplies-view"),
  refs: { supply: "supply" },
};
