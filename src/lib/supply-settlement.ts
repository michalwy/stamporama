import "server-only";
import type { DbTransaction } from "./db";
import { settleSupplyUses } from "./supply-stock";

// Keeping a packing supply's uses in step with its stock (#1898, ADR-0068 §7).
//
// Every write that changes what a supply holds or what it is asked for — a sale's supply line
// written, changed or removed, a sale deleted, a purchase's supply line (a batch) written, changed or
// removed, a purchase deleted — calls `settleSupplies` in the same transaction, after its own write.
// The rule itself is pure (`settleSupplyUses`); this reads one supply's batches, lines and takes,
// and writes back what changed.
//
// The supply's row is locked first, so two writes settling one supply at once queue rather than both
// handing out the same units.

/** Settle each of `supplyIds` (duplicates and an empty list are fine). Run inside the caller's
 * transaction, after the write that called for it. */
export async function settleSupplies(
  tx: DbTransaction,
  supplyIds: Iterable<string>
): Promise<void> {
  // Sorted, so two transactions settling overlapping supplies lock them in one order.
  for (const supplyId of [...new Set(supplyIds)].sort()) {
    await settleSupply(tx, supplyId);
  }
}

async function settleSupply(tx: DbTransaction, supplyId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "packing_supply" WHERE "id" = ${supplyId} FOR UPDATE`;

  const [batches, lines] = await Promise.all([
    tx.purchaseSupplyLine.findMany({
      where: { supplyId },
      select: { id: true, quantity: true, createdAt: true, purchase: { select: { purchasedAt: true } } },
    }),
    tx.saleSupplyLine.findMany({
      where: { supplyId },
      select: {
        id: true,
        quantity: true,
        createdAt: true,
        sale: { select: { soldAt: true } },
        uses: { select: { id: true, batchId: true, quantity: true } },
      },
    }),
  ]);

  const current = lines.flatMap((l) =>
    l.uses.map((u) => ({ lineId: l.id, batchId: u.batchId, quantity: u.quantity }))
  );
  const settled = settleSupplyUses(
    batches.map((b) => ({
      id: b.id,
      boughtOn: b.purchase.purchasedAt.toISOString().slice(0, 10),
      createdAt: b.createdAt.toISOString(),
      quantity: b.quantity,
    })),
    lines.map((l) => ({
      id: l.id,
      usedOn: l.sale.soldAt.toISOString().slice(0, 10),
      createdAt: l.createdAt.toISOString(),
      quantity: l.quantity,
    })),
    current
  );

  // Write only the difference: a take that still stands keeps its row.
  const key = (lineId: string, batchId: string) => `${lineId}\u0000${batchId}`;
  const wanted = new Map(settled.map((t) => [key(t.lineId, t.batchId), t]));
  const existing = new Map(
    lines.flatMap((l) => l.uses.map((u) => [key(l.id, u.batchId), u] as const))
  );

  const drop = [...existing].filter(([k]) => !wanted.has(k)).map(([, u]) => u.id);
  if (drop.length > 0) await tx.saleSupplyUse.deleteMany({ where: { id: { in: drop } } });
  for (const [k, take] of wanted) {
    const row = existing.get(k);
    if (!row) {
      await tx.saleSupplyUse.create({
        data: { lineId: take.lineId, batchId: take.batchId, quantity: take.quantity },
      });
    } else if (row.quantity !== take.quantity) {
      await tx.saleSupplyUse.update({ where: { id: row.id }, data: { quantity: take.quantity } });
    }
  }
}
