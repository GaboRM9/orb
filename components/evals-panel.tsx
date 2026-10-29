import Link from "next/link";
import { deleteEvalCase, runEvalAction, saveEvalCase } from "@/lib/actions";
import { getSetting, listAgents } from "@/lib/db";
import { GRADER_MODEL, listCases, listEvalRuns, MAX_CASES, newlyFailing, runResults, type EvalCase, type EvalResult, type EvalRun } from "@/lib/evals";
import { DEFAULT_MODEL, MODELS } from "@/lib/models";
import { toolInfo, toolNames } from "@/lib/tools";
import { RunEvalButton } from "./run-eval-button";
import { Spark } from "./surfaces/spark";

const pct = (r: EvalRun) => Math.round((r.passed / r.total) * 100);
const secs = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const usd = (n: number | null) => (n == null ? "—" : `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`);
const href = (o: { agent: string; run?: string; edit?: number }) =>
  `/library?${new URLSearchParams({ tab: "evals", agent: o.agent, ...(o.run && { run: o.run }), ...(o.edit && { edit: String(o.edit) }) })}`;

export async function EvalsPanel({ agent: agentId, run: runId, edit, error }: { agent?: string; run?: string; edit?: string; error?: string }) {
  const [agents, runs, workspaceModel] = await Promise.all([listAgents(), listEvalRuns(), getSetting("model", DEFAULT_MODEL)]);
  if (!agents.length) return <p className="text-sm text-mute">Create an agent first, then give it test questions here.</p>;
  const agent = agents.find((a) => a.id === agentId) ?? agents[0];
  const mine = runs.filter((r) => r.agent_id === agent.id); // newest first
  const shown = mine.find((r) => r.run_id === runId) ?? mine[0];
  const prev = shown && mine[mine.indexOf(shown) + 1];
  const [cases, results, prevResults] = await Promise.all([listCases(agent.id), shown ? runResults(shown.run_id) : [], prev ? runResults(prev.run_id) : []]);
  const regressed = newlyFailing(results, prevResults);
  const delta = shown && prev ? pct(shown) - pct(prev) : null;

  return (
    <div className="space-y-8">
      <p className="text-xs text-mute">
        Test questions for each agent, with what a good answer looks like. A run asks the agent every question the way chat would, and a grader model
        passes or fails each answer. Run it after changing an agent&apos;s instructions, tools or model to see what got better or worse.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {agents.map((a) => {
          const hist = runs.filter((r) => r.agent_id === a.id);
          const last = hist[0];
          return (
            <Link key={a.id} href={href({ agent: a.id })} aria-current={a.id === agent.id ? "page" : undefined}
              className={`card block space-y-2 !p-4 transition-colors ${a.id === agent.id ? "!border-accent" : "hover:bg-hover"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{a.name}</span>
                <span className="text-xs text-mute">{last ? `${last.passed}/${last.total} pass` : "No runs yet"}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={last ? `${pct(last)}% passed` : "No runs yet"}>
                {last && <div className="h-full rounded-full bg-accent" style={{ width: `${pct(last)}%` }} />}
              </div>
              <Spark values={hist.slice(0, 12).reverse().map(pct)} className="h-8 w-full" label={`Pass rate over the last ${Math.min(hist.length, 12)} runs`} />
              {last && <div className="text-xs text-mute">Last run {new Date(last.started).toLocaleString()}</div>}
            </Link>
          );
        })}
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg">{agent.name}</h2>
            <p className="text-xs text-mute">
              Chats on {agent.model || workspaceModel}; pick another model to compare. {GRADER_MODEL} grades every run.
              Tools that need approval are refused during evals, so nothing is sent or saved.
            </p>
          </div>
          <form action={runEvalAction.bind(null, agent.id)} className="flex items-center gap-2">
            <select name="model" defaultValue="" className="field !w-auto !py-2" aria-label="Model to run on">
              <option value="">{agent.model || workspaceModel}</option>
              {MODELS.filter((m) => m !== (agent.model || workspaceModel)).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <RunEvalButton disabled={!cases.length} />
          </form>
        </div>
        {error && <p role="alert" className="rounded-lg border border-accent p-3 text-sm">{error}</p>}

        {shown ? (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
              {([
                ["Pass rate", `${pct(shown)}%`, `${shown.passed} of ${shown.total} questions`],
                ["vs previous run", delta == null ? "—" : delta === 0 ? "Same" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)} pts`,
                  regressed.size ? `${regressed.size} newly failing` : prev ? "Nothing newly failing" : "First run"],
                ["Cost of this run", usd(shown.cost), "Answers and grading"],
                ["Avg answer time", secs(shown.ms), shown.model],
              ] as const).map(([label, value, sub]) => (
                <div key={label} className="bg-bg p-4">
                  <dt className="text-xs text-mute">{label}</dt>
                  <dd className="mt-1 text-2xl font-light">{value}</dd>
                  <dd className="mt-0.5 truncate text-xs text-mute">{sub}</dd>
                </div>
              ))}
            </dl>
            <Results results={results} regressed={regressed} />
            {mine.length > 1 && <History runs={mine} agent={agent.id} shown={shown.run_id} />}
          </>
        ) : (
          <p className="text-sm text-mute">{cases.length ? "No runs yet. Press Run evals to grade every question." : "Add a test question below to get started."}</p>
        )}
      </section>

      <Cases agent={agent.id} cases={cases} edit={Number(edit) || undefined} />
    </div>
  );
}

/** Newly failing first, then the other failures, then passes; each opens to the full answer. */
function Results({ results, regressed }: { results: EvalResult[]; regressed: Set<number> }) {
  const rank = (r: EvalResult) => (regressed.has(r.case_id) ? 0 : r.pass ? 2 : 1);
  return (
    <div className="divide-y divide-line border-y border-line">
      {[...results].sort((a, b) => rank(a) - rank(b)).map((r) => (
        <details key={r.id} className="group py-3">
          <summary className="flex cursor-pointer items-start gap-3 text-sm">
            <span className={`chip mt-0.5 shrink-0 ${r.pass ? "text-mute" : "border-accent text-accent"}`} aria-label={r.pass ? "Passed" : "Failed"}>{r.pass ? "✓ pass" : "✗ fail"}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{r.prompt}</span>
              <span className="block text-xs text-mute">{r.reason}</span>
            </span>
            {regressed.has(r.case_id) && <span className="chip shrink-0 border-accent bg-accent text-on-accent">Newly failing</span>}
          </summary>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-line p-3 font-mono text-xs">{r.answer || "(no answer)"}</pre>
          <div className="mt-1 text-xs text-mute">{secs(r.ms)} · {usd(r.cost)}</div>
        </details>
      ))}
    </div>
  );
}

function History({ runs, agent, shown }: { runs: EvalRun[]; agent: string; shown: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-mute hover:text-fg">Earlier runs ({runs.length})</summary>
      <table className="mt-2 w-full text-left text-sm">
        <tbody>
          {runs.slice(0, 30).map((r) => (
            <tr key={r.run_id} className="border-b border-line row-hover">
              <td className="py-1.5 pr-4">
                <Link href={href({ agent, run: r.run_id })} className={r.run_id === shown ? "font-medium" : "underline underline-offset-2"}>{new Date(r.started).toLocaleString()}</Link>
              </td>
              <td className="pr-4 font-mono text-xs">{r.model}</td>
              <td className="pr-4">{r.passed}/{r.total}</td>
              <td className="font-mono text-xs">{usd(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Cases({ agent, cases, edit }: { agent: string; cases: EvalCase[]; edit?: number }) {
  const editing = cases.find((c) => c.id === edit);
  return (
    <section className="space-y-3">
      <h2 className="text-lg">Test questions <span className="text-sm text-mute">{cases.length}/{MAX_CASES}</span></h2>
      {cases.length > 0 && (
        <div className="divide-y divide-line border-y border-line">
          {cases.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0 space-y-0.5 text-sm">
                <div>{c.prompt}</div>
                <div className="text-xs text-mute">Good answer: {c.expect}{c.tool && <span className="chip ml-2">uses {toolInfo[c.tool as keyof typeof toolInfo]?.label ?? c.tool}</span>}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link href={href({ agent, edit: c.id })} scroll={false} className="btn text-xs">Edit</Link>
                <form action={deleteEvalCase.bind(null, c.id, agent)}><button className="btn text-xs">Delete</button></form>
              </div>
            </div>
          ))}
        </div>
      )}
      {(editing || cases.length < MAX_CASES) && (
        <form key={editing?.id ?? "new"} action={saveEvalCase} className="space-y-2 card">
          <div className="text-sm font-medium">{editing ? "Edit question" : "Add a question"}</div>
          <input type="hidden" name="agent" value={agent} />
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <textarea className="field min-h-16" name="prompt" defaultValue={editing?.prompt} placeholder="What a user would ask, e.g. What are my options for getting from Madrid to Lisbon?" required aria-label="Question" />
          <textarea className="field min-h-16" name="expect" defaultValue={editing?.expect} placeholder="A good answer… e.g. compares train, bus and flight with rough prices and times; under 150 words" required aria-label="A good answer" />
          <select className="field" name="tool" defaultValue={editing?.tool ?? ""} aria-label="Tool it should use">
            <option value="">Any tools (or none)</option>
            {toolNames.map((t) => <option key={t} value={t}>Must use: {toolInfo[t].label}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <button className="btn-solid">{editing ? "Save" : "Add"}</button>
            {editing && <Link href={href({ agent })} scroll={false} className="text-xs text-mute hover:text-fg">Cancel</Link>}
          </div>
        </form>
      )}
    </section>
  );
}
