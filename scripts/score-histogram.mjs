/**
 * Prints before/after histograms of the app's scores, to check they spread out.
 *
 *   node scripts/score-histogram.mjs [loanType]     # default car
 *
 * Before: the stored numbers (data.json priority.score, area_demand.json).
 * After:  what the server now serves (evidence-derived, ranked per officer).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace } from './mock-workspace.mjs';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const loanType = process.argv[2] || 'car';

function histogram(title, scores) {
  const bins = Array.from({ length: 10 }, (_, i) => [i * 10, i === 9 ? 100 : i * 10 + 9]);
  const counts = bins.map(([lo, hi]) => scores.filter((s) => s >= lo && s <= hi).length);
  const top = Math.max(...counts, 1);
  const sorted = [...scores].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const p85 = scores.filter((s) => s >= 85).length;
  console.log(
    `\n${title}  (n=${scores.length}, median ${med}, ${p85} at 85+ = ${Math.round((100 * p85) / scores.length)}%)`,
  );
  bins.forEach(([lo, hi], i) => {
    const bar = '█'.repeat(Math.round((counts[i] / top) * 40));
    console.log(
      `  ${String(lo).padStart(3)}–${String(hi).padEnd(3)} ${String(counts[i]).padStart(4)} ${bar}`,
    );
  });
}

const raw = read('data.json');
const officer = raw.officers[0].id;

// Start the in-process workspace (no HTTP) and read what the app gets.
const ws = createWorkspace(raw);
async function get(pathname) {
  let out;
  const url = new URL(`http://x${pathname}`);
  url.searchParams.set('officerId', officer);
  const req = {
    method: 'GET',
    url: url.pathname + url.search,
    headers: { 'x-officer-id': officer },
  };
  await ws.handle(req, {}, url, (_status, body) => (out = body));
  return out;
}

const before = raw.prospects.filter((p) => p.assignmentOfficerId === officer);
const after = (await get('/workspace')).prospects;
histogram(
  `Prospect visit priority, ${officer} — BEFORE`,
  before.map((p) => p.priority.score),
);
histogram(
  `Prospect visit priority, ${officer} — AFTER`,
  after.map((p) => p.priority.score),
);

const ppBefore = Object.entries(read('area_demand.json').communes).filter(([c]) =>
  c.startsWith('12'),
);
const ppAfter = Object.entries((await get('/area-demand?province=12')).communes);
histogram(
  `Area demand, Phnom Penh, ${loanType} — BEFORE`,
  ppBefore.map(([, d]) => d.score[loanType]),
);
histogram(
  `Area demand, Phnom Penh, ${loanType} — AFTER`,
  ppAfter.map(([, d]) => d.score[loanType]),
);
