"use client";
import { useState, useTransition } from "react";
import { runTool } from "@/lib/actions";

export function ToolRunner({ name }: { name: string }) {
  const [input, setInput] = useState("{}");
  const [out, setOut] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="field font-mono" value={input} onChange={(e) => setInput(e.target.value)} aria-label={`${name} input JSON`} />
        <button className="btn" disabled={pending} onClick={() => start(async () => setOut(await runTool(name, input)))}>Run</button>
      </div>
      {out && <pre className="overflow-x-auto rounded-md border border-line p-2 font-mono text-xs">{out}</pre>}
    </div>
  );
}
