import type { IconName } from "@/app/icons";
import type { SectionKey } from "./nav-sections";

/**
 * The sidebar's entries, as data (#2504).
 *
 * The sidebar draws itself from this table, and the Pinned section names, marks and lights a pinned
 * screen from the same row — so a screen renamed, moved or given another icon changes in its section
 * and in Pinned at once. What the sections *are* (labels, routes, tints) stays in `nav-sections.ts`.
 *
 * Every `path` is under the collection (`/offers/prepare`); the Overview's is the empty string.
 */

export interface NavScreen {
  path: string;
  label: string;
  /** Omitted for an entry inside a group, where the group's icon names the subject. */
  icon?: IconName;
  /** The name it goes by in Pinned, where it stands without its group — only where the bare label
   * would be ambiguous there (the auction *Sales* beside the Sales list). */
  pinnedLabel?: string;
  /** Lit only on its own address, for the shorter of two entries on one branch (#376). */
  exact?: boolean;
  /** Branches under its path that are entries of their own and so do not light it (#502). */
  except?: string[];
}

export type NavNode =
  | { type: "item"; screen: NavScreen & { icon: IconName } }
  | {
      type: "group";
      icon: IconName;
      label: string;
      /** The subject's main screen, where it has one — the group's row becomes that entry. */
      head?: NavScreen;
      children: NavScreen[];
    };

/** Outside every section and never folded away. */
export const NAV_TOP: NavNode[] = [
  // The operational Dashboard (#1808; ADR-0067): the work waiting across the collection. First,
  // outside every section and never folded away — it is the screen opened every day, and entries
  // are ordered by how often they are wanted (#971).
  { type: "item", screen: { path: "/dashboard", label: "Dashboard", icon: "dashboard" } },
  // Outside every section and never folded away (#762): it is the one screen that is about the
  // collection as a whole, and the way back when a section has been collapsed. Collection structure
  // (#1711) hangs beneath it as the Overview's breakdown, the way Variant prices hangs under Stamps;
  // the holdings tile still opens it too (ADR-0056).
  {
    type: "group",
    icon: "overview",
    label: "Overview",
    head: { path: "", label: "Overview" },
    children: [{ path: "/inventory/structure", label: "Collection structure" }],
  },
];

/** The order the sections stand in. Trading is split by *direction* (#351) and **Selling leads**:
 * buying is what a collection is built from, but selling is the side worked on daily. */
export const SECTION_ORDER: SectionKey[] = ["catalog", "collection", "selling", "buying", "partners"];

export const NAV_SECTIONS: Record<SectionKey, NavNode[]> = {
  catalog: [
    { type: "item", screen: { path: "/issues", label: "Issues", icon: "issues" } },
    // The variant-pricing worklist (#618) sits under Stamps rather than beside it (#762): what it
    // lists is stamp *trees* that are not fully priced, which makes it a second view of the same
    // subject — the rule Auctions and Offers are grouped by — and its route says the same thing.
    // The Stamps row itself is the stamp list, so the subject is named once.
    {
      type: "group",
      icon: "stamps",
      label: "Stamps",
      head: { path: "/stamps", label: "Stamps", except: ["/stamps/variant-prices"] },
      children: [{ path: "/stamps/variant-prices", label: "Variant prices" }],
    },
    // Checklists that span issues (#1416) — a set collected across publications, which no issue owns
    // and so no issue's page can hold (ADR-0031). An issue's own checklists stay on the issue. After
    // Stamps, because what it lists are sets of them.
    { type: "item", screen: { path: "/checklists", label: "Checklists", icon: "checklists" } },
    // Areas are how the catalogue is organised (#1234) — the tree issues and stamps hang on, and the
    // facet every catalogue screen filters by — so the collector looks for them here. #775 moved them
    // out of Settings on frequency, and that stands; it filed them under Collection, which this
    // corrects. Last in the section, because Issues and Stamps are the lists opened daily and the
    // tree is reached when it needs changing (#971). The address is still `/areas`.
    { type: "item", screen: { path: "/areas", label: "Areas", icon: "areas" } },
  ],
  collection: [
    // Card scans used to hang under Inventory (#725, #762). It was retired onto opening balances
    // (#1326): a card of stamps already owned is scanned on its opening balance, under Intake, like
    // any other document's. Replacements (#1936) sit under Inventory: what they list are copies,
    // pairs of them, and the route says the same thing — the rule Variant prices sits under Stamps by.
    {
      type: "group",
      icon: "inventory",
      label: "Inventory",
      head: {
        path: "/inventory",
        label: "Inventory",
        except: ["/inventory/structure", "/inventory/replacements"],
      },
      children: [{ path: "/inventory/replacements", label: "Replacements" }],
    },
    // How complete any chosen area and years are (#2266), counting only the copies of chosen
    // conditions and dispositions. In Collection, not beside Checklists (#2268): it answers how much
    // of the catalogue is held, and in what — the checklists are only its measure. Right after
    // Inventory, whose copies it counts. The address is still `/completeness`.
    { type: "item", screen: { path: "/completeness", label: "Completeness", icon: "completeness" } },
    // Locations and Albums follow Inventory, being where the paper physically sits.
    { type: "item", screen: { path: "/locations", label: "Locations", icon: "locations" } },
    // Albums (#767) sit in Collection rather than in Settings: the *template* is configuration and
    // lives in Settings beside the hawid stock (#765/#766), while an album is operational data — a
    // binder being filled — and is worked in.
    { type: "item", screen: { path: "/albums", label: "Albums", icon: "albums" } },
  ],
  selling: [
    // Where a listing is *made*: the row itself is the offer list — the screen the day is spent on —
    // and under it the builder that composes a hundred-copy lot (#760) and the batch posted from it
    // (#502). Each of those is its own sitting, and both were once reachable only by first landing
    // on the list and finding the way out of it.
    {
      type: "group",
      icon: "offers",
      label: "Offers",
      head: {
        path: "/offers",
        label: "Offers",
        // Not exact: an offer's own detail screen is still the list's, so it keeps this row lit.
        // Only the branches that became entries of their own are yielded.
        except: [
          "/offers/lot-builder",
          "/offers/series-from-singles",
          "/offers/prepare",
          "/offers/listing",
          "/offers/allegro",
          "/offers/delcampe",
          "/offers/posts",
          "/offers/proposals",
        ],
      },
      children: [
        { path: "/offers/lot-builder", label: "Lot Builder" },
        // The other way a listing gets composed (#1210): series that the singles already up on a
        // platform, plus the copies not offered there yet, could now go out whole. Beside the lot
        // builder and ahead of Bulk Listing, since both compose and Bulk Listing posts.
        { path: "/offers/series-from-singles", label: "Series from Singles" },
        // The step between composing and posting (#1894): the offers still being prepared, priced in
        // place and marked ready together — Bulk Listing does the same for the Ready ones, so the two
        // stand side by side in the order an offer passes through them.
        { path: "/offers/prepare", label: "Prepare" },
        { path: "/offers/listing", label: "Bulk Listing" },
        // Offers prepared for one contact each (#2287): composed and priced like any offer, for one
        // buyer rather than a platform, so under Offers after the batch screens.
        { path: "/offers/proposals", label: "Proposals" },
      ],
    },
    // Sales leads the two marketplace screens (#971): of the three rows that sit after Offers it is
    // the one opened daily — every order, on every platform and off them — while the per-platform
    // views are read when one wants to know what a single marketplace has been doing. The order used
    // to follow the *pipeline*; it now follows how often the screen is wanted, which is the same rule
    // that puts Selling before Intake.
    { type: "item", screen: { path: "/sales", label: "Sales", icon: "sales" } },
    // What the marketplaces have already done with what was posted (#502, #611) — its own group
    // (#762) rather than two more children of Offers. Composing a listing and reading back what a
    // platform has since done with it are opposite ends of the work. The children take the **bare
    // platform name** (#971): the group names the set and the child says which one, which is the
    // same principle that leaves a child without an icon. Each page keeps its own heading, which is
    // where a screen standing alone has to say what it shows.
    {
      type: "group",
      icon: "marketplaces",
      label: "Marketplaces",
      children: [
        { path: "/offers/allegro", label: "Allegro" },
        { path: "/offers/delcampe", label: "Delcampe" },
        // The posts of several lots put up in the Facebook groups (#1850), and each post's own screen
        // under it — a post was otherwise reached only through one of its lots.
        { path: "/offers/posts", label: "Facebook" },
      ],
    },
    // What parcels are packed with (#1897): the envelopes and cards bought on purchase orders, what
    // is on hand and what it is worth. Selling's, closing it, because a sale is where supplies are
    // spent — the shipping cost is what the track is for.
    { type: "item", screen: { path: "/supplies", label: "Packing supplies", icon: "parcel" } },
  ],
  buying: [
    // Leads the section (#532): what is being looked for comes before what has been ordered. It is
    // the screen opened *before* a fair or a dealer's list, whereas the intake documents are what is
    // written up afterwards.
    { type: "item", screen: { path: "/wants", label: "Want list", icon: "wants" } },
    // Intake documents, not Purchases (#1323): opening balances are listed here too, and they were
    // not bought. The address stays `/purchases`, which nobody reads.
    { type: "item", screen: { path: "/purchases", label: "Intake documents", icon: "purchases" } },
    // Two entries, not one (#376). The lots screen and the settlement screen answer different
    // questions on different days — "what do I bid on next", across every seller, versus "what do I
    // owe for this parcel" — and reaching the second through the first made the daily screen double
    // as a doorway. Lots leads, being the daily job (ADR-0021 §9).
    {
      type: "group",
      icon: "auctions",
      label: "Auctions",
      children: [
        // Exact: every sale route lives under `/auctions`, and a prefix test would light this entry
        // on the sales screens too.
        { path: "/auctions", label: "Lots", pinnedLabel: "Auction lots", exact: true },
        { path: "/auctions/sales", label: "Sales", pinnedLabel: "Auction sales" },
      ],
    },
  ],
  // The screens that serve **both** directions, under a heading of their own (#762). A trade is the
  // one part of the hobby where the two directions are the same act (#646); one address book holds
  // the house you bid with, the marketplace you list on and the collector you swap with; and
  // Colnect's lists (#686) are what a partner reads before offering anything. Filing any of them
  // under Selling or Intake would pick one half.
  partners: [
    { type: "item", screen: { path: "/trades", label: "Trades", icon: "trades" } },
    { type: "item", screen: { path: "/contacts", label: "Contacts", icon: "contacts" } },
    { type: "item", screen: { path: "/colnect", label: "Colnect", icon: "link" } },
  ],
};

/** A sidebar entry with everything Pinned needs to draw it on its own. */
export interface PinnableScreen extends NavScreen {
  /** Its own icon, or its group's for an entry inside a group. */
  icon: IconName;
  /** The section it sits in; null for the entries above the sections. */
  section: SectionKey | null;
}

function flatten(nodes: NavNode[], section: SectionKey | null): PinnableScreen[] {
  return nodes.flatMap((node): PinnableScreen[] => {
    if (node.type === "item") return [{ ...node.screen, section }];
    return [
      ...(node.head ? [{ ...node.head, icon: node.icon, section }] : []),
      ...node.children.map((child) => ({ ...child, icon: node.icon, section })),
    ];
  });
}

/** Every entry of the sidebar's navigation, top first, in the order drawn. */
export const NAV_SCREENS: PinnableScreen[] = [
  ...flatten(NAV_TOP, null),
  ...SECTION_ORDER.flatMap((key) => flatten(NAV_SECTIONS[key], key)),
];

/** The entry at `path`, or undefined — a pin of a screen the sidebar no longer has. */
export function navScreenByPath(path: string): PinnableScreen | undefined {
  return NAV_SCREENS.find((s) => s.path === path);
}

/**
 * Whether an entry owns the current screen.
 *
 * A prefix test is right for an entry whose sub-routes all belong to it, but wrong where two entries
 * sit on one branch — Auction lots (`/auctions`) and Auction sales (`/auctions/sales`) would
 * otherwise both light up on a sale (#376); the shorter of such a pair is `exact`. `except` is the
 * softer form, for a parent whose *other* sub-routes are still its own (#502): the offer list owns
 * `/offers/[offerId]`, so opening an offer keeps Offers lit, but it yields the branches that became
 * siblings of it. The Overview is always exact — every route begins with it.
 */
export function isNavScreenActive(
  pathname: string,
  base: string,
  screen: Pick<NavScreen, "path" | "exact" | "except">
): boolean {
  const href = `${base}${screen.path}`;
  if (screen.exact || screen.path === "") return pathname === href;
  if (
    (screen.except ?? []).some((branch) => {
      const b = `${base}${branch}`;
      return pathname === b || pathname.startsWith(`${b}/`);
    })
  ) {
    return false;
  }
  return pathname.startsWith(href);
}
