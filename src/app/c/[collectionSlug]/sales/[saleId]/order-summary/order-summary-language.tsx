"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "@/app/toast-provider";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { formControl } from "@/app/control-style";
import { languageLabel } from "@/lib/languages";
import { hasOrderSummaryLabels } from "@/lib/order-summary-labels";
import { setOrderSummaryLanguageAction } from "@/app/actions/sales";

// The order summary's **Language** (#2604), above the sheet and off the paper. It opens in the buyer's
// language, else the sale's platform's listing language; a choice is saved on the buyer, as a
// proposal's is (#2603), and the sheet is read again in it. A sale with no buyer keeps the choice in
// the page's address — there is no one to save it on.

const SELECT: React.CSSProperties = {
  ...formControl,
  padding: "0.25rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

export function OrderSummaryLanguageSelect({
  saleId,
  buyerName,
  language,
  languages,
}: {
  saleId: string;
  /** The sale's buyer, whom a choice is saved on — null on a sale with none. */
  buyerName: string | null;
  language: string | null;
  languages: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  function choose(next: string) {
    if (buyerName === null) {
      startTransition(() => router.replace(`${pathname}?language=${encodeURIComponent(next)}`));
      return;
    }
    startTransition(async () => {
      const result = await setOrderSummaryLanguageAction(saleId, next);
      if (result.status === "error") {
        toast({ message: result.message, tone: "error" });
        return;
      }
      router.refresh();
      toast({ message: `${languageLabel(next)} saved on ${buyerName}` });
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <label
        htmlFor="order-summary-language"
        style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--color-text-secondary)",
        }}
      >
        Language
      </label>
      <select
        id="order-summary-language"
        value={language ?? ""}
        disabled={isPending || languages.length === 0}
        onChange={(e) => choose(e.target.value)}
        style={SELECT}
      >
        {language === null && <option value="">—</option>}
        {languages.map((code) => (
          <option key={code} value={code}>
            {languageLabel(code)}
          </option>
        ))}
      </select>
      {language !== null && !hasOrderSummaryLabels(language) && (
        <Tooltip content="The sheet has no headings or totals in this language, so they print in English. The names are still translated where the collection has a translation.">
          <span style={{ fontSize: "0.75rem", color: "var(--color-warning)" }}>Sheet words in English</span>
        </Tooltip>
      )}
    </div>
  );
}
