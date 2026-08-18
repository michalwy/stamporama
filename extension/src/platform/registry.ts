import {
  canCapture,
  canExtract,
  canList,
  canReadOrders,
  type CaptureCapableModule,
  type ExtractionCapableModule,
  type ListingCapableModule,
  type OrdersCapableModule,
  type PlatformModule,
} from "./module";

// The shell's module registry. Platform modules register themselves at import time; the content
// script consults the registry for one matching the current page. The shell ships with none —
// #249 adds the Colnect module by calling `registerPlatformModule` from the content entrypoint.
const modules: PlatformModule[] = [];

/** Register a module. Idempotent by `id` — safe when the content script is re-injected on demand. */
export function registerPlatformModule(module: PlatformModule): void {
  if (modules.some((m) => m.id === module.id)) return;
  modules.push(module);
}

/** The first registered module that **extracts** from `url`, or null when none does. A module with
 *  no extraction half is not a candidate here at all: a page it handles for another reason — an
 *  Allegro auction, say — holds no catalogue items, and answering with it would report zero of
 *  something the page never had. */
export function findModuleForUrl(url: string): ExtractionCapableModule | null {
  return modules.find((m): m is ExtractionCapableModule => canExtract(m) && m.extraction.matches(url)) ?? null;
}

/** The first registered module that can **capture a lot** from `url`, or null when none can (#355).
 *  Separate from {@link findModuleForUrl} for the same reason the halves are separate: one page can
 *  be a catalogue entry, a listing to capture, both, or neither. */
export function findCaptureModuleForUrl(url: string): CaptureCapableModule | null {
  return (
    modules.find((m): m is CaptureCapableModule => canCapture(m) && m.capture.isListingUrl(url)) ??
    null
  );
}

/** The first registered module that reads a seller's own **orders** off `url`, or null when none
 *  does (#612). A fourth question about a page for the same reason as the third: a marketplace's
 *  order screens are neither a catalogue, nor a listing, nor an auction to bid on. */
export function findOrdersModuleForUrl(url: string): OrdersCapableModule | null {
  return modules.find((m): m is OrdersCapableModule => canReadOrders(m) && m.orders.matches(url)) ?? null;
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

/** What one module can do, by name (#408/#355). */
export type ModuleCapability = "extract" | "listing" | "capture" | "orders";

export interface ModuleReport {
  id: string;
  name: string;
  capabilities: ModuleCapability[];
}

/** Every registered module and which halves it carries. This is what a surface asking "can the
 *  Assistant post to this platform?" reads — never a hard-coded list of ids, so a module added later
 *  is answered for without touching the asker. */
export function moduleReports(): ModuleReport[] {
  return modules.map((m) => {
    const capabilities: ModuleCapability[] = [];
    if (canExtract(m)) capabilities.push("extract");
    if (canList(m)) capabilities.push("listing");
    if (canCapture(m)) capabilities.push("capture");
    if (canReadOrders(m)) capabilities.push("orders");
    return { id: m.id, name: m.name, capabilities };
  });
}
