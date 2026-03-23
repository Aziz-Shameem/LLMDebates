# Multi-LLM Debate Prototype (POC)

This is a small web app that lets **four AI models** answer your multiple-choice question (MCQ). They do it in **rounds**:
1. Each model picks an option (A/B/C/D).
2. In the next round, each model can “see” the others’ previous choices and may change its mind.
3. If all models agree, the app returns that answer. Otherwise, it uses a simple **majority vote**.

At the end, the app also generates a **PDF report** showing the transcript of the debate.

## 1) What you need

- Windows with PowerShell
- Node.js (includes npm)

## 2) Run it locally

1. Open a terminal and go to this folder:

   ```powershell
   cd LLMDebates
   ```

2. Install dependencies:

   ```powershell
   npm install
   ```

3. Start the server (dev mode):

   ```powershell
   npm run dev
   ```

4. Open in your browser:

   - `http://localhost:4000`

## 3) Add your API keys (so it uses the real models)

The server uses these environment variables:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `XAI_API_KEY`

### Temporary (recommended while testing)

In the same PowerShell window where you run the server:

```powershell
$env:OPENAI_API_KEY="your-openai-key"
$env:ANTHROPIC_API_KEY="your-anthropic-key"
$env:GEMINI_API_KEY="your-gemini-key"
$env:XAI_API_KEY="your-xai-key"
```

Then start the server again:

```powershell
npm run dev
```

### Verify the key is actually visible to the server process

In that same PowerShell window, run:

```powershell
$env:OPENAI_API_KEY
```

If it prints nothing, the app will fall back to a **mock response** (so you can still test the UI flow).

## 4) Use the app

1. Enter your **question**
2. Enter **Option A** and **Option B** (at least these two are required)
3. (Optional) enter Options C and D
4. Click **Run debate**
5. You’ll see:
   - each model’s selected option per round
   - the final answer returned to the user
6. Click **Download PDF report** to save the full transcript.

## 5) How the PDF report is generated

After each debate, the backend stores the latest result in memory (prototype behavior).
Then the UI downloads it via:

- `GET /api/session/:sessionId/report.pdf`

