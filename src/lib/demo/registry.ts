import "server-only";
import type { DbTransaction } from "@/lib/db";

export type SeederContribution = (
  collectionId: string,
  tx: DbTransaction
) => Promise<void>;
