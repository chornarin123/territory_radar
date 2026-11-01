// "Why this score" evidence and Ask Radar: types and session-only chat state.
// The packs are built server-side (scripts/evidence.mjs) from public data only.

import { useCallback, useState } from 'react';
import type { LoanType } from './areaDemand';

export interface EvidenceRecord {
  name: string;
  tag: string;
  when: string;
  lat?: number;
  lng?: number;
  osmId?: string;
  /** Set when the record is one of the officer's Radar leads. */
  prospectId?: string;
}

export interface EvidenceItem {
  id: string;
  /** 0 is the baseline; evidence is cited as [n]. */
  n: number;
  title: string;
  points: number;
  line: string;
  source: string;
  sourceUrl: string | null;
  date: string;
  records: EvidenceRecord[];
  totalRecords: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface EvidencePack {
  communeCode: string;
  name: string;
  districtName: string;
  loanType: LoanType;
  score: number;
  scanDate: string;
  previousScanDate: string;
  previousScore: number | null;
  confidence: Confidence;
  signalsAvailable: number;
  signalsTotal: number;
  breakdown: EvidenceItem[];
  limitations: string[];
  sample: boolean;
  groundTruth: { agree: number; disagree: number };
}

export interface RadarAction {
  type: 'show_on_map' | 'plan_visits' | 'compare_area';
  label: string;
  communeCodes?: string[];
  prospectIds?: string[];
}

export interface AskReply {
  answer: string;
  citations: number[];
  action: RadarAction | null;
  source: 'claude' | 'gemini' | 'offline';
  notice?: string;
  /** Set for "compare with X": citations from COMPARE_OFFSET up are X's. */
  compared?: { communeCode: string; name: string };
}

/** Evidence numbers of a compared area start here (scripts/evidence.mjs). */
export const COMPARE_OFFSET = 10;

/** Records of an item that can be drawn on a map. */
export const mappable = (records: EvidenceRecord[]) =>
  records.filter((r): r is EvidenceRecord & { lat: number; lng: number } => r.lat !== undefined);

/** "Open source" target: a single record's OSM object, else the item's source. */
export function sourceLink(item: EvidenceItem): string | null {
  if (item.records.length === 1 && item.records[0]!.osmId) {
    return `https://www.openstreetmap.org/${item.records[0]!.osmId}`;
  }
  return item.sourceUrl;
}

// Phnom Penh is the Capital: khans and sangkats. Elsewhere, districts and communes.
export const communeKind = (code: string) => (code.startsWith('12') ? 'Sangkat' : 'Commune');
export const districtKind = (code: string) => (code.startsWith('12') ? 'Khan' : 'District');

// ─── Chat: per (commune, loan type), for this app session only ───────────────

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  reply?: AskReply;
}

const chats = new Map<string, ChatTurn[]>();

/** Chat history that survives closing the sheet, but not an app restart. */
export function useChat(code: string, loanType: LoanType) {
  const key = `${code}|${loanType}`;
  const [turns, setTurns] = useState<ChatTurn[]>(() => chats.get(key) ?? []);
  const update = useCallback(
    (change: (t: ChatTurn[]) => ChatTurn[]) =>
      setTurns((prev) => {
        const next = change(prev);
        chats.set(key, next);
        return next;
      }),
    [key],
  );
  return [turns, update] as const;
}
