"use client";
import { useFormStatus } from "react-dom";

/** Submit button for an eval run, which takes a minute or two: it says so while the run is going. */
export function RunEvalButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button className="btn-solid" disabled={disabled || pending}>{pending ? "Running… (up to a few minutes)" : "Run evals"}</button>;
}
