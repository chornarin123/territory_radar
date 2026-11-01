import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/test',
  GOOGLE_PLACES_API_KEY: 'places-api-key',
  API_KEY: '0123456789abcdef0123456789abcdef',
  PLACES_MONTHLY_BUDGET: '50',
  ENRICH_ROTATION_PCT: '10',
};

describe('validateEnv', () => {
  it('succeeds with ANTHROPIC_API_KEY', () => {
    const env = validateEnv({
      ...BASE_ENV,
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it('succeeds with GEMINI_API_KEY', () => {
    const env = validateEnv({
      ...BASE_ENV,
      GEMINI_API_KEY: 'gemini-key-test',
    });
    expect(env.GEMINI_API_KEY).toBe('gemini-key-test');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('treats empty string keys as undefined', () => {
    const env = validateEnv({
      ...BASE_ENV,
      ANTHROPIC_API_KEY: '',
      GEMINI_API_KEY: 'gemini-key-test',
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBe('gemini-key-test');
  });

  it('fails if neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is provided', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        ANTHROPIC_API_KEY: '',
        GEMINI_API_KEY: '',
      }),
    ).toThrow(/ANTHROPIC_API_KEY is required/);
  });

  it('fails if AI_PROVIDER is gemini but GEMINI_API_KEY is missing', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        AI_PROVIDER: 'gemini',
        ANTHROPIC_API_KEY: 'sk-ant-test',
      }),
    ).toThrow(/GEMINI_API_KEY is required when using Gemini AI/);
  });

  it('fails if AI_PROVIDER is anthropic but ANTHROPIC_API_KEY is missing', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        AI_PROVIDER: 'anthropic',
        GEMINI_API_KEY: 'gemini-test',
      }),
    ).toThrow(/ANTHROPIC_API_KEY is required when using Anthropic AI/);
  });

  it('allows specifying custom AI_MODEL', () => {
    const env = validateEnv({
      ...BASE_ENV,
      GEMINI_API_KEY: 'gemini-test',
      AI_MODEL: 'gemini-1.5-pro',
    });
    expect(env.AI_MODEL).toBe('gemini-1.5-pro');
  });

  it('succeeds without GOOGLE_PLACES_API_KEY when using default OSM provider', () => {
    const env = validateEnv({
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/test',
      API_KEY: '0123456789abcdef0123456789abcdef',
      PLACES_MONTHLY_BUDGET: '50',
      ENRICH_ROTATION_PCT: '10',
      GEMINI_API_KEY: 'gemini-test',
      GOOGLE_PLACES_API_KEY: '',
    });
    expect(env.GOOGLE_PLACES_API_KEY).toBeUndefined();
    expect(env.PLACES_PROVIDER).toBeUndefined();
  });

  it('fails if PLACES_PROVIDER is google but GOOGLE_PLACES_API_KEY is missing', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/test',
        API_KEY: '0123456789abcdef0123456789abcdef',
        PLACES_MONTHLY_BUDGET: '50',
        ENRICH_ROTATION_PCT: '10',
        GEMINI_API_KEY: 'gemini-test',
        PLACES_PROVIDER: 'google',
        GOOGLE_PLACES_API_KEY: '',
      }),
    ).toThrow(/GOOGLE_PLACES_API_KEY is required when using Google Places/);
  });
});
