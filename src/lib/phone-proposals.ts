import "server-only";
import { findProposalId, getProposalScreen, type ProposalLot, type ProposalScreen } from "./proposals";
import {
  readProposalMessage,
  readProposalPhotos,
  readProposalShareState,
  type ProposalMessage,
} from "./proposal-handout";
import { isProposalOpen } from "./proposal-rules";
import type { ShareAddressRefusal } from "./share-address";
import { phoneProposalLotPicture } from "./phone-proposal-rules";

/**
 * A proposal as its phone screen shows it (#2625, ADR-0072): the desk's own reads, nothing of the
 * phone's — the screen (`getProposalScreen`), each lot's photos as the buyer is sent them
 * (`readProposalPhotos`), the message in the proposal's language with the choice of languages
 * (`readProposalMessage`) and the live link (`readProposalShareState`). What the phone decides is only
 * each lot's one picture (`phoneProposalLotPicture`).
 */
export interface PhoneProposal {
  proposalId: string;
  proposalNo: number;
  status: ProposalScreen["status"];
  contact: ProposalScreen["contact"];
  sentOn: string | null;
  total: string;
  unpriced: number;
  currency: string;
  /** The Direct platform, whose message template the buyer is sent. */
  platformName: string;
  post: ProposalScreen["post"];
  sale: ProposalScreen["sale"];
  lots: PhoneProposalLot[];
  /** The message, its language and the languages to choose from — null once the proposal is closed,
   *  when there is nothing left to send. */
  message: ProposalMessage | null;
  /** The live link as it stands: its token, why its address cannot be read, or none made yet. */
  link: { token: string } | { unreadable: ShareAddressRefusal } | null;
}

export interface PhoneProposalLot extends Pick<ProposalLot, "offerId" | "offerNo" | "lotNo" | "title" | "state" | "price" | "currency" | "pick"> {
  /** The lot's picture, `copy` when it is its first copy's photo rather than one the buyer is sent. */
  picture: { photoId: string; copy: boolean } | null;
}

export async function getPhoneProposal(
  ownerId: string,
  collectionId: string,
  proposalNo: number
): Promise<PhoneProposal | null> {
  const proposalId = await findProposalId(ownerId, collectionId, proposalNo);
  if (!proposalId) return null;
  const screen = await getProposalScreen(ownerId, proposalId);
  if (!screen) return null;
  const open = isProposalOpen(screen.status);
  const [photos, message, share] = await Promise.all([
    readProposalPhotos(ownerId, proposalId, collectionId),
    open ? readProposalMessage(ownerId, proposalId, collectionId) : null,
    open ? readProposalShareState(ownerId, proposalId, collectionId) : null,
  ]);
  const imagesOf = new Map(photos.map((lot) => [lot.offerId, lot.images]));
  const address = share?.link?.address;
  return {
    proposalId,
    proposalNo: screen.proposalNo,
    status: screen.status,
    contact: screen.contact,
    sentOn: screen.sentOn,
    total: screen.total,
    unpriced: screen.unpriced,
    currency: screen.currency,
    platformName: screen.platform.name,
    post: screen.post,
    sale: screen.sale,
    lots: screen.lots.map((lot) => ({
      offerId: lot.offerId,
      offerNo: lot.offerNo,
      lotNo: lot.lotNo,
      title: lot.title,
      state: lot.state,
      price: lot.price,
      currency: lot.currency,
      pick: lot.pick,
      picture: phoneProposalLotPicture(imagesOf.get(lot.offerId), lot.copyPhotoId),
    })),
    message,
    link: !address ? null : address.readable ? { token: address.token } : { unreadable: address.reason },
  };
}
