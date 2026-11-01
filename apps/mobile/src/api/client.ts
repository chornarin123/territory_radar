import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { AreaDemand } from '../data/areaDemand';
import type { AskReply, EvidencePack } from '../data/evidence';
import type { AreaPulse } from '../data/today';
import type { AddressProvince, BoundaryCollection, BoundaryLevel } from '../data/areas';
import type {
  InterestStatus,
  Notification,
  Prospect,
  ProspectStatus,
  Task,
  Visit,
  VisitOutcome,
  Workspace,
} from '../data/types';

// The mock server (scripts/mock-server.mjs) serves the officer workspace the UI
// spec is built on. PORT in apps/api/.env, or the mock server's PORT, must match.
const API_BASE_URL = reachable(process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3002');

/**
 * On a phone, "localhost" is the phone itself. In development, swap it for the
 * address the phone reached Metro on (the computer's Wi-Fi IP from the QR code),
 * so scanning works without editing .env on every network.
 */
function reachable(url: string): string {
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (Platform.OS === 'web' || !devHost) return url;
  return url.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, `//${devHost}`);
}

// No fallback value. `EXPO_PUBLIC_*` is inlined into the bundle at build time,
// so anything written here ships inside the app — a hardcoded default is a
// published secret. Set it in apps/mobile/.env (see .env.example).
const API_KEY = process.env.EXPO_PUBLIC_API_KEY;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = text || response.statusText;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      // plain-text error
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const id = encodeURIComponent;

export const api = {
  /** Everything one officer may see. Territory scoping is enforced by the server. */
  workspace: (officerId?: string) =>
    request<Workspace>(`/workspace${officerId ? `?officerId=${id(officerId)}` : ''}`),

  markNotificationRead: (notificationId: string, read = true) =>
    patch<Notification>(`/notifications/${id(notificationId)}`, { read }),

  setTaskStatus: (taskId: string, status: Task['status']) =>
    patch<Task>(`/tasks/${id(taskId)}`, { status }),

  /** Officer action only — interest is never inferred (spec §4). */
  recordInterest: (prospectId: string, interestStatus: InterestStatus) =>
    post<Prospect>(`/prospects/${id(prospectId)}/interest`, { interestStatus }),

  /** Rejected with 409 unless data.json's stateTransitions allows it. */
  transition: (prospectId: string, to: ProspectStatus) =>
    post<Prospect>(`/prospects/${id(prospectId)}/transition`, { to }),

  /** Cambodia's provinces → districts → communes, for the area filter. */
  areas: () => request<AddressProvince[]>('/areas'),

  /** One level's polygons, GeoJSON, optionally one province. Communes are ~1.8 MB in all. */
  boundaries: (level: BoundaryLevel, province?: string) =>
    request<BoundaryCollection>(
      `/boundaries/${level}${province ? `?province=${id(province)}` : ''}`,
    ),

  /** A province's khans/districts, each outlined as the union of its communes. */
  districtOutlines: (province: string) =>
    request<BoundaryCollection>(`/outlines/districts?province=${id(province)}`),

  /** Predicted loan demand per commune in a province. Use getAreaDemand(), not this. */
  areaDemand: (province: string) => request<AreaDemand>(`/area-demand?province=${id(province)}`),

  /** Why a sangkat scores what it does for a loan type: public evidence only. */
  evidence: (code: string, loanType: string) =>
    request<EvidencePack>(`/areas/${id(code)}/evidence?loanType=${id(loanType)}`),

  /** Ask Radar. The server loads the evidence itself; only the chat text goes up. */
  askRadar: (
    code: string,
    body: { loanType: string; question: string; history: { role: string; content: string }[] },
  ) => post<AskReply>(`/areas/${id(code)}/ask`, body),

  areaFeedback: (
    code: string,
    body: { loanType: string; scanDate: string; verdict: 'agree' | 'disagree'; note?: string },
  ) => post<{ groundTruth: EvidencePack['groundTruth'] }>(`/areas/${id(code)}/feedback`, body),

  /** The biggest area-score change in the officer's sangkats; null if none is big enough. */
  areaPulse: () => request<{ pulse: AreaPulse | null }>('/area-pulse'),

  /** "Not relevant" on a new lead: stored for the next scan to learn from. */
  leadNotRelevant: (prospectId: string) =>
    post<Prospect>(`/prospects/${id(prospectId)}/lead-feedback`, { verdict: 'not_relevant' }),

  checkIn: (visitId: string) => post<Visit>(`/visits/${id(visitId)}/check-in`),

  recordVisitOutcome: (visitId: string, outcome: VisitOutcome) =>
    post<Visit>(`/visits/${id(visitId)}/outcome`, { outcome }),

  /**
   * Discussion coach. The whole chat goes each time; the server keeps nothing.
   * A 422 means the last message looked like customer details and was refused
   * before reaching any model.
   */
  coach: (prospectId: string, messages: CoachMessage[]) =>
    post<CoachReply>(`/prospects/${id(prospectId)}/coach`, {
      messages: messages.map(({ role, content }) => ({ role, content })),
    }),
};

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoachReply {
  reply: string;
  /** Which brain answered: a model, or the offline coach built from the data. */
  source: 'claude' | 'gemini' | 'offline';
  model: string | null;
  /** Why it fell back to offline, when it did. */
  notice?: string;
}
