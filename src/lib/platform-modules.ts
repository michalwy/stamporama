// Which marketplace a platform `Contact` is, as far as the Assistant is concerned (#406, part of
// #155) — pure, no Prisma.
//
// `Contact.platformModule` holds the id of the extension's `PlatformModule` that knows that
// marketplace's sale form (#408). It exists because the listing preconditions (#406) are **one
// module's rules** — a Colnect item-ID on every stamp, a Colnect grade for every condition — and a
// platform with no module has no such rules to fail. Checking them on a Delcampe listing would
// report a problem about a form nobody is going to fill from here.
//
// Which contact carries it is set in **Settings → Colnect** (`setColnectPlatform`), not on the
// contact form: it is one fact per collection — which platform *is* Colnect — and the collector
// deciding it is already on that tab, setting up the catalog and condition mappings it belongs with.
// Exactly one contact may hold it, since Colnect is one marketplace.
//
// There is deliberately no registry of modules here. Colnect is the only one, and the value is
// written by the one setter above rather than picked from a list, so an enumeration would be a
// vocabulary nothing reads.

/** The value `Contact.platformModule` carries for Colnect, and what the extension recognises. */
export const COLNECT_PLATFORM_MODULE = "colnect";
