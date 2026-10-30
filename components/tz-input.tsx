"use client";
import { useSyncExternalStore } from "react";

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The browser's timezone as a hidden form field (the server can't know it); UTC until hydrated. */
export function TzInput() {
  const tz = useSyncExternalStore(() => () => {}, browserTz, () => "UTC");
  return <input type="hidden" name="tz" value={tz} />;
}
