# orbz

A calm, minimal agent workspace (AI SDK v7): chat, tools, skills, settings. SQLite storage, Anthropic models.

```
npm i && npm run dev -- -p 3100
```
Set `ADMIN_PASSWORD` in `.env.local` (see `.env.example`); without it nobody can sign in. Add your Anthropic key in Settings (or `ANTHROPIC_API_KEY` in `.env.local`).

## Generative UI tools (`lib/ui-tools.ts`, rendered in `components/gen-ui.tsx`)

| Tool | Kind | Renders |
|---|---|---|
| `askUser` | client (no `execute`) | form: text / number / select / toggle / slider / date / color |
| `choose` | client | option buttons (also confirm/deny) |
| `showPlan` | render | step checklist |
| `showCards` | render | card grid |
| `showTable` | render | table |
| `showChart` | render | bar chart |
| `showTimeline` | render | vertical timeline |
| `showMap` | render | map with places |

Client tools stop the model loop; the answer is sent with `addToolOutput` and
`sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` resumes it.

## Test prompts

Everything:
> Plan a 3-day trip for me. First ask me a form with: destination, budget (number), travel style (select: relaxed/adventure) and a toggle for "include flights". Then show your plan as a checklist, the day-by-day itinerary as cards, a cost breakdown as a table and a bar chart of spend per category. Finally ask me to pick one of 3 upgrade options.

Just a form → cards: "Ask me a form for my favorite language, years of experience (number) and remote (toggle), then show 3 learning-path cards."

Confirm flow: "I want to delete all my notes. Ask me to confirm first."

Multi-step + tools + UI: "Get the time in America/Merida, calculate 17% of 2340, then show both results in a table and a chart."
