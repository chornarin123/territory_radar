// Single source for enum values: the API's Drizzle pgEnums are built from these
// arrays, so the database, the API and the app can't drift apart.

export const PLACE_STATUSES = ['active', 'missing', 'closed'] as const;
export type PlaceStatus = (typeof PLACE_STATUSES)[number];

export const SIGNAL_TYPES = [
  // Detected from scans and snapshots — these four feed the scoring formula.
  'new_opening',
  'velocity_spike',
  'low_stock',
  'hours_extended',
  // Extracted from reviews by Claude. Stored and shown to officers; not yet
  // weighted in scoreLead (see docs/scoring.md).
  'expansion',
  'second_branch',
  'renovation',
  'long_queue',
  'price_increase',
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const LEAD_STATUSES = ['new', 'visited', 'won', 'declined', 'revisit'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const BUSINESS_SCALES = ['micro', 'small', 'medium'] as const;
export type BusinessScale = (typeof BUSINESS_SCALES)[number];
