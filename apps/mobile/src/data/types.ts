// Types for the officer workspace served by scripts/mock-server.mjs (GET /workspace).
// Field names mirror data/data.json exactly — design/UI_SPEC.md says not to invent any.

export type ProspectStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'visit_planned'
  | 'follow_up'
  | 'unreachable'
  | 'application_referred'
  | 'not_interested'
  | 'closed';

export type InterestStatus = 'unknown' | 'confirmed' | 'not_interested';
export type PriorityBand = 'high' | 'medium' | 'low';
export type DataQualityFlag =
  'limited_operating_history' | 'missing_coordinates' | 'stale_evidence' | 'conflicting_address';
export type Locale = 'en' | 'km';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PriorityFactors {
  signalStrength: number;
  freshness: number;
  businessMaturity: number;
  productRelevance: number;
  evidenceQuality: number;
}

export interface Prospect {
  id: string;
  displayName: string;
  entityType: string;
  sector: string;
  borrowerType: string;
  isSynthetic: boolean;
  assignmentOfficerId: string;
  territoryPathIds: string[];
  address: {
    display: string;
    villageId: string | null;
    communeId: string | null;
    districtId: string | null;
    provinceId: string | null;
    isApproximate: boolean;
    /** Official codes the pin falls in, added by the server (scripts/area-codes.mjs). */
    communeCode: string | null;
    districtCode: string | null;
    provinceCode: string | null;
    communeName: string | null;
  };
  location: (LatLng & { accuracy: string }) | null;
  businessProfile: {
    operatingMonths: number | null;
    operatingMonthsBasis: string;
    operatingStatus: string;
  };
  contact: {
    name: string | null;
    role: string | null;
    phone: string | null;
    email: string | null;
    canCall: boolean;
    consentToContact: string;
  };
  /** Sample until the real scan fills them: see metadata.sampleFields. */
  why_now: string | null;
  ask_about: string;
  first_seen_at: string;
  /** Set when the officer marked a new lead "Not relevant". */
  lead_feedback?: { verdict: 'not_relevant'; at: string };
  pipelineStatus: ProspectStatus;
  dispositionReason: string | null;
  financing: {
    interestStatus: InterestStatus;
    interestSource: string | null;
    interestRecordedAt: string | null;
    note: string | null;
  };
  priority: {
    score: number;
    band: PriorityBand;
    scoreType: string;
    factors: PriorityFactors;
    maxPoints: PriorityFactors;
    explanation: string;
  };
  signalIds: string[];
  recommendedProductIds: string[];
  tags: string[];
  dataQuality: {
    flags: DataQualityFlag[];
    lastVerifiedAt: string | null;
    requiresOfficerVerification: boolean;
  };
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
}

export interface Signal {
  id: string;
  prospectId: string;
  type: string;
  evidenceIds: string[];
  title: string;
  detectedAt: string;
  eventDate: string;
  strength: 'weak' | 'moderate' | 'strong';
  freshness: 'fresh' | 'stale';
  interpretation: string;
  limitations: string[];
}

export interface Evidence {
  id: string;
  prospectId: string;
  sourceType: string;
  sourceName: string;
  publishedAt: string;
  observedAt: string;
  title: string;
  verificationStatus: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  isDemo: boolean;
  disclaimer: string;
}

export interface ProductMatch {
  id: string;
  prospectId: string;
  productId: string;
  rank: number;
  fitLabel: string;
  reason: string;
  unverifiedRequirements: string[];
  discoveryQuestions: string[];
  suggestedOpening: string;
  isEligibilityDecision: boolean;
}

export interface Activity {
  id: string;
  prospectId: string;
  officerId: string | null;
  type: string;
  occurredAt: string;
  note: string;
}

export interface Task {
  id: string;
  prospectId: string;
  officerId: string;
  type: string;
  title: string;
  description: string;
  dueAt: string;
  status: 'open' | 'done';
  priority: string;
  completedAt: string | null;
}

export type VisitOutcome = 'interested' | 'follow_up' | 'no_need';

export interface Visit {
  id: string;
  prospectId: string;
  officerId: string;
  status: 'planned' | 'in_progress' | 'completed';
  scheduledStartAt: string;
  durationMinutes: number;
  objective: string;
  contactConfirmed: boolean;
  checkedInAt: string | null;
  completedAt: string | null;
  outcome: VisitOutcome | null;
  locationVerified: boolean;
}

export interface RoutePlan {
  id: string;
  officerId: string;
  date: string;
  name: string;
  status: string;
  startLocation: LatLng;
  visitIds: string[];
  optimizationStatus: string;
}

export interface Notification {
  id: string;
  officerId: string;
  type: string;
  title: string;
  body: string;
  prospectId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface AdministrativeArea {
  id: string;
  level: 'province' | 'district' | 'commune' | 'village';
  nameEn: string;
  nameKm: string;
  parentId: string | null;
}

export interface Officer {
  id: string;
  displayName: string;
  role: string;
  branchId: string;
  email: string;
  preferredLocale: Locale;
  avatarInitials: string;
}

export interface Settings {
  defaultProspectFilter: { activeOnly: boolean; minScore: number; interest: string };
  excludeNotInterestedFromRecommendations: boolean;
  autoConfirmFinancingInterest: boolean;
  allowExternalContactActions: boolean;
  showSyntheticDataBanner: boolean;
  mapDefaultCenter: LatLng;
  mapDefaultZoom: number;
}

export interface Workspace {
  metadata: {
    asOf: string;
    timezone: string;
    fixedClock: boolean;
    isSynthetic: boolean;
    /** The scan "new since" is measured from. */
    lastScanAt: string;
    sampleFields: string[];
    defaultOfficerId: string;
    translationCoverage: Record<Locale, string>;
    disclaimer: string;
  };
  settings: Settings;
  uiCopy: Record<Locale, Record<string, string>>;
  stateTransitions: Record<ProspectStatus, ProspectStatus[]>;
  officer: Officer;
  branch: { id: string; name: string; location: LatLng } | null;
  territoryAssignments: { id: string; rootAreaIds: string[]; effectiveFrom: string }[];
  administrativeAreas: AdministrativeArea[];
  products: Product[];
  prospects: Prospect[];
  signals: Signal[];
  evidence: Evidence[];
  productMatches: ProductMatch[];
  activities: Activity[];
  tasks: Task[];
  visits: Visit[];
  routePlans: RoutePlan[];
  notifications: Notification[];
}
