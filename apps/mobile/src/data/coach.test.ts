import { describe, expect, it } from 'vitest';
import raw from '../../../../data/data.json';
import { createCoach, findSensitive, pickProvider } from '../../../../scripts/mock-coach.mjs';
import { createWorkspace } from '../../../../scripts/mock-workspace.mjs';

// No keys: the coach runs offline, so these tests never touch the network.
const offline = {
  anthropicKey: '',
  geminiKey: '',
  provider: '',
  claudeModel: '',
  geminiModel: '',
  killSwitch: false,
};

/** Calls the mock server's handler the way Node's http server would. */
async function post(path: string, body: unknown, officerId = 'officer_001') {
  const { handle } = createWorkspace(raw, { coach: createCoach(offline) });
  const json = JSON.stringify(body);
  const req = {
    method: 'POST',
    on(event: string, cb: (chunk?: string) => void) {
      if (event === 'data') cb(json);
      if (event === 'end') cb();
    },
  };
  let status = 0;
  let out: { reply?: string; source?: string; code?: string; error?: string } = {};
  await handle(
    req as never,
    {} as never,
    new URL(`http://x${path}?officerId=${officerId}`),
    (s: number, d: never) => {
      status = s;
      out = d;
    },
  );
  return { status, out };
}

const ask = (content: string) => ({ messages: [{ role: 'user', content }] });

describe('sensitive-data guard', () => {
  it.each([
    ['Cambodian mobile', 'owner said call him on 012 345 678'],
    ['international format', 'number is +855 12 345 678'],
    ['email', 'send it to owner@example.com'],
    ['ID / account digits', 'account 0012 3456 7890'],
  ])('blocks %s', (_, text) => {
    expect(findSensitive(text)).not.toBeNull();
  });

  it.each([
    'Is this activity already fully funded?',
    'They want about USD 20,000 in 6 months',
    'Visit at 10:00 on 15 Oct, 2 branches, 30 staff',
    'តើសកម្មភាពនេះមានថវិការួចហើយឬនៅ?',
  ])('lets ordinary conversation through: %s', (text) => {
    expect(findSensitive(text)).toBeNull();
  });
});

describe('POST /prospects/:id/coach', () => {
  it('answers a suggested question, offline, from the prospect data', async () => {
    const { status, out } = await post(
      '/prospects/prospect_001/coach',
      ask('Is this activity already fully funded?'),
    );
    expect(status).toBe(200);
    expect(out.source).toBe('offline');
    expect(out.reply).toContain('Is this activity already fully funded?');
    expect(out.reply).toContain('Second location announced'); // grounded in this prospect's signal
  });

  it('refuses a message with customer details before any model sees it', async () => {
    const { status, out } = await post(
      '/prospects/prospect_001/coach',
      ask('Owner phone is 012 345 678, what next?'),
    );
    expect(status).toBe(422);
    expect(out.code).toBe('sensitive_content');
  });

  it('will not coach on another officer’s prospect', async () => {
    const other = raw.prospects.find((p) => p.assignmentOfficerId === 'officer_002')!;
    const { status } = await post(`/prospects/${other.id}/coach`, ask('Is this funded?'));
    expect(status).toBe(404);
  });

  it('rejects a malformed chat', async () => {
    const bad = { messages: [{ role: 'assistant', content: 'hi' }] };
    expect((await post('/prospects/prospect_001/coach', bad)).status).toBe(400);
    expect((await post('/prospects/prospect_001/coach', { messages: [] })).status).toBe(400);
  });

  it('accepts a continued conversation', async () => {
    const chat = {
      messages: [
        { role: 'user', content: 'Is this activity already fully funded?' },
        { role: 'assistant', content: 'Ask it early…' },
        { role: 'user', content: 'What if they say it is partly funded?' },
      ],
    };
    expect((await post('/prospects/prospect_001/coach', chat)).status).toBe(200);
  });
});

describe('provider choice', () => {
  it('prefers Claude when its key is set, Gemini otherwise, offline without keys', () => {
    expect(pickProvider({ ...offline, anthropicKey: 'k', geminiKey: 'g' })).toBe('claude');
    expect(pickProvider({ ...offline, geminiKey: 'g' })).toBe('gemini');
    expect(pickProvider(offline)).toBe('offline');
  });

  it('honours an explicit provider and the kill switch', () => {
    expect(
      pickProvider({ ...offline, anthropicKey: 'k', geminiKey: 'g', provider: 'gemini' }),
    ).toBe('gemini');
    expect(pickProvider({ ...offline, anthropicKey: 'k', killSwitch: true })).toBe('offline');
  });
});
