import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { FACEBOOK_PLATFORM_MODULE } from "./platform-modules";
import { readFacebookDefaults, toCustomSettings, toPostingSettings } from "./facebook-groups";
import { effectiveFacebookGroupSettings } from "./facebook-group-rules";
import { makeOfferLabeller, STAMP_LABEL_SELECT } from "./offer-labels";
import { offerDisplayLabel } from "./offer-set-rules";
import { resolveBuyerHandling } from "./sales";
import { renderBuyerMessage, type BuyerMessageSale } from "./buyer-message-rules";

// The message to a buyer after a sale (#1815): the platform's template, rendered for one sale.
//
// **Which template.** Off Facebook it is the platform's own. On Facebook it is a setting like
// the post templates (#1661): Facebook's defaults, and a group's own where it holds one. A sale has no
// group — its offers do — so a sale whose offers are all from **one** group takes that group's (its
// own or the default it follows), and any other sale — offers from several groups, or none naming one
// — takes Facebook's default (decided with the collector, 2026-10-11).
//
// A blank template is **no message**: the sale offers none, and nothing stands in for it (#1692).

/** The message for one sale, ready to copy. */
export interface SaleBuyerMessage {
  text: string;
  /** Whose template wrote it, in the collector's words — a group's name, *Facebook* or the
   *  platform's name — so the dialog can say where to change it. */
  source: string;
}

const MESSAGE_SALE_SELECT = {
  id: true,
  saleNo: true,
  collectionId: true,
  currency: true,
  buyerHandling: true,
  buyerPaidTotal: true,
  shippingOptionName: true,
  collection: { select: { ownerId: true } },
  buyer: { select: { name: true } },
  platform: {
    select: { id: true, name: true, platformModule: true, buyerMessageTemplate: true },
  },
  lines: {
    orderBy: { id: "asc" },
    select: {
      price: true,
      offer: {
        select: {
          offerNo: true,
          name: true,
          facebookGroupId: true,
          sets: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: {
              title: true,
              items: { select: { itemId: true, sortOrder: true, item: { select: STAMP_LABEL_SELECT } } },
            },
          },
        },
      },
      // A line whose offer is gone still names its set; the set's title is what it is called then.
      offerSet: { select: { title: true } },
    },
  },
} satisfies Prisma.SaleSelect;

/** The template a Facebook sale is written from, and whose it is. */
async function facebookTemplate(
  platformId: string,
  groupIds: readonly (string | null)[]
): Promise<{ template: string; source: string }> {
  const defaults = await readFacebookDefaults(platformId);
  const named = new Set(groupIds.filter((id): id is string => id !== null));
  // Every line's offer from the one group: that group's. A line with no group (an offer since moved
  // off Facebook, or gone) makes the sale not one group's.
  if (named.size === 1 && groupIds.every((id) => id !== null)) {
    const [groupId] = named;
    const group = await prisma.facebookGroup.findUnique({ where: { id: groupId } });
    if (group) {
      const settings = effectiveFacebookGroupSettings(
        { ...toPostingSettings(group), currency: group.currency, custom: toCustomSettings(group.customSettings) },
        defaults
      );
      return {
        template: settings.buyerMessageTemplate,
        source: group.customSettings.includes("buyerMessageTemplate") ? group.name : "Facebook",
      };
    }
  }
  return { template: defaults.buyerMessageTemplate, source: "Facebook" };
}

/**
 * The buyer message for a sale, or null when its platform has no template for it. Read on every render
 * of the sale's screen, so it is always the sale as it stands: a shipping option chosen a moment ago is
 * in the total.
 */
export async function readSaleBuyerMessage(ownerId: string, saleId: string): Promise<SaleBuyerMessage | null> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId }, select: MESSAGE_SALE_SELECT });
  if (!sale || sale.collection.ownerId !== ownerId) return null;

  const { template, source } =
    sale.platform.platformModule === FACEBOOK_PLATFORM_MODULE
      ? await facebookTemplate(
          sale.platform.id,
          sale.lines.map((l) => l.offer?.facebookGroupId ?? null)
        )
      : { template: sale.platform.buyerMessageTemplate ?? "", source: sale.platform.name };
  if (template.trim() === "") return null;

  const labeller = await makeOfferLabeller(sale.collectionId);
  const gross = sale.lines.reduce((sum, l) => sum + Number(l.price), 0);
  // The handling the buyer pays, as the sale's own breakdown reads it (#205): entered, or derived from
  // the total they paid. Neither recorded is none.
  const handling =
    sale.buyerHandling == null && sale.buyerPaidTotal == null
      ? null
      : resolveBuyerHandling(sale.buyerHandling, sale.buyerPaidTotal, gross).handling.toFixed(2);
  const options = await prisma.shippingOption.findMany({
    where: { platformId: sale.platform.id },
    orderBy: { name: "asc" },
    select: { name: true, price: true, currency: true },
  });

  const input: BuyerMessageSale = {
    saleNo: sale.saleNo,
    buyerName: sale.buyer?.name ?? null,
    currency: sale.currency,
    items: sale.lines.map((l) => ({
      offerNo: l.offer?.offerNo ?? null,
      title: l.offer
        ? offerDisplayLabel(l.offer.name, l.offer.sets, labeller)
        : (l.offerSet.title?.trim() ?? ""),
      price: l.price.toFixed(2),
    })),
    shippingOptionName: sale.shippingOptionName,
    buyerHandling: handling,
    shippingOptions: options.map((o) => ({ name: o.name, price: o.price.toFixed(2), currency: o.currency })),
  };
  return { text: renderBuyerMessage(template, input), source };
}
