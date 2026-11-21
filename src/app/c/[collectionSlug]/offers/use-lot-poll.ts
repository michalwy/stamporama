"use client";

import { useEffect, useRef } from "react";
import { focusManager } from "@tanstack/react-query";

/** How often a screen showing an offer that waits for its photos to turn Ready asks again (#1893). */
export const READY_WAIT_POLL_MS = 3_000;

/**
 * Ask after some lots of a post's or a proposal's screen (#2221, #2222, #2639) while there are any to
 * ask after: each answer is new data, so the next ask is scheduled from it — until none is left
 * waiting. Not in a tab out of view, as `refetchInterval` would not: an ask that falls due there waits
 * for the tab to come back.
 */
export function useLotPoll(waiting: string[], dataUpdatedAt: number, ms: number, ask: (lots: string[]) => Promise<void>) {
  const lots = waiting.join(",");
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  });
  useEffect(() => {
    if (!lots) return;
    const ask = () => void askRef.current(lots.split(","));
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (focusManager.isFocused()) return ask();
      unsubscribe = focusManager.subscribe((focused) => {
        if (!focused) return;
        unsubscribe?.();
        unsubscribe = undefined;
        ask();
      });
    }, ms);
    return () => {
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [lots, dataUpdatedAt, ms]);
}
