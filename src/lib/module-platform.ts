import "server-only";
import { prisma } from "./db";

// Which `Platform` **is** a given marketplace (#406, extended by #355; #1955) — one question asked
// once per module id.
//
// Since #1955 (ADR-0071) every collection holds exactly one platform per module, marked by
// `Platform.platformModule` and named after it, so the question no longer has a setter: what the
// collector decides on a module's page is whether its platform is **switched on**. A platform
// switched off answers null here, which is the state every caller already handled as *not set up* —
// a capture refused, an import with nowhere to land — so switching a module off leaves it exactly
// where an unchosen platform used to.
//
// Deliberately neutral about what the marker *switches on*. For Colnect it gates the listing
// preconditions (#406); for Allegro it names the platform a captured auction lot belongs to (#355).
// Neither is knowledge this module has, and adding a module should not need it.

/** The platform of `moduleId` while it is switched on, or null when it is off (or not made yet). */
export async function getModulePlatform(
  collectionId: string,
  moduleId: string
): Promise<{ id: string; name: string } | null> {
  return prisma.platform.findFirst({
    where: { collectionId, platformModule: moduleId, enabled: true },
    select: { id: true, name: true },
  });
}
