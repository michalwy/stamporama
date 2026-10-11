"use client";

import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import type { SaleBuyerMessage } from "@/lib/sale-buyer-message";

const MESSAGE_BOX: React.CSSProperties = {
  margin: 0,
  padding: "0.75rem 0.875rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-subtle)",
  color: "var(--color-text-primary)",
  fontFamily: "inherit",
  fontSize: "0.875rem",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

/**
 * The message to the buyer (#1815), rendered for this sale from its platform's template: shown first,
 * so it can be read before it is sent, and copied with one click — plain text, since it goes into a
 * chat. Nothing here edits it; the template is where it is changed.
 */
export function BuyerMessageDialog({
  message,
  onClose,
}: {
  message: SaleBuyerMessage;
  onClose: () => void;
}) {
  const { toast } = useToast();
  return (
    <DialogShell title="Message to buyer" onClose={onClose} maxWidth="36rem">
      <DialogBody>
        <pre style={MESSAGE_BOX}>{message.text}</pre>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          From {message.source}&rsquo;s template.
        </p>
      </DialogBody>
      <DialogActions
        actionLabel="Copy message"
        cancelLabel="Close"
        onCancel={onClose}
        onAction={() =>
          navigator.clipboard?.writeText(message.text).then(
            () => {
              toast({ message: "Message copied" });
              onClose();
            },
            () => toast({ message: "The message could not be copied", tone: "error" })
          )
        }
      />
    </DialogShell>
  );
}
