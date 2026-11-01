import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.service.js';
import { KillSwitchError } from '../../usage/usage.service.js';
import {
  AnthropicAiClient,
  createAiClient,
  GeminiAiClient,
  GeminiApiError,
  isAiRetryable,
} from './ai-client.js';

describe('ai-client', () => {
  describe('createAiClient', () => {
    it('creates GeminiAiClient when aiProvider is gemini', () => {
      const mockConfig = {
        aiProvider: 'gemini',
        aiModel: 'gemini-3.6-flash',
        aiApiKey: 'test-gemini-key',
      } as unknown as AppConfig;

      const client = createAiClient(mockConfig);
      expect(client).toBeInstanceOf(GeminiAiClient);
      expect(client.provider).toBe('gemini');
      expect(client.model).toBe('gemini-3.6-flash');
    });

    it('creates AnthropicAiClient when aiProvider is anthropic', () => {
      const mockConfig = {
        aiProvider: 'anthropic',
        aiModel: 'claude-sonnet-4-6',
        aiApiKey: 'test-anthropic-key',
      } as unknown as AppConfig;

      const client = createAiClient(mockConfig);
      expect(client).toBeInstanceOf(AnthropicAiClient);
      expect(client.provider).toBe('anthropic');
      expect(client.model).toBe('claude-sonnet-4-6');
    });
  });

  describe('isAiRetryable', () => {
    it('returns false for KillSwitchError', () => {
      expect(isAiRetryable(new KillSwitchError())).toBe(false);
    });

    it('returns false for non-retryable Gemini errors', () => {
      expect(isAiRetryable(new GeminiApiError(400, 'Bad Request'))).toBe(false);
      expect(isAiRetryable(new GeminiApiError(401, 'Unauthorized'))).toBe(false);
      expect(isAiRetryable(new GeminiApiError(403, 'Invalid API Key'))).toBe(false);
      expect(isAiRetryable(new GeminiApiError(404, 'Model Not Found'))).toBe(false);
    });

    it('returns true for retryable Gemini errors', () => {
      expect(isAiRetryable(new GeminiApiError(429, 'Rate Limit'))).toBe(true);
      expect(isAiRetryable(new GeminiApiError(500, 'Internal Server Error'))).toBe(true);
      expect(isAiRetryable(new GeminiApiError(503, 'Service Unavailable'))).toBe(true);
    });

    it('returns false for non-retryable Anthropic errors', () => {
      const authErr = new Anthropic.AuthenticationError(
        401,
        { error: { message: 'Invalid key', type: 'authentication_error' } },
        'Invalid key',
        new Headers(),
      );
      expect(isAiRetryable(authErr)).toBe(false);
    });

    it('returns true for generic transient errors', () => {
      expect(isAiRetryable(new Error('Network timeout'))).toBe(true);
    });
  });
});
