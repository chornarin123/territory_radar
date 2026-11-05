/**
 * Adds the SAMPLE fields the Today screen needs to data/data.json. Safe to re-run:
 * same input, same file.
 *
 *   node scripts/add-today-sample-fields.mjs
 *
 * On each prospect:
 *   why_now        its main signal's title, so it can't say more than the signal does
 *   ask_about      talking points for that kind of signal
 *   first_seen_at  when a scan first saw it: this week for "new" prospects
 * On metadata:
 *   lastScanAt     the scan "first seen since" is measured from
 *   sampleFields   which fields are sample, until the real scan fills them
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/data.json');
const LAST_SCAN = '2026-10-12T08:30:00+07:00'; // Monday of the demo week
const NEW_DAYS = ['2026-10-12', '2026-10-13', '2026-10-14'];

/** Talking points per signal type; also used by add-sample-prospects.mjs. */
export const ASK_ABOUT = {
  new_branch: 'Timing of the new location, fit-out costs, how it is funded.',
  renovation: 'Scope and budget of the work, timing, how it is funded.',
  hiring: 'How many roles and why, payroll cover, plans for growth.',
  equipment_purchase: 'Equipment cost, timing, current lender.',
  inventory_growth: 'Stock cycle, supplier terms, cash-flow gaps.',
  imports: 'Supplier terms, shipment sizes, how purchases are paid.',
  purchase_order: 'Order size, payment terms, working capital needed.',
  new_opening: 'Setup costs, months trading, plans for the first year.',
  housing_project: 'Project stage, buyers or tenants, financing in place.',
  new_employer: 'Number of staff, payroll setup, staff banking needs.',
};
export const ASK_DEFAULT = 'What the business needs next, and how it is funded today.';

// Run directly, not when imported for ASK_ABOUT.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

function main() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

  let fresh = 0;
  for (const p of data.prospects) {
    // Generated sample prospects set their own (scripts/add-sample-prospects.mjs).
    if (p.id.startsWith('prospect_s')) continue;
    const signal = data.signals.find(
      (s) => s.prospectId === p.id && s.type !== 'directory_presence',
    );
    p.why_now = signal?.title ?? null;
    p.ask_about = (signal && ASK_ABOUT[signal.type]) ?? ASK_DEFAULT;
    p.first_seen_at =
      p.pipelineStatus === 'new'
        ? `${NEW_DAYS[fresh++ % NEW_DAYS.length]}T08:30:00+07:00`
        : p.createdAt;
  }

  data.metadata.lastScanAt = LAST_SCAN;
  data.metadata.sampleFields = [
    'metadata.lastScanAt',
    'prospects[].why_now',
    'prospects[].ask_about',
    'prospects[].first_seen_at',
  ];

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  console.log(`Added sample Today fields to ${data.prospects.length} prospects.`);
}
