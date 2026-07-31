import { registerPlatformModule } from "./registry";
import { colnectModule } from "./colnect";
import { allegroModule } from "./allegro";

// Single place listing the platform modules the extension ships. Importing this module registers
// them (registration is idempotent by id), so both the content script and the popup — separate
// bundles, each with their own registry instance — see the same set.
registerPlatformModule(colnectModule);
registerPlatformModule(allegroModule);

export { findCaptureModuleForUrl, findModuleForUrl } from "./registry";
