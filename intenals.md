# Multi-LLM Debate Prototype - Technical Setup & Architecture

## Repo structure

All code lives under `LLMDebates/`:

- `src/server.ts`: Express server + API endpoints + static UI hosting
- `src/types.ts`: request/response types (DebateRequest, DebateResult, etc.)
- `src/debateEngine.ts`: orchestration loop (multi-round deliberation, consensus check, majority vote)
- `src/llmClients.ts`: provider adapters (chatgpt/claude/gemini/grok) behind a unified `callModel()`
- `src/pdfReport.ts`: PDF generation (pdfkit) from a `DebateResult`
- `public/index.html`: minimal UI + PDF download link

## How to run (local)

```powershell
cd LLMDebates
npm install
npm run dev
```

Then open:

- `http://localhost:4000/`

## Configuration: API keys

The LLM adapters look for these environment variables at server startup:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `XAI_API_KEY`

If a key is missing, the adapter returns a mock JSON response so the debate pipeline still runs.

On Windows/PowerShell (recommended for quick tests):

```powershell
$env:OPENAI_API_KEY="..."
$env:ANTHROPIC_API_KEY="..."
$env:GEMINI_API_KEY="..."
$env:XAI_API_KEY="..."
```

Restart the dev server after setting them in the current terminal session.

## API contracts

### `POST /api/debate`

Request (`DebateRequest`):

- `question: string`
- `options: string[]` (min 2)
- `models?: ModelId[]` (defaults to all 4)
- `maxRounds?: number` (default 3; capped to 5 server-side)
- `temperature?: number` (default 0.3; clamped to [0,1])

Response (`DebateResult`):

- `sessionId`
- `question`, `options`, `models`, `maxRounds`
- `rounds[]`, each with `responses[]` (per-model choice + reasoning + usage + prompt text)
- `finalChoice` (index into `options`)
- `consensus: boolean`
- `totalEstimatedCostUsd` (approx; based on usage token counts when available)

### `GET /api/session/:sessionId/report.pdf`

Returns a generated PDF transcript for a previously executed session.

## Orchestration logic (multi-round debate)

Implemented in `src/debateEngine.ts`:

1. For each round `r = 1..maxRounds`:
   - Build a provider-specific prompt for each model with:
     - question + options
     - a compact summary of prior rounds (other models' choices + truncated reasoning)
   - Run all models in parallel via `Promise.all()`
2. Parse each model’s response into:
   - `choice` (A/B/C/D mapped to an index)
   - `reasoning` (string)
   - `rawText` (full returned text)
3. Stop early if all models agree (`consensusChoice` set).
4. If no consensus, compute final answer via majority vote across all rounds.

## Prompting + parsing

- Each provider is instructed to respond with strict JSON:
  - `{ "choice": "A|B|C|D", "reasoning": "..." }`
- `parseChoiceFromText()`:
  - attempts `JSON.parse()`
  - falls back to regex extraction of `"choice": ...`
  - last resort searches for letters A..D in the text

## Cost control (POC-friendly)

To minimize spend, the adapters cap output length:

- OpenAI: `max_tokens: 220`
- Anthropic: `max_tokens: 220`
- Gemini: `generationConfig.maxOutputTokens: 220`
- Grok: `max_tokens: 220`

Additionally, the deliberation prompt constrains reasoning length in its own instruction:

- `reasoning` should be <= 60 words (server prompt)
- prior-round reasoning is truncated when included in subsequent rounds

`estimatedCostUsd` is computed using the usage token counts when providers return them,
otherwise it may be omitted.

## PDF report generation

Implemented in `src/pdfReport.ts` using `pdfkit`:

- Title + session metadata
- Question + options
- For each round:
  - round header
  - for each model response:
    - model choice + selected option text
    - reasoning (truncated)
    - token counts + estimated cost
    - prompt text used for that call (truncated)
    - raw model output (truncated)

Prototype note: session results are stored in memory in `src/server.ts`, so PDF generation
works only for sessions created since the server started.

