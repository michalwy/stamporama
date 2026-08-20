import type { ItemListItem } from "@/lib/items";
import type { TradeReceiveLineData } from "@/lib/trade-lines";
import type { QuickPriceSubject } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";

// **What the trade screen hands the quick-price dialog** (#638), from either side.
//
// The dialog prices a `stamp × condition × certificate` on the latest edition of every catalogue
// active on the stamp's area (#147/#170), and its subject is the same shape whichever screen opened
// it. Both trade rows can satisfy it — a give line through the copy it names, a receive line through
// the want key it carries — and that they can is the reason the affordance is on both sides: what
// the dialog writes is a price on the **stamp**, and a stamp is a stamp whether or not anybody owns
// this one yet.
//
// Two thin builders rather than one row rendering the dialog itself: a hook cannot be called in a
// loop (#531), so the surface keeps one dialog and remembers which row opened it — which is exactly
// what the purchase-order intake screen does.

/** A subject plus the two ids the dialog's vendor map and area name are resolved from. */
export interface QuickPriceTarget {
  subject: QuickPriceSubject;
  areaId: string | null;
  issueId: string | null;
}

/** A give line: the copy it names already **is** a subject structurally — it carries its own
 *  condition, certificate and format — which is why the Copies list and the intake screen hand the
 *  dialog one unchanged. */
export function giveQuickPriceTarget(copy: ItemListItem): QuickPriceTarget {
  return { subject: copy, areaId: copy.areaId, issueId: copy.issueId };
}

/** A receive line: the want key, spelled out. Every field the dialog shows is already on the row —
 *  it has to be, since the row draws them — so this is a rename, not a second read. */
export function receiveQuickPriceTarget(line: TradeReceiveLineData): QuickPriceTarget {
  return {
    subject: {
      stampId: line.stampId,
      stampName: line.stampName,
      issueName: line.issueName,
      issueYear: line.issueYear,
      conditionId: line.conditionId,
      conditionAbbreviation: line.conditionAbbreviation,
      certificateStatusId: line.certificateStatusId,
      certificateStatusName: line.certificateStatusName,
      formatId: line.formatId,
      formatAbbreviation: line.formatAbbreviation,
      catalogNumbers: line.catalogNumbers,
      photos: line.photos,
    },
    areaId: line.areaId,
    issueId: line.issueId,
  };
}
