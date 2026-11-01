/**
 * Territory Radar - High-Fidelity Mock & Prototype API Server
 *
 * Implements the full backend REST API contract for Territory Radar using data.json.
 * Features:
 * - Domain-aware DTO transformation (officers, leads, live place details, pipeline runs)
 * - State persistence in-memory with optional write-back to data.json
 * - Full CORS, preflight handling, error formatting
 * - Zero external dependencies (pure Node.js)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace } from './mock-workspace.mjs';
import { createCoach, loadCoachEnv, pickProvider } from './mock-coach.mjs';
import { createRadarAsk } from './radar-ask.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.resolve(__dirname, '../data/data.json');

const PORT = parseInt(process.env.PORT || '3002', 10);

// Load mock dataset into memory
let rawData;
try {
  rawData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  console.log(
    `[MockServer] Loaded data.json (${rawData.prospects?.length || 0} prospects, ${rawData.officers?.length || 0} officers)`,
  );
} catch (err) {
  console.error('[MockServer] Failed to load data.json:', err.message);
  process.exit(1);
}

// Officer workspace for the mobile app: GET /workspace plus its write actions.
// Discussion coach: keys from the environment, then apps/api/.env. Never logged.
const coachEnv = loadCoachEnv(path.resolve(__dirname, '../apps/api/.env'));
const coachProvider = {
  claude: `Claude ${coachEnv.claudeModel}`,
  gemini: `Gemini ${coachEnv.geminiModel}`,
  offline: coachEnv.killSwitch ? 'offline (KILL_SWITCH)' : 'offline (no AI key)',
}[pickProvider(coachEnv)];
const workspace = createWorkspace(rawData, {
  coach: createCoach(coachEnv),
  radar: createRadarAsk(coachEnv),
});

// In-memory runtime state for mutations (feedback, status transitions, logs)
const state = {
  prospects: new Map(rawData.prospects.map((p) => [p.id, { ...p }])),
  officers: rawData.officers || [],
  branches: new Map((rawData.branches || []).map((b) => [b.id, b])),
  territoryAssignments: rawData.territoryAssignments || [],
  products: new Map((rawData.products || []).map((p) => [p.id, p])),
  signals: new Map((rawData.signals || []).map((s) => [s.id, s])),
  evidence: new Map((rawData.evidence || []).map((e) => [e.id, e])),
  productMatches: rawData.productMatches || [],
  jobRuns: [
    {
      id: 'run_003',
      jobName: 'scan.score',
      startedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      finishedAt: new Date(Date.now() - 3600000 * 1.8).toISOString(),
      itemsProcessed: 36,
      apiCalls: { 'places.details': 0, 'places.search': 0 },
      errors: [],
    },
    {
      id: 'run_002',
      jobName: 'scan.enrich',
      startedAt: new Date(Date.now() - 3600000 * 3).toISOString(),
      finishedAt: new Date(Date.now() - 3600000 * 2.5).toISOString(),
      itemsProcessed: 28,
      apiCalls: { 'places.details': 28 },
      errors: [],
    },
    {
      id: 'run_001',
      jobName: 'scan.discover',
      startedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
      finishedAt: new Date(Date.now() - 3600000 * 3.7).toISOString(),
      itemsProcessed: 142,
      apiCalls: { 'places.search': 12 },
      errors: [],
    },
  ],
  spendUsd: 18.4,
};

// Helper: map pipelineStatus to mobile app LeadStatus
function mapToLeadStatus(pipelineStatus) {
  switch (pipelineStatus) {
    case 'new':
      return 'new';
    case 'contacted':
    case 'qualified':
    case 'visit_planned':
      return 'visited';
    case 'application_referred':
      return 'won';
    case 'follow_up':
      return 'revisit';
    case 'not_interested':
    case 'closed':
    case 'unreachable':
      return 'declined';
    default:
      return 'new';
  }
}

// Transform prospect to LeadDto contract
function transformToLeadDto(prospect, index) {
  const branch = state.branches.get('branch_001');
  const routePlan = rawData.routePlans?.[0];
  const visitIndex = routePlan
    ? routePlan.visitIds?.findIndex((vId) => vId.includes(prospect.id))
    : -1;

  // Find recommended product match
  const match = state.productMatches.find((m) => m.prospectId === prospect.id);
  const matchedProduct = match ? state.products.get(match.productId) : null;

  // Extract sangkat code (e.g. 120201 from territoryPathIds)
  const sangkatCode = prospect.territoryPathIds?.find((id) => /^\d{6}$/.test(id)) || '120201';

  // Normalize score breakdown
  const rawScore = prospect.priority?.score ?? 75;
  const factors = prospect.priority?.factors || {};

  return {
    id: prospect.id,
    placeId: prospect.id,
    officerId: prospect.assignmentOfficerId || 'officer_001',
    status: mapToLeadStatus(prospect.pipelineStatus),
    assignedAt: prospect.createdAt || '2026-10-15T08:30:00+07:00',
    revisitAfter: prospect.pipelineStatus === 'follow_up' ? '2026-10-25' : null,
    outcomeNote: prospect.dispositionReason || (match ? match.reason : null),
    location: prospect.location ? { lat: prospect.location.lat, lng: prospect.location.lng } : null,
    primaryType: prospect.sector || 'retail',
    sangkatCode,
    routeId: routePlan?.id || 'route_001',
    routePosition: visitIndex >= 0 ? visitIndex + 1 : (index % 12) + 1,
    summaryKm:
      match?.suggestedOpening ||
      `ឱកាសពង្រីកអាជីវកម្មជាមួយកម្ចី PPCBank សម្រាប់ ${prospect.displayName}`,
    businessScale: prospect.borrowerType === 'corporate' ? 'large' : 'small_medium',
    score: {
      scanDate: prospect.priority?.computedAt || '2026-10-15T08:30:00+07:00',
      total: Math.round(rawScore) / 100, // normalized 0-1
      need: (factors.signalStrength || 20) / 35,
      capacity: (factors.businessMaturity || 15) / 20,
      bankability: (factors.evidenceQuality || 8) / 10,
      topFactors: [
        {
          name: 'signal_strength',
          contribution: (factors.signalStrength || 20) / 35,
          weight: 0.35,
        },
        {
          name: 'business_maturity',
          contribution: (factors.businessMaturity || 15) / 20,
          weight: 0.2,
        },
        { name: 'freshness', contribution: (factors.freshness || 15) / 20, weight: 0.2 },
      ],
    },
    // Enriched prototype properties
    displayName: prospect.displayName,
    address: prospect.address?.display || 'Phnom Penh, Cambodia',
    phone: prospect.contact?.phone || '+855 23 909 888',
    recommendedProduct: matchedProduct
      ? {
          name: matchedProduct.name,
          category: matchedProduct.category,
          fitLabel: match.fitLabel,
          pitchGuidance: matchedProduct.pitchGuidance,
        }
      : null,
  };
}

// Transform officers to OfficerDto contract
function getOfficerDtos() {
  return state.officers.map((officer) => {
    const branch = state.branches.get(officer.branchId);
    const assignments = state.territoryAssignments
      .filter((t) => t.officerId === officer.id)
      .flatMap((t) => t.rootAreaIds);

    return {
      id: officer.id,
      name: officer.displayName.replace(' — Demo Loan Officer', ''),
      branch: branch ? branch.name : 'Phnom Penh Main Branch',
      assignedSangkats: assignments.length > 0 ? assignments : ['120201'],
      email: officer.email,
      avatarInitials: officer.avatarInitials,
    };
  });
}

// Create HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  console.log(`[MockServer] ${req.method} ${pathname}`);

  // Helper JSON responder
  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  if (await workspace.handle(req, res, url, sendJson)) return;

  // Route: Health
  if (pathname === '/health') {
    return sendJson(200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      prospectsCount: state.prospects.size,
      officersCount: state.officers.length,
    });
  }

  // Route: GET /officers
  if (pathname === '/officers' && req.method === 'GET') {
    return sendJson(200, getOfficerDtos());
  }

  // Route: GET /leads
  if (pathname === '/leads' && req.method === 'GET') {
    const officerId = url.searchParams.get('officerId');
    const sangkat = url.searchParams.get('sangkat');

    let prospects = Array.from(state.prospects.values());

    if (officerId) {
      prospects = prospects.filter((p) => p.assignmentOfficerId === officerId);
    }

    if (sangkat) {
      prospects = prospects.filter((p) => p.territoryPathIds?.includes(sangkat));
    }

    const leads = prospects.map((p, idx) => transformToLeadDto(p, idx));
    return sendJson(200, leads);
  }

  // Route: GET /places/:placeId/live
  const placeMatch = pathname.match(/^\/places\/([^/]+)\/live$/);
  if (placeMatch && req.method === 'GET') {
    const placeId = decodeURIComponent(placeMatch[1]);
    const prospect = state.prospects.get(placeId);

    if (!prospect) {
      return sendJson(404, { error: 'Place not found' });
    }

    // Resolve signals & evidence
    const relatedSignals = (prospect.signalIds || [])
      .map((sId) => {
        const s = state.signals.get(sId);
        if (!s) return null;
        const ev = (s.evidenceIds || []).map((eId) => state.evidence.get(eId)).filter(Boolean);
        return {
          id: s.id,
          type: s.type,
          title: s.title,
          strength: s.strength,
          interpretation: s.interpretation,
          evidence: ev.map((e) => ({ source: e.sourceName, excerpt: e.excerpt })),
        };
      })
      .filter(Boolean);

    // Resolve product match
    const match = state.productMatches.find((m) => m.prospectId === prospect.id);
    const product = match ? state.products.get(match.productId) : null;

    return sendJson(200, {
      placeId: prospect.id,
      name: prospect.displayName,
      address: prospect.address?.display || 'Phnom Penh, Cambodia',
      phone: prospect.contact?.phone || '+855 23 909 888',
      googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${prospect.location?.lat},${prospect.location?.lng}`,
      // Enriched intelligence
      sector: prospect.sector,
      borrowerType: prospect.borrowerType,
      recommendedProduct: product
        ? {
            id: product.id,
            name: product.name,
            category: product.category,
            fitLabel: match?.fitLabel || 'Candidate',
            reason: match?.reason,
            pitchGuidance: product.pitchGuidance,
            discussionDocuments: product.discussionDocuments,
          }
        : null,
      suggestedOpening:
        match?.suggestedOpening ||
        `PPCBank offers tailored financing for growing ${prospect.sector} businesses.`,
      discoveryQuestions: match?.discoveryQuestions || [
        'What are your primary business goals for the upcoming quarter?',
        'Do you have any upcoming equipment purchases or lease renewals?',
      ],
      signals: relatedSignals,
    });
  }

  // Route: PATCH /leads/:id
  const leadPatchMatch = pathname.match(/^\/leads\/([^/]+)$/);
  if (leadPatchMatch && req.method === 'PATCH') {
    const leadId = decodeURIComponent(leadPatchMatch[1]);
    const prospect = state.prospects.get(leadId);

    if (!prospect) {
      return sendJson(404, { error: 'Lead not found' });
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (payload.status) {
          prospect.pipelineStatus =
            payload.status === 'visited'
              ? 'qualified'
              : payload.status === 'won'
                ? 'application_referred'
                : payload.status === 'revisit'
                  ? 'follow_up'
                  : payload.status === 'declined'
                    ? 'not_interested'
                    : payload.status;
        }
        if (payload.outcomeNote) {
          prospect.dispositionReason = payload.outcomeNote;
        }

        prospect.updatedAt = new Date().toISOString();
        state.prospects.set(leadId, prospect);

        const updatedLead = transformToLeadDto(prospect, 0);
        return sendJson(200, updatedLead);
      } catch (err) {
        return sendJson(400, { error: 'Invalid JSON payload' });
      }
    });
    return;
  }

  // Route: GET /jobs/runs
  if (pathname === '/jobs/runs' && req.method === 'GET') {
    return sendJson(200, state.jobRuns);
  }

  // Route: GET /jobs/usage
  if (pathname === '/jobs/usage' && req.method === 'GET') {
    return sendJson(200, {
      placesSpendUsd: state.spendUsd,
      dailySpendUsd: 2.45,
      budgetCapUsd: 50.0,
      activeScanCells: 16,
    });
  }

  // Route: POST /jobs/:jobName/run
  const jobRunMatch = pathname.match(/^\/jobs\/([^/]+)\/run$/);
  if (jobRunMatch && req.method === 'POST') {
    const jobName = decodeURIComponent(jobRunMatch[1]);
    const sangkat = url.searchParams.get('sangkat') || '120201';

    const newRun = {
      id: `run_${Date.now()}`,
      jobName,
      startedAt: new Date().toISOString(),
      finishedAt: new Date(Date.now() + 1500).toISOString(),
      itemsProcessed: Math.floor(Math.random() * 25) + 10,
      apiCalls: { 'places.search': 1, 'places.details': 5 },
      errors: [],
    };

    state.jobRuns.unshift(newRun);
    state.spendUsd = Math.round((state.spendUsd + 0.2) * 100) / 100;

    return sendJson(200, {
      success: true,
      message: `Triggered ${jobName} for Sangkat ${sangkat}`,
      run: newRun,
    });
  }

  // Route: Raw collections pass-through. Reads live state, so writes made through
  // the workspace endpoints show up here too. Not officer-scoped: debugging only.
  const collectionKey = pathname.slice(1);
  if (workspace.db[collectionKey]) {
    return sendJson(200, workspace.db[collectionKey]);
  }

  // Fallback 404
  return sendJson(404, { error: 'Route not found', path: pathname });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 Territory Radar Mock Server running on http://localhost:${PORT}`);
  console.log(`📦 Serving dataset: ${rawData.metadata?.datasetId}`);
  console.log(`🎯 Endpoints:`);
  console.log(`   - GET  /workspace?officerId=officer_001   (mobile app)`);
  console.log(`   - PATCH /notifications/:id · PATCH /tasks/:id`);
  console.log(`   - POST /prospects/:id/interest · POST /prospects/:id/transition`);
  console.log(`   - POST /visits/:id/check-in · POST /visits/:id/outcome`);
  console.log(`   - POST /prospects/:id/coach   (discussion coach: ${coachProvider})`);
  console.log(`   - GET  /officers`);
  console.log(`   - GET  /leads?officerId=officer_001`);
  console.log(`   - GET  /places/:placeId/live`);
  console.log(`   - PATCH /leads/:id`);
  console.log(`   - GET  /jobs/runs`);
  console.log(`   - GET  /jobs/usage`);
  console.log(`   - POST /jobs/:name/run`);
  console.log(`=======================================================`);
});
