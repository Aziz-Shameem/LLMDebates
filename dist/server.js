"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const debateEngine_1 = require("./debateEngine");
const pdfReport_1 = require("./pdfReport");
const app = (0, express_1.default)();
const port = process.env.PORT || 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// In-memory session store for prototype (resets on server restart).
const sessionStore = new Map();
// Serve simple static UI
const publicDir = path_1.default.join(__dirname, '..', 'public');
app.use(express_1.default.static(publicDir));
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});
app.post('/api/debate', async (req, res) => {
    const body = req.body;
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
    const maxRounds = typeof body.maxRounds === 'number' && body.maxRounds > 0
        ? Math.min(body.maxRounds, 5)
        : 3;
    const temperature = typeof body.temperature === 'number'
        ? Math.min(Math.max(body.temperature, 0), 1)
        : 0.3;
    const debateReq = {
        question: body.question.trim(),
        options: trimmedOptions,
        models: body.models,
        maxRounds,
        temperature,
    };
    try {
        const result = await (0, debateEngine_1.runDebate)(debateReq);
        sessionStore.set(result.sessionId, result);
        res.json(result);
    }
    catch (err) {
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
    (0, pdfReport_1.streamDebatePdf)(debate, res);
});
app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${port}`);
});
