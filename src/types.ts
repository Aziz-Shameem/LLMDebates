export type ModelId = 'chatgpt' | 'claude' | 'gemini' | 'grok';

export interface DebateRequest {
  question: string;
  options: string[];
  models?: ModelId[];
  maxRounds?: number;
  temperature?: number;
}

export interface ModelResponse {
  modelId: ModelId;
  choice: number; // index into options array
  reasoning: string;
  rawText: string;
  // The full prompt text that was sent to the model (used for audit/reporting).
  promptText?: string;
  usageTokens?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  estimatedCostUsd?: number;
}

export interface RoundResult {
  round: number;
  responses: ModelResponse[];
  consensusChoice?: number;
}

export interface DebateResult {
  sessionId: string;
  question: string;
  options: string[];
  models: ModelId[];
  maxRounds: number;
  rounds: RoundResult[];
  finalChoice: number;
  finalReasoning: string;
  consensus: boolean;
  totalEstimatedCostUsd?: number;
}

export interface ProviderCallOptions {
  temperature?: number;
}
