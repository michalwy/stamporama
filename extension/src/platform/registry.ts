import type { PlatformModule } from "./module";

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

export function registeredModules(): readonly PlatformModule[] {
  return modules;
}
