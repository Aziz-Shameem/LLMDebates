import {
  DebateRequest,
  DebateResult,
  ModelId,
  ModelResponse,
  RoundResult,
} from './types';
import { callModel, estimateCostUsd } from './llmClients';

function buildPromptForModel(
  modelId: ModelId,
  req: DebateRequest,
  roundsSoFar: RoundResult[],
): string {
  const { question, options } = req;

  const optionsText = options
    .map((opt, idx) => {
      const label = String.fromCharCode('A'.charCodeAt(0) + idx);
      return `${label}. ${opt}`;
    })
    .join('\n');

  const historyLines: string[] = [];
  for (const round of roundsSoFar) {
    historyLines.push(`Round ${round.round}:`);
    for (const resp of round.responses) {
      const label = String.fromCharCode('A'.charCodeAt(0) + resp.choice);
      const shortReasoning =
        resp.reasoning.length > 140
          ? `${resp.reasoning.slice(0, 140)}...`
          : resp.reasoning;
      historyLines.push(
        `- ${resp.modelId} chose ${label} with reasoning: ${shortReasoning}`,
      );
    }
  }

  const historyBlock =
    historyLines.length > 0
      ? `Previous rounds and other models' answers:\n${historyLines.join('\n')}\n\n`
      : '';

  const prompt = `
You are model ${modelId}, participating in a multi-model deliberation on a multiple-choice question.

Question:
${question}

Options:
${optionsText}

${historyBlock}Carefully consider the question and the previous answers. You may keep or change your previous answer (if any).

You MUST respond ONLY in valid JSON, with this exact shape:
{
  "choice": "A",
  "reasoning": "one short explanation (<= 60 words)"
}

Do not include any additional fields or text outside this JSON.
`.trim();

  return prompt;
}

function parseChoiceFromText(
  rawText: string,
  numOptions: number,
): { choiceIndex: number; reasoning: string } {
  const trimmed = rawText.trim();

  // Try strict JSON parse first.
  try {
    const json = JSON.parse(trimmed);
    if (typeof json.choice === 'string') {
      const letter = json.choice.trim().toUpperCase();
      const code = letter.charCodeAt(0) - 'A'.charCodeAt(0);
      if (code >= 0 && code < numOptions) {
        return {
          choiceIndex: code,
          reasoning: typeof json.reasoning === 'string' ? json.reasoning : '',
        };
      }
    }
  } catch {
    // fall through
  }

  // Fallback: look for "choice" field in a looser way.
  const choiceMatch = /\"choice\"\s*:\s*\"?([A-Za-z0-9])\"?/i.exec(trimmed);
  if (choiceMatch) {
    const raw = choiceMatch[1].toUpperCase();
    let idx = -1;
    if (/[A-Z]/.test(raw)) {
      idx = raw.charCodeAt(0) - 'A'.charCodeAt(0);
    } else if (/[0-9]/.test(raw)) {
      idx = parseInt(raw, 10);
    }
    if (idx >= 0 && idx < numOptions) {
      // Reasoning is often the first field to get truncated or slightly malformed,
      // so we try multiple extraction strategies (quoted/unquoted/incomplete JSON).
      const reasoningQuoted = /\"reasoning\"\s*:\s*\"([\s\S]*?)\"\s*(?:,|\})/i.exec(
        trimmed,
      );
      const reasoningQuotedToEnd = /\"reasoning\"\s*:\s*\"([\s\S]*)$/i.exec(
        trimmed,
      );
      const reasoningUnquoted = /\"reasoning\"\s*:\s*([^,}\n\r]+)\s*(?:,|\})/i.exec(
        trimmed,
      );

      let reasoning = '';
      const candidate =
        (reasoningQuoted && reasoningQuoted[1]) ||
        (reasoningQuotedToEnd && reasoningQuotedToEnd[1]) ||
        (reasoningUnquoted && reasoningUnquoted[1]) ||
        '';

      if (typeof candidate === 'string') {
        reasoning = candidate
          .trim()
          // Convert escaped sequences back into readable text (best-effort).
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"');
      }

      // If the provider cut off mid-reasoning, still return something non-empty
      // so the UI doesn't show "n/a".
      if (!reasoning) {
        reasoning = `Model output (truncated): ${trimmed.slice(0, 160)}`;
      }

      return { choiceIndex: idx, reasoning };
    }
  }

  // Last resort: first letter A.. up to max.
  for (let i = 0; i < numOptions; i++) {
    const letter = String.fromCharCode('A'.charCodeAt(0) + i);
    if (trimmed.includes(letter)) {
      return { choiceIndex: i, reasoning: '' };
    }
  }

  // If still nothing, default to 0.
  return { choiceIndex: 0, reasoning: '' };
}

export async function runDebate(
  req: DebateRequest,
): Promise<DebateResult> {
  const models: ModelId[] =
    req.models && req.models.length > 0
      ? req.models
      : ['chatgpt', 'claude', 'gemini', 'grok'];

  const maxRounds = req.maxRounds && req.maxRounds > 0 ? req.maxRounds : 3;
  const rounds: RoundResult[] = [];

  let consensusChoice: number | undefined;

  for (let round = 1; round <= maxRounds; round++) {
    const roundResults: ModelResponse[] = [];

    await Promise.all(
      models.map(async (modelId) => {
        const prompt = buildPromptForModel(modelId, req, rounds);
        try {
          const llmRes = await callModel(modelId, prompt, {
            temperature: req.temperature ?? 0.3,
          });

          const parsed = parseChoiceFromText(
            llmRes.text,
            req.options.length,
          );

          const estimatedCost = estimateCostUsd(
            modelId,
            llmRes.inputTokens,
            llmRes.outputTokens,
          );

          roundResults.push({
            modelId,
            choice: parsed.choiceIndex,
            reasoning: parsed.reasoning,
            rawText: llmRes.text,
            promptText: prompt,
            usageTokens: {
              inputTokens: llmRes.inputTokens,
              outputTokens: llmRes.outputTokens,
            },
            estimatedCostUsd: estimatedCost,
          });
        } catch (err: any) {
          // If a provider fails, record a placeholder and continue.
          roundResults.push({
            modelId,
            choice: 0,
            reasoning: `Error from provider: ${String(err?.message ?? err)}`,
            rawText: '',
          });
        }
      }),
    );

    // Sort responses by modelId for stable ordering.
    roundResults.sort((a, b) => a.modelId.localeCompare(b.modelId));

    const firstChoice = roundResults[0]?.choice;
    const allAgree =
      firstChoice != null &&
      roundResults.every((r) => r.choice === firstChoice);

    const roundRecord: RoundResult = {
      round,
      responses: roundResults,
      consensusChoice: allAgree ? firstChoice : undefined,
    };
    rounds.push(roundRecord);

    if (allAgree) {
      consensusChoice = firstChoice;
      break;
    }
  }

  // Decide final answer (consensus or majority vote).
  let finalChoiceIndex: number;
  let consensus = false;
  if (consensusChoice != null) {
    finalChoiceIndex = consensusChoice;
    consensus = true;
  } else {
    const counts = new Map<number, number>();
    for (const round of rounds) {
      for (const resp of round.responses) {
        counts.set(resp.choice, (counts.get(resp.choice) ?? 0) + 1);
      }
    }
    let bestChoice = 0;
    let bestCount = -1;
    for (const [choice, count] of counts.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestChoice = choice;
      }
    }
    finalChoiceIndex = bestChoice;
  }

  const lastRound = rounds[rounds.length - 1];
  const finalReasoning =
    lastRound?.responses
      .map((r) => `${r.modelId}: ${r.reasoning}`)
      .join('\n') ?? '';

  const totalEstimatedCostUsd = rounds
    .flatMap((r) => r.responses)
    .reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0);

  const result: DebateResult = {
    sessionId: generateSessionId(),
    question: req.question,
    options: req.options,
    models,
    maxRounds,
    rounds,
    finalChoice: finalChoiceIndex,
    finalReasoning,
    consensus,
    totalEstimatedCostUsd:
      totalEstimatedCostUsd > 0 ? totalEstimatedCostUsd : undefined,
  };

  return result;
}

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID();
  }
  return `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

