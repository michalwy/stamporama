import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { readCollectionAreas } from "./areas";
import { buildAreaVendorMaps, formatStampCN } from "./area-vendor";
import { loadIssuePrefixMap } from "./issue-prefix";
import { VARIANT_FLAG_SELECT } from "./variant-classification";

// **How a trade line is named when it is spoken about away from its row** (#638, lifted here by
// #641).
//
// It was the balancing engine's, because the valuation gate was the first thing that had to name a
// line it could not draw. The partner's feedback inbox is the second: an item there is read out of
// the column that would otherwise say what it is about, so it has to carry the same string the row
// says. One labeller, so a line named in a refusal and the same line named in the inbox are
// recognisably the same line.
//
// **The catalogue number leads, not the name.** A stamp's `name` is optional and in practice usually
// blank — a collector files by `Mi·PL 200`, not by *Chopin* — so naming by name produced *"8 lines
// have no value yet: Unnamed stamp, Unnamed stamp, …"*, the exact failure naming them was meant to
// prevent. The leading number is the **primary** vendor's for the stamp's area, prefixed exactly as
// every other stamp surface prints it (`formatStampCN`, #357/#377), so what is said about a line and
// what its row shows are the same string. The name is the fallback, and a stamp with neither is
// still worth naming badly rather than not at all.
//
// **Both sides read the same**, and deliberately so: the copy number a give line could also carry is
// an internal handle, and putting it in front would make the two sides of one list look like two
// different kinds of thing while adding nothing a collector reads a line by.

/** What naming a line takes: the catalogue number and everything needed to prefix it the way every
 *  other stamp surface does (#357/#377), plus the variant flags the valuation key reads. */
export const LABEL_STAMP_SELECT = {
  name: true,
  catalogNumbers: { select: { catalogVendorId: true, number: true } },
  stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
  issueMemberships: { select: { issueId: true }, take: 1 },
  variants: { select: VARIANT_FLAG_SELECT },
} satisfies Prisma.StampSelect;

export type LabelStamp = Prisma.StampGetPayload<{ select: typeof LABEL_STAMP_SELECT }>;

/** Where a label reads its stamp and condition from — a receive line reads its own, a give line
 *  reads its copy's. Structural, so any query selecting these fields can be labelled without being
 *  taught to this module. */
export interface TradeLabelSource {
  condition: { name: string; abbreviation: string | null } | null;
  stamp: LabelStamp | null;
}

export interface TradeLabelLine extends TradeLabelSource {
  item: TradeLabelSource | null;
}

export type TradeLineLabeller = (line: TradeLabelLine) => string;

/** Build a labeller over already-loaded areas and issue prefixes — the shape callers that are
 *  loading both anyway (the balance read) want. */
export function makeTradeLineLabeller(
  areas: Awaited<ReturnType<typeof readCollectionAreas>>,
  issuePrefixes: Awaited<ReturnType<typeof loadIssuePrefixMap>>
): TradeLineLabeller {
  const { primaryVendorByArea, vendorMapFor } = buildAreaVendorMaps(areas, issuePrefixes);

  const nameStamp = (stamp: LabelStamp | null): string => {
    if (!stamp) return "Unidentified stamp";
    const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
    const leading =
      stamp.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ??
      stamp.catalogNumbers[0] ??
      null;
    if (leading) {
      const issueId = stamp.issueMemberships[0]?.issueId ?? null;
      return formatStampCN(
        leading.number,
        vendorMapFor(areaId, issueId).get(leading.catalogVendorId)
      );
    }
    return stamp.name || "Unidentified stamp";
  };

  return (line) => {
    const source = line.item ?? line;
    const cond = source.condition?.abbreviation || source.condition?.name || "";
    return `${nameStamp(source.stamp)}${cond ? ` (${cond})` : ""}`;
  };
}

/** The same labeller for a caller that has neither map yet. Two light reads, both of them
 *  collection-wide dictionaries the app loads on most screens anyway. */
export async function loadTradeLineLabeller(collectionId: string): Promise<TradeLineLabeller> {
  const [areas, issuePrefixes] = await Promise.all([
    readCollectionAreas(collectionId),
    loadIssuePrefixMap(collectionId),
  ]);
  return makeTradeLineLabeller(areas, issuePrefixes);
}
