// How well a Google place type matches PPCBank's SME lending appetite, 0..1.
// Business judgement, not data — review with the credit team, and keep it here
// (one table, versioned) rather than scattering rules through the scorer.

/** Types we never turn into leads: not businesses, or not lendable at all. */
export const EXCLUDED_TYPES = new Set([
  'atm',
  'bank',
  'bus_station',
  'cemetery',
  'church',
  'city_hall',
  'courthouse',
  'embassy',
  'fire_station',
  'hindu_temple',
  'local_government_office',
  'mosque',
  'park',
  'parking',
  'police',
  'post_office',
  'primary_school',
  'school',
  'secondary_school',
  'synagogue',
  'tourist_attraction',
  'university',
]);

const LENDABILITY: Record<string, number> = {
  // Stock-heavy retail: the clearest working-capital need.
  convenience_store: 1,
  grocery_store: 1,
  supermarket: 1,
  pharmacy: 1,
  hardware_store: 1,
  furniture_store: 0.9,
  electronics_store: 0.9,
  clothing_store: 0.9,
  jewelry_store: 0.8,
  book_store: 0.8,
  pet_store: 0.8,
  store: 0.8,
  // Food and drink: high turnover, equipment finance.
  bakery: 0.9,
  restaurant: 0.8,
  cafe: 0.8,
  coffee_shop: 0.8,
  meal_takeaway: 0.7,
  bar: 0.6,
  // Services with equipment or premises to finance.
  car_repair: 0.9,
  car_wash: 0.7,
  beauty_salon: 0.7,
  hair_care: 0.7,
  laundry: 0.7,
  gym: 0.6,
  lodging: 0.6,
  hotel: 0.6,
  // Thin margins or hard to underwrite.
  real_estate_agency: 0.4,
  travel_agency: 0.4,
  insurance_agency: 0.3,
};

/** Default for a commercial type we haven't classified yet. */
export const DEFAULT_LENDABILITY = 0.5;

export function isExcludedType(primaryType: string | null): boolean {
  return primaryType !== null && EXCLUDED_TYPES.has(primaryType);
}

/** null when the type is unknown, so the score reports it as missing data. */
export function categoryLendability(primaryType: string | null): number | null {
  if (primaryType === null) return null;
  return LENDABILITY[primaryType] ?? DEFAULT_LENDABILITY;
}
