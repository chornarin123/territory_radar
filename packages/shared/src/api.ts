// Wire types for the HTTP API. Dates are ISO strings because this is JSON.
// Business names, addresses and phone numbers are NOT here except in
// LivePlaceDetails — they are fetched from Google at display time and never stored.

import type { BusinessScale, LeadStatus } from './enums.js';
import type { FactorContribution } from './scoring.js';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface LeadScoreDto {
  scanDate: string;
  total: number;
  need: number;
  capacity: number;
  bankability: number;
  /** The three factors that drove this score, largest first. */
  topFactors: FactorContribution[];
}

export interface LeadDto {
  id: string;
  placeId: string;
  officerId: string;
  status: LeadStatus;
  assignedAt: string;
  revisitAfter: string | null;
  outcomeNote: string | null;
  /** null once Google's 30-day coordinate cache window has lapsed. */
  location: LatLng | null;
  primaryType: string | null;
  sangkatCode: string;
  /** Walking route this lead belongs to; stops share a routeId. */
  routeId: string | null;
  /** 1-based stop order within the route. */
  routePosition: number | null;
  /**
   * Claude's one-sentence Khmer opening line for the officer, derived from the
   * place's reviews. null until the reviews have been analysed. Render it with
   * truncateGraphemes, never String.slice, or Khmer clusters break apart.
   */
  summaryKm: string | null;
  businessScale: BusinessScale | null;
  score: LeadScoreDto | null;
}

export interface LeadFeedbackRequest {
  status: Exclude<LeadStatus, 'new'>;
  outcomeNote?: string;
  /** ISO date (YYYY-MM-DD). Required when status is "revisit". */
  revisitAfter?: string;
}

/** Fetched live from Google Places for display. Never persisted. */
export interface LivePlaceDetails {
  placeId: string;
  name: string | null;
  address: string | null;
  phone: string | null;
  googleMapsUri: string | null;
}

export interface OfficerDto {
  id: string;
  name: string;
  branch: string;
  assignedSangkats: string[];
}
