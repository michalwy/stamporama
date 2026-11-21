import type { CSSProperties } from "react";
import { FACEBOOK_POST_STAGE_LABEL, type FacebookPostStage } from "@/lib/facebook-post-rules";

/** A post's stage on the phone (#2626), in the desk's words — a post up or waiting for approval is live
 *  in its group and marked so, as the desk's list of posts marks it. No hover hint: a phone has none. */
export function PhonePostStageChip({ stage }: { stage: FacebookPostStage }) {
  const live = stage === "up" || stage === "pending";
  return <span style={live ? { ...CHIP, ...LIVE } : CHIP}>{FACEBOOK_POST_STAGE_LABEL[stage]}</span>;
}

const CHIP: CSSProperties = {
  display: "inline-block",
  flexShrink: 0,
  padding: "0.0625rem 0.5rem",
  border: "1px solid var(--color-border)",
  borderRadius: "999px",
  fontSize: "0.8125rem",
  whiteSpace: "nowrap",
};

const LIVE: CSSProperties = {
  color: "var(--color-accent)",
  borderColor: "var(--color-accent-border)",
};
