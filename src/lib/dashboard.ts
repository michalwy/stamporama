import "server-only";
import { assertCollectionOwner } from "./platform-category";
import {
  capGroup,
  dashboardSectionSpec,
  type DashboardGroup,
  type DashboardSection,
  type DashboardSectionId,
} from "./dashboard-rules";

/**
 * The operational Dashboard's reads (#1808; ADR-0067). The shape and its rules are in the pure
 * `dashboard-rules.ts`; this file only says which reads fill which section.
 *
 * **Providers, per section**, the bell's extension point (`action-items.ts`) applied here: a provider
 * returns one or more groups, so two groups out of one read stay one read, and filling a section is
 * entries in {@link SECTION_PROVIDERS} and nothing else — the route, the query and the screen are
 * written against the shape. The sections' contents are their own issues (#1809 Sales, #1810
 * Incoming purchases, #1811 Offers to handle, #1812 Auctions I bid in, #1813 Trades); until each
 * lands, its section has no groups and says so.
 *
 * **A provider reads through the function the group's own screen reads through**, and where a group
 * means what a bell group means it reads the bell's source and hands it over with
 * `dashboardGroupFromBell` — a second derivation of the same set is the drift #397 was worried
 * about. A provider returns a group **even when it is empty**: the screen shows the zero.
 */

interface DashboardContext {
  ownerId: string;
  collectionId: string;
}

type DashboardProvider = (ctx: DashboardContext) => Promise<DashboardGroup[]>;

const SECTION_PROVIDERS: Record<DashboardSectionId, DashboardProvider[]> = {
  sales: [],
  "incoming-purchases": [],
  offers: [],
  auctions: [],
  trades: [],
};

/**
 * One section of the dashboard. Its own call — and its own route and query — so each section loads
 * and fails on its own, the Overview's pattern (#649).
 *
 * The collection is asserted here as well as by every provider's own reads, so a section with no
 * providers yet still refuses a collection that is not the caller's.
 */
export async function getDashboardSection(
  ownerId: string,
  collectionId: string,
  sectionId: DashboardSectionId
): Promise<DashboardSection> {
  await assertCollectionOwner(ownerId, collectionId);
  const groups = (
    await Promise.all(SECTION_PROVIDERS[sectionId].map((load) => load({ ownerId, collectionId })))
  )
    .flat()
    .map((group) => capGroup(group));
  return { ...dashboardSectionSpec(sectionId), groups };
}
