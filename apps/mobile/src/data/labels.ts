import type { DataQualityFlag, InterestStatus, ProspectStatus } from './types';

// Label maps from design/UI_SPEC.md §2.

export const STATUS_LABEL: Record<ProspectStatus, string> = {
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

export const FLAG_LABEL: Record<DataQualityFlag, string> = {
  limited_operating_history: 'Limited history',
  missing_coordinates: 'No map pin',
  stale_evidence: 'Stale evidence',
  conflicting_address: 'Address conflict',
};

export const INTEREST_LABEL: Record<InterestStatus, string> = {
  confirmed: 'Interest confirmed',
  not_interested: 'No financing need',
  unknown: 'Interest unconfirmed',
};

export const SECTOR_LABEL: Record<string, string> = {
  food_beverage: 'Food & beverage',
  retail: 'Retail',
  manufacturing: 'Manufacturing',
  education: 'Education',
  healthcare: 'Healthcare',
  automotive: 'Automotive',
  services: 'Services',
  wholesale: 'Wholesale',
  logistics: 'Logistics',
  property_project: 'Property project',
  employer: 'Employer',
};

export const sectorLabel = (s: string) => SECTOR_LABEL[s] ?? s.replace(/_/g, ' ');

/**
 * Radar / Filters signal groups, keyed by signal.type. The prototype grouped by
 * matching words in the title; type is what data.json actually provides.
 * directory_presence is context, not a signal, so it is in no group.
 */
export type SignalGroup = 'exp' | 'equip' | 'stock' | 'newbiz' | 'other';

export const SIGNAL_GROUP_LABEL: Record<SignalGroup, string> = {
  exp: 'Expansion',
  equip: 'Equipment',
  stock: 'Stock & trade',
  newbiz: 'New opening',
  other: 'Housing & employer',
};

const SIGNAL_GROUP_OF: Record<string, SignalGroup> = {
  new_branch: 'exp',
  renovation: 'exp',
  hiring: 'exp',
  equipment_purchase: 'equip',
  inventory_growth: 'stock',
  imports: 'stock',
  purchase_order: 'stock',
  new_opening: 'newbiz',
  housing_project: 'other',
  new_employer: 'other',
};

export const signalGroupOf = (type: string): SignalGroup | null => SIGNAL_GROUP_OF[type] ?? null;

/** Pipeline stage groups used by the Filters screen. */
export type Stage = 'open' | 'visit' | 'referred' | 'stuck' | 'done';

export const STAGE_STATUSES: Record<Stage, ProspectStatus[]> = {
  open: ['new', 'contacted', 'qualified'],
  visit: ['visit_planned', 'follow_up'],
  referred: ['application_referred'],
  stuck: ['unreachable'],
  done: ['not_interested', 'closed'],
};

export const STAGE_LABEL: Record<Stage, string> = {
  open: 'New & qualifying',
  visit: 'Visit / follow-up',
  referred: 'Referred',
  stuck: 'Unreachable',
  done: 'Closed / no need',
};

export const BAND_LABEL = { high: 'High 80+', medium: 'Medium 60–79', low: 'Low < 60' } as const;

export const PRIORITY_FACTOR_LABEL = {
  signalStrength: 'Signal strength',
  freshness: 'Freshness',
  businessMaturity: 'Business maturity',
  productRelevance: 'Product relevance',
  evidenceQuality: 'Evidence quality',
} as const;

/** "Business Expansion — DEMO" → "Business Expansion". */
export const productShortName = (name: string) => name.replace(/\s+—\s+DEMO$/, '');
