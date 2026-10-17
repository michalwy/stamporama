/**
 * What the Withdraw confirmation says, on the offer's own screen at the desk and on the phone (#2008)
 * — one sentence for both, so the phone cannot promise less or more than the desk does.
 *
 * `takesPost` is a lot of a multi-lot Facebook post still waiting for approval, which is taken back
 * whole (#1779). Its own module, without `"use client"`, so either screen can import it.
 */
export function withdrawOfferMessage(takesPost: boolean): string {
  return takesPost
    ? "This takes the post back from the group: every lot of it still waiting for approval is withdrawn with this one. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
    : "This takes the listing down on the platform. Withdrawn is final — to sell here again, create a new offer. The copies are untouched.";
}
