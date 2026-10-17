"use client";

import { useRef, type CSSProperties } from "react";
import { Icon } from "@/app/icons";
import { phoneButton } from "@/app/phone-screen";

/**
 * *Take a photo* on the phone (#2011): the phone's own camera, opened straight from the button —
 * `capture="environment"` asks for the back camera rather than the gallery. One picture a tap; the
 * caller stages it.
 *
 * `accept` is any image, not the upload route's three types: a narrower list makes some phones offer
 * the file picker instead of the camera. A camera's picture is a JPEG, and the route refuses anything
 * it cannot take.
 */
export function PhoneCameraButton({
  label,
  disabled,
  onPicture,
}: {
  label: string;
  disabled?: boolean;
  onPicture: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => input.current?.click()} style={BUTTON}>
        <Icon name="camera" size="lg" />
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so the same picture can be taken again after a failed upload.
          e.target.value = "";
          if (file) onPicture(file);
        }}
      />
    </>
  );
}

const BUTTON: CSSProperties = {
  ...phoneButton,
  gap: "0.5rem",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-primary)",
  fontWeight: 500,
};
