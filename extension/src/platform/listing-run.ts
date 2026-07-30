import { canList, type ListingCapableModule } from "./module";
import { findModuleById } from "./registry";
import type { ListingFillOutcome, ListingTask } from "./listing";

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

/** Where this task is filled in: the module that owns the platform, and the sale form's URL.
 *  Refuses rather than guesses — a task with no module, an unknown module and a module that only
 *  reads a marketplace are three different answers, each said in full. */
export function resolveListingTarget(task: ListingTask): ListingTarget {
  const module = resolveListingModule(task);
  if (!module.ok) return module;
  try {
    return {
      ok: true,
      moduleId: module.module.id,
      moduleName: module.module.name,
      url: module.module.listing.formUrl(task),
    };
  } catch (e) {
    // A task the module cannot express as a form at all — nothing the preconditions (#406) let
    // through, and a refusal rather than a thrown error because the caller has a person to tell.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ListingFillResult =
  | { ok: true; moduleId: string; moduleName: string; outcome: ListingFillOutcome }
  | { ok: false; error: string };

/**
 * Fill `doc` — the page at `url` — from `task`, through the task's own module.
 *
 * The page is checked against the module's own `isFormUrl` first: the collector may have navigated
 * on, or the platform may have answered with a sign-in page, and filling a form that is not the sale
 * form is the one outcome worth refusing outright. Nothing is submitted here or anywhere below.
 */
export function fillListing(task: ListingTask, doc: Document, url: string): ListingFillResult {
  const module = resolveListingModule(task);
  if (!module.ok) return module;
  const { listing } = module.module;
  if (!listing.isFormUrl(url)) {
    return { ok: false, error: `This page is not ${module.module.name}'s listing form.` };
  }
  try {
    return {
      ok: true,
      moduleId: module.module.id,
      moduleName: module.module.name,
      outcome: listing.fill(doc, task),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
