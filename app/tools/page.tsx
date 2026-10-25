import { z } from "zod";
import { toggleTool } from "@/lib/actions";
import { allTools, APPROVAL_TOOLS, disabledTools, toolNames } from "@/lib/tools";
import { ToolRunner } from "@/components/tool-runner";

export const dynamic = "force-dynamic";

export default function ToolsPage() {
  const off = new Set(disabledTools());
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">Tools</h1>
      <p className="text-sm text-mute">Defined with <code>tool()</code> + zod. Enabled tools are available to the chat model.</p>
      {toolNames.map((name) => {
        const t = allTools[name];
        const schema = JSON.stringify(z.toJSONSchema(t.inputSchema as z.ZodType), null, 2);
        return (
          <section key={name} className="space-y-3 rounded-lg border border-line p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-mono text-sm">{name}{APPROVAL_TOOLS.has(name) && <span className="ml-2 rounded-full border border-line px-2 py-0.5 font-sans text-xs text-mute">asks approval</span>}</div>
                <div className="text-sm text-mute">{typeof t.description === "string" ? t.description : ""}</div>
              </div>
              <form action={toggleTool.bind(null, name)}>
                <button className={off.has(name) ? "btn" : "btn-solid"}>{off.has(name) ? "Off" : "On"}</button>
              </form>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-mute">input schema</summary>
              <pre className="mt-2 overflow-x-auto font-mono">{schema}</pre>
            </details>
            <ToolRunner name={name} />
          </section>
        );
      })}
    </div>
  );
}
