"use client";

import { useRef, useState } from "react";
import type { ProposalDocument as ProposalDocumentData } from "@/lib/proposal-handout";
import { ProposalDocument } from "@/app/c/[collectionSlug]/offers/proposals/[proposalNo]/document/proposal-document";

// **The buyer ticks the lots they want** (#2601) — the page's only client state. Each tick is saved
// the moment it is made, with no submit: the box moves first, so a tick that waited never reads as one
// that did not register, and goes back to what the server last said if the write is refused.
//
// Ticks are saved one after another, never two at once, so the last answer back is always the last
// tick made.

async function postPick(token: string, lotNo: number, picked: boolean): Promise<number[]> {
  const res = await fetch(`/api/p/${encodeURIComponent(token)}/picks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lotNo, picked }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data?.picked)) throw new Error(data?.error ?? "Not saved.");
  return data.picked as number[];
}

export function ProposalPicksDocument({
  token,
  document,
  photoSrc,
}: {
  token: string;
  document: ProposalDocumentData;
  photoSrc: Readonly<Record<string, string>>;
}) {
  const [picked, setPicked] = useState<ReadonlySet<number>>(
    () => new Set(document.lots.filter((lot) => lot.picked).map((lot) => lot.lotNo))
  );
  const [failed, setFailed] = useState(false);
  // What the server last said, to go back to; and the chain the saves run along.
  const saved = useRef<ReadonlySet<number>>(picked);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  function toggle(lotNo: number, on: boolean) {
    setFailed(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(lotNo);
      else next.delete(lotNo);
      return next;
    });
    pending.current += 1;
    queue.current = queue.current.then(async () => {
      try {
        saved.current = new Set(await postPick(token, lotNo, on));
        // Once nothing is left to save, the boxes are what the server holds.
        if (pending.current === 1) setPicked(saved.current);
      } catch {
        setPicked(saved.current);
        setFailed(true);
      } finally {
        pending.current -= 1;
      }
    });
  }

  return <ProposalDocument document={document} photoSrc={photoSrc} picks={{ picked, onToggle: toggle, failed }} />;
}
