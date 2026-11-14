import { getAppVersionLabel } from "@/lib/version";
import { formatEntityNo } from "@/lib/quick-jump";
import { saleStatusMeta } from "../sale-status";
import { GeneratedAt } from "@/app/c/[collectionSlug]/shared/generated-at";

/** The sale date is a **calendar date**, not an instant (`soldAt` is `@db.Date`, read back as UTC
 * midnight), so it is printed off the UTC fields exactly as stored — reading it through a zone is
 * what would move it a day. The generated *timestamp* is a real instant and belongs to the
 * collector's zone instead; that one is `GeneratedAt` (#503). */
function formatDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

export interface SalePrintFooterSale {
  saleNo: number;
  platformName: string;
  buyerName: string | null;
  externalRef: string | null;
  soldAt: Date;
  status: string;
}

/**
 * The page footer of a sale's printouts — the packing list (#330) and the buyer's order summary
 * (#2512) — pinned to the foot of every printed page (`.print-footer`). One piece for both (#2519),
 * so the two printouts of a sale cannot drift apart again.
 *
 * It carries enough to identify the sale on its own — a page separated from the stack has to be
 * matchable back to its order without the header — plus the provenance of the printout itself. On
 * paper it is two lines, each clipped to one (#701): anything added goes *inside* one of the two
 * spans, never as a third child.
 */
export function SalePrintFooter({
  sale,
  copyCount,
  collectionName,
}: {
  sale: SalePrintFooterSale;
  copyCount: number;
  collectionName: string;
}) {
  return (
    <div
      className="print-footer"
      style={{
        marginTop: "0.5rem",
        fontSize: "0.6875rem",
        color: "var(--color-text-muted)",
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "0.75rem",
        flexWrap: "wrap",
      }}
    >
      <span>
        <strong style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>
          {formatEntityNo(sale.saleNo)} · {sale.platformName}
          {sale.buyerName ? ` — ${sale.buyerName}` : ""}
        </strong>
        {sale.externalRef ? ` · #${sale.externalRef}` : ""} · sold {formatDate(sale.soldAt)} · {copyCount}{" "}
        {copyCount === 1 ? "copy" : "copies"} · {saleStatusMeta(sale.status).label}
      </span>
      <span>
        Stamporama {getAppVersionLabel()} · {collectionName} · generated <GeneratedAt iso={new Date().toISOString()} />
      </span>
    </div>
  );
}
