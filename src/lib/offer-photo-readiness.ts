import type { ListingBlocker } from "./listing-preconditions";
import type { ListingTextLimitBlocker } from "./listing-text-limits";
import type { OfferPhotoGenerationStatus } from "./offer-photo-generation";

// Whether an offer's listing photos are in a state that lets it be marked **Ready** — pure, no
// Prisma, and deliberately separate from `listing-preconditions.ts`.
//
// The two gates meet on the same transition but answer different questions. The preconditions are
// one Assistant module's rules about the *goods being misdescribed*, and a marketplace listed by
// hand has nothing to fail there. Photos are not a platform's rule at all: a listing goes up with
// images, and `Ready` means "assembled, waiting to be posted". An offer whose images do not exist —
// or were rendered from a composition it no longer has (#311) — is not assembled, on any platform.
//
// The gate is only asked where there is something to render. An offer whose plan produces no image
// at all (no collage numbers on it and no manual attachment) has no photo work outstanding, and
// refusing it would trap the collector behind a configuration this step never asked for.

export type PhotoReadinessCode =
  | "photos-missing"
  | "photos-outdated"
  | "photos-generating"
  | "photos-failed";

/** One reason an offer's photos are not ready, in the shape every ready-gate reason takes. */
export interface PhotoReadinessBlocker {
  code: PhotoReadinessCode;
  /** The fault in one short line, exactly as {@link ListingBlocker.title} — the ready gate states
   *  both kinds of reason in one hover hint and renders them from one shape. */
  title: string;
  message: string;
  subjects: string[];
  stampIds: string[];
}

/** What a **listing** surface reports about one offer: the Assistant's own preconditions (#406) and
 *  the platform's listing-text caps (#636). The bulk workspace's card and the offer's own screen ask
 *  for exactly this pair — a photo gap is a different question, answered by the photo chip beside
 *  it. */
export type ListingCardBlocker = ListingBlocker | ListingTextLimitBlocker;

/** Everything the ready gate reports, whatever it is about: the Assistant's listing preconditions
 *  (#406/#418), the platform's text caps (#636) and the photo plan's own state. Same shape, so a
 *  surface renders one list. */
export type ReadyBlocker = ListingCardBlocker | PhotoReadinessBlocker;

export interface PhotoReadinessInput {
  status: OfferPhotoGenerationStatus;
  /** The stored images were rendered from inputs that have since changed (#311). */
  outOfDate: boolean;
  /** Images actually stored for this offer right now. */
  storedCount: number;
  /** Images a Generate right now would produce — what makes the check apply at all. */
  plannedCount: number;
}

function blocker(
  code: PhotoReadinessCode,
  title: string,
  message: string
): PhotoReadinessBlocker {
  return { code, title, message, subjects: [], stampIds: [] };
}

/**
 * Why this offer's photos are not ready, empty when they are.
 *
 * `queued` / `running` and "nothing stored" each stand **alone**: a run in flight is answered by
 * waiting rather than by anything the collector could fix, and an offer with no images at all has
 * one thing to do about it — everything else would be noise on top. Out of date and a failed run can
 * report together: the stored images are both stale and the attempt to replace them did not work,
 * which are two different things to know.
 */
export function evaluatePhotoReadiness(input: PhotoReadinessInput): PhotoReadinessBlocker[] {
  // Nothing to render and nothing rendered — this offer's listing simply has no photo plan.
  if (input.plannedCount === 0 && input.storedCount === 0) return [];

  if (input.status === "queued" || input.status === "running") {
    return [
      blocker(
        "photos-generating",
        "The listing photos are still being generated",
        "The listing photos are still being generated. Wait for the run to finish, then mark this offer ready."
      ),
    ];
  }

  if (input.storedCount === 0) {
    return [
      blocker(
        "photos-missing",
        "No listing photos have been generated yet",
        `This offer has no generated listing photos — its plan holds ${input.plannedCount} ${input.plannedCount === 1 ? "image" : "images"}. Generate them on the Photos card before marking it ready.`
      ),
    ];
  }

  const blockers: PhotoReadinessBlocker[] = [];
  if (input.outOfDate) {
    blockers.push(
      blocker(
        "photos-outdated",
        "The generated listing photos are out of date",
        "The generated listing photos are out of date — the offer has changed since they were rendered. Generate them again before marking it ready."
      )
    );
  }
  if (input.status === "failed") {
    blockers.push(
      blocker(
        "photos-failed",
        "The last photo generation failed",
        "The last photo generation failed. Fix what the Photos card reports and generate again before marking this offer ready."
      )
    );
  }
  return blockers;
}
