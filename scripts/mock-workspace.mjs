/**
 * Officer-workspace endpoints for the mobile app (design/UI_SPEC.md).
 *
 * The app reads one officer-scoped bundle (GET /workspace) and writes back
 * through a handful of small actions. Territory scoping happens HERE, on the
 * server: a prospect outside the officer's assignment is never sent, so the
 * app cannot show it by mistake ("Never show prospects outside the officer's
 * territory", spec §4).
 *
 * State is an in-memory copy of data.json. Restarting the server resets it,
 * which is what a demo wants.
 */

import {
  BOUNDARY_LEVELS,
  areaAt,
  areaDemand,
  boundariesIn,
  districtOutlines,
  communeInfo,
  loadAddressTree,
  loadEvidenceConfig,
  loadEvidenceSample,
} from './area-codes.mjs';
import { buildEvidencePack, pickPulse } from './evidence.mjs';
import { checkAskInput, compareTarget } from './radar-ask.mjs';

/**
 * @param {any} rawData parsed data.json
 * @param {{ coach?: (ctx: any, messages: any[]) => Promise<{ status: number, body: any }>, radar?: (input: any) => Promise<{ status: number, body: any }> }} [options]
 *   `coach` answers POST /prospects/:id/coach (see mock-coach.mjs); `radar`
 *   answers POST /areas/:code/ask (see radar-ask.mjs). Injected so tests can
 *   run them offline.
 */
export function createWorkspace(rawData, options = {}) {
  // Deep copy: writes must never touch the caller's parsed data.json.
  const db = JSON.parse(JSON.stringify(rawData));
  const meta = db.metadata;

  // Prospects carry lat/lng only: add the commune/district/province codes they
  // fall in, for the app's area filter (see area-codes.mjs).
  for (const p of db.prospects) {
    const at = p.location ? areaAt(p.location.lat, p.location.lng) : null;
    Object.assign(p.address, {
      communeCode: at?.communeCode ?? null,
      districtCode: at?.districtCode ?? null,
      provinceCode: at?.provinceCode ?? null,
      communeName: at?.communeName ?? null,
    });
  }

  // "Now" is metadata.asOf when fixedClock is set (spec §3). Real elapsed time
  // is added so actions recorded in one session keep their order.
  const bootedAt = Date.now();
  const now = () =>
    meta.fixedClock
      ? toPhnomPenhIso(new Date(Date.parse(meta.asOf) + (Date.now() - bootedAt)))
      : toPhnomPenhIso(new Date());

  let seq = 0;
  const newId = (prefix) => `${prefix}_live_${Date.now().toString(36)}_${++seq}`;

  /** Area ids an officer may see: assignment roots plus their descendants. */
  function territoryAreaIds(officerId) {
    const ids = new Set();
    for (const a of db.territoryAssignments.filter((t) => t.officerId === officerId)) {
      for (const root of a.rootAreaIds) {
        ids.add(root);
        if (!a.includeDescendants) continue;
        const stack = [root];
        while (stack.length) {
          const parent = stack.pop();
          for (const child of db.administrativeAreas.filter((x) => x.parentId === parent)) {
            ids.add(child.id);
            stack.push(child.id);
          }
        }
      }
    }
    return ids;
  }

  /** Assigned to this officer AND inside their territory — both, not either. */
  function visibleProspects(officerId) {
    const area = territoryAreaIds(officerId);
    return db.prospects.filter(
      (p) =>
        p.assignmentOfficerId === officerId &&
        (p.territoryPathIds ?? []).some((id) => area.has(id)),
    );
  }

  function workspace(officerId) {
    const officer = db.officers.find((o) => o.id === officerId);
    if (!officer) return null;
    const prospects = visibleProspects(officerId);
    const pids = new Set(prospects.map((p) => p.id));
    const mine = (x) => x.officerId === officerId;
    const forProspect = (x) => pids.has(x.prospectId);
    const area = territoryAreaIds(officerId);

    return {
      metadata: meta,
      settings: db.settings,
      uiCopy: db.uiCopy,
      stateTransitions: db.stateTransitions,
      officer,
      branch: db.branches.find((b) => b.id === officer.branchId) ?? null,
      territoryAssignments: db.territoryAssignments.filter(mine),
      administrativeAreas: db.administrativeAreas.filter((a) => area.has(a.id)),
      products: db.products,
      prospects,
      signals: db.signals.filter(forProspect),
      evidence: db.evidence.filter(forProspect),
      productMatches: db.productMatches.filter(forProspect),
      activities: db.activities.filter(forProspect),
      tasks: db.tasks.filter((t) => mine(t) && pids.has(t.prospectId)),
      visits: db.visits.filter((v) => mine(v) && pids.has(v.prospectId)),
      routePlans: db.routePlans.filter(mine),
      notifications: db.notifications.filter(
        (n) => mine(n) && (n.prospectId == null || pids.has(n.prospectId)),
      ),
    };
  }

  function addActivity(prospect, officerId, type, note) {
    const at = now();
    db.activities.push({
      id: newId('activity'),
      prospectId: prospect.id,
      officerId,
      type,
      occurredAt: at,
      note,
      visibility: 'officer_workspace',
    });
    prospect.updatedAt = at;
    prospect.lastActivityAt = at;
  }

  const STATUS_LABEL = {
    new: 'New',
    contacted: 'Contacted',
    qualified: 'Qualified',
    visit_planned: 'Visit planned',
    follow_up: 'Follow-up',
    unreachable: 'Unreachable',
    application_referred: 'Referred',
    not_interested: 'Not interested',
    closed: 'Closed',
  };

  /** Validated against data.json's stateTransitions. Returns an error string or null. */
  function transition(prospect, officerId, to) {
    const from = prospect.pipelineStatus;
    if (from === to) return null;
    if (!(db.stateTransitions[from] ?? []).includes(to)) {
      return `Cannot move from ${from} to ${to}`;
    }
    prospect.pipelineStatus = to;
    addActivity(
      prospect,
      officerId,
      'status_changed',
      `Status: ${STATUS_LABEL[from]} → ${STATUS_LABEL[to]}`,
    );
    return null;
  }

  /** Only ever called from an officer action — interest is never inferred (spec §4). */
  function recordInterest(prospect, officerId, interestStatus) {
    prospect.financing = {
      ...prospect.financing,
      interestStatus,
      interestSource: 'officer_recorded',
      interestRecordedAt: now(),
    };
    addActivity(
      prospect,
      officerId,
      'interest_recorded',
      interestStatus === 'confirmed'
        ? 'Financing interest confirmed by officer'
        : interestStatus === 'not_interested'
          ? 'No financing need recorded'
          : 'Financing interest reset to unconfirmed',
    );
  }

  // ─── Evidence, Ask Radar, feedback ──────────────────────────────────────────

  const evidenceCache = new Map(); // code|loanType|scanDate|officer leads → pack
  const feedback = new Map(); // officer|code|loanType|scanDate → { verdict, note, at }
  const LOAN_TYPES = Object.keys(loadEvidenceConfig().loanTypes);

  /** The officer's live prospects in one commune, as public scan results only. */
  function leadsIn(code, officerId) {
    return visibleProspects(officerId)
      .filter(
        (p) =>
          p.address.communeCode === code &&
          p.pipelineStatus !== 'closed' &&
          p.pipelineStatus !== 'not_interested',
      )
      .map((p) => ({
        prospectId: p.id,
        name: p.displayName,
        ...(p.location ? { lat: p.location.lat, lng: p.location.lng } : {}),
        signals: db.signals
          .filter((s) => s.prospectId === p.id)
          .map((s) => ({ type: s.type, detectedAt: s.detectedAt })),
      }));
  }

  /** The pack, without feedback counts: those are added fresh on each read. */
  function packFor(code, loanType, officerId) {
    const commune = communeInfo(code);
    const sample = loadEvidenceSample();
    const score = areaDemand().communes[code]?.score?.[loanType];
    if (!commune || score === undefined || !sample.communes[code]) return null;
    const leads = leadsIn(code, officerId);
    const key = [code, loanType, sample.scanDate, leads.map((l) => l.prospectId).join(',')].join(
      '|',
    );
    if (!evidenceCache.has(key)) {
      evidenceCache.set(
        key,
        buildEvidencePack({
          code,
          loanType,
          commune,
          score,
          sample,
          config: loadEvidenceConfig(),
          leads,
          today: now().slice(0, 10),
        }),
      );
    }
    return evidenceCache.get(key);
  }

  function groundTruth(code, loanType, scanDate) {
    const counts = { agree: 0, disagree: 0 };
    for (const [key, f] of feedback) {
      if (key.endsWith(`|${code}|${loanType}|${scanDate}`)) counts[f.verdict] += 1;
    }
    return counts;
  }

  function evidenceFor(code, loanType, officerId) {
    if (!LOAN_TYPES.includes(loanType)) {
      return { status: 400, body: { error: `loanType must be one of ${LOAN_TYPES.join(', ')}` } };
    }
    const pack = packFor(code, loanType, officerId);
    if (!pack) {
      return {
        status: 404,
        body: { error: 'No evidence for this area yet. The sample covers Phnom Penh.' },
      };
    }
    return {
      status: 200,
      body: { ...pack, groundTruth: groundTruth(code, loanType, pack.scanDate) },
    };
  }

  async function askRadar(code, body, officerId) {
    if (!options.radar) return { status: 503, body: { error: 'Ask Radar is not configured' } };
    const bad = checkAskInput(body);
    if (bad) return { status: 400, body: { error: bad } };
    const { loanType, question, history = [] } = body;
    if (!LOAN_TYPES.includes(loanType)) {
      return { status: 400, body: { error: `loanType must be one of ${LOAN_TYPES.join(', ')}` } };
    }
    // Always the server's own pack: never one sent by the app.
    const pack = packFor(code, loanType, officerId);
    if (!pack) return { status: 404, body: { error: 'No evidence for this area yet.' } };

    // "Compare with X": load X's pack too, if X is a sangkat in the same province.
    const self = communeInfo(code);
    const target = compareTarget(
      question,
      self.province.districts.flatMap((d) => d.communes),
      code,
    );
    const comparePack = target ? packFor(target.code, loanType, officerId) : null;

    const r = await options.radar({ officerId, pack, comparePack, question, history });
    // Citations from the compared pack are numbered from COMPARE_OFFSET; name it
    // so the app can label and open them.
    if (r.status === 200 && comparePack) {
      r.body.compared = { communeCode: comparePack.communeCode, name: comparePack.name };
    }
    return r;
  }

  function recordFeedback(code, body, officerId) {
    const { loanType, scanDate, verdict, note } = body ?? {};
    if (!LOAN_TYPES.includes(loanType)) return { status: 400, body: { error: 'Unknown loanType' } };
    if (verdict !== 'agree' && verdict !== 'disagree') {
      return { status: 400, body: { error: 'verdict must be agree or disagree' } };
    }
    if (typeof scanDate !== 'string')
      return { status: 400, body: { error: 'scanDate is required' } };
    if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
      return { status: 400, body: { error: 'note must be text, at most 500 characters' } };
    }
    if (!communeInfo(code)) return { status: 404, body: { error: 'Unknown area' } };
    // One per officer, area, loan type and scan: a second answer replaces the first.
    feedback.set(`${officerId}|${code}|${loanType}|${scanDate}`, {
      verdict,
      note: note ?? null,
      at: now(),
    });
    return { status: 200, body: { groundTruth: groundTruth(code, loanType, scanDate) } };
  }

  /** Returns true when the request was handled. */
  async function handle(req, res, url, sendJson) {
    const path = url.pathname;
    const method = req.method;
    const officerId = url.searchParams.get('officerId') || meta.defaultOfficerId;

    // Area tree and boundaries for the area filter. Public geography, not
    // territory-scoped; the boundaries are fetched lazily, communes are ~1.8 MB.
    if (path === '/areas' && method === 'GET') {
      sendJson(200, loadAddressTree());
      return true;
    }
    const b = path.match(/^\/boundaries\/([a-z]+)$/);
    if (b && method === 'GET') {
      if (!BOUNDARY_LEVELS.includes(b[1])) return (notFound(sendJson, 'Boundary level'), true);
      sendJson(200, boundariesIn(b[1], url.searchParams.get('province')));
      return true;
    }
    // Khan/district outlines unioned from their communes, for Area demand.
    if (path === '/outlines/districts' && method === 'GET') {
      const province = url.searchParams.get('province');
      if (!province) return (sendJson(400, { error: 'province is required' }), true);
      sendJson(200, districtOutlines(province));
      return true;
    }
    // Predicted loan demand per commune. Sample data until the model's output lands.
    if (path === '/area-demand' && method === 'GET') {
      sendJson(200, areaDemand(url.searchParams.get('province')));
      return true;
    }

    // "Why this score": evidence pack, Ask Radar and officer feedback.
    const ev = path.match(/^\/areas\/(\d{6})\/(evidence|ask|feedback)$/);
    if (ev) {
      const [, code, what] = ev;
      if (what === 'evidence' && method === 'GET') {
        const r = evidenceFor(code, url.searchParams.get('loanType'), officerId);
        sendJson(r.status, r.body);
        return true;
      }
      if (what === 'ask' && method === 'POST') {
        const body = await readJson(req);
        const r = await askRadar(code, body, officerId);
        sendJson(r.status, r.body);
        return true;
      }
      if (what === 'feedback' && method === 'POST') {
        const r = recordFeedback(code, await readJson(req), officerId);
        sendJson(r.status, r.body);
        return true;
      }
    }

    if (path === '/workspace' && method === 'GET') {
      const ws = workspace(officerId);
      sendJson(ws ? 200 : 404, ws ?? { error: `Unknown officer ${officerId}` });
      return true;
    }

    // Today's Area pulse: the biggest score change in the officer's own sangkats.
    if (path === '/area-pulse' && method === 'GET') {
      const codes = new Set(
        visibleProspects(officerId)
          .map((p) => p.address.communeCode)
          .filter(Boolean),
      );
      const packs = [...codes].flatMap((code) =>
        LOAN_TYPES.map((t) => packFor(code, t, officerId)).filter(Boolean),
      );
      sendJson(200, { pulse: pickPulse(packs) });
      return true;
    }

    // Everything below acts on one record and must stay inside the territory.
    const visible = () => new Set(visibleProspects(officerId).map((p) => p.id));

    // "Not relevant" on a new lead: kept for the next scan to learn from.
    const lf = path.match(/^\/prospects\/([^/]+)\/lead-feedback$/);
    if (lf && method === 'POST') {
      const p = db.prospects.find((x) => x.id === lf[1]);
      if (!p || !visible().has(p.id)) return (notFound(sendJson, 'Prospect'), true);
      const body = await readJson(req);
      if (body.verdict !== 'not_relevant') {
        sendJson(400, { error: 'verdict must be not_relevant' });
        return true;
      }
      p.lead_feedback = { verdict: body.verdict, at: now() };
      addActivity(p, officerId, 'lead_feedback', 'Marked not relevant on Today');
      sendJson(200, p);
      return true;
    }

    let m = path.match(/^\/notifications\/([^/]+)$/);
    if (m && method === 'PATCH') {
      const n = db.notifications.find((x) => x.id === m[1] && x.officerId === officerId);
      if (!n) return (notFound(sendJson, 'Notification'), true);
      const body = await readJson(req);
      n.readAt = body.read === false ? null : now();
      sendJson(200, n);
      return true;
    }

    m = path.match(/^\/tasks\/([^/]+)$/);
    if (m && method === 'PATCH') {
      const t = db.tasks.find((x) => x.id === m[1] && x.officerId === officerId);
      if (!t) return (notFound(sendJson, 'Task'), true);
      const body = await readJson(req);
      if (body.status !== 'open' && body.status !== 'done') {
        sendJson(400, { error: 'status must be "open" or "done"' });
        return true;
      }
      t.status = body.status;
      t.completedAt = body.status === 'done' ? now() : null;
      sendJson(200, t);
      return true;
    }

    m = path.match(/^\/prospects\/([^/]+)\/(interest|transition)$/);
    if (m && method === 'POST') {
      const p = db.prospects.find((x) => x.id === m[1]);
      if (!p || !visible().has(p.id)) return (notFound(sendJson, 'Prospect'), true);
      const body = await readJson(req);

      if (m[2] === 'interest') {
        if (!['confirmed', 'not_interested', 'unknown'].includes(body.interestStatus)) {
          sendJson(400, { error: 'interestStatus must be confirmed, not_interested or unknown' });
          return true;
        }
        recordInterest(p, officerId, body.interestStatus);
        // "No financing need" also closes the conversation, as the prototype does.
        if (body.interestStatus === 'not_interested') transition(p, officerId, 'not_interested');
      } else {
        const err = transition(p, officerId, body.to);
        if (err) {
          sendJson(409, { error: err, allowed: db.stateTransitions[p.pipelineStatus] ?? [] });
          return true;
        }
      }
      sendJson(200, p);
      return true;
    }

    // Discussion coach. Nothing is stored: the app sends the chat each time.
    m = path.match(/^\/prospects\/([^/]+)\/coach$/);
    if (m && method === 'POST') {
      const p = db.prospects.find((x) => x.id === m[1]);
      if (!p || !visible().has(p.id)) return (notFound(sendJson, 'Prospect'), true);
      if (!options.coach) {
        sendJson(503, { error: 'Coach is not configured on this server' });
        return true;
      }
      const body = await readJson(req);
      const match = db.productMatches.find((x) => x.prospectId === p.id && x.rank === 1) ?? null;
      const ctx = {
        prospect: p,
        commune: db.administrativeAreas.find((a) => a.id === p.address?.communeId)?.nameEn ?? '',
        signals: db.signals.filter((s) => s.prospectId === p.id),
        match,
        product: match ? (db.products.find((x) => x.id === match.productId) ?? null) : null,
      };
      // Only role and text go any further — nothing else the client sent.
      const messages = Array.isArray(body.messages)
        ? body.messages.map((x) => ({ role: x?.role, content: x?.content }))
        : body.messages;
      const { status, body: out } = await options.coach(ctx, messages);
      sendJson(status, out);
      return true;
    }

    m = path.match(/^\/visits\/([^/]+)\/(check-in|outcome)$/);
    if (m && method === 'POST') {
      const v = db.visits.find((x) => x.id === m[1] && x.officerId === officerId);
      if (!v || !visible().has(v.prospectId)) return (notFound(sendJson, 'Visit'), true);
      const p = db.prospects.find((x) => x.id === v.prospectId);

      if (m[2] === 'check-in') {
        v.status = 'in_progress';
        v.checkedInAt = now();
        v.contactConfirmed = true;
        v.locationVerified = true;
        addActivity(p, officerId, 'visit_checked_in', 'Checked in at visit');
        sendJson(200, v);
        return true;
      }

      const body = await readJson(req);
      const outcomes = ['interested', 'follow_up', 'no_need'];
      if (!outcomes.includes(body.outcome)) {
        sendJson(400, { error: `outcome must be one of ${outcomes.join(', ')}` });
        return true;
      }
      if (!v.checkedInAt) {
        sendJson(409, { error: 'Check in before recording an outcome' });
        return true;
      }
      v.status = 'completed';
      v.completedAt = now();
      v.outcome = body.outcome;

      // Each outcome is the officer reporting what they heard on the visit.
      if (body.outcome === 'interested') {
        recordInterest(p, officerId, 'confirmed');
      } else if (body.outcome === 'no_need') {
        recordInterest(p, officerId, 'not_interested');
        transition(p, officerId, 'not_interested');
      } else {
        db.tasks.push({
          id: newId('task'),
          prospectId: p.id,
          officerId,
          type: 'follow_up',
          title: `Follow up with ${p.displayName}`,
          description: 'Agreed at visit. Confirm needs and next step. Do not assume approval.',
          dueAt: toPhnomPenhIso(new Date(Date.parse(now()) + 3 * 86_400_000)),
          status: 'open',
          priority: 'normal',
          createdAt: now(),
          completedAt: null,
        });
        addActivity(p, officerId, 'visit_completed', 'Visit completed · follow-up task created');
      }
      sendJson(200, v);
      return true;
    }

    return false;
  }

  return { db, handle };
}

function notFound(sendJson, what) {
  sendJson(404, { error: `${what} not found in this officer's workspace` });
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

/** ISO-8601 in +07:00, matching how data.json writes every timestamp. */
function toPhnomPenhIso(d) {
  const local = new Date(d.getTime() + 7 * 3_600_000);
  return local.toISOString().replace(/\.\d{3}Z$/, '+07:00');
}
