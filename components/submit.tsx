"use client";
import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

/**
 * A form's submit button that dims while the form's action runs, so a click always shows it landed.
 * Inside a <Dialog>, the dialog closes once the action finishes.
 */
export function Submit({ pendingText, children, disabled, ...props }: React.ComponentProps<"button"> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending) ref.current?.closest("dialog")?.close();
    was.current = pending;
  }, [pending]);
  return (
    <button ref={ref} {...props} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
