import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { roundAmount } from "./decimal-input";
import { isOpeningBalance } from "./purchase-kind";
import type { PurchaseExpenseData } from "./purchases";

// A purchase's **non-inventory** lines (ADR-0009 §1) — a magnifier, a catalogue, a stockbook bought
// in the same parcel: a label and a price, absorbing their share of the shipping so the stamps are
// not costed for it.
//
// The table has been in the schema since ADR-0009 and nothing wrote to it until #1390, which gave
// the agent API verbs over it and the order screen the card those verbs' writes are seen and undone
// on. One module for both, so the rules below have one spelling.
//
// **A purchase only.** An opening balance spent nothing, so a priced line that is not stock would
// state money that never left anybody's pocket (#1323).
//
// **Nothing here touches a lot's frozen cost basis.** An expense moves the order's shipping split
// (§3.1 spreads it by line price), which moves the pool an *open* lot will be closed against; a
// closed lot's copies keep the snapshot they were frozen with (§3.5), exactly as they do when the
// shipping itself is edited on the header.
//
// All access is collection-owner-scoped; the checks live here, server-side.

/** The purchase an expense is written onto, proved to be the caller's and to be a purchase. */
async function assertPurchase(ownerId: string, purchaseId: string): Promise<void> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { kind: true, collection: { select: { ownerId: true } } },
  });
  if (!purchase || purchase.collection.ownerId !== ownerId) {
    throw new Error("Purchase not found or access denied.");
  }
  if (isOpeningBalance(purchase)) {
    throw new Error("An opening balance has no expenses: nothing was paid for it.");
  }
}

/** The expense this call is about, proved to be the caller's. */
async function assertExpense(ownerId: string, expenseId: string): Promise<void> {
  const expense = await prisma.purchaseExpense.findUnique({
    where: { id: expenseId },
    select: { purchase: { select: { collection: { select: { ownerId: true } } } } },
  });
  if (!expense || expense.purchase.collection.ownerId !== ownerId) {
    throw new Error("Expense not found or access denied.");
  }
}

export interface PurchaseExpenseInput {
  label: string;
  /** In the purchase's transaction currency. */
  price: number;
}

/** The columns an expense stores, validated: a label is required and a price is never negative. */
function expenseData(input: PurchaseExpenseInput): { label: string; price: Prisma.Decimal } {
  const label = input.label.trim();
  if (!label) throw new Error("An expense needs a label.");
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw new Error("An expense price must be a non-negative number.");
  }
  return { label, price: new Prisma.Decimal(roundAmount(input.price)) };
}

/** A purchase's expenses, oldest first — the order they were added in. */
export async function listPurchaseExpenses(
  ownerId: string,
  purchaseId: string
): Promise<PurchaseExpenseData[]> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { collection: { select: { ownerId: true } } },
  });
  if (!purchase || purchase.collection.ownerId !== ownerId) {
    throw new Error("Purchase not found or access denied.");
  }
  const rows = await prisma.purchaseExpense.findMany({
    where: { purchaseId },
    select: { id: true, label: true, price: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => ({ id: row.id, label: row.label, price: row.price.toFixed(2) }));
}

/** Add an expense to a purchase. Returns its id. */
export async function createPurchaseExpense(
  ownerId: string,
  purchaseId: string,
  input: PurchaseExpenseInput
): Promise<string> {
  await assertPurchase(ownerId, purchaseId);
  const created = await prisma.purchaseExpense.create({
    data: { purchaseId, ...expenseData(input) },
    select: { id: true },
  });
  return created.id;
}

/** Restate an expense's label and price. */
export async function updatePurchaseExpense(
  ownerId: string,
  expenseId: string,
  input: PurchaseExpenseInput
): Promise<void> {
  await assertExpense(ownerId, expenseId);
  await prisma.purchaseExpense.update({ where: { id: expenseId }, data: expenseData(input) });
}

/** Remove an expense. Nothing hangs off one, so nothing else goes with it. */
export async function deletePurchaseExpense(ownerId: string, expenseId: string): Promise<void> {
  await assertExpense(ownerId, expenseId);
  await prisma.purchaseExpense.delete({ where: { id: expenseId } });
}
