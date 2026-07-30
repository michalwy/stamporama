import { canList, type ListingCapableModule, type PlatformModule } from "./module";

// The shell's module registry. Platform modules register themselves at import time; the content
// script consults the registry for one matching the current page. The shell ships with none —
// #249 adds the Colnect module by calling `registerPlatformModule` from the content entrypoint.
const modules: PlatformModule[] = [];

/** Register a module. Idempotent by `id` — safe when the content script is re-injected on demand. */
export function registerPlatformModule(module: PlatformModule): void {
  if (modules.some((m) => m.id === module.id)) return;
  modules.push(module);
}

/** The first registered module that handles `url`, or null when none does. */
export function findModuleForUrl(url: string): PlatformModule | null {
  return modules.find((m) => m.matches(url)) ?? null;
}

/** The module with this id, or null. Ids come off a listing task (`platform.module`, #406) rather
 *  than off a URL: a listing starts from an offer, before any marketplace page is open. */
export function findModuleById(id: string): PlatformModule | null {
  return modules.find((m) => m.id === id) ?? null;
}

/** The module with this id **if it can list**, or null — for the id and for the missing half alike.
 *  Callers that want to tell the two apart use {@link findModuleById} plus `canList`. */
export function findListingModule(id: string): ListingCapableModule | null {
  const module = findModuleById(id);
  return module && canList(module) ? module : null;
}

export function registeredModules(): readonly PlatformModule[] {
  return modules;
}

/** What one module can do, by name (#408). */
export type ModuleCapability = "extract" | "listing";

export interface ModuleReport {
  id: string;
  name: string;
  capabilities: ModuleCapability[];
}

/** Every registered module and which halves it carries. This is what a surface asking "can the
 *  Assistant post to this platform?" reads — never a hard-coded list of ids, so a module added later
 *  is answered for without touching the asker. */
export function moduleReports(): ModuleReport[] {
  return modules.map((m) => ({
    id: m.id,
    name: m.name,
    capabilities: canList(m) ? ["extract", "listing"] : ["extract"],
  }));
}
