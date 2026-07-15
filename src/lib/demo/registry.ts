import "server-only";
import { PrismaClient } from "@/generated/prisma/client";

export type SeederContribution = (
  collectionId: string,
  tx: PrismaClient
) => Promise<void>;
