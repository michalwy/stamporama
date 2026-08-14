import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getOrFetchRate } from "./exchange-rates";
import { resolvePurchaseContact } from "./contacts";
import { allocateEntityNumber } from "./items";
import { realizedProceedsForItems } from "./sales";
import { summarizePurchaseReturn, type PurchaseReturn } from "./purchase-return";
import { collectScanStorageRefs, deleteScanStorageRefs } from "./scan-sheets";

// Server-side domain logic for purchase records (ADR-0009, #120). A `Purchase` is one
// acquisition event: an optional supplier (`Contact`), a date, a single transaction
// currency, a shared shipping cost, and a physical delivery status. Its priced lines
// are `PurchaseLot`s (inventory) and `PurchaseExpense`s (non-inventory). This module
// owns CRUD only; lot close / item resolution and cost allocation are #121/#122 and
// live elsewhere (see `purchase-allocation.ts`).
//
// All access is collection-owner-scoped; the checks live here, server-side.

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, baseCurrency: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** Resolve the owning collection of a purchase, asserting ownership. Returns the
 * collection id + base currency so mutations can (re)freeze the FX rate. */
async function assertPurchaseOwner(
  ownerId: string,
  purchaseId: string
): Promise<{ collectionId: string; baseCurrency: string }> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { collection: { select: { id: true, ownerId: true, baseCurrency: true } } },
  });
  if (!purchase || purchase.collection.ownerId !== ownerId) {
    throw new Error("Purchase not found or access denied.");
  }
  return {
    collectionId: purchase.collection.id,
    baseCurrency: purchase.collection.baseCurrency,
  };
}

/** Physical delivery status of the whole shipment (ADR-0009 §1). */
export type PurchaseStatus = "preparing" | "in_transit" | "arrived";
const VALID_STATUS = new Set<PurchaseStatus>(["preparing", "in_transit", "arrived"]);

export type PurchaseSortBy = "purchasedAt" | "createdAt";

/** A priced inventory line. Intake `status` is managed by the close flow (#121); the
 * CRUD dialog only reads/writes the price and never opens the lifecycle here. */
export interface PurchaseLotData {
  id: string;
  price: string;
  status: string;
}

/** A priced non-inventory line: a label and a price. */
export interface PurchaseExpenseData {
  id: string;
  label: string;
  price: string;
}

/** Full purchase, with its lines, for the edit dialog. */
export interface PurchaseData {
  id: string;
  collectionId: string;
  contactId: string | null;
  contactName: string | null;
  platformId: string | null;
  platformName: string | null;
  purchasedAt: string;
  currency: string;
  fxRateToBase: string | null;
  shippingCost: string | null;
  status: string;
  createdAt: Date;
  lots: PurchaseLotData[];
  expenses: PurchaseExpenseData[];
}

/** A row in the purchases list. `total` is lots + expenses + shipping, in the
 * transaction currency (2 dp). */
export interface PurchaseListItem {
  id: string;
  /** The short per-collection purchase number (#432) — what the quick-jump box takes after `p`. */
  purchaseNo: number;
  contactId: string | null;
  contactName: string | null;
  platformId: string | null;
  platformName: string | null;
  purchasedAt: string;
  currency: string;
  status: string;
  shippingCost: string | null;
  lotCount: number;
  expenseCount: number;
  total: string;
}

export interface PurchaseListFilters {
  offset?: number;
  status?: PurchaseStatus;
  contactId?: string;
  sortBy?: PurchaseSortBy;
  sortDir?: "asc" | "desc";
  pageSize?: number;
}

export interface PaginatedPurchasesResult {
  items: PurchaseListItem[];
  nextCursor: string | null;
}

/** A lot line coming from the dialog (id present ⇒ update existing, absent ⇒ create). */
export interface PurchaseLotInput {
  id?: string;
  price: number;
}

/** An expense line from the dialog. */
export interface PurchaseExpenseInput {
  id?: string;
  label: string;
  price: number;
}

export interface PurchaseCreateInput {
  // Supplier / platform may arrive as a picked id, or as a typed name that is resolved to
  // an existing contact or created on save (#120). When both are present the id wins.
  contactId?: string | null;
  contactName?: string | null;
  platformId?: string | null;
  platformName?: string | null;
  purchasedAt: string;
  currency: string;
  shippingCost?: number | null;
  status?: PurchaseStatus;
  // No line items here. Both inventory lots and non-inventory expenses are the order's
  // line items and are managed during lot intake (#121); the purchase dialog only captures
  // the header and the shared shipping cost.
}

export type PurchaseUpdateInput = PurchaseCreateInput;

function toDate(iso: string): Date {
  // `purchasedAt` is a DATE column; parse the yyyy-mm-dd form at UTC midnight so the
  // stored day matches what the user picked regardless of server timezone.
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid purchase date.");
  return d;
}

function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function normalizeStatus(status: PurchaseStatus | undefined): PurchaseStatus {
  if (status && VALID_STATUS.has(status)) return status;
  return "preparing";
}

/** Freeze the base-currency FX rate for a purchase (ADR-0009 §4). Best-effort: a
 * lookup/network failure with no cached rate yields `null` (stored as unknown) rather
 * than blocking the save — the rate can be backfilled by the close flow later. */
async function freezeFxRate(
  collectionId: string,
  currency: string,
  baseCurrency: string
): Promise<Prisma.Decimal | null> {
  if (currency === baseCurrency) return null;
  try {
    const { rate } = await getOrFetchRate(collectionId, currency, baseCurrency);
    return new Prisma.Decimal(rate);
  } catch {
    return null;
  }
}

function money(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n.toFixed(2));
}

/** Paginated purchases for a collection (offset-based, mirroring `listItemsPaginated`).
 * Newest purchase date first by default. */
export async function listPurchasesPaginated(
  ownerId: string,
  collectionId: string,
  filters: PurchaseListFilters = {}
): Promise<PaginatedPurchasesResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;
  const dir = filters.sortDir ?? "desc";
  const sortBy = filters.sortBy ?? "purchasedAt";
  const orderBy: Prisma.PurchaseOrderByWithRelationInput[] =
    sortBy === "createdAt" ? [{ createdAt: dir }] : [{ purchasedAt: dir }, { createdAt: dir }];

  const rows = await prisma.purchase.findMany({
    where: {
      collectionId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.contactId ? { contactId: filters.contactId } : {}),
    },
    orderBy,
    take: pageSize + 1,
    skip: offset,
    select: {
      id: true,
      purchaseNo: true,
      contactId: true,
      platformId: true,
      purchasedAt: true,
      currency: true,
      status: true,
      shippingCost: true,
      contact: { select: { name: true } },
      platform: { select: { name: true } },
      lots: { select: { price: true } },
      expenses: { select: { price: true } },
    },
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  const items: PurchaseListItem[] = page.map((row) => {
    const linesTotal = [...row.lots, ...row.expenses].reduce(
      (sum, l) => sum.add(l.price),
      new Prisma.Decimal(0)
    );
    const total = row.shippingCost ? linesTotal.add(row.shippingCost) : linesTotal;
    return {
      id: row.id,
      purchaseNo: row.purchaseNo,
      contactId: row.contactId,
      contactName: row.contact?.name ?? null,
      platformId: row.platformId,
      platformName: row.platform?.name ?? null,
      purchasedAt: dateToIso(row.purchasedAt),
      currency: row.currency,
      status: row.status,
      shippingCost: row.shippingCost?.toFixed(2) ?? null,
      lotCount: row.lots.length,
      expenseCount: row.expenses.length,
      total: total.toFixed(2),
    };
  });

  const nextCursor = hasMore ? String(offset + pageSize) : null;
  return { items, nextCursor };
}

/** One purchase with its lines, for the edit dialog. Returns `null` if not found /
 * not owned. */
export async function getPurchase(
  ownerId: string,
  purchaseId: string
): Promise<PurchaseData | null> {
  const row = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      collectionId: true,
      contactId: true,
      platformId: true,
      purchasedAt: true,
      currency: true,
      fxRateToBase: true,
      shippingCost: true,
      status: true,
      createdAt: true,
      collection: { select: { ownerId: true } },
      contact: { select: { name: true } },
      platform: { select: { name: true } },
      lots: { select: { id: true, price: true, status: true }, orderBy: { id: "asc" } },
      expenses: {
        select: { id: true, label: true, price: true },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!row || row.collection.ownerId !== ownerId) return null;

  return {
    id: row.id,
    collectionId: row.collectionId,
    contactId: row.contactId,
    contactName: row.contact?.name ?? null,
    platformId: row.platformId,
    platformName: row.platform?.name ?? null,
    purchasedAt: dateToIso(row.purchasedAt),
    currency: row.currency,
    fxRateToBase: row.fxRateToBase?.toString() ?? null,
    shippingCost: row.shippingCost?.toFixed(2) ?? null,
    status: row.status,
    createdAt: row.createdAt,
    lots: row.lots.map((l) => ({ id: l.id, price: l.price.toFixed(2), status: l.status })),
    expenses: row.expenses.map((e) => ({
      id: e.id,
      label: e.label,
      price: e.price.toFixed(2),
    })),
  };
}

/** Create a purchase header. FX rate is frozen at save. Line items (lots and expenses)
 * are added later during intake (#121), so a fresh purchase has none. */
export async function createPurchase(
  ownerId: string,
  collectionId: string,
  data: PurchaseCreateInput
): Promise<PurchaseData> {
  await assertCollectionOwner(ownerId, collectionId);
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { baseCurrency: true },
  });
  const baseCurrency = col!.baseCurrency;

  const currency = data.currency.trim();
  if (!currency) throw new Error("A transaction currency is required.");

  const purchasedAt = toDate(data.purchasedAt);
  const fxRateToBase = await freezeFxRate(collectionId, currency, baseCurrency);
  const contactId = await resolvePurchaseContact(collectionId, {
    id: data.contactId,
    name: data.contactName,
    role: "seller",
  });
  const platformId = await resolvePurchaseContact(collectionId, {
    id: data.platformId,
    name: data.platformName,
    role: "platform",
  });

  // In a transaction for the number's sake (#432): the counter bump and the row it belongs to have
  // to stand or fall together, or a failed create would burn a number.
  const created = await prisma.$transaction(async (tx) =>
    tx.purchase.create({
      data: {
        collectionId,
        purchaseNo: await allocateEntityNumber(tx, collectionId, "purchase"),
        contactId,
        platformId,
        purchasedAt,
        currency,
        fxRateToBase,
        shippingCost: data.shippingCost != null ? money(data.shippingCost) : null,
        status: normalizeStatus(data.status),
        // No line items here — lots and expenses are created during intake (#121).
      },
      select: { id: true },
    })
  );

  return (await getPurchase(ownerId, created.id))!;
}

/** Update a purchase header. The FX rate is re-frozen when the currency or date changes.
 *
 * The order's line items — inventory lots and non-inventory expenses — are deliberately
 * untouched here: they belong to the intake flow (#121), so editing a purchase's header
 * must never add, change, or remove them. */
export async function updatePurchase(
  ownerId: string,
  purchaseId: string,
  data: PurchaseUpdateInput
): Promise<PurchaseData> {
  const { collectionId, baseCurrency } = await assertPurchaseOwner(ownerId, purchaseId);

  const currency = data.currency.trim();
  if (!currency) throw new Error("A transaction currency is required.");

  const purchasedAt = toDate(data.purchasedAt);
  const fxRateToBase = await freezeFxRate(collectionId, currency, baseCurrency);
  const contactId = await resolvePurchaseContact(collectionId, {
    id: data.contactId,
    name: data.contactName,
    role: "seller",
  });
  const platformId = await resolvePurchaseContact(collectionId, {
    id: data.platformId,
    name: data.platformName,
    role: "platform",
  });

  await prisma.purchase.update({
    where: { id: purchaseId },
    data: {
      contactId,
      platformId,
      purchasedAt,
      currency,
      fxRateToBase,
      shippingCost: data.shippingCost != null ? money(data.shippingCost) : null,
      status: normalizeStatus(data.status),
    },
  });

  return (await getPurchase(ownerId, purchaseId))!;
}

/** Set only a purchase's delivery status (#141) — a single-field update for the inline
 * control on the detail view, with none of the contact/currency/FX handling of a full edit.
 * Marking a purchase `arrived` has copy side-effects, so that transition goes through
 * `markPurchaseArrived` instead; this path is for `preparing` / `in_transit`. */
export async function setPurchaseStatus(
  ownerId: string,
  purchaseId: string,
  status: PurchaseStatus
): Promise<void> {
  await assertPurchaseOwner(ownerId, purchaseId);
  await prisma.purchase.update({
    where: { id: purchaseId },
    data: { status: normalizeStatus(status) },
  });
}

/**
 * What one purchase order has cost and earned back so far (#559) — the cost side of #179 read
 * against the sale side of ADR-0012, over the same copies.
 *
 * **Copies that never arrived are left out entirely.** A `not_delivered` copy carries no
 * cost-basis (ADR-0009 §5) and can never sell, so counting it would only make the order look
 * emptier than it is. Everything else that arrived counts, **including copies since disposed**
 * (#394): that money really was spent, and dropping it would flatter what the order achieved —
 * the same call the holdings bar's write-off row makes.
 */
export async function getPurchaseReturn(
  ownerId: string,
  purchaseId: string
): Promise<PurchaseReturn> {
  const { collectionId, baseCurrency } = await assertPurchaseOwner(ownerId, purchaseId);
  return returnOverCopies(collectionId, baseCurrency, { lot: { purchaseId } });
}

/**
 * The same figure for **one lot** (#559) — the level a purchase is actually read at, since a lot is
 * what was bought as a unit and what a cost-basis was allocated over (ADR-0009 §3).
 *
 * It is the order's figure narrowed, never a different calculation: the same copies, the same
 * frozen snapshots, the same sale-side attribution. A sale line mixing two *lots of one order* is
 * therefore split exactly as one mixing two orders is — for this scope they are two purchases'
 * worth of copies, and a whole-line shortcut that ignored the boundary would credit one lot with
 * the other's proceeds.
 */
export async function getLotReturn(ownerId: string, lotId: string): Promise<PurchaseReturn> {
  const lot = await prisma.purchaseLot.findUnique({
    where: { id: lotId },
    select: {
      purchase: { select: { collection: { select: { id: true, ownerId: true, baseCurrency: true } } } },
    },
  });
  if (!lot || lot.purchase.collection.ownerId !== ownerId) {
    throw new Error("Lot not found or access denied.");
  }
  const { id, baseCurrency } = lot.purchase.collection;
  return returnOverCopies(id, baseCurrency, { lotId });
}

/** Shared body of the two scopes above: cost-basis and realized proceeds over whichever copies the
 * `where` selects, minus the ones that never arrived. */
async function returnOverCopies(
  collectionId: string,
  baseCurrency: string,
  where: Prisma.ItemWhereInput
): Promise<PurchaseReturn> {
  const rows = await prisma.item.findMany({
    where: { ...where, collectionId, deliveryState: { not: "not_delivered" } },
    select: {
      id: true,
      costBasis: true,
      lotId: true,
      lot: { select: { status: true } },
    },
  });
  const realized = await realizedProceedsForItems(
    collectionId,
    rows.map((r) => r.id)
  );
  return summarizePurchaseReturn(
    rows.map((r) => ({
      id: r.id,
      costBasis: r.costBasis == null ? null : r.costBasis.toFixed(2),
      lotId: r.lotId,
      lotStatus: r.lot?.status ?? null,
      sold: realized.resolved.has(r.id) || realized.unresolved.has(r.id),
      proceedsResolved: realized.resolved.has(r.id),
    })),
    realized.total,
    baseCurrency
  );
}

/** Delete a purchase and its lines (cascade). Blocked by the DB if any lot still has
 * `Item`s attached (`onDelete: Restrict`); surfaced as a friendly error. */
export async function deletePurchase(
  ownerId: string,
  purchaseId: string
): Promise<void> {
  await assertPurchaseOwner(ownerId, purchaseId);
  // The cascade drops the `ScanSheet`/`ScanTile` rows but never the files (#566), and a retained
  // card scan is the largest object the app stores. The addresses are read *before* the delete
  // because afterwards there is nothing left to find them from, and the files are removed *after*
  // it because this delete can be refused — a purchase whose lots still hold copies is blocked
  // below, and destroying the collector's scans on the way to that error would be unforgivable.
  //
  // Read off the purchase itself since #586: the scans hang here rather than on the lots, which is
  // also why deleting a lot no longer reaches for them at all.
  const scanBytes = await collectScanStorageRefs([purchaseId]);
  try {
    await prisma.purchase.delete({ where: { id: purchaseId } });
  } catch (err) {
    if (isRestrictViolation(err)) {
      throw new Error(
        "Cannot delete a purchase whose lots have copies. Detach the copies first."
      );
    }
    throw err;
  }
  await deleteScanStorageRefs(scanBytes);
}

/** Prisma FK-restrict violation (P2003) / required-relation guard (P2014). */
function isRestrictViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    ((err as { code?: string }).code === "P2003" ||
      (err as { code?: string }).code === "P2014")
  );
}
