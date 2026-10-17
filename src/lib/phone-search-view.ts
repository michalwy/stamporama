// The phone search's words (#2004, ADR-0072): what one hit reads as on a narrow row — which stamp it
// is, whether copies are held and how many, whether it is wanted. Pure, so the unit suite holds it;
// the hits themselves are the desk's own search (`searchCollection`), and nothing here decides a
// match or a figure, only how one is said.

import type { CollectionSearchStamp } from "./collection-search";
import { formatEntityNo } from "./quick-jump";

export interface PhoneSearchHit {
  /** The row's first line: the stamp's name, else its leading catalogue number — the phone stamp
   *  screen's own title, so the row and the screen it opens are named alike. */
  title: string;
  /** Every catalogue number, primary first, and the stamp's short number (`#901`). */
  numbers: string;
  /** Where it sits: the area, then the issue's year and name. Empty when none is known. */
  place: string;
  /** How many copies are held, said at once (`3 held`, `Not held`), the variants' figure beside. */
  held: string;
  /** True when at least one copy is held, of the stamp or under its variants. */
  isHeld: boolean;
  /** `Wanted` (with the loudest open want's priority when it is not normal), or null. */
  wanted: string | null;
}

export function phoneSearchHit(stamp: CollectionSearchStamp): PhoneSearchHit {
  const catalogue = stamp.catalogNumbers.map((n) => n.label);
  const stampNo = formatEntityNo(stamp.stampNo);
  const issue = [stamp.issueYear ?? stamp.issuedYear, stamp.issueName].filter(Boolean).join(", ");

  const held: string[] = [stamp.copies > 0 ? `${stamp.copies} held` : "Not held"];
  // The umbrella's second figure (#528): copies filed one level down, under its variants, so a base
  // stamp held only as variants does not read as "not held" and nothing more.
  if (stamp.variantCopies > 0) held.push(`${stamp.variantCopies} under its variants`);

  const wants = stamp.wants;
  let wanted: string | null = null;
  if (wants && wants.openCount > 0) {
    wanted = wants.topPriority === "normal" ? "Wanted" : `Wanted · ${wants.topPriority} priority`;
  }

  return {
    title: stamp.name ?? catalogue[0] ?? `Stamp ${stampNo}`,
    numbers: [...catalogue, stampNo].join(" · "),
    place: [stamp.areaName, issue].filter(Boolean).join(" · "),
    held: held.join(" · "),
    isHeld: stamp.copies > 0 || stamp.variantCopies > 0,
    wanted,
  };
}

/** The line a search that found nothing reads, naming what was searched for. */
export function phoneSearchMiss(query: string): string {
  return `No stamp matches “${query}”.`;
}
