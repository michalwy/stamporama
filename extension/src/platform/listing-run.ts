import { canList, type ListingCapableModule } from "./module";
import { findModuleById } from "./registry";
import type {
  ListingFillOutcome,
  ListingPhotoFile,
  ListingSkippedField,
  ListingTask,
  ListingTaskPhoto,
  ListingTaskPhotos,
} from "./listing";

// Driving a listing task through whichever module owns it (#408) — the neutral half of listing,
// with no knowledge of Colnect or of any other marketplace.
//
// It is **two steps**, because a navigation sits between them: the shell first resolves where the
// task has to be filled in, and the page it lands on then fills it. The two are separate content
// script lifetimes, so they cannot be one call however much they read like one.
//
// Everything here is pure — no `chrome.*`, no fetch, no DOM of its own. Who opens the tab and who
// reports the outcome back to the instance belongs to the wiring (#407/#409), which is exactly the
// part a second marketplace would reuse unchanged.

export type ListingTarget =
  | { ok: true; moduleId: string; moduleName: string; url: string }
  | { ok: false; error: string };

/**
 * Where this task is filled in: the module that owns the platform, and the form's URL.
 *
 * Refuses rather than guesses — a task with no module, an unknown module and a module that only reads
 * a marketplace are three different answers, each said in full.
 *
 * An **update** (#462) resolves to the module's edit address instead, and a module with none is a
 * fourth such answer: posting to a marketplace is no promise that a posted listing can be reached
 * again. Which one is asked for is the only thing the mode changes here — everything downstream, the
 * fill included, is the same run.
 */
export function resolveListingTarget(task: ListingTask): ListingTarget {
  const module = resolveListingModule(task);
  if (!module.ok) return module;
  const { listing } = module.module;
  const update = task.mode === "update";
  if (update && !listing.editUrl) {
    return {
      ok: false,
      error: `${module.module.name} listings can be posted from here, but not edited.`,
    };
  }
  try {
    return {
      ok: true,
      moduleId: module.module.id,
      moduleName: module.module.name,
      url: update ? listing.editUrl!(task) : listing.formUrl(task),
    };
  } catch (e) {
    // A task the module cannot express as a form at all — nothing the preconditions (#406) let
    // through, and a refusal rather than a thrown error because the caller has a person to tell.
    return { ok: false, error: messageOf(e) };
  }
}

/**
 * How many bytes of pictures one listing run carries (#411).
 *
 * The images are fetched in the service worker — the only place with the token and the CORS
 * exemption — and handed to the page over extension messaging, which is a size-bounded channel. So
 * there is a ceiling, and the honest thing is to state it: what fits is attached, what does not is
 * named, and the offer's ZIP is still there for the rest. Generous against a plan's rendered
 * listing images, which are sized for a marketplace rather than for archival.
 */
export const LISTING_PHOTO_BUDGET_BYTES = 24 * 1024 * 1024;

/** Which of the task's images this run carries, and why the others are not — decided before a single
 *  byte is fetched. */
export interface ListingPhotoSelection {
  images: ListingTaskPhoto[];
  skipped: ListingSkippedField[];
}

/** How pictures are named in a report — one field for the whole set, since they are attached in one
 *  act and a per-image line would bury the fill's own report under them. */
const PHOTOS_FIELD = "Pictures";

/**
 * The images to hand over for `task`, and the report for the ones left behind (#411).
 *
 * Pure, and deliberately ahead of the fetch: an offer whose pictures are still rendering, or whose
 * platform has no uploader, should cost no network at all.
 *
 * Three separate answers, and they are not the same thing:
 *
 *   • the module cannot attach pictures — **silence**, not a skip. A sale form with no uploader is a
 *     form this Assistant fills completely, and reporting a gap would invent one.
 *   • the plan is not `ready` — a skip naming what Stamporama is doing about it, since the fix is
 *     there rather than here.
 *   • the set does not fit the run's budget — as many as do, **from the front**, because the plan's
 *     order is the priority order (#313) and that is already how the platform's own photo limit
 *     fills it.
 *
 * An **out-of-date** render is none of those and is not reported here at all: what is stored is still
 * a truthful set of pictures of these stamps (#311), and the offer's own Photos card is already where
 * that signal lives. Repeating it in a fill report would turn a signal into a warning.
 */
export function selectListingPhotos(
  task: ListingTask,
  budgetBytes: number = LISTING_PHOTO_BUDGET_BYTES
): ListingPhotoSelection {
  const module = resolveListingModule(task);
  if (!module.ok || !module.module.listing.takesPhotos) return { images: [], skipped: [] };

  const { status, images } = task.photos;
  if (status !== "ready") {
    return { images: [], skipped: [{ field: PHOTOS_FIELD, reason: photoStatusReason(status) }] };
  }
  // An offer whose plan renders nothing is not a gap: plenty of listings are posted without pictures.
  if (images.length === 0) return { images: [], skipped: [] };

  const carried: ListingTaskPhoto[] = [];
  const left: string[] = [];
  let spent = 0;
  for (const image of images) {
    if (spent + image.sizeBytes > budgetBytes && carried.length > 0) {
      left.push(image.fileName);
      continue;
    }
    carried.push(image);
    spent += image.sizeBytes;
  }

  const skipped: ListingSkippedField[] = [];
  if (left.length > 0) {
    skipped.push({
      field: `${PHOTOS_FIELD} — ${left.join(", ")}`,
      reason: `One listing carries at most ${Math.round(budgetBytes / (1024 * 1024))} MB of pictures — attach these by hand from the offer's ZIP.`,
    });
  }
  return { images: carried, skipped };
}

/** Why a plan that is not `ready` has nothing to hand over. Every reason names Stamporama, because
 *  that is where each of them is fixed. */
function photoStatusReason(status: ListingTaskPhotos["status"]): string {
  switch (status) {
    case "queued":
    case "running":
      return "Stamporama is still rendering this offer's pictures — try again once they are ready.";
    case "failed":
      return "Stamporama could not render this offer's pictures.";
    default:
      return "This offer has no rendered pictures yet — generate them in Stamporama.";
  }
}

export type ListingFillResult =
  | { ok: true; moduleId: string; moduleName: string; outcome: ListingFillOutcome }
  | {
      ok: false;
      error: string;
      /** The page may still **become** the form on its own (#419) — an interstitial that reloads into
       *  it, a redirect on its way. The wiring answers this by waiting for the next load and asking
       *  again, rather than by reporting a listing that was never filled. */
      retry?: boolean;
    };

/**
 * Fill `doc` — the page at `url` — from `task` and the run's `photos`, through the task's own module.
 *
 * The page is checked against the module's own `isFormUrl` first: the collector may have navigated
 * on, or the platform may have answered with a sign-in page, and filling a form that is not the sale
 * form is the one outcome worth refusing outright. Nothing is submitted here or anywhere below.
 *
 * The **document** is then checked too (#419), and that refusal is a different one: the address is
 * the sale form's and its contents are not, which is what an anti-bot interstitial looks like from
 * here — a page on its way to becoming the form. It is reported as `retry`, so the wiring waits for
 * the reload rather than filling nothing and calling it a fill.
 *
 * **The pictures go in here** (#719), which is why this is async and why the bytes cross with the
 * task rather than in a message of their own. Where in the form they land is the module's, and the
 * two modules answer differently: Colnect's uploader posts each picture the moment it is handed over
 * (#402) so its fill leaves them until the very end, while Allegro's wizard refuses to be filled any
 * further until it has one, so its fill hands them over in the middle. Both are true of the form
 * being filled and neither is a rule this shell can hold.
 */
export async function fillListing(
  task: ListingTask,
  doc: Document,
  url: string,
  photos: readonly ListingPhotoFile[] = []
): Promise<ListingFillResult> {
  const module = resolveListingModule(task);
  if (!module.ok) return module;
  const { listing } = module.module;
  if (!listing.isFormUrl(url)) {
    return { ok: false, error: `This page is not ${module.module.name}'s listing form.` };
  }
  if (!listing.isFormDocument(doc)) {
    return {
      ok: false,
      error: `${module.module.name} has not served the listing form on this page yet.`,
      retry: true,
    };
  }
  try {
    return {
      ok: true,
      moduleId: module.module.id,
      moduleName: module.module.name,
      outcome: await listing.fill(doc, task, photos),
    };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export type ListingPrepareResult =
  | { ok: true; advanced: boolean }
  | { ok: false; error: string };

/**
 * Make this page ready to be filled (#493) — run **before** every fill, and a no-op for every module
 * that has nothing to do here.
 *
 * Two jobs, and they are the same job at two distances from the form. A page that is at the sale
 * form's address but is *not* the form is walked one step closer to it (Allegro answers one address
 * with three different pages). A page that **is** the form may still be hiding fields this task
 * needs behind a control of its own, and revealing them is asynchronous, which is exactly why it
 * cannot be part of {@link fillListing}.
 *
 * `advanced: false` is a module with no `prepare` — every module but Allegro's — and the shell then
 * behaves precisely as it did before this existed.
 */
export async function prepareListing(
  task: ListingTask,
  doc: Document,
  url: string
): Promise<ListingPrepareResult> {
  const module = resolveListingModule(task);
  if (!module.ok) return module;
  const { listing } = module.module;
  if (!listing.isFormUrl(url)) {
    return { ok: false, error: `This page is not ${module.module.name}'s listing form.` };
  }
  if (!listing.prepare) return { ok: true, advanced: false };
  try {
    await listing.prepare(doc, task);
    return { ok: true, advanced: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

/**
 * The listed entry's URL, when `url` is where a submitted sale form landed — asked of the module the
 * listing was filled by, and null for anything else (#412).
 *
 * Keyed on a **module id** rather than on a task, because the question is asked long after the fill:
 * the collector may submit minutes later, and what is remembered in the meantime is the listing's
 * tab and the module that owns it, never the whole payload. An unknown or read-only module is null
 * too — a page nobody claims is not a listing that went live.
 */
/**
 * The listed entry's URL as the **page in front of the collector** states it (#493) — for a
 * marketplace that confirms a submitted form without navigating, and null for everyone else.
 *
 * Keyed on a module id for {@link resolveListedUrl}'s reason: the question is asked long after the
 * fill, and what is remembered in the meantime is the tab and the module that owns it.
 */
export function resolveListedUrlInDocument(moduleId: string, doc: Document): string | null {
  const module = findModuleById(moduleId);
  if (!module || !canList(module) || !module.listing.listedUrlInDocument) return null;
  try {
    return module.listing.listedUrlInDocument(doc);
  } catch {
    // A module refusing to read a page is not an outcome worth reporting, exactly as above.
    return null;
  }
}

export function resolveListedUrl(moduleId: string, url: string): string | null {
  const module = findModuleById(moduleId);
  if (!module || !canList(module)) return null;
  try {
    return module.listing.listedUrl(url);
  } catch {
    // A module refusing to read a URL is not an outcome worth reporting: the collector is on a page,
    // and the listing simply has not been recognised yet.
    return null;
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type ResolvedModule =
  | { ok: true; module: ListingCapableModule }
  | { ok: false; error: string };

/** The listing-capable module a task names, or why there is none. */
function resolveListingModule(task: ListingTask): ResolvedModule {
  const id = task.platform.module;
  if (!id) {
    return { ok: false, error: `${task.platform.name} is not listed through the Assistant.` };
  }
  const module = findModuleById(id);
  if (!module) {
    return { ok: false, error: `This Assistant has no module "${id}" for ${task.platform.name}.` };
  }
  if (!canList(module)) {
    return { ok: false, error: `${module.name} pages can be matched, but not listed from here.` };
  }
  return { ok: true, module };
}
