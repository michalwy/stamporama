// Which marketplace a platform `Contact` is, as far as the Assistant is concerned (#406, part of
// #155) — pure, no Prisma.
//
// `Contact.platformModule` holds the id of the extension's `PlatformModule` that knows that
// marketplace's sale form (#408). It exists because the listing preconditions (#406) are **one
// module's rules** — a Colnect item-ID on every stamp, a Colnect grade for every condition — and a
// platform with no module has no such rules to fail. Checking them on a Delcampe listing would
// report a problem about a form nobody is going to fill from here.
//
// Which contact carries it is set on that marketplace's **own Settings tab** — Colnect's beside the
// catalog and condition mappings it belongs with, Allegro's on a tab of its own — never on the
// contact form: it is one fact per collection ("which platform *is* Colnect"), and the collector
// deciding it is already on that tab. Exactly one contact may hold each id, since each is one
// marketplace; `setModulePlatform` is what enforces that.
//
// There is still deliberately no registry of modules here, and no enumeration to pick from. Each id
// is written by the one setter that owns its tab, so the ids are named where they are used and a
// list of them would be a vocabulary nothing reads.

/** The value `Contact.platformModule` carries for Colnect, and what the extension recognises. */
export const COLNECT_PLATFORM_MODULE = "colnect";

/**
 * The same, for Allegro (#355).
 *
 * Allegro's module carries no listing half — nothing here posts a sale form to it — so this marker
 * gates nothing about offers. What it names is the platform an **auction lot captured from an
 * allegro.pl page** belongs to: a capture never asks which marketplace it is on, because the page it
 * was read from already answers that. It is the one fact a capture cannot read off the listing,
 * since the platform is a `Contact` of this collection and not something Allegro knows about.
 */
export const ALLEGRO_PLATFORM_MODULE = "allegro";

/**
 * Whether a platform's module has a **listing half** — i.e. whether anything here knows how to fill
 * that marketplace's sale form (#471).
 *
 * Only Colnect's does. "Names a module" and "can be listed to" were the same question while Colnect
 * was the only module, and everything about listing was written against the first: the preconditions
 * (#406), the listing kit (#405), **⚡ List via Assistant** and the platform-catalogue card (#423).
 * Allegro's marker (#355) then made them different — it names the marketplace a captured auction lot
 * belongs to and carries no sale form — and the truthiness test quietly promoted it to a listable
 * platform, so an Allegro offer was shown Colnect's catalog/market links and refused `ready` over
 * missing Colnect item-IDs.
 *
 * So the test is a named question and not `!== null`: a module id is not a promise about listing,
 * and a third one added for some other purpose must not inherit Colnect's rules by existing.
 */
export function hasListingModule(platformModule: string | null): boolean {
  return platformModule === COLNECT_PLATFORM_MODULE;
}
