import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
} from '../signals/review-mining/review-mining.schema.js';
import type { Env } from './env.js';

export type AiProvider = 'anthropic' | 'gemini';

/** Typed, validated access to env. Inject this rather than ConfigService. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get killSwitch(): boolean {
    return this.get('KILL_SWITCH');
  }

  get aiProvider(): AiProvider {
    const configured = this.get('AI_PROVIDER');
    if (configured) return configured;
    if (this.get('GEMINI_API_KEY') && !this.get('ANTHROPIC_API_KEY')) {
      return 'gemini';
    }
    return 'anthropic';
  }

  get aiModel(): string {
    const explicit = this.get('AI_MODEL');
    if (explicit) return explicit;
    return this.aiProvider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_ANTHROPIC_MODEL;
  }

  get aiApiKey(): string {
    const provider = this.aiProvider;
    const key = provider === 'gemini' ? this.get('GEMINI_API_KEY') : this.get('ANTHROPIC_API_KEY');
    if (!key) {
      throw new Error(`Missing API key for AI provider: ${provider}`);
    }
    return key;
  }

  get placesProvider(): 'google' | 'osm' {
    const configured = this.get('PLACES_PROVIDER');
    if (configured) return configured;
    return this.get('GOOGLE_PLACES_API_KEY') ? 'google' : 'osm';
  }

  get overpassApiUrl(): string {
    return this.get('OVERPASS_API_URL') || 'https://lz4.overpass-api.de/api/interpreter';
  }
}
