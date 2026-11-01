import { describe, expect, it } from 'vitest';
import raw from '../../../../data/data.json';
import config from '../../../../data/evidence_config.json';
import sample from '../../../../data/evidence_sample.json';
import { areaDemand, communeInfo } from '../../../../scripts/area-codes.mjs';
import {
  allocate,
  assertPublicPack,
  buildAskMessages,
  COMPARE_OFFSET,
  buildEvidencePack,
  confidenceOf,
  offlineAnswer,
  offsetPack,
  packViolations,
  promptPack,
  validateAnswer,
} from '../../../../scripts/evidence.mjs';
import { createWorkspace } from '../../../../scripts/mock-workspace.mjs';
import { RATE_LIMIT, compareTarget, createRadarAsk } from '../../../../scripts/radar-ask.mjs';

const TYPES = Object.keys(config.loanTypes);
const demand = areaDemand();
const TODAY = '2026-10-15';

function pack(code: string, loanType = 'car', leads: (typeof lead)[] = []) {
  return buildEvidencePack({
    code,
    loanType,
    commune: communeInfo(code),
    score: demand.communes[code].score[loanType],
    sample,
    config,
    leads,
    today: TODAY,
  });
}

const lead = {
  prospectId: 'prospect_x',
  name: 'Sample Garage',
  lat: 11.55,
  lng: 104.93,
  signals: [{ type: 'equipment_purchase', detectedAt: '2026-10-01T08:00:00+07:00' }],
};

describe('evidence pack', () => {
  it('has points that sum exactly to the score, for every sangkat and loan type', () => {
    for (const code of Object.keys(sample.communes)) {
      for (const t of TYPES) {
        const p = pack(code, t)!;
        expect(p.breakdown.reduce((s: number, i: { points: number }) => s + i.points, 0)).toBe(
          p.score,
        );
        expect(p.breakdown[0].n).toBe(0);
        expect(p.breakdown.every((i: { points: number }) => i.points >= 0)).toBe(true);
      }
    }
  });

  it('is sample data, and missing census leaves fewer signals', () => {
    const p = pack('120101')!;
    expect(p.sample).toBe(true);
    expect(p.signalsTotal).toBe(4);
    const noCensus = Object.entries(sample.communes).find(([, c]) => c.householdsPerKm2 === null);
    expect(noCensus).toBeDefined();
    expect(pack(noCensus![0])!.signalsAvailable).toBe(3);
  });

  it('lists matching leads with their prospect ids', () => {
    const p = pack('120101', 'car', [lead])!;
    const leads = p.breakdown.find((i: { id: string }) => i.id === 'leads');
    expect(leads.records[0]).toMatchObject({ name: 'Sample Garage', prospectId: 'prospect_x' });
    // A lead whose signals don't fit the loan type is not evidence for it.
    const other = pack('120101', 'home', [lead])!;
    expect(other.breakdown.find((i: { id: string }) => i.id === 'leads').totalRecords).toBe(0);
  });

  it('returns null outside the sample', () => {
    expect(pack('010201')).toBeNull();
  });
});

describe('confidence', () => {
  it('follows the signal-agreement rules', () => {
    expect(confidenceOf(4, '2026-10-03', TODAY)).toBe('high');
    expect(confidenceOf(3, '2026-10-03', TODAY)).toBe('medium');
    expect(confidenceOf(2, '2026-10-03', TODAY)).toBe('low');
  });

  it('is low when the scan is over 30 days old', () => {
    expect(confidenceOf(4, '2026-09-01', TODAY)).toBe('low');
    expect(confidenceOf(4, '2026-09-15', TODAY)).toBe('high'); // exactly 30 days
  });

  it('shares out points exactly', () => {
    expect(allocate(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocate(7, [0, 0])).toEqual([0, 0]);
  });
});

describe('public-data allowlist', () => {
  it('passes every real pack', () => {
    for (const t of TYPES) expect(packViolations(pack('120101', t, [lead])!)).toEqual([]);
  });

  it('fails on any field outside the allowlist, at any depth', () => {
    const p = pack('120101', 'car', [lead])!;
    expect(() => assertPublicPack({ ...p, officerName: 'Dara' })).toThrow(/pack\.officerName/);
    const leaky = structuredClone(p);
    leaky.breakdown[3].records[0].phone = '012 345 678';
    expect(() => assertPublicPack(leaky)).toThrow(/records\[0\]\.phone/);
    leaky.breakdown[3].records[0] = { name: 'x', tag: 'y', when: 'z', accountNo: '1' };
    expect(packViolations(leaky)).toContain('breakdown[3].records[0].accountNo');
  });

  it('keeps coordinates and officer feedback out of the prompt form', () => {
    const p = { ...pack('120101', 'car', [lead])!, groundTruth: { agree: 2, disagree: 1 } };
    const forPrompt = promptPack(p);
    expect(forPrompt.groundTruth).toBeUndefined();
    const text = JSON.stringify(forPrompt);
    expect(text).not.toMatch(/"lat"|"lng"|"osmId"|groundTruth/);
    expect(packViolations(forPrompt, { forPrompt: true })).toEqual([]);
  });
});

describe('answer checks', () => {
  const p = pack('120101', 'car', [lead])!;

  it('strips citations the pack does not have', () => {
    const r = validateAnswer(
      { answer: 'Demand is high [1][2]. Also [9] and [1, 7].', citations: [1, 9], action: null },
      [p],
    )!;
    expect(r.answer).toBe('Demand is high [1][2]. Also and [1].');
    expect(r.citations).toEqual([1, 2]);
  });

  it('drops prospect ids and areas that are not in the evidence', () => {
    const r = validateAnswer(
      {
        answer: 'Visit them [3].',
        citations: [3],
        action: {
          type: 'plan_visits',
          label: 'Plan',
          prospectIds: ['prospect_x', 'prospect_fake'],
        },
      },
      [p],
    )!;
    expect(r.action).toEqual({ type: 'plan_visits', label: 'Plan', prospectIds: ['prospect_x'] });
    const none = validateAnswer(
      {
        answer: 'x',
        citations: [],
        action: { type: 'plan_visits', label: 'P', prospectIds: ['nope'] },
      },
      [p],
    )!;
    expect(none.action).toBeNull();
  });

  it('removes made-up citation formats and the gaps they leave', () => {
    const r = validateAnswer(
      {
        answer: 'Scores 99 [area="Tonle Basak"] [score] and 28 points [42]) [1].',
        citations: [],
        action: null,
      },
      [p],
    )!;
    expect(r.answer).toBe('Scores 99 and 28 points) [1].');
  });

  it('keeps a compared area’s citations, renumbered from 10', () => {
    const other = offsetPack(pack('120408')!, COMPARE_OFFSET);
    const r = validateAnswer(
      { answer: 'Here [1], there [11]; nowhere [5].', citations: [1, 11], action: null },
      [p, other],
    )!;
    expect(r.citations).toEqual([1, 11]);
    expect(r.answer).toBe('Here [1], there [11]; nowhere.');
  });

  it('rejects replies without an answer', () => {
    expect(validateAnswer({ citations: [1] }, [p])).toBeNull();
    expect(validateAnswer(null, [p])).toBeNull();
  });

  it('says "not in the evidence" instead of guessing', () => {
    expect(offlineAnswer('What is the average income here?', p).answer).toMatch(
      /not in the evidence/,
    );
    const why = offlineAnswer('Why is car loan demand high here?', p);
    expect(why.citations.length).toBeGreaterThan(0);
  });

  it('finds the sangkat a compare question names', () => {
    const communes = communeInfo('120101').province.districts.flatMap(
      (d: { communes: unknown[] }) => d.communes,
    );
    expect(compareTarget('Compare with Boeng Kak Ti Pir', communes, '120101')?.code).toBe('120408');
    expect(compareTarget('Why is demand high?', communes, '120101')).toBeNull();
  });
});

describe('Ask Radar prompt', () => {
  it('contains only the pack, the question and earlier chat (snapshot)', () => {
    const p = { ...pack('120101', 'car', [lead])!, groundTruth: { agree: 5, disagree: 0 } };
    const messages = buildAskMessages({
      pack: p,
      question: 'Why is car loan demand high here?',
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Ask me about Tonle Basak.' },
      ],
    });
    expect(messages).toMatchSnapshot();
    const text = JSON.stringify(messages);
    // Nothing from the officer's workspace beyond public scan results.
    for (const leak of [
      'officer_',
      'Dara',
      'groundTruth',
      'outcome_note',
      'phone',
      'email',
      '"lat"',
    ]) {
      expect(text).not.toContain(leak);
    }
  });
});

describe('endpoints', () => {
  const quiet = { log: () => undefined };
  const offline = { anthropicKey: '', geminiKey: '', provider: '', killSwitch: false };

  async function call(
    ws: ReturnType<typeof createWorkspace>,
    method: string,
    path: string,
    body?: unknown,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON bodies
    let out: { status: number; data: any } = { status: 0, data: null };
    const req = {
      method,
      on(event: string, cb: (chunk?: Buffer) => void) {
        if (event === 'data' && body !== undefined) cb(Buffer.from(JSON.stringify(body)));
        if (event === 'end') cb();
        return req;
      },
    };
    await ws.handle(
      req as never,
      {} as never,
      new URL(`http://x${path}`),
      (status: number, data: unknown) => {
        out = { status, data };
      },
    );
    return out;
  }

  it('serves a pack with feedback counts, and feedback upserts per officer', async () => {
    const ws = createWorkspace(raw, { radar: createRadarAsk(offline, quiet) });
    const first = await call(
      ws,
      'GET',
      '/areas/120101/evidence?loanType=car&officerId=officer_001',
    );
    expect(first.status).toBe(200);
    expect(first.data.groundTruth).toEqual({ agree: 0, disagree: 0 });
    const body = { loanType: 'car', scanDate: first.data.scanDate, verdict: 'agree' };
    await call(ws, 'POST', '/areas/120101/feedback?officerId=officer_001', body);
    const again = await call(ws, 'POST', '/areas/120101/feedback?officerId=officer_001', {
      ...body,
      verdict: 'disagree',
    });
    expect(again.data.groundTruth).toEqual({ agree: 0, disagree: 1 });
    await call(ws, 'POST', '/areas/120101/feedback?officerId=officer_002', body);
    const after = await call(
      ws,
      'GET',
      '/areas/120101/evidence?loanType=car&officerId=officer_001',
    );
    expect(after.data.groundTruth).toEqual({ agree: 1, disagree: 1 });
  });

  it('answers from the server-side pack, citing it', async () => {
    const ws = createWorkspace(raw, { radar: createRadarAsk(offline, quiet) });
    const r = await call(ws, 'POST', '/areas/120101/ask?officerId=officer_001', {
      loanType: 'car',
      question: 'Why is car loan demand high here?',
      // A pack sent by the app is ignored.
      pack: { breakdown: [{ n: 99 }] },
    });
    expect(r.status).toBe(200);
    expect(r.data.citations.length).toBeGreaterThan(0);
    expect(r.data.citations.every((n: number) => n >= 0 && n <= 4)).toBe(true);
  });

  it('refuses customer details and enforces the hourly limit', async () => {
    const ask = createRadarAsk(offline, quiet);
    const p = pack('120101')!;
    const sensitive = await ask({
      officerId: 'o1',
      pack: p,
      question: 'Call 012 345 678?',
      history: [],
    });
    expect(sensitive.status).toBe(422);
    let last = 0;
    for (let i = 0; i <= RATE_LIMIT.questions; i++) {
      last = (await ask({ officerId: 'o2', pack: p, question: 'Why?', history: [], now: 1000 }))
        .status;
    }
    expect(last).toBe(429);
  });
});
