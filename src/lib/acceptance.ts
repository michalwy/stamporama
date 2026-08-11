import "server-only";
import { prisma } from "./db";

// The acceptance vocabulary shared by a want (#532) and by a named profile (#533; ADR-0032 §1/§9).
//
// It lives here rather than in `wants.ts` because a profile is defined *over* the same three axes
// and validated by the same rule — and two implementations of "these ids belong to this collection
// and `null` is a member" is exactly how the two would come to disagree about what "no certificate"
// means. `wants.ts` re-exports the type under its own name, so nothing that already had it changed.

/**
 * A set of acceptable values per axis, where **zero rows means "any"**.
 *
 * Each field is the **whole** set for its axis: the editor owns all three and replaces them as a
 * unit, so a diff computed downstream could not match what was on screen.
 *
 * `null` inside the certificate and format sets is a **member**, not an absence — "no certificate"
 * (ADR-0006 §2) and "single" — which is the reason those two are `(string | null)[]` and condition
 * is not.
 */
export interface AcceptanceInput {
  conditionIds: string[];
  certificateStatusIds: (string | null)[];
  formatIds: (string | null)[];
}

/** Reject an id that is not this collection's, and collapse a set's duplicates — including the
 *  `null` member, which the `NULLS NOT DISTINCT` index would refuse and no editor should send
 *  twice. */
export async function validateAcceptance(
  collectionId: string,
  input: AcceptanceInput
): Promise<AcceptanceInput> {
  const conditionIds = [...new Set(input.conditionIds)];
  const certificateStatusIds = [...new Set(input.certificateStatusIds)];
  const formatIds = [...new Set(input.formatIds)];

  const [conditions, certs, formats] = await Promise.all([
    conditionIds.length
      ? prisma.stampCondition.findMany({
          where: { collectionId, id: { in: conditionIds } },
          select: { id: true },
        })
      : [],
    certificateStatusIds.some((id) => id !== null)
      ? prisma.certificateStatus.findMany({
          where: { collectionId, id: { in: certificateStatusIds.filter((id): id is string => !!id) } },
          select: { id: true },
        })
      : [],
    formatIds.some((id) => id !== null)
      ? prisma.stampFormat.findMany({
          where: { collectionId, id: { in: formatIds.filter((id): id is string => !!id) } },
          select: { id: true },
        })
      : [],
  ]);

  if (conditions.length !== conditionIds.length) {
    throw new Error("A condition is not in this collection.");
  }
  if (certs.length !== certificateStatusIds.filter((id) => id !== null).length) {
    throw new Error("A certificate status is not in this collection.");
  }
  if (formats.length !== formatIds.filter((id) => id !== null).length) {
    throw new Error("A format is not in this collection.");
  }
  return { conditionIds, certificateStatusIds, formatIds };
}
