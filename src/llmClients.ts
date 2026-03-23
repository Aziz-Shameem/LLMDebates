import { ModelId, ProviderCallOptions } from './types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const XAI_API_KEY = process.env.XAI_API_KEY;

// Very rough per-1M token pricing estimates (USD) for budgeting.
const PRICING_PER_MILLION: Record<
  ModelId,
  { input: number; output: number }
> = {
  chatgpt: { input: 0.15, output: 0.6 }, // GPT-4o Mini style
  claude: { input: 1.0, output: 5.0 }, // Claude Haiku-like
  gemini: { input: 0.15, output: 0.6 }, // Gemini Flash-like
  grok: { input: 0.2, output: 0.5 }, // Grok Fast-like
};

let resolvedClaudeModelId: string | null = null;
let resolvedXaiModelId: string | null = null;

export interface NormalizedLLMResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function estimateCostUsd(
  modelId: ModelId,
  inputTokens?: number,
  outputTokens?: number,
): number | undefined {
  if (inputTokens == null && outputTokens == null) return undefined;
  const pricing = PRICING_PER_MILLION[modelId];
  const inMillionsIn = (inputTokens ?? 0) / 1_000_000;
  const inMillionsOut = (outputTokens ?? 0) / 1_000_000;
  return inMillionsIn * pricing.input + inMillionsOut * pricing.output;
}

export async function callModel(
  modelId: ModelId,
  prompt: string,
  options: ProviderCallOptions = {},
): Promise<NormalizedLLMResponse> {
  switch (modelId) {
    case 'chatgpt':
      return callOpenAI(prompt, options);
    case 'claude':
      return callAnthropic(prompt, options);
    case 'gemini':
      return callGemini(prompt, options);
    case 'grok':
      return callXaiGrok(prompt, options);
    default:
      throw new Error(`Unsupported modelId: ${modelId satisfies never}`);
  }
}

async function resolveClaudeModelId(): Promise<string> {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  if (resolvedClaudeModelId) return resolvedClaudeModelId;
  if (!ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  // If the hardcoded model id is wrong/retired, we try to pick an available
  // model dynamically from the provider's /v1/models list.
  const res = await fetch('https://api.anthropic.com/v1/models', {
    method: 'GET',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic models error: ${res.status} ${text}`);
  }

  const data: any = await res.json();
  const models: any[] = data?.data ?? [];
  const pickBest = (candidates: any[]): string | null => {
    if (!candidates || candidates.length === 0) return null;
    const ranked = [...candidates].sort((a, b) => {
      const aMax = typeof a.max_tokens === 'number' ? a.max_tokens : Number.POSITIVE_INFINITY;
      const bMax = typeof b.max_tokens === 'number' ? b.max_tokens : Number.POSITIVE_INFINITY;
      return aMax - bMax;
    });
    return String(ranked[0]?.id ?? '');
  };

  const haikuCandidates = models.filter((m) => {
    const id = String(m?.id ?? '').toLowerCase();
    return id.includes('haiku') && !id.includes('vision') && !id.includes('image');
  });

  const sonnetCandidates = models.filter((m) => {
    const id = String(m?.id ?? '').toLowerCase();
    return id.includes('sonnet') && !id.includes('vision') && !id.includes('image');
  });

  const preferred = pickBest(haikuCandidates) ?? pickBest(sonnetCandidates) ?? pickBest(models);

  if (!preferred) throw new Error('Could not resolve Claude model id');
  resolvedClaudeModelId = preferred;
  // eslint-disable-next-line no-console
  console.log(`[Claude] Resolved model id: ${preferred}`);
  return preferred;
}

async function resolveXaiGrokModelId(): Promise<string> {
  if (process.env.XAI_MODEL) return process.env.XAI_MODEL;
  if (resolvedXaiModelId) return resolvedXaiModelId;
  if (!XAI_API_KEY) throw new Error('Missing XAI_API_KEY');

  const res = await fetch('https://api.x.ai/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`xAI models error: ${res.status} ${text}`);
  }

  const data: any = await res.json();
  const models: any[] = data?.data ?? [];
  const ids: string[] = models.map((m: any) => String(m.id));
  const textOnlyIds: string[] = ids.filter(
    (id: string) =>
      !id.toLowerCase().includes('vision') &&
      !id.toLowerCase().includes('image'),
  );

  // Prefer smaller/cheaper general-purpose text models first.
  const preference = [
    'grok-3-mini',
    'grok-3-mini-fast',
    'grok-3-mini-latest',
    'grok-3',
    // Only use higher-tier grok variants if minis aren't available.
    'grok-4-0709',
    'grok-2-1212',
    'grok-code-fast-1',
  ];

  const preferred =
    preference.find((p) => ids.includes(p)) ??
    textOnlyIds.find((id: string) => id.toLowerCase().includes('mini')) ??
    textOnlyIds.find((id: string) => id.toLowerCase().startsWith('grok-')) ??
    ids[0];

  if (!preferred) throw new Error('Could not resolve Grok model id');
  resolvedXaiModelId = preferred;
  // eslint-disable-next-line no-console
  console.log(`[Grok] Resolved model id: ${preferred}`);
  return preferred;
}

async function callOpenAI(
  prompt: string,
  options: ProviderCallOptions,
): Promise<NormalizedLLMResponse> {
  if (!OPENAI_API_KEY) {
    // Fallback for local dev without keys.
    return {
      text:
        '{"choice":"A","reasoning":"Mocked ChatGPT response (no OPENAI_API_KEY set)."}',
    };
  }

  const temperature = options.temperature ?? 0.3;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature,
      // Keep outputs small for cost control (we parse strict JSON anyway).
      max_tokens: 220,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${text}`);
  }

  const data: any = await res.json();
  const messageText: string =
    data.choices?.[0]?.message?.content ?? JSON.stringify(data);
  const usage = data.usage || {};

  return {
    text: messageText,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  };
}

async function callAnthropic(
  prompt: string,
  options: ProviderCallOptions,
): Promise<NormalizedLLMResponse> {
  if (!ANTHROPIC_API_KEY) {
    return {
      text:
        '{"choice":"A","reasoning":"Mocked Claude response (no ANTHROPIC_API_KEY set)."}',
    };
  }

  const temperature = options.temperature ?? 0.3;
  const modelId = await resolveClaudeModelId();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId,
      // Keep outputs small for cost control.
      max_tokens: 220,
      temperature,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();

    // Common case: model id is retired/removed after we resolved it.
    // Retry once with a fresh resolution.
    const isModelNotFound =
      text.toLowerCase().includes('not_found') ||
      text.toLowerCase().includes('model') ||
      text.toLowerCase().includes('404');
    if (isModelNotFound) {
      resolvedClaudeModelId = null;
      const retryModelId = await resolveClaudeModelId();
      const retryRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: retryModelId,
          max_tokens: 220,
          temperature,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });
      if (!retryRes.ok) {
        const retryText = await retryRes.text();
        throw new Error(`Anthropic error: ${retryRes.status} ${retryText}`);
      }
      const data: any = await retryRes.json();
      const content = data.content?.[0]?.text ?? JSON.stringify(data);
      const usage = data.usage || {};
      return {
        text: content,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      };
    }

    throw new Error(`Anthropic error: ${res.status} ${text}`);
  }

  const data: any = await res.json();
  const content = data.content?.[0]?.text ?? JSON.stringify(data);
  const usage = data.usage || {};

  return {
    text: content,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}

async function callGemini(
  prompt: string,
  options: ProviderCallOptions,
): Promise<NormalizedLLMResponse> {
  if (!GEMINI_API_KEY) {
    return {
      text:
        '{"choice":"A","reasoning":"Mocked Gemini response (no GEMINI_API_KEY set)."}',
    };
  }

  const temperature = options.temperature ?? 0.3;
  // const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: 220,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error: ${res.status} ${text}`);
  }

  const data: any = await res.json();
  const candidates = data.candidates || [];
  const first = candidates[0];
  // const text =
  //   first?.content?.parts?.map((p: any) => p.text).join(' ') ??
  //   JSON.stringify(data);

  const text =
    first?.content?.parts
      ?.map((p: any) => p?.text)
      ?.filter((t: any) => typeof t === 'string')
      ?.join(' ')
      ?.trim();
  
  const finalText = text && text.length > 0 ? text : JSON.stringify(data);

  const usage = data.usageMetadata || {};
  const approxTokens = (s: string) => Math.max(1, Math.ceil((s ?? '').length / 4));

  const inputTokensRaw =
    usage.promptTokenCount ??
    usage.prompt_tokens ??
    usage.promptToken_count ??
    usage.promptTokenCount;
  const outputTokensRaw =
    usage.candidatesTokenCount ??
    usage.completionTokenCount ??
    usage.candidatesToken_count ??
    usage.candidatesTokenCount;

  return {
    text: finalText,
    // Gemini sometimes returns different/partial usage fields; fall back to a
    // cheap heuristic so cost reporting doesn't show `n/a`.
    inputTokens:
      typeof inputTokensRaw === 'number' ? inputTokensRaw : approxTokens(prompt),
    outputTokens:
      typeof outputTokensRaw === 'number'
        ? outputTokensRaw
        : approxTokens(text),
  };
}

async function callXaiGrok(
  prompt: string,
  options: ProviderCallOptions,
): Promise<NormalizedLLMResponse> {
  if (!XAI_API_KEY) {
    return {
      text:
        '{"choice":"A","reasoning":"Mocked Grok response (no XAI_API_KEY set)."}',
    };
  }

  const temperature = options.temperature ?? 0.3;
  const modelId = await resolveXaiGrokModelId();
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: modelId,
      temperature,
      max_tokens: 220,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();

    // If the provider says model not found, try resolving again and retry once.
    const isModelNotFound =
      text.toLowerCase().includes('model') &&
      text.toLowerCase().includes('not found');
    if (isModelNotFound) {
      resolvedXaiModelId = null;
      const retryModelId = await resolveXaiGrokModelId();
      const retryRes = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${XAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: retryModelId,
          temperature,
          max_tokens: 220,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });
      if (!retryRes.ok) {
        const retryText = await retryRes.text();
        throw new Error(`xAI Grok error: ${retryRes.status} ${retryText}`);
      }
      const data: any = await retryRes.json();
      const messageText: string =
        data.choices?.[0]?.message?.content ?? JSON.stringify(data);
      const usage = data.usage || {};
      return {
        text: messageText,
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
      };
    }

    throw new Error(`xAI Grok error: ${res.status} ${text}`);
  }

  const data: any = await res.json();
  const messageText: string =
    data.choices?.[0]?.message?.content ?? JSON.stringify(data);
  const usage = data.usage || {};

  return {
    text: messageText,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  };
}

