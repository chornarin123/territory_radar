import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { AppConfig } from '../../config/app-config.service.js';
import { KillSwitchError } from '../../usage/usage.service.js';
import { buildUserPrompt } from './review-mining.logic.js';
import { BatchResponseSchema, SYSTEM_PROMPT } from './review-mining.schema.js';

export interface AiBatchItem {
  key: string;
  reviews: readonly string[];
}

export interface AiCallResult {
  body: unknown;
  inputTokens: number;
  outputTokens: number;
  callSku: 'anthropic.messages' | 'gemini.generateContent';
}

export interface AiClient {
  readonly provider: 'anthropic' | 'gemini';
  readonly model: string;
  call(batch: readonly AiBatchItem[]): Promise<AiCallResult>;
}

export class GeminiApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Google Gemini API ${status}: ${message}`);
  }
}

export class AnthropicAiClient implements AiClient {
  readonly provider = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async call(batch: readonly AiBatchItem[]): Promise<AiCallResult> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      output_config: { effort: 'low', format: zodOutputFormat(BatchResponseSchema) },
      messages: [{ role: 'user', content: buildUserPrompt(batch) }],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('the model declined the request');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('the response was cut off');
    }

    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
    }

    const { input_tokens: inputTokens = 0, output_tokens: outputTokens = 0 } = response.usage;

    return {
      body: response.parsed_output ?? text,
      inputTokens,
      outputTokens,
      callSku: 'anthropic.messages',
    };
  }
}

export class GeminiAiClient implements AiClient {
  readonly provider = 'gemini' as const;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async call(batch: readonly AiBatchItem[]): Promise<AiCallResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model,
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const payload = {
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: buildUserPrompt(batch) }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      let message = errorText;
      try {
        const json = JSON.parse(errorText) as { error?: { message?: string } };
        if (json.error?.message) message = json.error.message;
      } catch {
        // use raw text
      }
      throw new GeminiApiError(res.status, message.slice(0, 300));
    }

    interface GeminiResponse {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    }

    const data = (await res.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];

    if (!candidate) {
      throw new Error('Gemini returned no candidates');
    }

    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new Error('the response was cut off');
    }
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION') {
      throw new Error(`the model declined the request (${candidate.finishReason})`);
    }

    const text = candidate.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

    return {
      body: text,
      inputTokens,
      outputTokens,
      callSku: 'gemini.generateContent',
    };
  }
}

/** Factory: instantiates the appropriate AI client based on configuration. */
export function createAiClient(config: AppConfig): AiClient {
  const provider = config.aiProvider;
  const model = config.aiModel;
  const apiKey = config.aiApiKey;

  if (provider === 'gemini') {
    return new GeminiAiClient(model, apiKey);
  }
  return new AnthropicAiClient(model, apiKey);
}

/** Retrying cannot fix these: bad key, forbidden, bad request, or kill switch. */
export function isAiRetryable(err: unknown): boolean {
  if (err instanceof KillSwitchError) return false;

  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError ||
    err instanceof Anthropic.BadRequestError ||
    err instanceof Anthropic.NotFoundError
  ) {
    return false;
  }

  if (err instanceof GeminiApiError) {
    // 400 (bad request/model), 401 (unauthorized), 403 (invalid key/forbidden), 404 (model not found)
    if ([400, 401, 403, 404].includes(err.status)) {
      return false;
    }
  }

  return true;
}
