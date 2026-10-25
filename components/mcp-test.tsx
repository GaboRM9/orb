"use client";
import { useState, useTransition } from "react";
import { testMcp } from "@/lib/actions";

export function McpTest({ id }: { id: string }) {
  const [res, setRes] = useState<{ ok: boolean; text: string }>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <button className="btn text-xs" disabled={pending} onClick={() => start(async () => setRes(await testMcp(id)))}>
        {pending ? "Testing…" : "Test"}
      </button>
      {res && (
        <pre className="whitespace-pre-wrap rounded-md border border-line p-2 font-mono text-xs">
          {res.ok ? "Connected\n" : "Failed: "}{res.text}
        </pre>
      )}
    </div>
  );
}
