import { z } from 'zod';

const optionalNonEmptyString = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().min(1).optional(),
);

const optionalDatabaseUrl = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.url({ protocol: /^postgres(ql)?$/ }).optional(),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /**
     * Connection used by pg-boss. Defaults to DATABASE_URL. On Neon, prefer the
     * DIRECT (unpooled) host here: the queue holds long-lived polling sessions,
     * which sit awkwardly behind PgBouncer's transaction pooling.
     */
    QUEUE_DATABASE_URL: optionalDatabaseUrl,
    /** Google Places API key. Required if PLACES_PROVIDER is 'google' (or auto-detected). */
    GOOGLE_PLACES_API_KEY: optionalNonEmptyString,
    /** Places data source: 'google' or 'osm' (OpenStreetMap Overpass). Defaults to 'osm' if GOOGLE_PLACES_API_KEY is unset. */
    PLACES_PROVIDER: z.enum(['google', 'osm']).optional(),
    /** Overpass API URL for OSM queries. */
    OVERPASS_API_URL: optionalNonEmptyString,
    /** Anthropic API key for review mining. Required if AI_PROVIDER is 'anthropic' (or auto-detected). */
    ANTHROPIC_API_KEY: optionalNonEmptyString,
    /** Google Gemini API key for review mining. Required if AI_PROVIDER is 'gemini'. */
    GEMINI_API_KEY: optionalNonEmptyString,
    /** Active AI provider. Defaults to 'gemini' if GEMINI_API_KEY is present without Anthropic, else 'anthropic'. */
    AI_PROVIDER: z.enum(['anthropic', 'gemini']).optional(),
    /** Model override (e.g. 'claude-sonnet-4-6', 'gemini-2.5-flash'). */
    AI_MODEL: optionalNonEmptyString,
    API_KEY: z.string().min(32, 'API_KEY must be at least 32 characters'),
    /** USD per calendar month, estimated from call counts × list price. */
    PLACES_MONTHLY_BUDGET: z.coerce.number().nonnegative(),
    ENRICH_ROTATION_PCT: z.coerce.number().min(0).max(100),
    // z.coerce.boolean() would turn the string "false" into true.
    KILL_SWITCH: z.stringbool().default(false),
    /** Queue workers run in parallel per queue. Keep low — Google rate limits apply. */
    SCAN_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    /** Ceiling on outbound Google calls per second, across all workers. */
    PLACES_MAX_QPS: z.coerce.number().positive().max(50).default(8),
  })
  .superRefine((data, ctx) => {
    const placesProvider = data.PLACES_PROVIDER ?? (data.GOOGLE_PLACES_API_KEY ? 'google' : 'osm');
    if (placesProvider === 'google' && !data.GOOGLE_PLACES_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        message:
          'GOOGLE_PLACES_API_KEY is required when using Google Places (or set PLACES_PROVIDER=osm)',
        path: ['GOOGLE_PLACES_API_KEY'],
      });
    }

    const provider =
      data.AI_PROVIDER ?? (data.GEMINI_API_KEY && !data.ANTHROPIC_API_KEY ? 'gemini' : 'anthropic');
    if (provider === 'gemini') {
      if (!data.GEMINI_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          message: 'GEMINI_API_KEY is required when using Gemini AI',
          path: ['GEMINI_API_KEY'],
        });
      }
    } else {
      if (!data.ANTHROPIC_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          message:
            'ANTHROPIC_API_KEY is required when using Anthropic AI (or set GEMINI_API_KEY / AI_PROVIDER=gemini)',
          path: ['ANTHROPIC_API_KEY'],
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** For ConfigModule's `validate` hook: fails fast at boot with every problem listed. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
