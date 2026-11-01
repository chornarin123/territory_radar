/**
 * Ask Radar: answers an officer's question about one sangkat from its evidence
 * pack only. The pack is loaded by the server; the app never sends one.
 *
 * Uses the same model setup as the discussion coach (mock-coach.mjs): Claude if
 * a key is set, else Gemini, else answers built from the pack alone. Replies
 * must be JSON and pass validateAnswer(); one retry, then a safe fallback.
 * Logs question, area, loan type, cited ids and latency, never the answer.
 */

import {
  ASK_SYSTEM,
  COMPARE_OFFSET,
  buildAskMessages,
  offlineAnswer,
  offsetPack,
  parseJsonReply,
  validateAnswer,
} from './evidence.mjs';
import {
  askClaude,
  askGemini,
  describeFailure,
  findSensitive,
  pickProvider,
} from './mock-coach.mjs';

export const MAX_HISTORY = 6;
export const RATE_LIMIT = { questions: 30, windowMs: 60 * 60 * 1000 };
const MAX_QUESTION = 500;

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    citations: { type: 'array', items: { type: 'integer' } },
    action: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['show_on_map', 'plan_visits', 'compare_area'] },
            label: { type: 'string' },
            communeCodes: { type: 'array', items: { type: 'string' } },
            prospectIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['type', 'label'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['answer', 'citations', 'action'],
  additionalProperties: false,
};

const FALLBACK =
  "Radar couldn't produce a checked answer to that. Try rephrasing, or look through the evidence cards.";

/** Validation errors for the request body, or null. */
export function checkAskInput({ question, history }) {
  if (typeof question !== 'string' || !question.trim()) return 'question is required';
  if (question.length > MAX_QUESTION) return `questions are limited to ${MAX_QUESTION} characters`;
  if (history !== undefined && !Array.isArray(history)) return 'history must be an array';
  for (const m of history ?? []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return 'history items need a role (user/assistant) and text';
    }
  }
  return null;
}

/** Keeps the last MAX_HISTORY turns, starting on a user turn, as plain text. */
export function trimHistory(history = []) {
  const recent = history
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (recent.length && recent[0].role !== 'user') recent.shift();
  return recent;
}

export function createRadarAsk(cfg, { log = (e) => console.log(JSON.stringify(e)) } = {}) {
  const provider = pickProvider(cfg);
  const asked = new Map(); // officerId → timestamps in the window

  function limited(officerId, now) {
    const recent = (asked.get(officerId) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
    if (recent.length >= RATE_LIMIT.questions) {
      asked.set(officerId, recent);
      return true;
    }
    recent.push(now);
    asked.set(officerId, recent);
    return false;
  }

  async function callModel(messages) {
    const raw =
      provider === 'claude'
        ? (await askClaude(cfg, ASK_SYSTEM, messages, { jsonSchema: ANSWER_SCHEMA })).reply
        : (await askGemini(cfg, ASK_SYSTEM, messages, { json: true })).reply;
    return parseJsonReply(raw);
  }

  /**
   * @returns {Promise<{ status: number, body: object }>}
   */
  return async function ask({
    officerId,
    pack,
    comparePack = null,
    question,
    history = [],
    now = Date.now(),
  }) {
    const started = Date.now();

    // Officers type freely: keep customer details out of every model call.
    for (const text of [
      question,
      ...history.filter((m) => m.role === 'user').map((m) => m.content),
    ]) {
      const sensitive = findSensitive(text);
      if (sensitive) {
        return {
          status: 422,
          body: {
            code: 'sensitive_content',
            error: `That looks like ${sensitive}. Ask Radar only sees public data — rephrase without customer details.`,
          },
        };
      }
    }
    if (limited(officerId, now)) {
      return {
        status: 429,
        body: {
          error: `Ask Radar is limited to ${RATE_LIMIT.questions} questions an hour. Try again later.`,
        },
      };
    }

    // Checked against the numbers the model saw: the compared pack is renumbered.
    const packs = comparePack ? [pack, offsetPack(comparePack, COMPARE_OFFSET)] : [pack];
    const messages = buildAskMessages({
      pack,
      comparePack,
      question,
      history: trimHistory(history),
    });

    let result = null;
    let source = provider === 'claude' ? 'claude' : provider === 'gemini' ? 'gemini' : 'offline';
    let notice;
    if (provider === 'offline') {
      result = offlineAnswer(question, pack, comparePack);
      notice = cfg.killSwitch
        ? 'KILL_SWITCH is on — answers built from the evidence.'
        : 'No AI key configured — answers built from the evidence.';
    } else {
      try {
        for (let attempt = 0; attempt < 2 && !result; attempt++) {
          result = validateAnswer(await callModel(messages), packs);
        }
        if (!result) {
          result = { answer: FALLBACK, citations: [], action: null };
          notice = "The model's reply failed the evidence checks twice.";
        }
      } catch (err) {
        // Never dead-end a demo: answer from the evidence and say why.
        result = offlineAnswer(question, pack, comparePack);
        source = 'offline';
        notice = `AI unavailable (${describeFailure(err)}) — answer built from the evidence.`;
      }
    }

    log({
      event: 'ask_radar',
      question,
      communeCode: pack.communeCode,
      compareCode: comparePack?.communeCode ?? null,
      loanType: pack.loanType,
      cited: result.citations,
      source,
      latencyMs: Date.now() - started,
    });

    return {
      status: 200,
      body: { ...result, source, ...(notice ? { notice } : {}) },
    };
  };
}

/**
 * The area a "compare with X" question names, among `candidates`
 * ({ code, name_en }), or null. Longest name first, so "Boeng Kak Ti Pir"
 * wins over "Boeng Kak".
 */
export function compareTarget(question, candidates, selfCode) {
  if (!/\b(compare|compared|vs\.?|versus)\b/i.test(question)) return null;
  const q = question.toLowerCase();
  return (
    [...candidates]
      .filter((c) => c.code !== selfCode)
      .sort((a, b) => b.name_en.length - a.name_en.length)
      .find((c) => q.includes(c.name_en.toLowerCase())) ?? null
  );
}
