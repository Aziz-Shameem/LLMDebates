import express from 'express';
import cors from 'cors';
import path from 'path';
import { DebateRequest } from './types';
import { runDebate } from './debateEngine';
import { streamDebatePdf } from './pdfReport';
import { DebateResult } from './types';

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// In-memory session store for prototype (resets on server restart).
const sessionStore = new Map<string, DebateResult>();

// Serve simple static UI
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/debate', async (req, res) => {
  const body = req.body as Partial<DebateRequest>;

  if (!body || typeof body.question !== 'string') {
    return res.status(400).json({ error: 'Missing question' });
  }
  if (!Array.isArray(body.options) || body.options.length < 2) {
    return res
      .status(400)
      .json({ error: 'options must be an array with at least 2 items' });
  }

  const trimmedOptions = body.options
    .map((o) => (typeof o === 'string' ? o.trim() : ''))
    .filter((o) => o.length > 0);
  if (trimmedOptions.length < 2) {
    return res
      .status(400)
      .json({ error: 'At least 2 non-empty options are required' });
  }

  const maxRounds =
    typeof body.maxRounds === 'number' && body.maxRounds > 0
      ? Math.min(body.maxRounds, 5)
      : 3;

  const temperature =
    typeof body.temperature === 'number'
      ? Math.min(Math.max(body.temperature, 0), 1)
      : 0.3;

  const debateReq: DebateRequest = {
    question: body.question.trim(),
    options: trimmedOptions,
    models: body.models as any,
    maxRounds,
    temperature,
  };

  try {
    const result = await runDebate(debateReq);
    sessionStore.set(result.sessionId, result);
    res.json(result);
  } catch (err: any) {
    console.error('Error in /api/debate:', err);
    res
      .status(500)
      .json({ error: 'Internal error running debate', detail: String(err) });
  }
});

app.get('/api/session/:sessionId/report.pdf', (req, res) => {
  const sessionId = String(req.params.sessionId ?? '');
  const debate = sessionStore.get(sessionId);
  if (!debate) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  streamDebatePdf(debate, res);
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});

