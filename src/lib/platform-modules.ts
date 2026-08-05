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
 * What one module's sale form asks of an offer before it can be filled (#493).
 *
 * The listing preconditions (#406) were written while Colnect was the only module that could list,
 * so its two questions — a Colnect item-ID on every stamp (#247), a Colnect grade for every
 * condition (#404) — were asked of every listable platform as though they were the *shell's* rules.
 * They are not: Allegro lists stamps by category (#488) and has no catalogue of ours to point at and
 * no grade vocabulary to translate into, so asking them of an Allegro offer refuses it `ready` over
 * a catalogue it is not listed in.
 *
 * So a module's rules are stated here, one entry per module, and the neutral evaluation asks only
 * what the entry claims. What stays shell-wide is deliberately small — being Ready, holding copies,
 * and the sets being interchangeable (a quantity says "N of the same thing" on every marketplace
 * there is, #406) — because those are properties of the *offer*, not of anyone's form.
 */
export interface ListingModuleRules {
  /** Every stamp must carry this platform's catalog item-ID (#247): its form points at a catalogue
   *  entry, and there is nothing to point at without one. */
  requiresCatalogItemId: boolean;
  /** Every condition must be translated into the platform's own grade vocabulary (#404). Where this
   *  is false the module's form has no grade field, or grades what it sells some other way — and the
   *  condition map is then not even read (#406's exemption, applied per module). */
  requiresPlatformCondition: boolean;
  /** Where the collector maps those grades, by the name of the screen — the refusal names it, and
   *  only a module that asks for them has one. Null with {@link requiresPlatformCondition}. */
  conditionMappingLocation: string | null;
}

const LISTING_MODULE_RULES: Record<string, ListingModuleRules> = {
  [COLNECT_PLATFORM_MODULE]: {
    requiresCatalogItemId: true,
    requiresPlatformCondition: true,
    conditionMappingLocation: "Settings → Colnect",
  },
  // Allegro's form asks for **neither** (#493). A listing is filed under a category with that
  // category's parameters (#488), not against a catalogue entry, so there is no item-ID to point at;
  // and the condition is one of those parameters, answered in Allegro's own words, so there is no
  // second grade vocabulary to map ours into. What an Allegro listing does need — a category, a
  // profile, a title Allegro will take — is `allegro-listing-rules.ts`, because those are refusals
  // the API path shares and none of them is a fault in the *goods*, which is all this file's rules
  // are about.
  [ALLEGRO_PLATFORM_MODULE]: {
    requiresCatalogItemId: false,
    requiresPlatformCondition: false,
    conditionMappingLocation: null,
  },
};

/**
 * The listing rules of `platformModule`, or **null** when it has no listing half at all — i.e. when
 * nothing here knows how to fill that marketplace's sale form (#471).
 *
 * A platform naming no module, and a module that only captures (Allegro's, #355, while it carried
 * capture alone), both answer null: a marketplace the Assistant cannot post to is a perfectly good
 * marketplace, listed by hand.
 */
export function listingModuleRules(platformModule: string | null): ListingModuleRules | null {
  if (!platformModule) return null;
  return LISTING_MODULE_RULES[platformModule] ?? null;
}

/**
 * Whether a platform's module has a **listing half** (#471) — the question **⚡ List via Assistant**
 * and the listing kit (#405) ask.
 *
 * "Names a module" and "can be listed to" were the same question while Colnect was the only module,
 * and everything about listing was written against the first. Allegro's marker (#355) then made them
 * different — it names the marketplace a captured auction lot belongs to — and the truthiness test
 * quietly promoted it to a listable platform, so an Allegro offer was shown Colnect's catalog/market
 * links and refused `ready` over missing Colnect item-IDs.
 *
 * So the test is a named question and not `!== null`: a module id is not a promise about listing,
 * and a third one added for some other purpose must not inherit anyone's rules by existing. What a
 * listable platform's rules then *are* is {@link listingModuleRules} — and that is a second question,
 * because Allegro gaining a listing half must not gain Colnect's catalogue with it.
 */
export function hasListingModule(platformModule: string | null): boolean {
  return listingModuleRules(platformModule) !== null;
}

/**
 * Whether this platform's module lists against a **catalogue of its own** — the Colnect item-ID on
 * every stamp, and with it the platform-catalogue card (#423) and its market links.
 *
 * The same fact as {@link ListingModuleRules.requiresCatalogItemId}, asked by the surfaces that are
 * not evaluating preconditions: the card exists to show what a stamp *is* on the marketplace and
 * what it is being asked for there, and a marketplace that lists by category has neither page.
 */
export function usesPlatformCatalogue(platformModule: string | null): boolean {
  return listingModuleRules(platformModule)?.requiresCatalogItemId ?? false;
}

/** Whether this platform's module needs our conditions translated into its own grades (#404) — the
 *  question the condition map is loaded on. */
export function usesPlatformConditions(platformModule: string | null): boolean {
  return listingModuleRules(platformModule)?.requiresPlatformCondition ?? false;
}
