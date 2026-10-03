"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
  DialogDestructiveButton,
} from "@/app/dialog-shell";
import {
  UMBRELLA_PRICES_FIELD,
  ownPricesPhrase,
  type UmbrellaPricesAnswer,
  type UmbrellaPricesQuestionState,
  type UmbrellaWithOwnPrices,
} from "@/lib/umbrella-prices-question";

// #1573: a stamp with catalogue prices of its own that gains its first variant becomes an umbrella,
// and a price recorded on an umbrella overrides the value rolled up from its variants. Every screen
// that can give a stamp a variant asks — Add child stamp, Add variant range, the variant tree,
// reassigning a parent, and editing a child into a variant — so the question lives once, above
// every screen of the collection, and each caller only wraps its server action in
// `useUmbrellaPricesQuestion()`. The server decides whether to ask: it answers
// `{ status: "umbrella-prices" }` instead of writing, and the caller submits again with the answer.

type Ask = (umbrellas: UmbrellaWithOwnPrices[]) => Promise<UmbrellaPricesAnswer | null>;

const AskContext = createContext<Ask | null>(null);

export function UmbrellaPricesQuestionProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{
    umbrellas: UmbrellaWithOwnPrices[];
    resolve: (answer: UmbrellaPricesAnswer | null) => void;
  } | null>(null);

  const ask = useCallback<Ask>(
    (umbrellas) => new Promise((resolve) => setPending({ umbrellas, resolve })),
    []
  );

  function answer(choice: UmbrellaPricesAnswer | null) {
    pending?.resolve(choice);
    setPending(null);
  }

  return (
    <AskContext.Provider value={ask}>
      {children}
      {pending && (
        <UmbrellaPricesDialog
          umbrellas={pending.umbrellas}
          onAnswer={answer}
          onClose={() => answer(null)}
        />
      )}
    </AskContext.Provider>
  );
}

/** `fd` with the collector's answer set, for a server action reading {@link UMBRELLA_PRICES_FIELD}. */
export function withUmbrellaAnswer(fd: FormData, answer?: UmbrellaPricesAnswer): FormData {
  if (answer) fd.set(UMBRELLA_PRICES_FIELD, answer);
  return fd;
}

function isQuestion(result: { status: string }): result is UmbrellaPricesQuestionState {
  return result.status === "umbrella-prices";
}

/**
 * Run a write that may make a priced stamp an umbrella: `run()` once, and when the server hands the
 * question back, ask it and `run(answer)` again. **Cancelling answers `{ status: "idle" }`** with
 * nothing written, so the dialog that asked stays open as it was.
 */
export function useUmbrellaPricesQuestion() {
  const ask = useContext(AskContext);
  return useCallback(
    async <S extends { status: string }>(
      run: (answer?: UmbrellaPricesAnswer) => Promise<S>
    ): Promise<Exclude<S, UmbrellaPricesQuestionState> | { status: "idle" }> => {
      const first = await run();
      if (!isQuestion(first)) return first as Exclude<S, UmbrellaPricesQuestionState>;
      if (!ask) throw new Error("UmbrellaPricesQuestionProvider is not mounted above this screen.");
      const choice = await ask(first.umbrellas);
      if (!choice) return { status: "idle" };
      const second = await run(choice);
      // The answer is on the second submit, so the server cannot ask again; if it somehow does,
      // nothing was written and the dialog stays as it was.
      return isQuestion(second) ? { status: "idle" } : (second as Exclude<S, UmbrellaPricesQuestionState>);
    },
    [ask]
  );
}

const TEXT_STYLE = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-primary)",
  lineHeight: 1.6,
} as const;

function UmbrellaPricesDialog({
  umbrellas,
  onAnswer,
  onClose,
}: {
  umbrellas: UmbrellaWithOwnPrices[];
  onAnswer: (answer: UmbrellaPricesAnswer) => void;
  onClose: () => void;
}) {
  const single = umbrellas.length === 1 ? umbrellas[0] : null;
  return (
    // Above whichever dialog asked: it is always opened from inside one.
    <DialogShell title="Keep its own catalogue prices?" onClose={onClose} zIndexBase={400}>
      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {single ? (
            <p style={TEXT_STYLE}>
              {single.label ? <strong>{single.label}</strong> : "This stamp"} has{" "}
              {ownPricesPhrase(single)}. With its first variant it becomes an umbrella, worth the
              lowest of its variants&apos; prices — but a price kept on it overrides that value.
            </p>
          ) : (
            <>
              <p style={TEXT_STYLE}>
                These stamps get their first variants and become umbrellas, worth the lowest of their
                variants&apos; prices — but a price kept on an umbrella overrides that value.
              </p>
              <ul style={{ ...TEXT_STYLE, paddingLeft: "1.25rem" }}>
                {umbrellas.map((u) => (
                  <li key={u.stampId}>
                    <strong>{u.label ?? "A stamp with no number"}</strong> has {ownPricesPhrase(u)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p style={{ ...TEXT_STYLE, color: "var(--color-text-muted)" }}>
            Clearing removes {single ? "all of them" : "all of these prices"}, in every edition,
            condition, certificate and format.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogSecondaryButton onClick={onClose}>Cancel</DialogSecondaryButton>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <DialogSecondaryButton onClick={() => onAnswer("keep")}>Keep prices</DialogSecondaryButton>
          <DialogDestructiveButton onClick={() => onAnswer("clear")}>Clear prices</DialogDestructiveButton>
        </div>
      </DialogFooter>
    </DialogShell>
  );
}
