/**
 * Discussion coach for the mobile app's prospect screen.
 *
 * The officer taps one of the suggested questions ("Is this activity already
 * fully funded?") and keeps chatting. The model coaches the OFFICER — how to ask,
 * why it matters, what the answers could mean. It never plays the business owner
 * and never decides eligibility.
 *
 * Provider: Claude when ANTHROPIC_API_KEY is set, else Gemini when GEMINI_API_KEY
 * is, else (or on any failure, or with KILL_SWITCH=true) a deterministic offline
 * reply built from the prospect data — so a demo never dead-ends on a network
 * error. Keys come from the environment, then apps/api/.env.
 *
 * Only synthetic demo data from data.json is sent. Messages that look like
 * personal or account details are refused before they reach any model: the
 * contest rule is that customer information never goes into an AI tool.
 */
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

// The reference default for new Claude code. Override with COACH_CLAUDE_MODEL.
const CLAUDE_MODEL = 'claude-opus-5-5';
// Same default as review mining (apps/api review-mining.schema.ts).
const GEMINI_MODEL = 'gemini-2.5-flash';

const MAX_MESSAGES = 20;
const MAX_CHARS = 2000;

/** Reads KEY=value lines; the environment wins over the file. */
export function loadCoachEnv(envFile, env = process.env) {
  const file = {};
  try {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) file[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // no .env — offline coach
  }
  const get = (k) => (env[k] ?? file[k] ?? '').trim();
  return {
    anthropicKey: get('ANTHROPIC_API_KEY'),
    geminiKey: get('GEMINI_API_KEY'),
    provider: get('COACH_PROVIDER') || get('AI_PROVIDER'),
    claudeModel: get('COACH_CLAUDE_MODEL') || CLAUDE_MODEL,
    geminiModel: get('COACH_GEMINI_MODEL') || GEMINI_MODEL,
    killSwitch: get('KILL_SWITCH').toLowerCase() === 'true',
  };
}

// ─── Sensitive-data guard ─────────────────────────────────────────────────────

const SENSITIVE = [
  { re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, what: 'an email address' },
  // Cambodian numbers: +855 / 855 / 0, then 8–9 digits, spaces or dashes allowed.
  { re: /(?:\+?855|\b0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{3,4}\b/, what: 'a phone number' },
  // Eight or more digits in a run (spaces/dashes allowed): ID, account or card numbers.
  { re: /\b\d(?:[\s-]?\d){7,}\b/, what: 'an ID, account or phone number' },
];

/** Returns a short description of what looks sensitive, or null. */
export function findSensitive(text) {
  for (const { re, what } of SENSITIVE) if (re.test(text)) return what;
  return null;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM = `You are a discussion coach inside Territory Radar, an app PPCBank loan officers use to prepare for and run first conversations with small businesses in Cambodia. The officer is talking to you, not to the business owner.

Help with the conversation: how to phrase a question naturally, why it matters, what different answers could mean, and a sensible follow-up. Keep it short and practical — a few sentences or bullets, under about 120 words. The app shows plain text, so write no markdown: no asterisks, underscores or # headings. Use a hyphen for a bullet.

Ground what you say in the prospect context below. The evidence is unverified and the business may not need financing at all; don't invent facts about it, and say when something can only be learned by asking.

Boundaries:
- You don't decide eligibility, approval, rates or limits. Products named here are placeholders, not a verified PPCBank catalogue.
- The visit priority score is not a loan probability; never describe it as one.
- Don't ask for or repeat personal or financial details about real people: names, phone numbers, ID or account numbers, transactions. If the officer shares some, remind them not to and answer without them.
- Reply in the language the officer writes in (English or Khmer).`;

/** Plain-text context from the prospect's own records — all synthetic. */
export function buildContext({ prospect, commune, signals, match, product }) {
  const lines = [
    `Business: ${prospect.displayName} (${prospect.sector.replace(/_/g, ' ')}, ${commune})`,
    `Operating: ~${prospect.businessProfile?.operatingMonths ?? '?'} months (unverified)`,
    `Pipeline status: ${prospect.pipelineStatus}; financing interest: ${prospect.financing.interestStatus}`,
    `Visit priority: ${prospect.priority.score}/100 (not a loan probability)`,
    'Signals:',
    ...signals.map((s) => `- ${s.title} (${s.strength}, ${s.freshness}): ${s.interpretation}`),
  ];
  if (match) {
    lines.push(
      `Suggested discussion: ${product?.name ?? match.productId} — ${match.reason}`,
      `Suggested opening: ${match.suggestedOpening}`,
      `Questions to ask: ${match.discoveryQuestions.join(' | ')}`,
      `Still to verify: ${match.unverifiedRequirements.join(' | ')}`,
    );
  }
  return lines.join('\n');
}

// ─── Providers ────────────────────────────────────────────────────────────────

/** `jsonSchema`: ask for JSON matching it (structured output). */
export async function askClaude(cfg, system, messages, { jsonSchema } = {}) {
  const client = new Anthropic({ apiKey: cfg.anthropicKey });
  const response = await client.beta.messages.create({
    model: cfg.claudeModel,
    max_tokens: 16000,
    // Chat is latency-sensitive and does well at low effort.
    output_config: {
      effort: 'low',
      ...(jsonSchema ? { format: { type: 'json_schema', schema: jsonSchema } } : {}),
    },
    // If the model declines, the API re-runs the request on a fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages,
  });
  if (response.stop_reason === 'refusal') {
    return {
      reply: 'I can’t help with that one. Try rephrasing the question about the conversation.',
      model: response.model,
    };
  }
  const reply = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return { reply, model: response.model };
}

/** `json`: ask for a JSON reply. */
export async function askGemini(cfg, system, messages, { json = false } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: json ? 0.2 : 0.4,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body.slice(0, 200);
    try {
      detail = JSON.parse(body).error?.message ?? detail;
    } catch {
      // raw text
    }
    throw new Error(`Gemini ${res.status}: ${detail}`);
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  if (!cand) throw new Error('Gemini returned no answer');
  if (cand.finishReason === 'SAFETY' || cand.finishReason === 'RECITATION') {
    return {
      reply: 'I can’t help with that one. Try rephrasing the question about the conversation.',
      model: cfg.geminiModel,
    };
  }
  const reply = (cand.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!reply) throw new Error('Gemini returned an empty answer');
  return { reply, model: cfg.geminiModel };
}

/** Readable reason for a failed call, without leaking keys or stack traces. */
export function describeFailure(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'the Claude API key was rejected';
  if (err instanceof Anthropic.PermissionDeniedError) return 'the Claude API key lacks permission';
  if (err instanceof Anthropic.RateLimitError) return 'Claude is rate-limited right now';
  if (err instanceof Anthropic.APIConnectionError) return 'no connection to Claude';
  if (err instanceof Anthropic.APIError) return `Claude returned ${err.status}`;
  return err instanceof Error ? err.message.slice(0, 160) : 'the AI call failed';
}

/**
 * The app renders plain text. Models still slip in markdown emphasis now and then,
 * which would show as literal asterisks, so strip the common markers.
 */
export function plainText(text) {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1$2')
    .replace(/^\s*\*\s+/gm, '- ')
    .trim();
}

// ─── Offline fallback ─────────────────────────────────────────────────────────

/** Deterministic coaching from the prospect data. Labelled as such in the app. */
export function offlineReply(question, ctx) {
  const signal = ctx.signals.find((s) => s.type !== 'directory_presence') ?? ctx.signals[0];
  const verify = ctx.match?.unverifiedRequirements ?? [];
  const parts = [
    `Ask it plainly and early: "${question}"`,
    signal
      ? `Why it matters here: the only evidence is "${signal.title}" (${signal.strength}, unverified). ${signal.interpretation}`
      : 'Why it matters: nothing on file confirms a financing need yet.',
    'Listen for: whether money is already arranged, the rough amount and timing, and who decides.',
  ];
  if (verify.length)
    parts.push(`Then note what is still unverified: ${verify.slice(0, 3).join(', ')}.`);
  parts.push('Record interest only if the owner actually says so.');
  return parts.join('\n\n');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Validates a chat, then answers it. Returns { status, body } for the server.
 * `ctx` is the prospect data from buildContext's input.
 */
/** 'claude' | 'gemini' | 'offline'. A named provider wins if its key is set. */
export function pickProvider(cfg) {
  if (cfg.killSwitch) return 'offline';
  if (cfg.provider === 'gemini' && cfg.geminiKey) return 'gemini';
  if (cfg.provider === 'anthropic' && cfg.anthropicKey) return 'claude';
  if (cfg.anthropicKey) return 'claude';
  if (cfg.geminiKey) return 'gemini';
  return 'offline';
}

export function createCoach(cfg) {
  const provider = pickProvider(cfg);

  return async function coach(ctx, messages) {
    const bad = validate(messages);
    if (bad) return { status: 400, body: { error: bad } };

    const last = messages[messages.length - 1].content;
    const sensitive = findSensitive(last);
    if (sensitive) {
      return {
        status: 422,
        body: {
          code: 'sensitive_content',
          error: `That looks like ${sensitive}. Don't share customer personal or account details with the coach — rephrase without them.`,
        },
      };
    }

    const firstQuestion = messages[0].content;
    if (provider === 'offline') {
      return {
        status: 200,
        body: {
          reply: offlineReply(firstQuestion, ctx),
          source: 'offline',
          model: null,
          notice: cfg.killSwitch
            ? 'KILL_SWITCH is on — offline coach.'
            : 'No AI key configured — offline coach.',
        },
      };
    }

    const system = `${SYSTEM}\n\nProspect context:\n${buildContext(ctx)}`;
    try {
      const { reply, model } =
        provider === 'claude'
          ? await askClaude(cfg, system, messages)
          : await askGemini(cfg, system, messages);
      return { status: 200, body: { reply: plainText(reply), source: provider, model } };
    } catch (err) {
      // Never dead-end a demo: fall back to the offline coach and say why.
      return {
        status: 200,
        body: {
          reply: offlineReply(firstQuestion, ctx),
          source: 'offline',
          model: null,
          notice: `AI unavailable (${describeFailure(err)}) — offline coach.`,
        },
      };
    }
  };
}

function validate(messages) {
  if (!Array.isArray(messages) || messages.length === 0)
    return 'messages must be a non-empty array';
  if (messages.length > MAX_MESSAGES) return `at most ${MAX_MESSAGES} messages per request`;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const role = i % 2 === 0 ? 'user' : 'assistant';
    if (!m || m.role !== role)
      return 'messages must alternate user / assistant, starting with user';
    if (typeof m.content !== 'string' || !m.content.trim()) return 'every message needs text';
    if (m.content.length > MAX_CHARS) return `messages are limited to ${MAX_CHARS} characters`;
  }
  if (messages[messages.length - 1].role !== 'user')
    return 'the last message must be from the officer';
  return null;
}
