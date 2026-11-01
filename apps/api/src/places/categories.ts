/**
 * Place types we scan for. Each is a separate Nearby Search per cell, because
 * an unfiltered search in a dense street returns 20 of whatever Google ranks
 * highest and nothing else.
 *
 * Chosen for SME lending appetite — stock-heavy retail and equipment-heavy
 * services. Adding a category multiplies scan cost by cell count, so add
 * deliberately.
 */
export const SCAN_CATEGORIES = [
  'restaurant',
  'cafe',
  'convenience_store',
  'supermarket',
  'hardware_store',
  'cell_phone_store',
  'clothing_store',
  'pharmacy',
  'car_repair',
  'beauty_salon',
  'furniture_store',
  'electronics_store',
] as const;

export type ScanCategory = (typeof SCAN_CATEGORIES)[number];
