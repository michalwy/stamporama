"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { SpecificationLanguageSelect } from "./specification-language-select";

// *Copy specification as text…* (#1759, #2605): the printable specification's contents as plain text,
// for a buyer asking in a chat, in a language chosen for them. It opens in the offer's own language;
// the choice applies to this one copy and is saved nowhere.
//
// The text is read when the dialog opens and again for each language, and shown before it is copied,
// so the copy is a plain `writeText` of what is on screen — made from the button's own click.

interface SpecificationTextAnswer {
  text: string;
  count: number;
  language: string | null;
  offerLanguage: string | null;
  languages: string[];
}

const PREVIEW: React.CSSProperties = {
  margin: 0,
  padding: "0.625rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-page)",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: "24rem",
  overflowY: "auto",
};

const META: React.CSSProperties = { margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" };

export function SpecificationTextDialog({
  collectionId,
  offerId,
  onClose,
}: {
  collectionId: string;
  offerId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  // Null until chosen: the first read is in the offer's own language and names it.
  const [chosen, setChosen] = useState<string | null>(null);
  const { data, isFetching, isError } = useQuery<SpecificationTextAnswer>({
    queryKey: ["offer-specification-text", offerId, chosen],
    queryFn: async () => {
      const query = chosen ? `?language=${encodeURIComponent(chosen)}` : "";
      const res = await fetch(`/api/collections/${collectionId}/offers/${offerId}/specification${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SpecificationTextAnswer;
    },
    placeholderData: (previous) => previous,
    // Read fresh on every opening: it lists what the offer holds now.
    gcTime: 0,
  });

  function copy() {
    if (!data) return;
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard) {
      toast({ message: "Could not copy — this browser offers no clipboard here", tone: "error" });
      return;
    }
    clipboard.writeText(data.text).then(
      () => {
        toast({
          message: `Specification copied as text — ${data.count} ${data.count === 1 ? "copy" : "copies"}`,
        });
        onClose();
      },
      () => toast({ message: "Could not copy the specification", tone: "error" })
    );
  }

  return (
    <DialogShell title="Copy specification as text" onClose={onClose} maxWidth="40rem">
      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <SpecificationLanguageSelect
            id="specification-text-language"
            value={chosen ?? data?.language ?? null}
            offerLanguage={data?.offerLanguage ?? null}
            languages={data?.languages ?? []}
            disabled={isFetching}
            pageWords={false}
            onChange={setChosen}
          />
          {data ? (
            <pre style={{ ...PREVIEW, opacity: isFetching ? 0.6 : 1 }}>{data.text}</pre>
          ) : (
            <p style={META}>{isError ? "Could not read the specification." : "Reading the specification…"}</p>
          )}
        </div>
      </DialogBody>
      <DialogActions
        actionLabel="Copy"
        disabled={!data || isFetching}
        error={isError && data ? "Could not read the specification in that language." : undefined}
        onCancel={onClose}
        onAction={copy}
      />
    </DialogShell>
  );
}
