import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app-config.service.js';
import { SCAN_CATEGORIES } from './categories.js';
import { OsmPlacesClient, OSM_TAG_FILTERS } from './osm-places.client.js';

describe('OsmPlacesClient', () => {
  let mockConfig: AppConfig;
  let client: OsmPlacesClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockConfig = {
      placesProvider: 'osm',
      overpassApiUrl: 'https://overpass-api.de/api/interpreter',
      killSwitch: false,
    } as unknown as AppConfig;

    client = new OsmPlacesClient(mockConfig);
  });

  it('covers all 12 SCAN_CATEGORIES in OSM_TAG_FILTERS', () => {
    for (const cat of SCAN_CATEGORIES) {
      expect(OSM_TAG_FILTERS[cat]).toBeDefined();
      expect(OSM_TAG_FILTERS[cat].length).toBeGreaterThan(0);
    }
  });

  describe('searchNearby', () => {
    it('queries Overpass and parses nodes and ways', async () => {
      const mockElements = [
        {
          type: 'node',
          id: 101,
          lat: 11.5564,
          lon: 104.9282,
          tags: {
            name: 'Brown Coffee',
            'name:km': 'ប្រោន កាហ្វេ',
            amenity: 'cafe',
            phone: '+855 23 215 215',
            'addr:street': 'Street 51',
          },
        },
        {
          type: 'way',
          id: 202,
          center: { lat: 11.557, lon: 104.929 },
          tags: {
            name: 'Amazon Cafe',
            amenity: 'cafe',
            website: 'https://cafe-amazon.com.kh',
          },
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ elements: mockElements }),
      } as Response);

      const places = await client.searchNearby(
        { lat: 11.5564, lng: 104.9282, radiusM: 350 },
        'cafe',
      );

      expect(places).toHaveLength(2);
      expect(places[0]).toEqual({
        placeId: 'osm:node:101',
        location: { lat: 11.5564, lng: 104.9282 },
        primaryType: 'cafe',
      });
      expect(places[1]).toEqual({
        placeId: 'osm:way:202',
        location: { lat: 11.557, lng: 104.929 },
        primaryType: 'cafe',
      });
    });

    it('handles Overpass query failures gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network offline'));

      const places = await client.searchNearby(
        { lat: 11.5564, lng: 104.9282, radiusM: 350 },
        'restaurant',
      );

      expect(places).toEqual([]);
    });
  });

  describe('fetchEnrichment & fetchLiveDetails', () => {
    it('enriches a place using cached metadata and generates reviews', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          elements: [
            {
              type: 'node',
              id: 303,
              lat: 11.56,
              lon: 104.92,
              tags: {
                name: 'Lucky Supermarket',
                shop: 'supermarket',
                website: 'https://luckymarket.com.kh',
                'addr:street': 'Sihanouk Blvd',
                'addr:housenumber': '168',
                phone: '023 215 350',
              },
            },
          ],
        }),
      } as Response);

      await client.searchNearby({ lat: 11.56, lng: 104.92, radiusM: 350 }, 'supermarket');

      const enrichment = await client.fetchEnrichment('osm:node:303');
      expect(enrichment.displayName).toBe('Lucky Supermarket');
      expect(enrichment.businessStatus).toBe('OPERATIONAL');
      expect(enrichment.hasWebOrPage).toBe(true);
      expect(enrichment.reviews.length).toBeGreaterThan(0);

      const live = await client.fetchLiveDetails('osm:node:303');
      expect(live.name).toBe('Lucky Supermarket');
      expect(live.address).toBe('168, Sihanouk Blvd');
      expect(live.phone).toBe('023 215 350');
      expect(live.googleMapsUri).toContain('11.56,104.92');
    });
  });
});
