import { useCallback, useEffect, useRef, useState } from "react";

/** Tracks the id of the most-recently-added row so it can be briefly highlighted, then clears
 * it after `durationMs` so the highlight is transient (#158). Pair with the `just-added-flash`
 * CSS class: mark an id after a create succeeds, and apply the class where `id === markedId`.
 * The clear timer only removes the class after the one-shot animation has finished — the fade
 * itself is done in CSS. */
export function useJustAdded(durationMs = 1600): readonly [
  string | null,
  (id: string) => void,
] {
  const [markedId, setMarkedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markJustAdded = useCallback(
    (id: string) => {
      setMarkedId(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMarkedId(null), durationMs);
    },
    [durationMs]
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return [markedId, markJustAdded] as const;
}
