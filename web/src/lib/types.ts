export type EventType =
  | "NEW_LISTING"
  | "RESTOCK"
  | "PRICE_DROP"
  | "RESALE_DEAL"
  | "WENT_OUT_OF_STOCK";

export type ListingStatus = "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER" | "UNKNOWN";

export interface Shop {
  id: string;
  displayName: string;
  baseUrl: string;
  adapterType: string;
  enabled: boolean;
  pollIntervalSeconds: number;
  dropDayIntervalSeconds: number;
  lastSuccessfulRun: string | null;
  eventCount24h: number;
  online: boolean;
}

export interface Product {
  id: string;
  displayName: string;
  category: string;
  expectedReleaseDate: string | null;
  uvpEur: number | null;
  uvpToleranceEur: number;
  searchTerms: string[];
  negativeTerms: string[];
  ean: string | null;
  minResalePriceEur: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventListingSummary {
  shopId: string;
  productId: string;
  title: string;
  url: string;
  priceEur: number;
  status: ListingStatus;
}

export interface AppEvent {
  id: string;
  listingId: string;
  type: EventType;
  detail: Record<string, unknown>;
  notifiedAt: string | null;
  createdAt: string;
  listing: EventListingSummary;
}

export interface DetectedEvent {
  type: EventType;
  productId: string;
  shopId: string;
  externalId: string;
  url: string;
  title: string;
  priceEur: number;
  detail: Record<string, unknown>;
}

export interface Variant {
  id: string;
  setId: string;
  kind: string;
  displayName: string;
  uvpEur: number | null;
  uvpToleranceEur: number;
  ean: string | null;
}

export interface SetEntry {
  id: string;
  name: string;
  shortCode: string | null;
  description: string | null;
  releaseDate: string | null;
  language: string;
  era: string | null;
  searchTerms: string[];
  negativeTerms: string[];
  active: boolean;
  isPreset: boolean;
  variants: Variant[];
  createdAt: string;
  updatedAt: string;
}

export interface SetPreset {
  id: string;
  name: string;
  shortCode: string | null;
  era: string | null;
  active: boolean;
  releaseDate: string | null;
}

export interface Listing {
  id: string;
  productId: string;
  shopId: string;
  externalId: string;
  url: string;
  title: string;
  priceEur: number;
  currency: string;
  status: ListingStatus;
  seenAt: string;
}

export interface CurrentlyRunning {
  shopId: string;
  displayName: string;
  adapterType: string;
  startedAt: string | null;
  elapsedMs: number;
}

export interface RecentRun {
  shopId: string;
  displayName: string;
  adapterType: string;
  completedAt: string | null;
  durationMs: number;
  listingsFound: number;
  matched: number;
  events: number;
  newListings: number;
  restocks: number;
  online: boolean;
}

export interface HeartbeatSnapshot {
  shops: Array<{
    id: string;
    displayName: string;
    lastSuccessfulRun: string | null;
    enabled: boolean;
  }>;
  enabledCount: number;
  totalShopCount: number;
  onlineCount: number;
  offlineCount: number;
  listingCount: number;
  events24h: Array<{ type: EventType; count: number }>;
  totalEvents24h: number;
  currentlyRunning: CurrentlyRunning[];
  recentRuns: RecentRun[];
}
