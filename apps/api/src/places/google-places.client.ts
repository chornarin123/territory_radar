import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service.js';
import { UsageService } from '../usage/usage.service.js';
import type { PlacesSku } from '../usage/usage.service.js';
import type { ScanCategory } from './categories.js';
import type { BusinessStatus, ReturnedPlace } from './diff.js';
import type { CellCircle } from './grid.js';
import { backoffMs, isRetryableStatus, RateLimiter } from './rate-limiter.js';

const BASE_URL = 'https://places.googleapis.com/v1';

/** Nearby Search returns at most 20 results — a full page means the cell is saturated. */
export const NEARBY_PAGE_SIZE = 20;

/**
 * Field masks decide the SKU, which decides the bill. Keep these apart and
 * never widen the cheap one casually.
 */
export const FIELD_MASKS = {
  /** Nearby Search Pro — discovery only: who is here and where. */
  discover: 'places.id,places.location,places.primaryType',
  /** Place Details Enterprise + Atmosphere ($40/1k) — reviews is what makes it that tier. */
  enrich:
    'id,displayName,rating,userRatingCount,priceLevel,regularOpeningHours,reviews,websiteUri,nationalPhoneNumber,businessStatus',
  /** Place Details Enterprise — what the app shows an officer, fetched live. */
  live: 'id,displayName,formattedAddress,nationalPhoneNumber,googleMapsUri',
} as const;

const MAX_ATTEMPTS = 4;

export class PlacesApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Google Places API ${status}: ${message}`);
  }
}

interface GooglePlace {
  id: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  businessStatus?: BusinessStatus;
  displayName?: { text: string };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  regularOpeningHours?: { periods?: unknown[] };
  websiteUri?: string;
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
  reviews?: { text?: { text?: string }; originalText?: { text?: string } }[];
}

export interface PlaceEnrichment {
  /** In memory only: hashed for chain detection, never stored as text. */
  displayName: string | null;
  businessStatus: BusinessStatus;
  reviewCount: number | null;
  rating: number | null;
  priceLevel: number | null;
  openHours: unknown[] | null;
  hasWebOrPage: boolean;
  /** Passed to Claude, then discarded. */
  reviews: string[];
}

export interface LiveDetails {
  name: string | null;
  address: string | null;
  phone: string | null;
  googleMapsUri: string | null;
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/**
 * The only thing that talks to Google. Rate limited across all workers, retries
 * with exponential backoff, and logs every call with its SKU so the bill can be
 * reconciled against job_runs.
 */
import { OsmPlacesClient } from './osm-places.client.js';

@Injectable()
export class GooglePlacesClient {
  private readonly logger = new Logger(GooglePlacesClient.name);
  private readonly limiter: RateLimiter;

  constructor(
    private readonly config: AppConfig,
    private readonly usage: UsageService,
    private readonly osm: OsmPlacesClient,
  ) {
    this.limiter = RateLimiter.forQps(config.get('PLACES_MAX_QPS'));
  }

  /** Discovery: cheap mask (or OpenStreetMap if configured). */
  async searchNearby(cell: CellCircle, category: ScanCategory): Promise<ReturnedPlace[]> {
    if (this.config.placesProvider === 'osm') {
      return this.osm.searchNearby(cell, category);
    }

    const body = {
      includedTypes: [category],
      maxResultCount: NEARBY_PAGE_SIZE,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: { center: { latitude: cell.lat, longitude: cell.lng }, radius: cell.radiusM },
      },
    };

    const data = await this.request<{ places?: GooglePlace[] }>(
      'places:searchNearby',
      FIELD_MASKS.discover,
      'places.nearby_pro',
      { method: 'POST', body: JSON.stringify(body) },
    );

    return (data.places ?? [])
      .filter((p): p is GooglePlace & { location: { latitude: number; longitude: number } } =>
        Boolean(p.id && p.location),
      )
      .map((p) => ({
        placeId: p.id,
        location: { lat: p.location.latitude, lng: p.location.longitude },
        primaryType: p.primaryType ?? category,
      }));
  }

  /** Enrichment: the expensive mask (or OpenStreetMap with LLM review synthesis). */
  async fetchEnrichment(placeId: string): Promise<PlaceEnrichment> {
    if (this.config.placesProvider === 'osm' || placeId.startsWith('osm:')) {
      return this.osm.fetchEnrichment(placeId);
    }

    const place = await this.request<GooglePlace>(
      `places/${encodeURIComponent(placeId)}`,
      FIELD_MASKS.enrich,
      'places.details_enterprise_atmosphere',
    );

    return {
      displayName: place.displayName?.text ?? null,
      businessStatus: place.businessStatus ?? 'OPERATIONAL',
      reviewCount: place.userRatingCount ?? null,
      rating: place.rating ?? null,
      priceLevel: place.priceLevel ? (PRICE_LEVELS[place.priceLevel] ?? null) : null,
      openHours: place.regularOpeningHours?.periods ?? null,
      hasWebOrPage: Boolean(place.websiteUri),
      reviews: (place.reviews ?? [])
        .map((r) => r.text?.text ?? r.originalText?.text ?? '')
        .filter((text) => text.trim().length > 0),
    };
  }

  /** Name and address for display. NEVER persisted. */
  async fetchLiveDetails(placeId: string): Promise<LiveDetails> {
    if (this.config.placesProvider === 'osm' || placeId.startsWith('osm:')) {
      return this.osm.fetchLiveDetails(placeId);
    }

    const place = await this.request<GooglePlace>(
      `places/${encodeURIComponent(placeId)}`,
      FIELD_MASKS.live,
      'places.details_enterprise',
    );
    return {
      name: place.displayName?.text ?? null,
      address: place.formattedAddress ?? null,
      phone: place.nationalPhoneNumber ?? null,
      googleMapsUri: place.googleMapsUri ?? null,
    };
  }

  private async request<T>(
    path: string,
    fieldMask: string,
    sku: PlacesSku,
    init: RequestInit = {},
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Budget and kill switch are checked per attempt: a retry costs money too.
      await this.usage.authorize(sku);
      await this.limiter.acquire();

      const startedAt = Date.now();
      let response: Response | undefined;
      try {
        response = await fetch(`${BASE_URL}/${path}`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.config.get('GOOGLE_PLACES_API_KEY') ?? '',
            'X-Goog-FieldMask': fieldMask,
          },
        });
      } catch (err) {
        lastError = err;
      } finally {
        // Google bills the request even when it fails, so count it either way.
        await this.usage.record(sku);
      }

      const status = response?.status ?? 0;
      const ms = Date.now() - startedAt;
      this.logger.log(
        `${sku} ${path} status=${status || 'network-error'} ${ms}ms attempt=${attempt + 1}`,
      );

      if (response?.ok) return (await response.json()) as T;

      if (response && !isRetryableStatus(status)) {
        const detail = await response.text().catch(() => '');
        throw new PlacesApiError(status, detail.slice(0, 200));
      }
      if (response) {
        lastError = new PlacesApiError(status, await response.text().catch(() => ''));
      }

      if (attempt < MAX_ATTEMPTS - 1) {
        const wait = backoffMs(attempt);
        this.logger.warn(`${sku} ${path} retry in ${wait}ms after ${status || 'network error'}`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new PlacesApiError(0, 'Request failed after retries');
  }
}
