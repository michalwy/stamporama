"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { SaleCopyRef } from "@/lib/sales";
import { describeWithoutCost, explainWithoutCost } from "@/lib/sale-profit";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useEscapeLayer } from "@/app/escape-stack";
import { useAnchoredPlacement } from "@/app/use-anchored-placement";
import { Icon } from "@/app/icons";

// The mark on a sale's profit that counts copies with no cost recorded (#1875): *1 copy without
// cost*, which opens a short list of those copies, each a link to the copy's own page, where its cost
// is set. Once it is, the copy is no longer listed and the figure is plain again.

export function CopiesWithoutCost({
  copies,
  align = "end",
}: {
  copies: readonly SaleCopyRef[];
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (copies.length === 0) return null;
  return (
    <>
      <Tooltip content={explainWithoutCost(copies.length)} align={align}>
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{
            border: "none",
            background: "none",
            padding: 0,
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.75rem",
            color: "var(--color-warning)",
            textDecoration: "underline dotted",
            textUnderlineOffset: "0.15em",
          }}
        >
          {describeWithoutCost(copies.length)}
        </button>
      </Tooltip>
      {open && (
        <CopiesWithoutCostPopover
          copies={copies}
          anchor={triggerRef}
          align={align}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CopiesWithoutCostPopover({
  copies,
  anchor,
  align,
  onClose,
}: {
  copies: readonly SaleCopyRef[];
  anchor: React.RefObject<HTMLElement | null>;
  align: "start" | "end";
  onClose: () => void;
}) {
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const ref = useRef<HTMLDivElement>(null);
  const { style: placement } = useAnchoredPlacement({ open: true, anchor, floatingRef: ref, align });
  useEscapeLayer(onClose);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [anchor, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Copies without cost"
      onClick={(e) => e.stopPropagation()}
      style={{
        ...placement,
        zIndex: 300,
        width: "22rem",
        overflowY: "auto",
        overscrollBehavior: "contain",
        padding: "0.75rem",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "0.5rem",
        background: "var(--color-bg-elevated)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
        textAlign: "left",
        whiteSpace: "normal",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--color-warning)" }}>
          No cost recorded
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ border: "none", background: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "0.875rem", lineHeight: 1 }}
        >
          <Icon name="close" size="sm" />
        </button>
      </div>
      <ul style={{ listStyle: "none", margin: "0.5rem 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {copies.map((copy) => (
          <li key={copy.itemId}>
            <Link
              href={`/c/${collectionSlug}/inventory/${copy.itemId}`}
              style={{ fontSize: "0.8125rem", color: "var(--color-accent)", textDecoration: "none" }}
            >
              {copy.label || "Untitled copy"}
            </Link>
          </li>
        ))}
      </ul>
    </div>,
    document.body
  );
}
