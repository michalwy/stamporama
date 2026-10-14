import "server-only";
import type { DbTransaction } from "./db";
import { settleSupplyUses } from "./supply-stock";

// Keeping a packing supply's uses in step with its stock (#1898, ADR-0068 §7).
//
// Every write that changes what a supply holds or what it is asked for — a sale's supply line
// written, changed or removed, a sale deleted, a use without a sale written, changed or removed
// (#1900), a purchase's supply line (a batch) written, changed or removed, a purchase deleted — calls
// `settleSupplies` in the same transaction, after its own write.
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

  const [batches, saleLines, ownUses] = await Promise.all([
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
    // Uses without a sale (#1900) take from the same batches under the same rule.
    tx.supplyOwnUse.findMany({
      where: { supplyId },
      select: {
        id: true,
        quantity: true,
        createdAt: true,
        usedAt: true,
        takes: { select: { id: true, batchId: true, quantity: true } },
      },
    }),
  ]);

  // One list of lines for the rule, each keyed by its kind so a sale line and an own use can never
  // be taken for each other; the rows they came from, to write the difference back to.
  const lines = [
    ...saleLines.map((l) => ({
      key: `sale:${l.id}`,
      kind: "sale" as const,
      id: l.id,
      quantity: l.quantity,
      createdAt: l.createdAt,
      usedOn: l.sale.soldAt,
      takes: l.uses,
    })),
    ...ownUses.map((u) => ({
      key: `own:${u.id}`,
      kind: "own" as const,
      id: u.id,
      quantity: u.quantity,
      createdAt: u.createdAt,
      usedOn: u.usedAt,
      takes: u.takes,
    })),
  ];

  const current = lines.flatMap((l) =>
    l.takes.map((t) => ({ lineId: l.key, batchId: t.batchId, quantity: t.quantity }))
  );
  const settled = settleSupplyUses(
    batches.map((b) => ({
      id: b.id,
      boughtOn: b.purchase.purchasedAt.toISOString().slice(0, 10),
      createdAt: b.createdAt.toISOString(),
      quantity: b.quantity,
    })),
    lines.map((l) => ({
      id: l.key,
      usedOn: l.usedOn.toISOString().slice(0, 10),
      createdAt: l.createdAt.toISOString(),
      quantity: l.quantity,
    })),
    current
  );

  // Write only the difference: a take that still stands keeps its row.
  const pair = (lineKey: string, batchId: string) => `${lineKey}\u0000${batchId}`;
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const wanted = new Map(settled.map((t) => [pair(t.lineId, t.batchId), t]));
  const existing = new Map(
    lines.flatMap((l) => l.takes.map((t) => [pair(l.key, t.batchId), { ...t, kind: l.kind }] as const))
  );

  const drop = [...existing].filter(([k]) => !wanted.has(k)).map(([, t]) => t);
  const dropSale = drop.filter((t) => t.kind === "sale").map((t) => t.id);
  const dropOwn = drop.filter((t) => t.kind === "own").map((t) => t.id);
  if (dropSale.length > 0) await tx.saleSupplyUse.deleteMany({ where: { id: { in: dropSale } } });
  if (dropOwn.length > 0) await tx.supplyOwnUseTake.deleteMany({ where: { id: { in: dropOwn } } });
  for (const [k, take] of wanted) {
    const line = byKey.get(take.lineId)!;
    const row = existing.get(k);
    if (!row) {
      if (line.kind === "sale") {
        await tx.saleSupplyUse.create({
          data: { lineId: line.id, batchId: take.batchId, quantity: take.quantity },
        });
      } else {
        await tx.supplyOwnUseTake.create({
          data: { useId: line.id, batchId: take.batchId, quantity: take.quantity },
        });
      }
    } else if (row.quantity !== take.quantity) {
      if (line.kind === "sale") {
        await tx.saleSupplyUse.update({ where: { id: row.id }, data: { quantity: take.quantity } });
      } else {
        await tx.supplyOwnUseTake.update({ where: { id: row.id }, data: { quantity: take.quantity } });
      }
    }
  }
}
