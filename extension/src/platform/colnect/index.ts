import type { PlatformModule } from "../module";
import { extractColnect, matchesColnectUrl } from "./parse";

// The Colnect platform module (#249): the first module plugged into the neutral shell (#253). Pure
// DOM extraction — no knowledge of profiles or matching.
export const colnectModule: PlatformModule = {
  id: "colnect",
  name: "Colnect",
  matches: matchesColnectUrl,
  extract: extractColnect,
};
